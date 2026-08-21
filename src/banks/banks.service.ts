import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateBankDto } from "./dto/create-bank.dto";
import { UpdateBankDto } from "./dto/update-bank.dto";
import { JwtPayload } from "../auth/types";

@Injectable()
export class BanksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.bank.findMany({ orderBy: { nom: "asc" } });
  }

  async findOne(id: string) {
    const bank = await this.prisma.bank.findUnique({ where: { id } });
    if (!bank) throw new NotFoundException("Banque introuvable.");
    return bank;
  }

  async create(dto: CreateBankDto, actor: JwtPayload) {
    const created = await this.prisma.bank.create({ data: dto });
    await this.auditService.record({
      categorie: "BANQUE",
      action: "Banque ajoutée",
      detail: `${created.nom} (${created.swift})`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return created;
  }

  async update(id: string, dto: UpdateBankDto, actor: JwtPayload) {
    const before = await this.findOne(id);
    const updated = await this.prisma.bank.update({ where: { id }, data: dto });
    await this.auditService.record({
      categorie: "BANQUE",
      action: "Banque modifiée",
      detail: `${updated.nom} — ${describeChanges(before, dto)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const bank = await this.findOne(id);
    await this.prisma.bank.delete({ where: { id } });
    await this.auditService.record({
      categorie: "BANQUE",
      action: "Banque supprimée",
      detail: bank.nom,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return { id };
  }
}
