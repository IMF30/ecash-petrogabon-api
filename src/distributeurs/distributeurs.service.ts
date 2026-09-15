import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateDistributeurDto } from "./dto/create-distributeur.dto";
import { UpdateDistributeurDto } from "./dto/update-distributeur.dto";
import { JwtPayload } from "../auth/types";

@Injectable()
export class DistributeursService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(stationId: string | undefined, actor: JwtPayload) {
    // Une GERANTE est cantonnée à sa propre station, quel que soit le stationId demandé.
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    return this.prisma.distributeur.findMany({
      where: scopedStationId ? { stationId: scopedStationId } : undefined,
      include: { pumps: { orderBy: { code: "asc" } } },
      orderBy: { nom: "asc" },
    });
  }

  async create(dto: CreateDistributeurDto, actor: JwtPayload) {
    // GERANTE : la station cible est imposée, pas celle envoyée dans le corps de la requête.
    const stationId = actor.role === "GERANTE" ? (actor.stationId ?? dto.stationId) : dto.stationId;

    const existing = await this.prisma.distributeur.findUnique({
      where: { stationId_nom: { stationId, nom: dto.nom } },
    });
    if (existing) throw new ConflictException("Un distributeur avec ce nom existe déjà pour cette station.");

    const created = await this.prisma.distributeur.create({ data: { nom: dto.nom, stationId } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Distributeur créé",
      detail: created.nom,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.stationId,
    });
    return { ...created, pumps: [] };
  }

  async update(id: string, dto: UpdateDistributeurDto, actor: JwtPayload) {
    const distributeur = await this.prisma.distributeur.findUnique({ where: { id } });
    if (!distributeur) throw new NotFoundException("Distributeur introuvable.");
    if (actor.role === "GERANTE" && distributeur.stationId !== actor.stationId) {
      throw new ForbiddenException("Ce distributeur ne concerne pas votre station.");
    }
    const ancienNom = distributeur.nom;
    const updated = await this.prisma.distributeur.update({ where: { id }, data: { nom: dto.nom } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Distributeur renommé",
      detail: `${ancienNom} → ${updated.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.stationId,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const distributeur = await this.prisma.distributeur.findUnique({
      where: { id },
      include: { pumps: true },
    });
    if (!distributeur) throw new NotFoundException("Distributeur introuvable.");
    if (actor.role === "GERANTE" && distributeur.stationId !== actor.stationId) {
      throw new ForbiddenException("Ce distributeur ne concerne pas votre station.");
    }
    if (distributeur.pumps.length > 0) {
      throw new BadRequestException(
        "Ce distributeur contient encore des pompes — réaffectez-les à un autre distributeur avant de le supprimer.",
      );
    }
    await this.prisma.distributeur.delete({ where: { id } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Distributeur supprimé",
      detail: distributeur.nom,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: distributeur.stationId,
    });
    return { id };
  }
}
