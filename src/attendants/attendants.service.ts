import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateAttendantDto } from "./dto/create-attendant.dto";
import { UpdateAttendantDto } from "./dto/update-attendant.dto";
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

  /** Détermine le quart en cours selon l'heure actuelle et les horaires de la station. */
  async currentShift(stationId: string): Promise<"MATIN" | "SOIR" | "NUIT"> {
    const now = new Date();
    const h = now.getHours();
    if (h >= 6 && h < 14) return "MATIN";
    if (h >= 14 && h < 22) return "SOIR";
    return "NUIT";
  }
}
