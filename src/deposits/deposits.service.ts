import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { JwtPayload } from "../auth/types";

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

@Injectable()
export class DepositsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findDeposits(stationId: string | undefined, actor: JwtPayload) {
    // Une GERANTE ne voit que les versements de sa propre station : le paramètre
    // stationId reçu est ignoré à son profit pour empêcher la lecture d'une autre station.
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    return this.prisma.deposit.findMany({
      where: scopedStationId ? { stationId: scopedStationId } : undefined,
      include: {
        bank: true,
        station: true,
        denominations: true,
        createdByUser: { select: { id: true, prenom: true, nom: true, role: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async findDepositById(id: string, actor: JwtPayload) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id },
      include: {
        bank: true,
        station: true,
        denominations: true,
        createdByUser: { select: { id: true, prenom: true, nom: true, role: true } },
      },
    });
    if (!deposit) throw new NotFoundException("Versement introuvable.");
    if (actor.role === "GERANTE" && deposit.stationId !== actor.stationId) {
      throw new ForbiddenException("Ce versement ne concerne pas votre station.");
    }
    return deposit;
  }

  // Cash disponible en caisse pour une station = somme du cash physique de tous ses encaissements
  // (montant, hors TPE) moins la somme de tous ses versements déjà effectués en banque.
  private async cashDisponible(stationId: string): Promise<number> {
    const [encAgg, depAgg] = await Promise.all([
      this.prisma.cashEntry.aggregate({ where: { stationId }, _sum: { montant: true } }),
      this.prisma.deposit.aggregate({ where: { stationId }, _sum: { montant: true } }),
    ]);
    return Number(encAgg._sum.montant ?? 0) - Number(depAgg._sum.montant ?? 0);
  }

  async create(dto: CreateDepositDto, actor: JwtPayload) {
    // Une GERANTE ne peut verser que pour sa propre station : on ignore dto.stationId et on impose la sienne.
    const stationId = actor.role === "GERANTE" ? actor.stationId : dto.stationId;
    if (!stationId) throw new BadRequestException("Station introuvable pour ce versement.");

    const bank = await this.prisma.bank.findUnique({ where: { id: dto.bankId } });
    if (!bank) throw new NotFoundException("Banque introuvable.");
    if (bank.statut !== "ACTIF") {
      throw new BadRequestException("Cette banque est inactive et ne peut plus recevoir de versement.");
    }

    // Le numéro de bordereau n'est unique que PAR banque (contrainte composite bankId + numeroBordereau) :
    // deux banques différentes peuvent avoir un bordereau numéroté à l'identique.
    const doublon = await this.prisma.deposit.findUnique({
      where: { bankId_numeroBordereau: { bankId: dto.bankId, numeroBordereau: dto.numeroBordereau } },
    });
    if (doublon) {
      throw new ConflictException(`Le bordereau ${dto.numeroBordereau} a déjà été enregistré pour ${bank.nom}.`);
    }

    // Montant du versement = somme des dénominations (billets/pièces) saisies, valeur faciale × quantité.
    const montant = dto.denominations.reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    if (montant <= 0) {
      throw new BadRequestException("Le détail des billets et pièces versés ne peut pas être nul.");
    }

    // Un versement ne peut jamais excéder le cash physiquement disponible en caisse pour la station.
    const cash = await this.cashDisponible(stationId);
    if (montant > cash) {
      throw new BadRequestException(
        `Montant versé (${fcfa(montant)}) supérieur au cash disponible en caisse (${fcfa(cash)}).`,
      );
    }

    let created;
    try {
      created = await this.prisma.deposit.create({
        data: {
          numeroBordereau: dto.numeroBordereau,
          bankId: dto.bankId,
          stationId,
          montant,
          createdByUserId: actor.sub,
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
      });
    } catch (e) {
      // Filet de sécurité contre la course : si deux versements du même bordereau/banque
      // sont soumis en même temps, seul le premier passe et le second déclenche la
      // contrainte unique en base (P2002 sur bankId_numeroBordereau) plutôt qu'un 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(`Le bordereau ${dto.numeroBordereau} a déjà été enregistré pour ${bank.nom}.`);
      }
      throw e;
    }

    await this.auditService.record({
      categorie: "VERSEMENT",
      action: "Versement enregistré",
      detail: `Bordereau ${dto.numeroBordereau} — ${bank.nom} — ${fcfa(montant)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId,
    });

    return this.findDepositById(created.id, actor);
  }
}
