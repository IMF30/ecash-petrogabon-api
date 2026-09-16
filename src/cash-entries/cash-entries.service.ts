import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Produit, PriceConfig } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PricesService } from "../prices/prices.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { CloturerCashEntryDto } from "./dto/cloturer-cash-entry.dto";
import { VersementProduitDto } from "./dto/versement-produit.dto";
import { ModifierRemiseDto } from "./dto/modifier-remise.dto";
import { ModifierVersementDto } from "./dto/modifier-versement.dto";
import { ReassignerPompeDto } from "./dto/reassigner-pompe.dto";
import { JwtPayload } from "../auth/types";

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

const QUART_LABEL: Record<string, string> = { MATIN: "Matin", SOIR: "Soir", NUIT: "Nuit" };

/** Prix au litre du carburant (Essence, Gasoil, Pétrole — les "produits blancs" vendus à la pompe). */
function prixLitreDuProduit(produit: Produit, prixConfig: PriceConfig): number {
  if (produit === "ESSENCE") return Number(prixConfig.prixLitreEssence);
  if (produit === "GASOIL") return Number(prixConfig.prixLitreGasoil);
  return Number(prixConfig.prixLitrePetrole);
}

const INCLUDE_COMPLET = {
  denominations: true,
  // orderBy explicite indispensable : sans lui, Postgres/Prisma ne garantit aucun ordre stable
  // entre deux lectures, et chaque UPDATE (ex. enregistrement d'un versement) peut faire
  // apparaître les pompes/pompistes dans un ordre différent côté UI — l'id (cuid, ordonné dans
  // le temps) donne un ordre stable et correspond à l'ordre d'ajout à l'ouverture du quart.
  pumpReadings: { include: { pump: true, attendant: true, remises: { orderBy: { createdAt: "asc" as const } } }, orderBy: { id: "asc" as const } },
  lubricantSales: { include: { lubricantFormat: { include: { lubricantProduct: true } } } },
  versements: {
    include: { attendant: true, lubricantSales: { include: { lubricantFormat: { include: { lubricantProduct: true } } } } },
    orderBy: { createdAt: "asc" as const },
  },
  responsableQuart: true,
  responsableGpl: true,
  responsableLubrifiants: true,
};

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
      // Les quarts EN_COURS sont exclus de la liste "historique" par défaut : ils n'ont
      // pas encore de billetage/TPE/écart réels, et n'ont rien à faire mélangés aux
      // quarts clôturés dans les rapports. Voir findEnCours() pour la vue temps réel.
      where: { statut: "CLOTURE", ...(scopedStationId ? { stationId: scopedStationId } : {}) },
      include: INCLUDE_COMPLET,
      orderBy: { date: "desc" },
      take: 500,
    });
  }

  /** Quarts actuellement ouverts (cash physique en cours de constitution) — vue temps réel Trésorerie/Contrôle Interne. */
  findEnCours(stationId: string | undefined, actor: JwtPayload) {
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    return this.prisma.cashEntry.findMany({
      where: { statut: "EN_COURS", ...(scopedStationId ? { stationId: scopedStationId } : {}) },
      include: INCLUDE_COMPLET,
      orderBy: { date: "desc" },
    });
  }

  /** Ouvre un quart : responsables + index d'ouverture par pompe. Le reste se saisit à la clôture. */
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

    // Règle métier : une station ne peut avoir qu'un seul quart ouvert (EN_COURS) à la fois — la
    // gérante doit clôturer le quart en cours avant d'en ouvrir un nouveau, quel que soit le type
    // de quart (matin/soir/nuit).
    const quartDejaOuvert = await this.prisma.cashEntry.findFirst({
      where: { stationId: dto.stationId, statut: "EN_COURS" },
    });
    if (quartDejaOuvert) {
      throw new ConflictException(
        `Un quart est déjà en cours pour cette station (${quartDejaOuvert.quart} du ${quartDejaOuvert.date.toLocaleDateString("fr-FR")}) — clôturez-le avant d'en ouvrir un nouveau.`,
      );
    }

    const pumpIdsBruts = dto.pumpReadings.map((p) => p.pumpId);
    if (new Set(pumpIdsBruts).size !== pumpIdsBruts.length) {
      throw new BadRequestException("Une même pompe ne peut pas être assignée à plusieurs pompistes dans le même quart.");
    }

    // Règle métier : un pompiste ne peut physiquement surveiller plus de 8 pompes sur un même quart.
    const pompesParAttendant = new Map<string, number>();
    for (const r of dto.pumpReadings) {
      pompesParAttendant.set(r.attendantId, (pompesParAttendant.get(r.attendantId) ?? 0) + 1);
    }
    if ([...pompesParAttendant.values()].some((n) => n > 8)) {
      throw new BadRequestException("Un pompiste ne peut pas se voir assigner plus de 8 pompes sur un même quart.");
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
      ...new Set([dto.responsableQuartId, dto.responsableGplId, dto.responsableLubrifiantsId, ...dto.pumpReadings.map((p) => p.attendantId)]),
    ];
    const attendants = await this.prisma.attendant.findMany({ where: { id: { in: attendantIds } } });
    if (attendants.length !== attendantIds.length || attendants.some((a) => a.stationId !== dto.stationId)) {
      throw new BadRequestException("Un ou plusieurs pompistes ne correspondent pas à cette station.");
    }
    if (attendants.some((a) => a.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs pompistes sont inactifs et ne peuvent plus être affectés à un quart.");
    }

    // Règle métier : un pompiste n'est affecté qu'à un seul quart dans la journée (son quart
    // assigné sur sa fiche) — il ne peut pas être sélectionné pour un autre quart. La gérante
    // doit d'abord changer son quart assigné depuis sa fiche si elle veut le faire travailler
    // sur un autre quart.
    const horsQuartAssigne = attendants.filter((a) => a.quart !== dto.quart);
    if (horsQuartAssigne.length > 0) {
      const noms = horsQuartAssigne.map((a) => `${a.prenom} ${a.nom} (assigné(e) au quart ${QUART_LABEL[a.quart]})`).join(", ");
      throw new BadRequestException(
        `Un pompiste ne peut être sélectionné que pour son quart assigné : ${noms}. Modifiez son quart depuis sa fiche avant d'ouvrir ce quart.`,
      );
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

    let entry;
    try {
      entry = await this.prisma.cashEntry.create({
        data: {
          stationId: dto.stationId,
          quart: dto.quart,
          date,
          statut: "EN_COURS",
          responsableQuartId: dto.responsableQuartId,
          responsableGplId: dto.responsableGplId,
          responsableLubrifiantsId: dto.responsableLubrifiantsId,
          pumpReadings: {
            create: dto.pumpReadings.map((r) => ({
              attendantId: r.attendantId,
              pumpId: r.pumpId,
              indexOuverture: r.indexOuverture,
            })),
          },
        },
        include: INCLUDE_COMPLET,
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
      action: "Quart ouvert",
      detail: `Quart ${dto.quart} ouvert avec ${dto.pumpReadings.length} pompe(s) — en attente de clôture.`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: dto.stationId,
    });

    return entry;
  }

  /**
   * Versement progressif mid-quart : le pompiste ne doit pas garder plus de 100 000 FCFA
   * dans sa "banane" sur la piste de vente, il reverse donc régulièrement son cash à la
   * gérante, pompe par pompe (fait avancer l'index courant de chaque pompe concernée —
   * montant / prix au litre du produit). Dans le même geste, il ou elle peut aussi déclarer
   * ses ventes carte (TPE) et, pour le/la responsable Gaz/Lubrifiants du quart, les
   * bouteilles ou bidons vendus depuis le dernier versement. Rien n'attend la clôture du
   * quart — c'est ce qui permet à la Trésorerie et au Contrôle Interne de voir le cash
   * physique et les ventes se constituer en temps réel.
   */
  async enregistrerVersement(cashEntryId: string, dto: VersementProduitDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez saisir un versement que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucun versement ne peut plus y être ajouté.");
    }

    const attendantsImpliques = new Set([
      entry.responsableQuartId, entry.responsableGplId, entry.responsableLubrifiantsId,
      ...entry.pumpReadings.map((r) => r.attendantId),
    ]);
    if (!attendantsImpliques.has(dto.attendantId)) {
      throw new BadRequestException("Ce pompiste ne fait pas partie de ce quart.");
    }
    const attendant = entry.pumpReadings.find((r) => r.attendantId === dto.attendantId)?.attendant
      ?? (await this.prisma.attendant.findUnique({ where: { id: dto.attendantId } }))!;

    const remisesDto = (dto.remises ?? []).filter((r) => r.montant > 0 || (r.montantTpe ?? 0) > 0);
    const qteGpl125Pleine = dto.quantiteGpl125Pleine ?? 0;
    const qteGpl125Consigne = dto.quantiteGpl125Consigne ?? 0;
    const qteGpl125ConsigneRecharge = dto.quantiteGpl125ConsigneRecharge ?? 0;
    const qteGpl35Pleine = dto.quantiteGpl35Pleine ?? 0;
    const qteGpl35Consigne = dto.quantiteGpl35Consigne ?? 0;
    const qteGpl35ConsigneRecharge = dto.quantiteGpl35ConsigneRecharge ?? 0;
    const lubricantSalesDto = dto.lubricantSales ?? [];
    const aUneVenteGpl = qteGpl125Pleine + qteGpl125Consigne + qteGpl125ConsigneRecharge + qteGpl35Pleine + qteGpl35Consigne + qteGpl35ConsigneRecharge > 0;
    // Une vente Gaz est presque toujours payée cash, mais une vente TPE-Gaz est possible.
    // Sans effet sur les Lubrifiants, toujours considérés cash.
    const modePaiementGpl = dto.modePaiementGpl ?? "CASH";

    if (remisesDto.length === 0 && !aUneVenteGpl && lubricantSalesDto.length === 0) {
      throw new BadRequestException("Renseignez au moins un montant remis ou TPE pour une pompe, une vente de gaz ou une vente de lubrifiant.");
    }

    const prixConfig = await this.pricesService.get();

    const remisesAEnregistrer = remisesDto.map((r) => {
      const pumpReading = entry.pumpReadings.find((pr) => pr.id === r.pumpReadingId);
      if (!pumpReading) throw new BadRequestException("Cette pompe ne fait pas partie de ce quart.");
      const prixLitre = prixLitreDuProduit(pumpReading.pump.produit, prixConfig);
      const montantTpe = r.montantTpe ?? 0;
      // L'index courant reflète le carburant réellement délivré par cette pompe — donc le cash ET
      // le TPE de cette remise (un client qui paie par carte fait quand même tourner le compteur).
      const litres = (r.montant + montantTpe) / prixLitre;
      const indexCourant = Number(pumpReading.indexCourant ?? pumpReading.indexOuverture) + litres;
      return {
        pumpReadingId: pumpReading.id,
        pumpCode: pumpReading.pump.code,
        montant: r.montant,
        montantTpe,
        litres,
        indexCourant,
      };
    });
    const montantTpeTotal = remisesAEnregistrer.reduce((s, r) => s + r.montantTpe, 0);

    const montantGpl =
      qteGpl125Pleine * Number(prixConfig.prixGpl125Pleine) +
      qteGpl125Consigne * Number(prixConfig.prixGpl125Consigne) +
      qteGpl125ConsigneRecharge * Number(prixConfig.prixGpl125ConsigneRecharge) +
      qteGpl35Pleine * Number(prixConfig.prixGpl35Pleine) +
      qteGpl35Consigne * Number(prixConfig.prixGpl35Consigne) +
      qteGpl35ConsigneRecharge * Number(prixConfig.prixGpl35ConsigneRecharge);

    const lubricantFormatIdsBruts = lubricantSalesDto.map((v) => v.lubricantFormatId);
    if (new Set(lubricantFormatIdsBruts).size !== lubricantFormatIdsBruts.length) {
      throw new BadRequestException("Un même format de lubrifiant ne peut être saisi qu'une seule fois par versement.");
    }
    const lubricantFormats = lubricantFormatIdsBruts.length
      ? await this.prisma.lubricantFormat.findMany({ where: { id: { in: lubricantFormatIdsBruts } }, include: { lubricantProduct: true } })
      : [];
    if (lubricantFormats.length !== new Set(lubricantFormatIdsBruts).size) {
      throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont introuvables.");
    }
    if (lubricantFormats.some((f) => f.statut !== "ACTIF" || f.lubricantProduct.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont inactifs et ne peuvent plus être vendus.");
    }
    const lubricantFormatById = new Map(lubricantFormats.map((f) => [f.id, f]));
    const lubricantSalesData = lubricantSalesDto.map((v) => {
      const format = lubricantFormatById.get(v.lubricantFormatId)!;
      return { lubricantFormatId: v.lubricantFormatId, quantite: v.quantite, montantCalcule: v.quantite * Number(format.prixUnitaire) };
    });

    const aUnVersementProduit = aUneVenteGpl || lubricantSalesData.length > 0;

    const resultatsTransaction = await this.prisma.$transaction([
      ...remisesAEnregistrer.flatMap((r) => [
        this.prisma.remiseCaisse.create({
          data: { pumpReadingId: r.pumpReadingId, montant: r.montant, montantTpe: r.montantTpe, litres: r.litres },
        }),
        this.prisma.pumpReading.update({ where: { id: r.pumpReadingId }, data: { indexCourant: r.indexCourant } }),
      ]),
      ...(aUnVersementProduit
        ? [
            this.prisma.versementProduit.create({
              data: {
                cashEntryId,
                attendantId: dto.attendantId,
                quantiteGpl125Pleine: qteGpl125Pleine,
                quantiteGpl125Consigne: qteGpl125Consigne,
                quantiteGpl125ConsigneRecharge: qteGpl125ConsigneRecharge,
                quantiteGpl35Pleine: qteGpl35Pleine,
                quantiteGpl35Consigne: qteGpl35Consigne,
                quantiteGpl35ConsigneRecharge: qteGpl35ConsigneRecharge,
                montantGpl,
                modePaiement: modePaiementGpl,
                lubricantSales: { create: lubricantSalesData },
              },
            }),
          ]
        : []),
      this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET }),
    ]);
    // Le dernier élément est toujours le findUnique final, quel que soit le nombre de remises/le
    // versement optionnel qui le précèdent dans le tableau.
    const entryMaj = resultatsTransaction[resultatsTransaction.length - 1];

    const detailParts = [
      remisesAEnregistrer.length > 0 && `Cash : ${remisesAEnregistrer.map((r) => `${r.pumpCode} ${fcfa(r.montant)}`).join(", ")}`,
      montantTpeTotal > 0 && `TPE : ${remisesAEnregistrer.filter((r) => r.montantTpe > 0).map((r) => `TPE-(${r.pumpCode}) ${fcfa(r.montantTpe)}`).join(", ")}`,
      aUneVenteGpl && `Gaz ${fcfa(montantGpl)} (${modePaiementGpl === "TPE" ? "TPE" : "Cash"})`,
      lubricantSalesData.length > 0 && `Lubrifiants ${fcfa(lubricantSalesData.reduce((s, v) => s + v.montantCalcule, 0))}`,
    ].filter(Boolean);
    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Versement en cours de quart enregistré",
      detail: `${attendant.prenom} ${attendant.nom} — ${detailParts.join(" — ")}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return entryMaj;
  }

  /** Corrige le montant cash et/ou TPE d'une remise déjà enregistrée (erreur de saisie) et recalcule l'index courant de la pompe concernée. */
  async modifierRemise(cashEntryId: string, remiseId: string, dto: ModifierRemiseDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true, remises: { orderBy: { createdAt: "asc" } } } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez modifier une remise que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucune remise ne peut plus y être modifiée.");
    }

    const pumpReading = entry.pumpReadings.find((r) => r.remises.some((rm) => rm.id === remiseId));
    if (!pumpReading) throw new NotFoundException("Remise introuvable pour ce quart.");
    const remise = pumpReading.remises.find((rm) => rm.id === remiseId)!;
    const ancienMontant = Number(remise.montant);
    const ancienMontantTpe = Number(remise.montantTpe);
    const montantTpe = dto.montantTpe ?? ancienMontantTpe;

    const prixConfig = await this.pricesService.get();
    const prixLitre = prixLitreDuProduit(pumpReading.pump.produit, prixConfig);
    // Même logique qu'à l'enregistrement : l'index courant reflète le cash ET le TPE de la remise.
    const nouvellesLitres = (dto.montant + montantTpe) / prixLitre;
    const indexCourant =
      Number(pumpReading.indexOuverture) +
      pumpReading.remises.reduce((s, rm) => s + (rm.id === remiseId ? nouvellesLitres : Number(rm.litres)), 0);

    await this.prisma.$transaction([
      this.prisma.remiseCaisse.update({ where: { id: remiseId }, data: { montant: dto.montant, montantTpe, litres: nouvellesLitres } }),
      this.prisma.pumpReading.update({ where: { id: pumpReading.id }, data: { indexCourant } }),
    ]);

    const detailParts = [
      dto.montant !== ancienMontant && `Cash ${fcfa(ancienMontant)} → ${fcfa(dto.montant)}`,
      montantTpe !== ancienMontantTpe && `TPE-(${pumpReading.pump.code}) ${fcfa(ancienMontantTpe)} → ${fcfa(montantTpe)}`,
    ].filter(Boolean);
    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Remise en caisse modifiée",
      detail: `${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} — pompe ${pumpReading.pump.code} — ${detailParts.length > 0 ? detailParts.join(" — ") : "aucune valeur modifiée"}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Corrige un versement déjà enregistré (Gaz et/ou Lubrifiants — erreur de saisie ; le TPE se
   * corrige désormais par pompe via modifierRemise). Un champ omis dans le corps de la requête
   * reste inchangé ; le Gaz n'est recalculé que si l'une de ses quantités est fournie, et les
   * Lubrifiants ne sont remplacés que si `lubricantSales` est fourni — pour ne jamais faire
   * dériver silencieusement une partie du versement qui n'était pas concernée par la correction.
   */
  async modifierVersement(cashEntryId: string, versementId: string, dto: ModifierVersementDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { versements: { include: { attendant: true, lubricantSales: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez modifier un versement que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucun versement ne peut plus y être modifié.");
    }

    const versement = entry.versements.find((v) => v.id === versementId);
    if (!versement) throw new NotFoundException("Versement introuvable pour ce quart.");

    const ancienMontantGpl = Number(versement.montantGpl);
    const ancienModePaiement = versement.modePaiement;
    const ancienMontantLub = versement.lubricantSales.reduce((s, ls) => s + Number(ls.montantCalcule), 0);

    const prixConfig = await this.pricesService.get();
    const modePaiement = dto.modePaiementGpl ?? ancienModePaiement;

    const aGplFourni =
      dto.quantiteGpl125Pleine !== undefined || dto.quantiteGpl125Consigne !== undefined || dto.quantiteGpl125ConsigneRecharge !== undefined ||
      dto.quantiteGpl35Pleine !== undefined || dto.quantiteGpl35Consigne !== undefined || dto.quantiteGpl35ConsigneRecharge !== undefined;
    const quantiteGpl125Pleine = dto.quantiteGpl125Pleine ?? versement.quantiteGpl125Pleine;
    const quantiteGpl125Consigne = dto.quantiteGpl125Consigne ?? versement.quantiteGpl125Consigne;
    const quantiteGpl125ConsigneRecharge = dto.quantiteGpl125ConsigneRecharge ?? versement.quantiteGpl125ConsigneRecharge;
    const quantiteGpl35Pleine = dto.quantiteGpl35Pleine ?? versement.quantiteGpl35Pleine;
    const quantiteGpl35Consigne = dto.quantiteGpl35Consigne ?? versement.quantiteGpl35Consigne;
    const quantiteGpl35ConsigneRecharge = dto.quantiteGpl35ConsigneRecharge ?? versement.quantiteGpl35ConsigneRecharge;
    const montantGpl = aGplFourni
      ? quantiteGpl125Pleine * Number(prixConfig.prixGpl125Pleine) +
        quantiteGpl125Consigne * Number(prixConfig.prixGpl125Consigne) +
        quantiteGpl125ConsigneRecharge * Number(prixConfig.prixGpl125ConsigneRecharge) +
        quantiteGpl35Pleine * Number(prixConfig.prixGpl35Pleine) +
        quantiteGpl35Consigne * Number(prixConfig.prixGpl35Consigne) +
        quantiteGpl35ConsigneRecharge * Number(prixConfig.prixGpl35ConsigneRecharge)
      : ancienMontantGpl;

    let lubricantSalesData: { lubricantFormatId: string; quantite: number; montantCalcule: number }[] | null = null;
    if (dto.lubricantSales !== undefined) {
      const lubricantFormatIdsBruts = dto.lubricantSales.map((v) => v.lubricantFormatId);
      if (new Set(lubricantFormatIdsBruts).size !== lubricantFormatIdsBruts.length) {
        throw new BadRequestException("Un même format de lubrifiant ne peut être saisi qu'une seule fois par versement.");
      }
      const lubricantFormats = lubricantFormatIdsBruts.length
        ? await this.prisma.lubricantFormat.findMany({ where: { id: { in: lubricantFormatIdsBruts } }, include: { lubricantProduct: true } })
        : [];
      if (lubricantFormats.length !== new Set(lubricantFormatIdsBruts).size) {
        throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont introuvables.");
      }
      if (lubricantFormats.some((f) => f.statut !== "ACTIF" || f.lubricantProduct.statut !== "ACTIF")) {
        throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont inactifs et ne peuvent plus être vendus.");
      }
      const lubricantFormatById = new Map(lubricantFormats.map((f) => [f.id, f]));
      lubricantSalesData = dto.lubricantSales.map((v) => {
        const format = lubricantFormatById.get(v.lubricantFormatId)!;
        return { lubricantFormatId: v.lubricantFormatId, quantite: v.quantite, montantCalcule: v.quantite * Number(format.prixUnitaire) };
      });
    }
    const nouveauMontantLub = lubricantSalesData !== null ? lubricantSalesData.reduce((s, v) => s + v.montantCalcule, 0) : ancienMontantLub;

    await this.prisma.$transaction([
      this.prisma.versementProduit.update({
        where: { id: versementId },
        data: {
          quantiteGpl125Pleine, quantiteGpl125Consigne, quantiteGpl125ConsigneRecharge,
          quantiteGpl35Pleine, quantiteGpl35Consigne, quantiteGpl35ConsigneRecharge,
          montantGpl,
          modePaiement,
        },
      }),
      ...(lubricantSalesData !== null
        ? [
            this.prisma.versementLubrifiantSale.deleteMany({ where: { versementId } }),
            this.prisma.versementProduit.update({ where: { id: versementId }, data: { lubricantSales: { create: lubricantSalesData } } }),
          ]
        : []),
    ]);

    const detailParts = [
      montantGpl !== ancienMontantGpl && `Gaz ${fcfa(ancienMontantGpl)} → ${fcfa(montantGpl)}`,
      modePaiement !== ancienModePaiement && `Mode de paiement Gaz ${ancienModePaiement === "TPE" ? "TPE" : "Cash"} → ${modePaiement === "TPE" ? "TPE" : "Cash"}`,
      nouveauMontantLub !== ancienMontantLub && `Lubrifiants ${fcfa(ancienMontantLub)} → ${fcfa(nouveauMontantLub)}`,
    ].filter(Boolean);
    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Versement en cours de quart modifié",
      detail: `${versement.attendant.prenom} ${versement.attendant.nom} — ${detailParts.length > 0 ? detailParts.join(" — ") : "aucune valeur modifiée"}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Supprime une remise en caisse saisie par erreur et recalcule l'index courant de la pompe
   * concernée à partir de ses remises restantes (redevient `null` s'il n'en reste aucune).
   */
  async supprimerRemise(cashEntryId: string, remiseId: string, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true, remises: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez supprimer une remise que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucune remise ne peut plus y être supprimée.");
    }

    const pumpReading = entry.pumpReadings.find((r) => r.remises.some((rm) => rm.id === remiseId));
    if (!pumpReading) throw new NotFoundException("Remise introuvable pour ce quart.");
    const remise = pumpReading.remises.find((rm) => rm.id === remiseId)!;

    const litresRestantes = pumpReading.remises
      .filter((rm) => rm.id !== remiseId)
      .reduce((s, rm) => s + Number(rm.litres), 0);
    const restantIlEnA = pumpReading.remises.length > 1;
    const indexCourant = restantIlEnA ? Number(pumpReading.indexOuverture) + litresRestantes : null;

    await this.prisma.$transaction([
      this.prisma.remiseCaisse.delete({ where: { id: remiseId } }),
      this.prisma.pumpReading.update({ where: { id: pumpReading.id }, data: { indexCourant } }),
    ]);

    const detailParts = [
      `Cash ${fcfa(Number(remise.montant))}`,
      Number(remise.montantTpe) > 0 && `TPE-(${pumpReading.pump.code}) ${fcfa(Number(remise.montantTpe))}`,
    ].filter(Boolean);
    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Remise en caisse supprimée",
      detail: `${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} — pompe ${pumpReading.pump.code} — ${detailParts.join(" — ")} supprimé(e)`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /** Supprime un versement (Gaz et/ou Lubrifiants) saisi par erreur. */
  async supprimerVersement(cashEntryId: string, versementId: string, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { versements: { include: { attendant: true, lubricantSales: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez supprimer un versement que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucun versement ne peut plus y être supprimé.");
    }

    const versement = entry.versements.find((v) => v.id === versementId);
    if (!versement) throw new NotFoundException("Versement introuvable pour ce quart.");

    const detailParts = [
      Number(versement.montantTpe) > 0 && `TPE ${fcfa(Number(versement.montantTpe))}`,
      Number(versement.montantGpl) > 0 && `Gaz ${fcfa(Number(versement.montantGpl))}`,
      versement.lubricantSales.length > 0 && `Lubrifiants ${fcfa(versement.lubricantSales.reduce((s, ls) => s + Number(ls.montantCalcule), 0))}`,
    ].filter(Boolean);

    await this.prisma.$transaction([
      this.prisma.versementLubrifiantSale.deleteMany({ where: { versementId } }),
      this.prisma.versementProduit.delete({ where: { id: versementId } }),
    ]);

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Versement en cours de quart supprimé",
      detail: `${versement.attendant.prenom} ${versement.attendant.nom} — ${detailParts.join(" — ")} supprimé(s)`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Réaffecte une pompe à un autre pompiste en cours de quart (ex. malaise ou maladie du
   * pompiste initial). L'index d'ouverture, l'index courant et les remises déjà enregistrées
   * sur cette pompe sont conservés tels quels — seul le pompiste responsable change à partir
   * de maintenant.
   */
  async reassignerPompe(cashEntryId: string, dto: ReassignerPompeDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez réaffecter une pompe que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucune pompe ne peut plus y être réaffectée.");
    }

    const pumpReading = entry.pumpReadings.find((r) => r.id === dto.pumpReadingId);
    if (!pumpReading) {
      throw new BadRequestException("Cette pompe ne fait pas partie de ce quart.");
    }
    if (pumpReading.attendantId === dto.nouvelAttendantId) {
      throw new BadRequestException("Ce pompiste est déjà responsable de cette pompe.");
    }

    const nouvelAttendant = await this.prisma.attendant.findUnique({ where: { id: dto.nouvelAttendantId } });
    if (!nouvelAttendant || nouvelAttendant.stationId !== entry.stationId) {
      throw new BadRequestException("Ce pompiste ne fait pas partie de cette station.");
    }
    if (nouvelAttendant.statut !== "ACTIF") {
      throw new BadRequestException("Ce pompiste est inactif et ne peut pas être affecté à un quart.");
    }

    // Même règle que pour les autres pompes du pompiste : 8 pompes maximum sur un même quart.
    const pompesDejaTenues = entry.pumpReadings.filter((r) => r.attendantId === dto.nouvelAttendantId).length;
    if (pompesDejaTenues >= 8) {
      throw new BadRequestException(`${nouvelAttendant.prenom} ${nouvelAttendant.nom} tient déjà 8 pompes sur ce quart — maximum atteint.`);
    }

    // Un pompiste ne peut être affecté qu'à un seul quart par jour : vérifie qu'il n'est pas
    // déjà engagé sur un autre quart de cette station à cette même date.
    const entriesMemeJourAutreQuart = await this.prisma.cashEntry.findMany({
      where: { stationId: entry.stationId, date: entry.date, quart: { not: entry.quart } },
      include: { pumpReadings: true },
    });
    const dejaAffecteAilleurs = entriesMemeJourAutreQuart.some(
      (e) =>
        e.responsableQuartId === dto.nouvelAttendantId ||
        e.responsableGplId === dto.nouvelAttendantId ||
        e.responsableLubrifiantsId === dto.nouvelAttendantId ||
        e.pumpReadings.some((r) => r.attendantId === dto.nouvelAttendantId),
    );
    if (dejaAffecteAilleurs) {
      throw new ConflictException(
        `${nouvelAttendant.prenom} ${nouvelAttendant.nom} est déjà affecté(e) à un autre quart ce jour-là.`,
      );
    }

    const pumpReadingMaj = await this.prisma.pumpReading.update({
      where: { id: pumpReading.id },
      data: { attendantId: dto.nouvelAttendantId },
      include: { pump: true, attendant: true, remises: { orderBy: { createdAt: "asc" } } },
    });

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Pompe réaffectée en cours de quart",
      detail: `Pompe ${pumpReading.pump.code} — ${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} → ${nouvelAttendant.prenom} ${nouvelAttendant.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return pumpReadingMaj;
  }

  /**
   * Clôture un quart EN_COURS : relevés réels de fermeture par pompe. Le cash
   * physique, le TPE, le Gaz et les Lubrifiants sont entièrement dérivés des
   * versements progressifs déjà enregistrés pendant le quart (remises +
   * VersementProduit) — il n'y a plus rien d'autre à saisir ici que les index.
   */
  async cloturer(cashEntryId: string, dto: CloturerCashEntryDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: {
        pumpReadings: { include: { pump: true, remises: true } },
        versements: { include: { lubricantSales: true } },
      },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez clôturer un quart que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new ConflictException("Ce quart a déjà été clôturé.");
    }

    const clotureParPumpReadingId = new Map(dto.pumpReadings.map((p) => [p.pumpReadingId, p.indexFermeture]));
    if (clotureParPumpReadingId.size !== entry.pumpReadings.length || entry.pumpReadings.some((r) => !clotureParPumpReadingId.has(r.id))) {
      throw new BadRequestException("L'index de fermeture de chaque pompe du quart doit être renseigné, ni plus ni moins.");
    }

    const prixConfig = await this.pricesService.get();

    const pumpReadingsMaj = entry.pumpReadings.map((r) => {
      const indexFermeture = clotureParPumpReadingId.get(r.id)!;
      const indexOuverture = Number(r.indexOuverture);
      if (indexFermeture < indexOuverture) {
        throw new BadRequestException(`Index de fermeture inférieur à l'index d'ouverture pour la pompe ${r.pump.code}.`);
      }
      const litresVendus = indexFermeture - indexOuverture;
      const prixLitre = prixLitreDuProduit(r.pump.produit, prixConfig);
      const montantCalcule = litresVendus * prixLitre;
      return { id: r.id, indexFermeture, litresVendus, montantCalcule };
    });
    const montantCarburant = pumpReadingsMaj.reduce((s, p) => s + p.montantCalcule, 0);

    // Cash physique = somme de toutes les remises en caisse reçues pendant le quart (plus de
    // billetage manuel obligatoire). TPE = somme du TPE propre à chaque pompe (RemiseCaisse) +
    // les éventuels versements TPE historiques (VersementProduit, saisis avant que le TPE ne
    // devienne propre à chaque pompe). Gaz et Lubrifiants = somme des versements progressifs.
    const montant = entry.pumpReadings.reduce((s, r) => s + r.remises.reduce((s2, rm) => s2 + Number(rm.montant), 0), 0);
    const montantTpe =
      entry.pumpReadings.reduce((s, r) => s + r.remises.reduce((s2, rm) => s2 + Number(rm.montantTpe), 0), 0) +
      entry.versements.reduce((s, v) => s + Number(v.montantTpe), 0);
    const montantGpl = entry.versements.reduce((s, v) => s + Number(v.montantGpl), 0);
    const quantiteGpl125Pleine = entry.versements.reduce((s, v) => s + v.quantiteGpl125Pleine, 0);
    const quantiteGpl125Consigne = entry.versements.reduce((s, v) => s + v.quantiteGpl125Consigne, 0);
    const quantiteGpl125ConsigneRecharge = entry.versements.reduce((s, v) => s + v.quantiteGpl125ConsigneRecharge, 0);
    const quantiteGpl35Pleine = entry.versements.reduce((s, v) => s + v.quantiteGpl35Pleine, 0);
    const quantiteGpl35Consigne = entry.versements.reduce((s, v) => s + v.quantiteGpl35Consigne, 0);
    const quantiteGpl35ConsigneRecharge = entry.versements.reduce((s, v) => s + v.quantiteGpl35ConsigneRecharge, 0);

    const lubMap = new Map<string, { quantite: number; montant: number }>();
    for (const v of entry.versements) {
      for (const ls of v.lubricantSales) {
        const cur = lubMap.get(ls.lubricantFormatId) ?? { quantite: 0, montant: 0 };
        cur.quantite += ls.quantite;
        cur.montant += Number(ls.montantCalcule);
        lubMap.set(ls.lubricantFormatId, cur);
      }
    }
    const lubricantSalesData = [...lubMap.entries()].map(([lubricantFormatId, v]) => ({
      lubricantFormatId, quantite: v.quantite, montantCalcule: v.montant,
    }));
    const montantLubrifiants = lubricantSalesData.reduce((s, v) => s + v.montantCalcule, 0);

    // Comptage de vérification optionnel : n'alimente plus le cash physique officiel, sert
    // uniquement à signaler un écart de comptage à surveiller.
    const denominations = dto.denominations ?? [];
    const totalBillets = denominations.filter((d) => d.type === "BILLET").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const totalPieces = denominations.filter((d) => d.type === "PIECE").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const ecartComptage = denominations.length > 0 ? totalBillets + totalPieces - montant : null;

    // Cash Global = tout ce qui a été reçu (cash + TPE carburant, et Gaz/Lubrifiants — également
    // vendus et encaissés, mais sans compteur physique à vérifier). Comparé au Total théorique
    // (Carburant+Gaz+Lubrifiants), Gaz et Lubrifiants s'annulent des deux côtés : l'écart se
    // recentre ainsi sur le seul écart carburant (cash/TPE remis vs. index de pompe réel).
    const montantGlobal = montant + montantTpe + montantGpl + montantLubrifiants;
    const ecart = montantGlobal - (montantCarburant + montantGpl + montantLubrifiants);

    await this.prisma.$transaction([
      ...pumpReadingsMaj.map((p) =>
        this.prisma.pumpReading.update({
          where: { id: p.id },
          data: { indexFermeture: p.indexFermeture, litresVendus: p.litresVendus, montantCalcule: p.montantCalcule },
        }),
      ),
      this.prisma.cashEntry.update({
        where: { id: cashEntryId },
        data: {
          statut: "CLOTURE",
          totalBillets,
          totalPieces,
          montant,
          montantTpe,
          montantGlobal,
          quantiteGpl125Pleine,
          quantiteGpl125Consigne,
          quantiteGpl125ConsigneRecharge,
          quantiteGpl35Pleine,
          quantiteGpl35Consigne,
          quantiteGpl35ConsigneRecharge,
          montantGpl,
          montantCarburant,
          montantLubrifiants,
          ecart,
          denominations: {
            create: denominations.filter((d) => d.quantite > 0).map((d) => ({
              type: d.type,
              valeurFaciale: d.valeurFaciale,
              quantite: d.quantite,
              sousTotal: d.valeurFaciale * d.quantite,
            })),
          },
          lubricantSales: { create: lubricantSalesData },
        },
      }),
    ]);

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Quart clôturé",
      detail:
        `Quart ${entry.quart} — Cash physique ${fcfa(montant)} + TPE ${fcfa(montantTpe)} + Gaz ${fcfa(montantGpl)} + Lubrifiants ${fcfa(montantLubrifiants)} = Global ${fcfa(montantGlobal)} — ` +
        `Carburant+Gaz+Lubrifiants calculé ${fcfa(montantCarburant + montantGpl + montantLubrifiants)} — Écart ${fcfa(ecart)}` +
        (ecartComptage !== null && Math.abs(ecartComptage) > 0.01
          ? ` — ⚠ Comptage de vérification différent des remises de ${fcfa(ecartComptage)}`
          : ""),
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }
}
