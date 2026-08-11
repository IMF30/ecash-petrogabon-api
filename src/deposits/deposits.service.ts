import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateDepositCodeDto } from "./dto/create-deposit-code.dto";
import { ValidateDepositDto } from "./dto/validate-deposit.dto";
import { JwtPayload } from "../auth/types";

const EXPIRATION_HEURES = 24;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  /* ── Codes de versement ────────────────────────────────────── */

  findCodes(stationId?: string) {
    return this.prisma.depositCode.findMany({
      where: stationId ? { stationId } : undefined,
      include: { bank: true, station: true },
      orderBy: { generatedAt: "desc" },
      take: 500,
    });
  }

  private async generateUniqueCode(): Promise<string> {
    for (let i = 0; i < 5; i++) {
      let candidate = "";
      for (let j = 0; j < 8; j++) candidate += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      const existing = await this.prisma.depositCode.findUnique({ where: { code: candidate } });
      if (!existing) return candidate;
    }
    throw new BadRequestException("Impossible de générer un code unique, veuillez réessayer.");
  }

  async createCode(dto: CreateDepositCodeDto, actor: JwtPayload) {
    const bank = await this.prisma.bank.findUnique({ where: { id: dto.bankId } });
    if (!bank) throw new NotFoundException("Banque introuvable.");

    const cash = await this.cashDisponible(dto.stationId);
    if (dto.montant > cash) {
      throw new BadRequestException(
        `Montant sélectionné (${fcfa(dto.montant)}) supérieur au cash disponible en coffre (${fcfa(cash)}).`,
      );
    }

    const code = await this.generateUniqueCode();
    const created = await this.prisma.depositCode.create({
      data: {
        code,
        bankId: dto.bankId,
        stationId: dto.stationId,
        montant: dto.montant,
        generatedByUserId: actor.sub,
      },
      include: { bank: true, station: true },
    });

    await this.auditService.record({
      categorie: "CODE",
      action: "Code de versement généré",
      detail: `Code ${created.code} — ${bank.nom} — ${fcfa(dto.montant)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: dto.stationId,
    });

    return created;
  }

  /* ── Versements ────────────────────────────────────────────── */

  findDeposits(stationId?: string) {
    return this.prisma.deposit.findMany({
      where: stationId ? { stationId } : undefined,
      include: { bank: true, station: true, receipt: true, depositCode: true },
      orderBy: { validatedAt: "desc" },
      take: 500,
    });
  }

  async findDepositById(id: string) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id },
      include: {
        bank: true,
        station: true,
        receipt: true,
        validatedByUser: { select: { id: true, prenom: true, nom: true, role: true } },
        depositCode: {
          include: { generatedByUser: { select: { id: true, prenom: true, nom: true, role: true } } },
        },
      },
    });
    if (!deposit) throw new NotFoundException("Versement introuvable.");
    return deposit;
  }

  private async cashDisponible(stationId: string): Promise<number> {
    const [encAgg, depAgg] = await Promise.all([
      this.prisma.cashEntry.aggregate({ where: { stationId }, _sum: { montant: true } }),
      this.prisma.deposit.aggregate({ where: { stationId }, _sum: { montant: true } }),
    ]);
    return Number(encAgg._sum.montant ?? 0) - Number(depAgg._sum.montant ?? 0);
  }

  async validate(dto: ValidateDepositDto, actor: JwtPayload) {
    const depositCode = await this.prisma.depositCode.findUnique({
      where: { code: dto.code },
      include: { bank: true },
    });

    if (!depositCode) {
      throw new BadRequestException("Code introuvable. Vérifiez la saisie ou contactez la Trésorerie.");
    }
    if (depositCode.usedAt) {
      throw new BadRequestException("Ce code a déjà été utilisé (usage unique).");
    }

    const heuresEcoulees = (Date.now() - depositCode.generatedAt.getTime()) / 3_600_000;
    if (heuresEcoulees > EXPIRATION_HEURES) {
      throw new BadRequestException(
        `Ce code a expiré (généré il y a ${Math.floor(heuresEcoulees)}h, au-delà des ${EXPIRATION_HEURES}h autorisées).`,
      );
    }

    if (depositCode.bankId !== dto.bankId) {
      const banqueSaisie = (await this.prisma.bank.findUnique({ where: { id: dto.bankId } }))?.nom ?? dto.bankId;
      throw new BadRequestException(
        `Ce code a été généré pour ${depositCode.bank.nom}, pas pour ${banqueSaisie}. Vérifiez la banque sélectionnée.`,
      );
    }

    if (actor.role === "GERANTE" && actor.stationId !== depositCode.stationId) {
      throw new ForbiddenException("Ce code ne concerne pas votre station.");
    }

    const montant = Number(depositCode.montant);
    const cash = await this.cashDisponible(depositCode.stationId);
    if (montant > cash) {
      throw new BadRequestException(
        `Montant du versement (${fcfa(montant)}) supérieur au cash disponible en caisse (${fcfa(cash)}).`,
      );
    }

    const numeroTransaction = "TXN-" + randomBytes(6).toString("hex").toUpperCase();

    const deposit = await this.prisma.$transaction(async (tx) => {
      await tx.depositCode.update({ where: { id: depositCode.id }, data: { usedAt: new Date() } });
      const created = await tx.deposit.create({
        data: {
          depositCodeId: depositCode.id,
          bankId: depositCode.bankId,
          stationId: depositCode.stationId,
          montant: depositCode.montant,
          validatedByUserId: actor.sub,
        },
      });
      await tx.receipt.create({ data: { depositId: created.id, numeroTransaction } });
      return created;
    });

    await this.auditService.record({
      categorie: "VERSEMENT",
      action: "Versement validé",
      detail: `Code ${depositCode.code} — ${depositCode.bank.nom} — ${fcfa(montant)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: depositCode.stationId,
    });

    return this.findDepositById(deposit.id);
  }
}
