import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Produit, PriceConfig } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PricesService } from "../prices/prices.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { CloturerCashEntryDto } from "./dto/cloturer-cash-entry.dto";
import { RemiseCaisseDto } from "./dto/remise-caisse.dto";
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
  pumpReadings: { include: { pump: true, attendant: true, remises: { orderBy: { createdAt: "asc" as const } } } },
  lubricantSales: { include: { lubricantFormat: { include: { lubricantProduct: true } } } },
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
   * Remise en caisse mid-quart : le pompiste ne doit pas garder plus de 100 000 FCFA
   * dans sa "banane" sur la piste de vente, il reverse donc régulièrement son cash à
   * la gérante. Chaque remise fait avancer l'index courant de la pompe concernée
   * (montant / prix au litre du produit), sans attendre la clôture du quart — c'est
   * ce qui permet à la Trésorerie et au Contrôle Interne de voir le cash physique
   * se constituer en temps réel.
   */
  async enregistrerRemise(cashEntryId: string, dto: RemiseCaisseDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez saisir une remise que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucune remise ne peut plus y être ajoutée.");
    }

    const pumpReading = entry.pumpReadings.find((r) => r.id === dto.pumpReadingId);
    if (!pumpReading) {
      throw new BadRequestException("Cette pompe ne fait pas partie de ce quart.");
    }

    const prixConfig = await this.pricesService.get();
    const prixLitre = prixLitreDuProduit(pumpReading.pump.produit, prixConfig);
    const litres = dto.montant / prixLitre;
    const indexCourant = Number(pumpReading.indexCourant ?? pumpReading.indexOuverture) + litres;

    const [, pumpReadingMaj] = await this.prisma.$transaction([
      this.prisma.remiseCaisse.create({
        data: { pumpReadingId: pumpReading.id, montant: dto.montant, litres },
      }),
      this.prisma.pumpReading.update({
        where: { id: pumpReading.id },
        data: { indexCourant },
        include: { pump: true, attendant: true, remises: { orderBy: { createdAt: "asc" } } },
      }),
    ]);

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Remise en caisse enregistrée",
      detail: `${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} — pompe ${pumpReading.pump.code} — ${fcfa(dto.montant)} remis(e) à la gérante`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return pumpReadingMaj;
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

  /** Clôture un quart EN_COURS : index de fermeture réels + billetage + TPE + GPL + lubrifiants. */
  async cloturer(cashEntryId: string, dto: CloturerCashEntryDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true } } },
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

    const montantGpl =
      dto.quantiteGpl125Pleine * Number(prixConfig.prixGpl125Pleine) +
      dto.quantiteGpl125Consigne * Number(prixConfig.prixGpl125Consigne) +
      dto.quantiteGpl125ConsigneRecharge * Number(prixConfig.prixGpl125ConsigneRecharge) +
      dto.quantiteGpl35Pleine * Number(prixConfig.prixGpl35Pleine) +
      dto.quantiteGpl35Consigne * Number(prixConfig.prixGpl35Consigne) +
      dto.quantiteGpl35ConsigneRecharge * Number(prixConfig.prixGpl35ConsigneRecharge);

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
    if (lubricantFormats.some((f) => f.statut !== "ACTIF" || f.lubricantProduct.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs formats de lubrifiant sont inactifs et ne peuvent plus être vendus.");
    }
    const lubricantFormatById = new Map(lubricantFormats.map((f) => [f.id, f]));
    const lubricantSalesData = dto.lubricantSales.map((v) => {
      const format = lubricantFormatById.get(v.lubricantFormatId)!;
      return { lubricantFormatId: v.lubricantFormatId, quantite: v.quantite, montantCalcule: v.quantite * Number(format.prixUnitaire) };
    });
    const montantLubrifiants = lubricantSalesData.reduce((s, v) => s + v.montantCalcule, 0);

    const totalBillets = dto.denominations.filter((d) => d.type === "BILLET").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const totalPieces = dto.denominations.filter((d) => d.type === "PIECE").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const montant = totalBillets + totalPieces;
    const montantGlobal = montant + dto.montantTpe;
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
            create: dto.denominations.filter((d) => d.quantite > 0).map((d) => ({
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
      detail: `Quart ${entry.quart} — Cash physique ${fcfa(montant)} + TPE ${fcfa(dto.montantTpe)} = Global ${fcfa(montantGlobal)} — Carburant+Gaz+Lubrifiants calculé ${fcfa(montantCarburant + montantGpl + montantLubrifiants)} — Écart ${fcfa(ecart)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }
}
