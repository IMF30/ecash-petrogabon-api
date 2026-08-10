import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { JwtPayload } from "../auth/types";

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

@Injectable()
export class CashEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll(stationId?: string) {
    return this.prisma.cashEntry.findMany({
      where: stationId ? { stationId } : undefined,
      include: { attendant: true, denominations: true },
      orderBy: { date: "desc" },
      take: 500,
    });
  }

  async create(dto: CreateCashEntryDto, actor: JwtPayload) {
    if (actor.role === "GERANTE" && actor.stationId !== dto.stationId) {
      throw new ForbiddenException("Vous ne pouvez saisir un encaissement que pour votre propre station.");
    }

    const totalBillets = dto.denominations
      .filter((d) => d.type === "BILLET")
      .reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const totalPieces = dto.denominations
      .filter((d) => d.type === "PIECE")
      .reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const montant = totalBillets + totalPieces;

    const attendant = await this.prisma.attendant.findUnique({ where: { id: dto.attendantId } });

    const entry = await this.prisma.cashEntry.create({
      data: {
        attendantId: dto.attendantId,
        stationId: dto.stationId,
        quart: dto.quart,
        totalBillets,
        totalPieces,
        montant,
        denominations: {
          create: dto.denominations
            .filter((d) => d.quantite > 0)
            .map((d) => ({
              type: d.type,
              valeurFaciale: d.valeurFaciale,
              quantite: d.quantite,
              sousTotal: d.valeurFaciale * d.quantite,
            })),
        },
      },
      include: { attendant: true, denominations: true },
    });

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Encaissement enregistré",
      detail: `${attendant?.prenom} ${attendant?.nom} — ${fcfa(montant)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: dto.stationId,
    });

    return entry;
  }
}
