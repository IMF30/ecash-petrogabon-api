import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { JwtPayload } from "../auth/types";

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

// Au-delà de ce montant, un versement est marqué comme nécessitant une certification
// complémentaire par la Trésorerie — a posteriori et non bloquante (voir certifier() plus bas).
// Même seuil que SEUIL_APPROBATION_COMMANDE_FCFA (approvisionnement.service.ts), pour rester
// cohérent entre les deux contrôles issus du même audit.
const SEUIL_CERTIFICATION_VERSEMENT_FCFA = 1_000_000;

const INCLUDE_COMPLET = {
  bank: true,
  station: true,
  denominations: true,
  createdByUser: { select: { id: true, prenom: true, nom: true, role: true } },
  certifieParUser: { select: { id: true, prenom: true, nom: true, role: true } },
};

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
      include: INCLUDE_COMPLET,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async findDepositById(id: string, actor: JwtPayload) {
    const deposit = await this.prisma.deposit.findUnique({
      where: { id },
      include: INCLUDE_COMPLET,
    });
    if (!deposit) throw new NotFoundException("Versement introuvable.");
    if (actor.role === "GERANTE" && deposit.stationId !== actor.stationId) {
      throw new ForbiddenException("Ce versement ne concerne pas votre station.");
    }
    return deposit;
  }

  // Réservée à la Trésorerie — certification a posteriori, non bloquante, d'un versement
  // au-delà du seuil. Contrairement à l'approbation des commandes, rien n'est conditionné par
  // cette certification : un versement documente un dépôt déjà physiquement effectué en banque.
  async certifier(id: string, actor: JwtPayload) {
    const deposit = await this.prisma.deposit.findUnique({ where: { id } });
    if (!deposit) throw new NotFoundException("Versement introuvable.");
    if (!deposit.necessiteCertification) {
      throw new BadRequestException("Ce versement ne dépasse pas le seuil de certification — rien à certifier.");
    }
    if (deposit.certifieLe) {
      throw new BadRequestException("Ce versement a déjà été certifié.");
    }

    const updated = await this.prisma.deposit.update({
      where: { id },
      data: { certifieParUserId: actor.sub, certifieLe: new Date() },
      include: INCLUDE_COMPLET,
    });

    await this.auditService.record({
      categorie: "VERSEMENT",
      action: "Versement certifié",
      detail: `Bordereau ${deposit.numeroBordereau} — ${fcfa(Number(deposit.montant))}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: deposit.stationId,
    });

    return updated;
  }

  // Cash disponible en caisse pour une station = somme du cash physique de tous ses encaissements
  // (montant, hors TPE) moins la somme de tous ses versements déjà effectués en banque. `client`
  // permet de relire cette valeur DANS la transaction Serializable de create() (voir plus bas) —
  // sans ça, deux versements concurrents pourraient tous les deux lire le même solde et passer le
  // contrôle, faisant passer le cash réel de la station en négatif.
  private async cashDisponible(stationId: string, client: Prisma.TransactionClient = this.prisma): Promise<number> {
    const [encAgg, depAgg] = await Promise.all([
      client.cashEntry.aggregate({ where: { stationId }, _sum: { montant: true } }),
      client.deposit.aggregate({ where: { stationId }, _sum: { montant: true } }),
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

    let created;
    try {
      // La relecture de cashDisponible() et la création du versement doivent être atomiques :
      // isolation Serializable pour que Postgres fasse échouer l'une des deux transactions si
      // deux versements concurrents pour la même station se chevauchent, plutôt que de laisser
      // les deux passer le contrôle "montant ≤ cash disponible" sur le même solde lu deux fois.
      created = await this.prisma.$transaction(
        async (tx) => {
          const cash = await this.cashDisponible(stationId, tx);
          if (montant > cash) {
            throw new BadRequestException(
              `Montant versé (${fcfa(montant)}) supérieur au cash disponible en caisse (${fcfa(cash)}).`,
            );
          }
          return tx.deposit.create({
            data: {
              numeroBordereau: dto.numeroBordereau,
              bankId: dto.bankId,
              stationId,
              montant,
              necessiteCertification: montant >= SEUIL_CERTIFICATION_VERSEMENT_FCFA,
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
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (e) {
      // Filet de sécurité contre la course : si deux versements du même bordereau/banque
      // sont soumis en même temps, seul le premier passe et le second déclenche la
      // contrainte unique en base (P2002 sur bankId_numeroBordereau) plutôt qu'un 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException(`Le bordereau ${dto.numeroBordereau} a déjà été enregistré pour ${bank.nom}.`);
      }
      // Conflit de sérialisation Postgres : deux versements concurrents pour la même station se
      // chevauchaient, l'un des deux doit resoumettre (voir le commentaire sur le $transaction ci-dessus).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2034") {
        throw new ConflictException("Un autre versement est en cours de traitement pour cette station — veuillez réessayer.");
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

    // Signalement a posteriori (non bloquant, même philosophie que le plafond banane) : un AUTRE
    // versement même station + même banque + même montant + même jour calendaire (bordereau
    // forcément différent, sinon déjà bloqué ci-dessus par la contrainte unique) peut être une
    // vraie double saisie accidentelle — on ne peut pas le savoir avec certitude, donc on se
    // contente de le tracer pour vérification humaine plutôt que de bloquer un versement légitime.
    const debutJour = new Date(created.createdAt);
    debutJour.setUTCHours(0, 0, 0, 0);
    const finJour = new Date(debutJour);
    finJour.setUTCDate(finJour.getUTCDate() + 1);
    const doublonPotentiel = await this.prisma.deposit.findFirst({
      where: {
        stationId,
        bankId: dto.bankId,
        montant,
        id: { not: created.id },
        createdAt: { gte: debutJour, lt: finJour },
      },
    });
    if (doublonPotentiel) {
      await this.auditService.record({
        categorie: "VERSEMENT",
        action: "Anomalie : versement potentiellement en double",
        detail: `Bordereau ${dto.numeroBordereau} — ${bank.nom} — ${fcfa(montant)} — même banque/montant/jour que le bordereau du versement ${doublonPotentiel.id}`,
        acteurUserId: actor.sub,
        acteurLabel: actor.role,
        stationId,
      });
    }

    return this.findDepositById(created.id, actor);
  }
}
