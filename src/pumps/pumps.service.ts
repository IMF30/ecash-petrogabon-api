import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreatePumpDto } from "./dto/create-pump.dto";
import { UpdatePumpDto } from "./dto/update-pump.dto";
import { JwtPayload } from "../auth/types";

@Injectable()
export class PumpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(stationId: string | undefined, actor: JwtPayload) {
    // Une GERANTE est cantonnée à sa propre station, quel que soit le stationId demandé.
    const scopedStationId = actor.role === "GERANTE" ? actor.stationId ?? undefined : stationId;
    return this.prisma.pump.findMany({
      where: scopedStationId ? { stationId: scopedStationId } : undefined,
      orderBy: { code: "asc" },
    });
  }

  async create(dto: CreatePumpDto, actor: JwtPayload) {
    // GERANTE : la station cible est imposée, pas celle envoyée dans le corps de la requête.
    const stationId = actor.role === "GERANTE" ? actor.stationId ?? dto.stationId : dto.stationId;

    const distributeur = await this.prisma.distributeur.findUnique({ where: { id: dto.distributeurId } });
    if (!distributeur || distributeur.stationId !== stationId) {
      throw new BadRequestException("Ce distributeur ne fait pas partie de cette station.");
    }

    // Le code de pompe n'est unique que par station (clé composite) : la même valeur
    // peut donc exister sur une autre station sans provoquer de conflit.
    const existing = await this.prisma.pump.findUnique({
      where: { stationId_code: { stationId, code: dto.code } },
    });
    if (existing) throw new ConflictException("Une pompe avec ce code existe déjà pour cette station.");

    const created = await this.prisma.pump.create({
      data: { code: dto.code, produit: dto.produit, stationId, distributeurId: dto.distributeurId },
    });
    await this.auditService.record({
      categorie: "STATION",
      action: "Pompe créée",
      detail: `${created.code} (${created.produit}) — ${distributeur.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.stationId,
    });
    return created;
  }

  async update(id: string, dto: UpdatePumpDto, actor: JwtPayload) {
    const pump = await this.prisma.pump.findUnique({ where: { id } });
    if (!pump) throw new NotFoundException("Pompe introuvable.");
    if (actor.role === "GERANTE" && pump.stationId !== actor.stationId) {
      throw new ForbiddenException("Cette pompe ne concerne pas votre station.");
    }
    if (dto.distributeurId) {
      const distributeur = await this.prisma.distributeur.findUnique({ where: { id: dto.distributeurId } });
      if (!distributeur || distributeur.stationId !== pump.stationId) {
        throw new BadRequestException("Ce distributeur ne fait pas partie de cette station.");
      }
    }
    const updated = await this.prisma.pump.update({ where: { id }, data: dto });
    await this.auditService.record({
      categorie: "STATION",
      action: "Pompe modifiée",
      detail: `${updated.code} (${updated.produit}) — ${describeChanges(pump, dto)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.stationId,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const pump = await this.prisma.pump.findUnique({
      where: { id },
      include: { pumpReadings: { select: { id: true }, take: 1 } },
    });
    if (!pump) throw new NotFoundException("Pompe introuvable.");
    if (actor.role === "GERANTE" && pump.stationId !== actor.stationId) {
      throw new ForbiddenException("Cette pompe ne concerne pas votre station.");
    }
    if (pump.pumpReadings.length > 0) {
      throw new BadRequestException(
        "Cette pompe a déjà été utilisée dans un quart — désactivez-la plutôt que de la supprimer, pour ne pas perdre l'historique.",
      );
    }
    await this.prisma.pump.delete({ where: { id } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Pompe supprimée",
      detail: `${pump.code} (${pump.produit})`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: pump.stationId,
    });
    return { id };
  }
}
