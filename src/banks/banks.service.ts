import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    let created;
    try {
      created = await this.prisma.bank.create({ data: dto });
    } catch (e) {
      // Le code interne est dérivé du nom côté frontend (tronqué à 12 caractères) : deux noms
      // proches peuvent produire le même code et déclencher la contrainte unique en base —
      // on traduit ça en erreur métier claire plutôt qu'en 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(
          `Le code "${dto.code}" est déjà utilisé par une autre banque — renommez légèrement cette banque (ex. en précisant la ville ou l'agence) pour obtenir un code différent.`,
        );
      }
      throw e;
    }
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

    // Sans ce contrôle, une contrainte de clé étrangère en base ferait échouer la suppression
    // avec une erreur 500 générique dès que cette banque a déjà reçu un versement.
    const deposits = await this.prisma.deposit.count({ where: { bankId: id } });
    if (deposits > 0) {
      throw new BadRequestException(
        "Cette banque a déjà des versements enregistrés — désactivez-la plutôt (statut Inactif) pour ne pas perdre l'historique.",
      );
    }

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
