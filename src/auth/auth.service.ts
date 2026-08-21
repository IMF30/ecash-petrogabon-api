import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { JwtPayload } from "./types";

// Le refresh token brut n'est jamais stocké en base : seul son empreinte SHA-256
// l'est, afin qu'une fuite de la base ne permette pas de réutiliser les jetons.
function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Authentification par double jeton : un access token JWT à courte durée de vie
 * (vérifiable hors ligne, sans base de données) et un refresh token opaque
 * stocké côté serveur (hashé) pour pouvoir être révoqué ou tourné à chaque usage.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // Jeton d'accès : courte durée de vie (15 min par défaut) car il est auto-suffisant
  // (vérifié par simple signature, sans aller en base) — le limiter dans le temps
  // borne les dégâts s'il est un jour intercepté.
  private signAccessToken(payload: JwtPayload): string {
    return this.jwtService.sign(payload, {
      secret: process.env.JWT_ACCESS_SECRET,
      expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as any,
    });
  }

  // Jeton de rafraîchissement : longue durée de vie (7 jours par défaut) mais tracé
  // en base (table refreshToken), ce qui permet de le révoquer (logout, rotation)
  // contrairement au jeton d'accès qui reste valide jusqu'à son expiration.
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

    // argon2.verify compare le mot de passe fourni au hash stocké (argon2, calculé
    // dans changePassword ci-dessous). Le message d'erreur reste volontairement
    // identique que l'identifiant soit inconnu ou le mot de passe faux, pour ne
    // pas révéler quels identifiants existent.
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

    // mustChangePassword est recopié dans le payload et renvoyé au frontend :
    // il force l'affichage d'un écran de changement de mot de passe obligatoire
    // (ex. compte créé par un Administrateur avec un mot de passe provisoire),
    // sans bloquer la connexion elle-même.
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

    // Rotation : le refresh token utilisé est révoqué immédiatement et remplacé
    // par un nouveau. Cela empêche un jeton volé d'être réutilisé indéfiniment
    // et permet de détecter un rejeu (le jeton révoqué ne sera plus jamais valide).
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

    // argon2.hash génère un nouveau hash (sel aléatoire inclus) : c'est la seule
    // façon dont un mot de passe est écrit en base dans l'application.
    const passwordHash = await argon2.hash(newPassword);
    await this.prisma.user.update({
      where: { id: userId },
      // mustChangePassword repasse à false : l'obligation de changement initial est levée.
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
