import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateStationDto } from "./dto/create-station.dto";
import { UpdateStationDto } from "./dto/update-station.dto";
import { JwtPayload } from "../auth/types";

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.station.findMany({ orderBy: { code: "asc" } });
  }

  async findOne(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw new NotFoundException("Station introuvable.");
    return station;
  }

  async create(dto: CreateStationDto, actor: JwtPayload) {
    const created = await this.prisma.station.create({ data: dto });
    await this.auditService.record({
      categorie: "STATION",
      action: "Station créée",
      detail: `${created.code} — ${created.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.id,
    });
    return created;
  }

  async update(id: string, dto: UpdateStationDto, actor: JwtPayload) {
    await this.findOne(id);
    const updated = await this.prisma.station.update({ where: { id }, data: dto });
    await this.auditService.record({
      categorie: "STATION",
      action: "Station modifiée",
      detail: `${updated.code} — ${updated.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.id,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const station = await this.findOne(id);
    await this.prisma.station.delete({ where: { id } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Station supprimée",
      detail: `${station.code} — ${station.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return { id };
  }
}
