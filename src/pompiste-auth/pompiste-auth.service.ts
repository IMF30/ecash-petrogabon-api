import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PompisteLoginDto } from "./dto/pompiste-login.dto";
import { PompisteJwtPayload } from "./types";

/**
 * Authentification par code PIN pour l'espace pompiste — volontairement distincte
 * du système de comptes Utilisateur (AuthService) : un Attendant n'est pas un User,
 * et le PIN est un facteur plus faible (4-6 chiffres) adapté à une saisie fréquente
 * sur le terrain, pas à un compte protégeant des droits d'administration.
 */
@Injectable()
export class PompisteAuthService {
  private static readonly MAX_FAILED_ATTEMPTS = 5;
  private static readonly LOCKOUT_DURATION_MS = 15 * 60_000;
  private static readonly TOKEN_TTL = "12h";

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly auditService: AuditService,
  ) {}

  // Même technique que AuthService.getDummyHash : un temps de réponse constant, que
  // l'identifiant existe ou non, pour ne pas permettre d'énumérer les pompistes/stations.
  private dummyHash: string | null = null;
  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash(randomBytes(32).toString("hex"));
    }
    return this.dummyHash;
  }

  async stationsActives() {
    return this.prisma.station.findMany({
      where: { statut: "EN_SERVICE" },
      select: { id: true, nom: true, code: true },
      orderBy: { nom: "asc" },
    });
  }

  async attendantsActifs(stationId: string) {
    return this.prisma.attendant.findMany({
      where: { stationId, statut: "ACTIF" },
      select: { id: true, prenom: true, nom: true },
      orderBy: { nom: "asc" },
    });
  }

  async login(dto: PompisteLoginDto) {
    const attendant = await this.prisma.attendant.findUnique({ where: { id: dto.attendantId } });

    if (attendant && attendant.pinLockedUntil && attendant.pinLockedUntil > new Date()) {
      throw new UnauthorizedException("Accès temporairement verrouillé suite à plusieurs codes PIN erronés. Réessayez plus tard.");
    }

    const pinValide = await argon2.verify(attendant?.pinHash ?? (await this.getDummyHash()), dto.pin);
    const stationCorrespond = attendant?.stationId === dto.stationId;

    if (!attendant || !attendant.pinHash || !pinValide || !stationCorrespond) {
      if (attendant && attendant.pinHash) {
        const attempts = attendant.pinFailedAttempts + 1;
        const verrouille = attempts >= PompisteAuthService.MAX_FAILED_ATTEMPTS;
        await this.prisma.attendant.update({
          where: { id: attendant.id },
          data: {
            pinFailedAttempts: verrouille ? 0 : attempts,
            pinLockedUntil: verrouille ? new Date(Date.now() + PompisteAuthService.LOCKOUT_DURATION_MS) : null,
          },
        });
      }
      throw new UnauthorizedException("Pompiste ou code PIN incorrect.");
    }

    if (attendant.statut !== "ACTIF") {
      throw new UnauthorizedException("Ce compte pompiste est désactivé.");
    }

    await this.prisma.attendant.update({
      where: { id: attendant.id },
      data: { pinFailedAttempts: 0, pinLockedUntil: null },
    });

    // Le PIN est régénéré à chaque ouverture de quart (voir CashEntriesService.create) — s'il n'y
    // a plus de quart EN_COURS impliquant ce pompiste, le code encore valide n'a plus lieu d'ouvrir
    // l'accès : son quart est terminé, rien à y déclarer.
    const quartImplique = await this.prisma.cashEntry.findFirst({
      where: {
        stationId: attendant.stationId,
        statut: "EN_COURS",
        OR: [
          { responsableQuartId: attendant.id },
          { responsableGplId: attendant.id },
          { pumpReadings: { some: { attendantId: attendant.id } } },
        ],
      },
      select: { id: true },
    });
    if (!quartImplique) {
      throw new UnauthorizedException("Désolé, votre quart est déjà clôturé !");
    }

    const payload: PompisteJwtPayload = { sub: attendant.id, stationId: attendant.stationId, type: "POMPISTE" };
    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_POMPISTE_SECRET,
      expiresIn: PompisteAuthService.TOKEN_TTL,
    });

    await this.auditService.record({
      categorie: "CONNEXION",
      action: "Connexion espace pompiste",
      detail: `${attendant.prenom} ${attendant.nom}`,
      acteurUserId: null,
      acteurLabel: `${attendant.prenom} ${attendant.nom} (pompiste)`,
      stationId: attendant.stationId,
    });

    return {
      accessToken,
      pompiste: { id: attendant.id, prenom: attendant.prenom, nom: attendant.nom, stationId: attendant.stationId },
    };
  }
}
