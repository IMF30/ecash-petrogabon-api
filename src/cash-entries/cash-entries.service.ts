import { BadRequestException, ConflictException, ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PricesService } from "../prices/prices.service";
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
    private readonly pricesService: PricesService,
  ) {}

  findAll(stationId: string | undefined, actor: JwtPayload) {
    // Une GERANTE ne voit que les encaissements de sa propre station : le paramètre
    // stationId reçu est ignoré à son profit pour empêcher la lecture d'une autre station.
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    return this.prisma.cashEntry.findMany({
      where: scopedStationId ? { stationId: scopedStationId } : undefined,
      include: {
        denominations: true,
        pumpReadings: { include: { pump: true, attendant: true } },
        lubricantSales: { include: { lubricantFormat: { include: { lubricantProduct: true } } } },
        responsableQuart: true,
        responsableGpl: true,
        responsableLubrifiants: true,
      },
      orderBy: { date: "desc" },
      take: 500,
    });
  }

  async create(dto: CreateCashEntryDto, actor: JwtPayload) {
    if (actor.role === "GERANTE" && actor.stationId !== dto.stationId) {
      throw new ForbiddenException("Vous ne pouvez saisir un encaissement que pour votre propre station.");
    }

    const date = new Date(dto.date);
    const aujourdhui = new Date();
    aujourdhui.setUTCHours(0, 0, 0, 0);
    if (date.getTime() > aujourdhui.getTime()) {
      throw new BadRequestException("La date du quart ne peut pas être dans le futur.");
    }

    const pumpIdsBruts = dto.pumpReadings.map((p) => p.pumpId);
    if (new Set(pumpIdsBruts).size !== pumpIdsBruts.length) {
      throw new BadRequestException("Une même pompe ne peut pas être assignée à plusieurs pompistes dans le même quart.");
    }

    // Règle métier : un pompiste ne peut physiquement surveiller plus de 4 pompes sur un même quart.
    const pompesParAttendant = new Map<string, number>();
    for (const r of dto.pumpReadings) {
      pompesParAttendant.set(r.attendantId, (pompesParAttendant.get(r.attendantId) ?? 0) + 1);
    }
    if ([...pompesParAttendant.values()].some((n) => n > 4)) {
      throw new BadRequestException("Un pompiste ne peut pas se voir assigner plus de 4 pompes sur un même quart.");
    }

    // Contrainte d'intégrité station + quart + date : un seul encaissement par quart et par jour pour une station.
    // Vérifiée ici pour renvoyer un message clair, et de nouveau via l'erreur P2002 (contrainte unique en base) en cas de course.
    const existant = await this.prisma.cashEntry.findUnique({
      where: { stationId_quart_date: { stationId: dto.stationId, quart: dto.quart, date } },
    });
    if (existant) {
      throw new ConflictException("Ce quart a déjà été enregistré pour cette date et ne peut plus être ressaisi.");
    }

    const attendantIds = [
      ...new Set([
        dto.responsableQuartId,
        dto.responsableGplId,
        dto.responsableLubrifiantsId,
        ...dto.pumpReadings.map((p) => p.attendantId),
      ]),
    ];
    const attendants = await this.prisma.attendant.findMany({ where: { id: { in: attendantIds } } });
    if (attendants.length !== attendantIds.length || attendants.some((a) => a.stationId !== dto.stationId)) {
      throw new BadRequestException("Un ou plusieurs pompistes ne correspondent pas à cette station.");
    }
    if (attendants.some((a) => a.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs pompistes sont inactifs et ne peuvent plus être affectés à un quart.");
    }

    // Règle métier : un pompiste ne peut être affecté qu'à un seul quart par jour, tous rôles confondus
    // (responsable de quart, GPL, lubrifiants ou pompiste). On récupère donc tous les encaissements du
    // même jour sur les AUTRES quarts de cette station pour détecter un pompiste déjà affecté ailleurs.
    const entriesMemeJourAutreQuart = await this.prisma.cashEntry.findMany({
      where: { stationId: dto.stationId, date, quart: { not: dto.quart } },
      include: { pumpReadings: true },
    });
    const attendantIdsDejaAffectes = new Set<string>();
    for (const e of entriesMemeJourAutreQuart) {
      attendantIdsDejaAffectes.add(e.responsableQuartId);
      attendantIdsDejaAffectes.add(e.responsableGplId);
      attendantIdsDejaAffectes.add(e.responsableLubrifiantsId);
      for (const r of e.pumpReadings) attendantIdsDejaAffectes.add(r.attendantId);
    }
    const conflits = attendants.filter((a) => attendantIdsDejaAffectes.has(a.id));
    if (conflits.length > 0) {
      const noms = conflits.map((a) => `${a.prenom} ${a.nom}`).join(", ");
      throw new ConflictException(
        `Un pompiste ne peut être affecté qu'à un seul quart par jour : ${noms} déjà affecté(e) à un autre quart ce jour-là.`,
      );
    }

    const pumpIds = [...new Set(pumpIdsBruts)];
    const pumps = await this.prisma.pump.findMany({ where: { id: { in: pumpIds } } });
    if (pumps.length !== pumpIds.length || pumps.some((p) => p.stationId !== dto.stationId)) {
      throw new BadRequestException("Une ou plusieurs pompes ne correspondent pas à cette station.");
    }
    if (pumps.some((p) => p.statut !== "ACTIF")) {
      throw new BadRequestException("Une ou plusieurs pompes sont hors service et ne peuvent plus enregistrer de relevé.");
    }
    const pumpById = new Map(pumps.map((p) => [p.id, p]));

    const lubricantFormatIdsBruts = dto.lubricantSales.map((v) => v.lubricantFormatId);
    if (new Set(lubricantFormatIdsBruts).size !== lubricantFormatIdsBruts.length) {
      throw new BadRequestException("Un même format de lubrifiant ne peut être saisi qu'une seule fois par quart.");
    }
    const lubricantFormatIds = [...new Set(lubricantFormatIdsBruts)];
    const lubricantFormats = await this.prisma.lubricantFormat.findMany({
      where: { id: { in: lubricantFormatIds } },
      include: { lubricantProduct: true },
    });
    if (lubricantFormats.length !== lubricantFormatIds.length) {
      throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont introuvables.");
    }
    // Un format n'est réellement en vente que si lui ET son produit parent sont actifs
    // (même règle que formatsActifs() côté frontend, cf. lubricants-store.ts).
    if (lubricantFormats.some((f) => f.statut !== "ACTIF" || f.lubricantProduct.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont inactifs et ne peuvent plus être vendus.");
    }
    const lubricantFormatById = new Map(lubricantFormats.map((f) => [f.id, f]));

    const prixConfig = await this.pricesService.get();

    // Montant carburant par pompe = (index de fermeture − index d'ouverture) en litres × prix au litre
    // du réseau, selon le produit de la pompe (essence ou gasoil). Le montant carburant global du quart
    // (montantCarburant plus bas) est la somme de ces montants sur toutes les pompes du quart.
    const pumpReadingsData = dto.pumpReadings.map((r) => {
      const pump = pumpById.get(r.pumpId)!;
      if (r.indexFermeture < r.indexOuverture) {
        throw new BadRequestException(`Index de fermeture inférieur à l'index d'ouverture pour la pompe ${pump.code}.`);
      }
      const litresVendus = r.indexFermeture - r.indexOuverture;
      const prixLitre = pump.produit === "ESSENCE" ? Number(prixConfig.prixLitreEssence) : Number(prixConfig.prixLitreGasoil);
      const montantCalcule = litresVendus * prixLitre;
      return {
        attendantId: r.attendantId,
        pumpId: r.pumpId,
        indexOuverture: r.indexOuverture,
        indexFermeture: r.indexFermeture,
        litresVendus,
        montantCalcule,
      };
    });
    const montantCarburant = pumpReadingsData.reduce((s, p) => s + p.montantCalcule, 0);

    // Montant GPL = somme des quantités vendues par catégorie de bouteille (12,5kg / 35kg, pleine /
    // consigne / recharge de consigne) multipliées chacune par son propre prix réseau.
    const montantGpl =
      dto.quantiteGpl125Pleine * Number(prixConfig.prixGpl125Pleine) +
      dto.quantiteGpl125Consigne * Number(prixConfig.prixGpl125Consigne) +
      dto.quantiteGpl125ConsigneRecharge * Number(prixConfig.prixGpl125ConsigneRecharge) +
      dto.quantiteGpl35Pleine * Number(prixConfig.prixGpl35Pleine) +
      dto.quantiteGpl35Consigne * Number(prixConfig.prixGpl35Consigne) +
      dto.quantiteGpl35ConsigneRecharge * Number(prixConfig.prixGpl35ConsigneRecharge);

    // Montant lubrifiants : quantité vendue × prix unitaire propre à chaque format (le prix n'est pas
    // dans la config réseau mais rattaché au format de lubrifiant lui-même).
    const lubricantSalesData = dto.lubricantSales.map((v) => {
      const format = lubricantFormatById.get(v.lubricantFormatId)!;
      return {
        lubricantFormatId: v.lubricantFormatId,
        quantite: v.quantite,
        montantCalcule: v.quantite * Number(format.prixUnitaire),
      };
    });
    const montantLubrifiants = lubricantSalesData.reduce((s, v) => s + v.montantCalcule, 0);

    const totalBillets = dto.denominations
      .filter((d) => d.type === "BILLET")
      .reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const totalPieces = dto.denominations
      .filter((d) => d.type === "PIECE")
      .reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const montant = totalBillets + totalPieces;
    const montantGlobal = montant + dto.montantTpe;

    // Écart = cash physique + TPE (montantGlobal, ce qui a été réellement encaissé) moins les ventes
    // calculées (carburant + GPL + lubrifiants, ce qui aurait dû être encaissé d'après les index/quantités).
    // Purement informatif : il n'est jamais bloquant et ne modifie aucun autre calcul, il permet juste à la
    // trésorerie de repérer un manquant ou un surplus de caisse à investiguer.
    const ecart = montantGlobal - (montantCarburant + montantGpl + montantLubrifiants);

    let entry;
    try {
      entry = await this.prisma.cashEntry.create({
        data: {
          stationId: dto.stationId,
          quart: dto.quart,
          date,
          responsableQuartId: dto.responsableQuartId,
          responsableGplId: dto.responsableGplId,
          responsableLubrifiantsId: dto.responsableLubrifiantsId,
          totalBillets,
          totalPieces,
          montant,
          montantTpe: dto.montantTpe,
          montantGlobal,
          quantiteGpl125Pleine: dto.quantiteGpl125Pleine,
          quantiteGpl125Consigne: dto.quantiteGpl125Consigne,
          quantiteGpl125ConsigneRecharge: dto.quantiteGpl125ConsigneRecharge,
          quantiteGpl35Pleine: dto.quantiteGpl35Pleine,
          quantiteGpl35Consigne: dto.quantiteGpl35Consigne,
          quantiteGpl35ConsigneRecharge: dto.quantiteGpl35ConsigneRecharge,
          montantGpl,
          montantCarburant,
          montantLubrifiants,
          ecart,
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
          pumpReadings: { create: pumpReadingsData },
          lubricantSales: { create: lubricantSalesData },
        },
        include: {
          denominations: true,
          pumpReadings: { include: { pump: true, attendant: true } },
          lubricantSales: { include: { lubricantFormat: { include: { lubricantProduct: true } } } },
          responsableQuart: true,
          responsableGpl: true,
          responsableLubrifiants: true,
        },
      });
    } catch (e) {
      // Filet de sécurité contre la course : si deux requêtes passent la vérification findUnique en même
      // temps, seule la première insertion réussit et la seconde déclenche la contrainte unique en base
      // (P2002 sur stationId_quart_date), qu'on traduit ici en erreur métier plutôt qu'en 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Ce quart a déjà été enregistré pour cette date et ne peut plus être ressaisi.");
      }
      throw e;
    }

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Encaissement de quart enregistré",
      detail: `Quart ${dto.quart} — Cash physique ${fcfa(montant)} + TPE ${fcfa(dto.montantTpe)} = Global ${fcfa(montantGlobal)} — Carburant+GPL+Lubrifiants calculé ${fcfa(montantCarburant + montantGpl + montantLubrifiants)} — Écart ${fcfa(ecart)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: dto.stationId,
    });

    return entry;
  }
}
