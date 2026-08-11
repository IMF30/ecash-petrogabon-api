import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { JwtPayload } from "./types";

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  private signAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as any,
    });
  }

  private async issueRefreshToken(userId: string): Promise<string> {
    const raw = randomBytes(48).toString("hex");
    const days = Number(process.env.JWT_REFRESH_TTL_DAYS ?? 7);
    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return raw;
  }

  async login(identifiant: string, password: string) {
    const user = await this.prisma.user.findUnique({ where: { identifiant } });

    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      await this.auditService.record({
        categorie: "CONNEXION",
        action: "Échec d'authentification",
        detail: `Identifiant tenté : ${identifiant}`,
        acteurUserId: null,
        acteurLabel: identifiant,
        stationId: null,
      });
      throw new UnauthorizedException("Identifiant ou mot de passe incorrect.");
    }

    if (user.statut === "INACTIF") {
      throw new UnauthorizedException("Ce compte est désactivé.");
    }

    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      stationId: user.stationId,
      mustChangePassword: user.mustChangePassword,
    };
    const accessToken = this.signAccessToken(payload);
    const refreshToken = await this.issueRefreshToken(user.id);

    await this.prisma.user.update({ where: { id: user.id }, data: { derniereConnexion: new Date() } });
    await this.auditService.record({
      categorie: "CONNEXION",
      action: "Connexion réussie",
      detail: `${user.prenom} ${user.nom} (${user.role})`,
      acteurUserId: user.id,
      acteurLabel: `${user.prenom} ${user.nom}`,
      stationId: user.stationId,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        prenom: user.prenom,
        nom: user.nom,
        identifiant: user.identifiant,
        email: user.email,
        role: user.role,
        stationId: user.stationId,
        mustChangePassword: user.mustChangePassword,
      },
    };
  }

  async refresh(rawRefreshToken: string) {
    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException("Session expirée, veuillez vous reconnecter.");
    }

    await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });

    const payload: JwtPayload = {
      sub: stored.user.id,
      role: stored.user.role,
      stationId: stored.user.stationId,
      mustChangePassword: stored.user.mustChangePassword,
    };
    const accessToken = this.signAccessToken(payload);
    const refreshToken = await this.issueRefreshToken(stored.user.id);
    return { accessToken, refreshToken };
  }

  async logout(rawRefreshToken: string | undefined) {
    if (!rawRefreshToken) return;
    const tokenHash = hashToken(rawRefreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await argon2.verify(user.passwordHash, currentPassword))) {
      throw new UnauthorizedException("Mot de passe actuel incorrect.");
    }

    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, mustChangePassword: false },
    });

    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: "Mot de passe modifié",
      detail: `${user.prenom} ${user.nom}`,
      acteurUserId: user.id,
      acteurLabel: user.role,
      stationId: user.stationId,
    });
  }
}
