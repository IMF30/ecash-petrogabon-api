import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateAttendantDto } from "./dto/create-attendant.dto";
import { UpdateAttendantDto } from "./dto/update-attendant.dto";
import { SetPinDto } from "./dto/set-pin.dto";
import { genererCodesPinUniques } from "./pin-generator";
import { JwtPayload } from "../auth/types";

@Injectable()
export class AttendantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(stationId: string | undefined, actor: JwtPayload) {
    // Une GERANTE ne voit que sa propre station : le paramètre stationId reçu est ignoré
    // à son profit pour empêcher un accès aux pompistes d'une autre station via la query string.
    const scopedStationId = actor.role === "GERANTE" ? actor.stationId ?? undefined : stationId;
    return this.prisma.attendant.findMany({
      where: scopedStationId ? { stationId: scopedStationId } : undefined,
      orderBy: { nom: "asc" },
    });
  }

  async findOne(id: string, actor: JwtPayload) {
    const attendant = await this.prisma.attendant.findUnique({ where: { id } });
    if (!attendant) throw new NotFoundException("Pompiste introuvable.");
    if (actor.role === "GERANTE" && attendant.stationId !== actor.stationId) {
      throw new ForbiddenException("Ce pompiste ne concerne pas votre station.");
    }
    return attendant;
  }

  async create(dto: CreateAttendantDto, actor: JwtPayload) {
    // Même règle qu'au-dessus : la station de la GERANTE prime sur celle du corps de la requête,
    // pour qu'elle ne puisse pas créer un pompiste rattaché à une autre station.
    const stationId = actor.role === "GERANTE" ? actor.stationId ?? dto.stationId : dto.stationId;
    const created = await this.prisma.attendant.create({
      data: { ...dto, stationId, embauche: new Date(dto.embauche) },
    });
    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Pompiste créé",
      detail: `${created.prenom} ${created.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.stationId,
    });
    return created;
  }

  async update(id: string, dto: UpdateAttendantDto, actor: JwtPayload) {
    const before = await this.findOne(id, actor);

    // La GERANTE peut réaffecter le quart de ses pompistes (gestion courante du planning),
    // mais ne peut toucher à aucun autre champ (rôle réservé à l'ADMINISTRATEUR : identité,
    // statut, rattachement à une station...).
    if (actor.role === "GERANTE") {
      const { quart, ...autresChamps } = dto;
      if (Object.values(autresChamps).some((v) => v !== undefined)) {
        throw new ForbiddenException("Vous ne pouvez modifier que le quart assigné à ce pompiste.");
      }
      dto = { quart };
    }

    const updated = await this.prisma.attendant.update({
      where: { id },
      data: { ...dto, embauche: dto.embauche ? new Date(dto.embauche) : undefined },
    });
    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Pompiste modifié",
      detail: `${updated.prenom} ${updated.nom} — ${describeChanges(before, dto)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.stationId,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const attendant = await this.findOne(id, actor);

    // Sans ce contrôle, une contrainte de clé étrangère en base ferait échouer la suppression
    // avec une erreur 500 générique dès que ce pompiste a déjà un relevé ou un versement.
    const [pumpReadings, versements, responsableQuart, responsableGpl] = await Promise.all([
      this.prisma.pumpReading.count({ where: { attendantId: id } }),
      this.prisma.versementProduit.count({ where: { attendantId: id } }),
      this.prisma.cashEntry.count({ where: { responsableQuartId: id } }),
      this.prisma.cashEntry.count({ where: { responsableGplId: id } }),
    ]);
    if (pumpReadings + versements + responsableQuart + responsableGpl > 0) {
      throw new BadRequestException(
        "Ce pompiste a déjà des relevés ou des versements enregistrés — désactivez-le plutôt (statut Inactif) pour ne pas perdre l'historique.",
      );
    }

    await this.prisma.attendant.delete({ where: { id } });
    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Pompiste supprimé",
      detail: `${attendant.prenom} ${attendant.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: attendant.stationId,
    });
    return { id };
  }

  /**
   * Définit ou réinitialise le code PIN d'accès à l'espace pompiste (auto-déclaration
   * des remises/ventes Gaz, cf. PompisteAuthModule). Réservé à l'Administrateur et à la
   * Gérante de la station concernée — même portée que les autres actions de gestion du
   * personnel.
   */
  async setPin(id: string, dto: SetPinDto, actor: JwtPayload) {
    const attendant = await this.findOne(id, actor);
    const pinHash = await argon2.hash(dto.pin);
    await this.prisma.attendant.update({
      where: { id },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Code PIN pompiste défini",
      detail: `${attendant.prenom} ${attendant.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: attendant.stationId,
    });
    return { ok: true };
  }

  /**
   * Régénère un code PIN à la demande (hors ouverture de quart) — ex. pompiste qui a oublié
   * son code en cours de service. Contrairement à setPin, le code est généré par le serveur
   * (jamais choisi par l'appelant) pour garder la même garantie de hasard que la génération
   * automatique à l'ouverture de quart.
   */
  async regenererPin(id: string, actor: JwtPayload) {
    const attendant = await this.findOne(id, actor);
    const [pin] = genererCodesPinUniques(1);
    const pinHash = await argon2.hash(pin);
    await this.prisma.attendant.update({
      where: { id },
      data: { pinHash, pinFailedAttempts: 0, pinLockedUntil: null },
    });
    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Code PIN pompiste régénéré",
      detail: `${attendant.prenom} ${attendant.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: attendant.stationId,
    });
    return { pin };
  }

  /** Détermine le quart en cours selon l'heure actuelle et les horaires de la station. */
  async currentShift(stationId: string): Promise<"MATIN" | "SOIR" | "NUIT"> {
    const now = new Date();
    const h = now.getHours();
    if (h >= 6 && h < 14) return "MATIN";
    if (h >= 14 && h < 22) return "SOIR";
    return "NUIT";
  }
}
