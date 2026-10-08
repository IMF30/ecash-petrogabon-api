import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { PriceConfig, ProduitStock, StatutCommande } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PricesService } from "../prices/prices.service";
import { CreateCommandeDto } from "./dto/create-commande.dto";
import { JwtPayload } from "../auth/types";
import { assertQuantiteRaisonnable } from "../common/produit-stock-limits";

const INCLUDE_COMPLET = {
  station: true,
  createdByUser: { select: { id: true, prenom: true, nom: true, role: true } },
  traiteParUser: { select: { id: true, prenom: true, nom: true, role: true } },
  livreeParUser: { select: { id: true, prenom: true, nom: true, role: true } },
  approuveParUser: { select: { id: true, prenom: true, nom: true, role: true } },
};

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

// Au-delà de ce montant ESTIMÉ (voir prixUnitaireProduitStock ci-dessous), une commande doit être
// approuvée par un Administrateur avant que le GRC puisse la traiter (voir traiter() ci-dessous).
const SEUIL_APPROBATION_COMMANDE_FCFA = 1_000_000;

// Prix de vente actuel du produit, pris comme approximation du coût de réapprovisionnement — on
// ne connaît pas le prix fournisseur réel dans ce système, seul le prix de vente réseau existe
// (PriceConfig). Approximation assumée, cohérente avec les autres approximations déjà acceptées
// dans ce module (ex. le stock Gaz décompté sur le prix "Pleine").
function prixUnitaireProduitStock(produit: ProduitStock, prixConfig: PriceConfig): number {
  switch (produit) {
    case "ESSENCE": return Number(prixConfig.prixLitreEssence);
    case "GASOIL": return Number(prixConfig.prixLitreGasoil);
    case "PETROLE": return Number(prixConfig.prixLitrePetrole);
    case "GPL_12_5": return Number(prixConfig.prixGpl125Pleine);
    case "GPL_35": return Number(prixConfig.prixGpl35Pleine);
  }
}

@Injectable()
export class ApprovisionnementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly pricesService: PricesService,
  ) {}

  findCommandes(stationId: string | undefined, statut: string | undefined, actor: JwtPayload) {
    // Une GERANTE ne voit que les commandes de sa propre station, comme pour les versements.
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    const statutValide =
      statut === "EN_COURS" || statut === "TRAITEE" || statut === "LIVREE" ? (statut as StatutCommande) : undefined;

    return this.prisma.commande.findMany({
      where: {
        ...(scopedStationId ? { stationId: scopedStationId } : {}),
        ...(statutValide ? { statut: statutValide } : {}),
      },
      include: INCLUDE_COMPLET,
      orderBy: { createdAt: "desc" },
      take: 500,
    });
  }

  async findCommandeById(id: string, actor: JwtPayload) {
    const commande = await this.prisma.commande.findUnique({ where: { id }, include: INCLUDE_COMPLET });
    if (!commande) throw new NotFoundException("Commande introuvable.");
    if (actor.role === "GERANTE" && commande.stationId !== actor.stationId) {
      throw new ForbiddenException("Cette commande ne concerne pas votre station.");
    }
    return commande;
  }

  async create(dto: CreateCommandeDto, actor: JwtPayload) {
    const stationId = actor.stationId;
    if (!stationId) throw new BadRequestException("Station introuvable pour cette commande.");
    assertQuantiteRaisonnable(dto.produit, dto.quantite);

    const prixConfig = await this.pricesService.get();
    const valeurEstimee = dto.quantite * prixUnitaireProduitStock(dto.produit, prixConfig);
    const necessiteApprobation = valeurEstimee >= SEUIL_APPROBATION_COMMANDE_FCFA;

    const created = await this.prisma.commande.create({
      data: {
        stationId,
        produit: dto.produit,
        quantite: dto.quantite,
        valeurEstimee,
        necessiteApprobation,
        dateLivraisonSouhaitee: new Date(dto.dateLivraisonSouhaitee),
        commentaire: dto.commentaire,
        createdByUserId: actor.sub,
      },
    });

    await this.auditService.record({
      categorie: "COMMANDE",
      action: "Commande créée",
      detail: `${dto.produit} — ${dto.quantite}${necessiteApprobation ? ` — valeur estimée ${fcfa(valeurEstimee)}, nécessite l'approbation d'un administrateur` : ""}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId,
    });

    return this.findCommandeById(created.id, actor);
  }

  // Irréversible — une fois TRAITEE, une commande ne peut pas repasser EN_COURS (même logique que
  // la clôture d'un quart, cf. CashEntriesService.cloturer). "Traitée" signifie seulement que le
  // GRC a traité la demande (ex. commande passée auprès du fournisseur) — PAS que le produit est
  // arrivé à la station : seule la confirmation de livraison par la gérante (livrer(), ci-dessous)
  // compte comme réception de stock.
  async traiter(id: string, actor: JwtPayload) {
    const commande = await this.prisma.commande.findUnique({ where: { id } });
    if (!commande) throw new NotFoundException("Commande introuvable.");
    if (commande.statut !== "EN_COURS") {
      throw new BadRequestException("Cette commande a déjà été traitée.");
    }
    if (commande.necessiteApprobation && !commande.approuveLe) {
      throw new BadRequestException(
        `Cette commande dépasse le seuil d'approbation (${fcfa(SEUIL_APPROBATION_COMMANDE_FCFA)}) et doit d'abord être approuvée par un administrateur.`,
      );
    }

    const updated = await this.prisma.commande.update({
      where: { id },
      data: { statut: "TRAITEE", traiteParUserId: actor.sub, traiteLe: new Date() },
      include: INCLUDE_COMPLET,
    });

    await this.auditService.record({
      categorie: "COMMANDE",
      action: "Commande traitée",
      detail: `${commande.produit} — ${commande.quantite} — station ${commande.stationId}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: commande.stationId,
    });

    return updated;
  }

  // Réservé à l'Administrateur — débloque le traitement GRC d'une commande qui dépasse le seuil
  // (voir le garde en tête de traiter() ci-dessus). N'a aucun effet si la commande ne nécessite
  // pas d'approbation, ou si elle est déjà approuvée.
  async approuver(id: string, actor: JwtPayload) {
    const commande = await this.prisma.commande.findUnique({ where: { id } });
    if (!commande) throw new NotFoundException("Commande introuvable.");
    if (!commande.necessiteApprobation) {
      throw new BadRequestException("Cette commande ne dépasse pas le seuil d'approbation — rien à approuver.");
    }
    if (commande.approuveLe) {
      throw new BadRequestException("Cette commande a déjà été approuvée.");
    }

    const updated = await this.prisma.commande.update({
      where: { id },
      data: { approuveParUserId: actor.sub, approuveLe: new Date() },
      include: INCLUDE_COMPLET,
    });

    await this.auditService.record({
      categorie: "COMMANDE",
      action: "Commande approuvée",
      detail: `${commande.produit} — ${commande.quantite} — valeur estimée ${fcfa(Number(commande.valeurEstimee))}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: commande.stationId,
    });

    return updated;
  }

  // Réservé à la gérante de la station concernée — confirme la réception physique du produit.
  // Ne peut s'appliquer qu'à une commande déjà TRAITEE par le GRC (on ne reçoit pas un produit
  // jamais commandé auprès du fournisseur) ; irréversible comme traiter(). C'est cette étape,
  // et uniquement elle, que StockService prend en compte pour recalculer le stock théorique.
  async livrer(id: string, actor: JwtPayload) {
    const commande = await this.prisma.commande.findUnique({ where: { id } });
    if (!commande) throw new NotFoundException("Commande introuvable.");
    if (actor.role === "GERANTE" && commande.stationId !== actor.stationId) {
      throw new ForbiddenException("Cette commande ne concerne pas votre station.");
    }
    if (commande.statut === "EN_COURS") {
      throw new BadRequestException("Cette commande n'a pas encore été traitée par le GRC.");
    }
    if (commande.statut === "LIVREE") {
      throw new BadRequestException("La livraison de cette commande a déjà été confirmée.");
    }

    const updated = await this.prisma.commande.update({
      where: { id },
      data: { statut: "LIVREE", livreeParUserId: actor.sub, livreeLe: new Date() },
      include: INCLUDE_COMPLET,
    });

    await this.auditService.record({
      categorie: "COMMANDE",
      action: "Livraison confirmée",
      detail: `${commande.produit} — ${commande.quantite}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: commande.stationId,
    });

    return updated;
  }
}
