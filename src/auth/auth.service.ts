import { ConflictException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { JwtPayload } from "./types";
import { UpdateProfileDto } from "./dto/update-profile.dto";

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
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // Hash de leurre calculé une seule fois (paresseusement) pour que login() puisse
  // toujours appeler argon2.verify, que l'identifiant existe ou non — sans ça, un
  // identifiant inconnu répondait sensiblement plus vite qu'un mot de passe faux sur
  // un compte réel (argon2.verify est une opération volontairement coûteuse), ce qui
  // permettait d'énumérer les identifiants valides par mesure du temps de réponse.
  private dummyHash: string | null = null;
  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash(randomBytes(32).toString("hex"));
    }
    return this.dummyHash;
  }

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

    // Verrouillage par compte : le débit-limitage par IP (@Throttle sur /auth/login,
    // 5/min) ne protège pas contre un attaquant distribuant ses tentatives sur
    // plusieurs IP pour viser un seul compte. Après AuthService.MAX_FAILED_ATTEMPTS
    // échecs consécutifs, le compte est bloqué pendant AuthService.LOCKOUT_DURATION_MS,
    // indépendamment de la provenance des requêtes.
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException("Compte temporairement verrouillé suite à plusieurs échecs de connexion. Réessayez plus tard.");
    }

    // argon2.verify compare le mot de passe fourni au hash stocké (argon2, calculé
    // dans changePassword ci-dessous). Le message d'erreur reste volontairement
    // identique que l'identifiant soit inconnu ou le mot de passe faux, pour ne
    // pas révéler quels identifiants existent. On appelle systématiquement
    // argon2.verify (sur un hash de leurre si l'identifiant n'existe pas) pour que
    // le temps de réponse ne le révèle pas non plus (cf. getDummyHash ci-dessus).
    const motDePasseValide = await argon2.verify(user?.passwordHash ?? await this.getDummyHash(), password);
    if (!user || !motDePasseValide) {
      if (user) {
        const attempts = user.failedLoginAttempts + 1;
        const verrouille = attempts >= AuthService.MAX_FAILED_ATTEMPTS;
        await this.prisma.user.update({
          where: { id: user.id },
          data: {
            failedLoginAttempts: verrouille ? 0 : attempts,
            lockedUntil: verrouille ? new Date(Date.now() + AuthService.LOCKOUT_DURATION_MS) : null,
          },
        });
      }
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

    await this.prisma.user.update({
      where: { id: user.id },
      data: { derniereConnexion: new Date(), failedLoginAttempts: 0, lockedUntil: null },
    });
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

    // Un compte désactivé après coup (licenciement, compte compromis...) ne doit plus
    // pouvoir prolonger sa session via /auth/refresh — sans ce contrôle, seul login()
    // vérifiait le statut, et un refresh token déjà émis restait valide jusqu'à son
    // expiration (7 jours par défaut) même après désactivation du compte.
    if (stored.user.statut !== "ACTIF") {
      await this.prisma.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException("Ce compte est désactivé.");
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

  /**
   * Révoque tous les refresh tokens actifs d'un utilisateur — à appeler chaque fois
   * qu'une session existante ne doit plus pouvoir se prolonger : désactivation du
   * compte ou changement de mot de passe (par l'intéressé ou par un Administrateur).
   * Le jeton d'accès en cours (JWT sans état) reste valide jusqu'à sa propre expiration
   * (15 min par défaut) — seule la capacité à en obtenir un nouveau est coupée.
   */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
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

    // Note : on ne révoque pas les refresh tokens ici (contrairement à la réinitialisation
    // par un Administrateur dans UsersService.update). Le flux de changement de mot de passe
    // obligatoire (changer-mot-de-passe/page.tsx) appelle /auth/refresh juste après ce succès
    // pour obtenir un JWT à jour (mustChangePassword: false) — une révocation ici casserait
    // cet enchaînement. L'utilisateur connaît déjà l'ancien mot de passe pour arriver ici,
    // ce qui limite le risque par rapport à une réinitialisation forcée par un tiers.

    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: "Mot de passe modifié",
      detail: `${user.prenom} ${user.nom}`,
      acteurUserId: user.id,
      acteurLabel: user.role,
      stationId: user.stationId,
    });
  }

  /**
   * Auto-modification du profil (prénom/nom/téléphone/email) par l'utilisateur
   * lui-même — distinct de UsersService.update, réservé aux Administrateurs, qui
   * porte en plus le rôle/la station/le statut du compte.
   */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const before = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!before) throw new UnauthorizedException("Utilisateur introuvable.");

    let updated;
    try {
      updated = await this.prisma.user.update({
        where: { id: userId },
        data: { prenom: dto.prenom, nom: dto.nom, email: dto.email, telephone: dto.telephone },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Cet email est déjà utilisé par un autre compte.");
      }
      throw e;
    }

    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: "Profil modifié",
      detail: describeChanges(before, dto),
      acteurUserId: updated.id,
      acteurLabel: updated.role,
      stationId: updated.stationId,
    });

    return {
      id: updated.id,
      prenom: updated.prenom,
      nom: updated.nom,
      identifiant: updated.identifiant,
      email: updated.email,
      telephone: updated.telephone,
      role: updated.role,
      stationId: updated.stationId,
      mustChangePassword: updated.mustChangePassword,
    };
  }
}
