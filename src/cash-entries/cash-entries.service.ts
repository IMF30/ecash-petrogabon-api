import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, Produit, PriceConfig, Quart } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { PricesService } from "../prices/prices.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { CloturerCashEntryDto } from "./dto/cloturer-cash-entry.dto";
import { VersementProduitDto } from "./dto/versement-produit.dto";
import { ModifierRemiseDto } from "./dto/modifier-remise.dto";
import { ModifierVersementDto } from "./dto/modifier-versement.dto";
import { ReassignerPompeDto } from "./dto/reassigner-pompe.dto";
import { genererCodesPinUniques } from "../attendants/pin-generator";
import { JwtPayload } from "../auth/types";

/**
 * Forme minimale d'acteur acceptée par enregistrerVersement : un JwtPayload (Gérante/
 * Administrateur) la satisfait déjà telle quelle, mais elle admet aussi l'acteur
 * synthétique construit par PompisteModule (role: "POMPISTE", qui n'existe pas dans
 * l'enum Prisma Role réservé aux comptes Utilisateur).
 */
interface ActeurVersement {
  sub: string;
  role: string;
  stationId: string | null;
}

function fcfa(n: number): string {
  return new Intl.NumberFormat("fr-FR").format(n) + " FCFA";
}

const QUART_LABEL: Record<string, string> = { MATIN: "Matin", SOIR: "Soir", NUIT: "Nuit" };

// Un pompiste ne doit pas garder plus de 100 000 FCFA dans sa "banane" entre deux remises (cf.
// CashEntry model doc). Le système n'a pas de télémétrie live des pompes : on ne peut donc QUE
// constater, a posteriori, qu'une remise reçue couvrait plus que ce plafond — pas l'empêcher en
// amont. Ce constat est journalisé (catégorie POMPISTE) pour le Journal d'Audit ; la gérante le
// voit aussi, calculé côté front à partir des mêmes remises déjà chargées (voir
// remisesDepassantLePlafond() dans encaissements-store.ts).
const PLAFOND_BANANE_FCFA = 100_000;

/** Ordre chronologique des quarts au sein d'une même journée (pour comparer deux quarts du même jour). */
const QUART_ORDER: Record<Quart, number> = { MATIN: 0, SOIR: 1, NUIT: 2 };

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
  versements: {
    include: { attendant: true },
    orderBy: { createdAt: "asc" as const },
  },
  responsableQuart: true,
  responsableGpl: true,
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
    // Garde-fou anti-saisie historique arbitraire (pas une vraie règle métier) — assez large pour
    // rattraper un oubli de saisie récent, sans permettre de fabriquer un quart à une date ancienne.
    const septJoursAvant = new Date(aujourdhui);
    septJoursAvant.setUTCDate(septJoursAvant.getUTCDate() - 7);
    if (date.getTime() < septJoursAvant.getTime()) {
      throw new BadRequestException("La date du quart ne peut pas remonter à plus de 7 jours.");
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
      ...new Set([dto.responsableQuartId, dto.responsableGplId, ...dto.pumpReadings.map((p) => p.attendantId)]),
    ];
    const attendants = await this.prisma.attendant.findMany({ where: { id: { in: attendantIds } } });
    if (attendants.length !== attendantIds.length || attendants.some((a) => a.stationId !== dto.stationId)) {
      throw new BadRequestException("Un ou plusieurs pompistes ne correspondent pas à cette station.");
    }
    if (attendants.some((a) => a.statut !== "ACTIF")) {
      throw new BadRequestException("Un ou plusieurs pompistes sont inactifs et ne peuvent plus être affectés à un quart.");
    }

    // Règle métier : un pompiste ne peut être affecté qu'à un seul quart par jour, tous rôles confondus
    // (responsable de quart, GPL ou pompiste). On récupère donc tous les encaissements du même jour
    // sur les AUTRES quarts de cette station pour détecter un pompiste déjà affecté ailleurs.
    const entriesMemeJourAutreQuart = await this.prisma.cashEntry.findMany({
      where: { stationId: dto.stationId, date, quart: { not: dto.quart } },
      include: { pumpReadings: true },
    });
    const attendantIdsDejaAffectes = new Set<string>();
    for (const e of entriesMemeJourAutreQuart) {
      attendantIdsDejaAffectes.add(e.responsableQuartId);
      attendantIdsDejaAffectes.add(e.responsableGplId);
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

    // Continuité des compteurs : l'index d'ouverture d'une pompe doit reprendre exactement là où
    // le dernier quart clôturé l'ayant utilisée s'est arrêté — une pompe physique ne "remet pas à
    // zéro" son compteur entre deux quarts. On cherche sa dernière lecture connue (pas forcément
    // le quart immédiatement précédent : une pompe n'est pas forcément affectée à chaque quart).
    const dernieresLectures = await this.prisma.pumpReading.findMany({
      where: {
        pumpId: { in: pumpIds },
        indexFermeture: { not: null },
        cashEntry: { stationId: dto.stationId, statut: "CLOTURE", date: { lte: date } },
      },
      select: { pumpId: true, indexFermeture: true, cashEntry: { select: { date: true, quart: true } } },
    });
    const lecturesParPompe = new Map<string, { date: Date; quart: Quart; indexFermeture: number }[]>();
    for (const l of dernieresLectures) {
      const liste = lecturesParPompe.get(l.pumpId) ?? [];
      liste.push({ date: l.cashEntry.date, quart: l.cashEntry.quart, indexFermeture: Number(l.indexFermeture) });
      lecturesParPompe.set(l.pumpId, liste);
    }
    const erreursIndex: string[] = [];
    for (const r of dto.pumpReadings) {
      const avant = (lecturesParPompe.get(r.pumpId) ?? [])
        .filter((l) => l.date.getTime() < date.getTime() || (l.date.getTime() === date.getTime() && QUART_ORDER[l.quart] < QUART_ORDER[dto.quart]))
        .sort((a, b) => b.date.getTime() - a.date.getTime() || QUART_ORDER[b.quart] - QUART_ORDER[a.quart]);
      const derniere = avant[0];
      if (derniere && derniere.indexFermeture !== r.indexOuverture) {
        const code = pumps.find((p) => p.id === r.pumpId)?.code ?? r.pumpId;
        erreursIndex.push(`${code} (attendu ${derniere.indexFermeture}, saisi ${r.indexOuverture})`);
      }
    }
    if (erreursIndex.length > 0) {
      throw new BadRequestException(
        `L'index d'ouverture doit correspondre à l'index de fermeture du dernier quart clôturé pour chaque pompe : ${erreursIndex.join(", ")}.`,
      );
    }

    // Un nouveau PIN est régénéré pour chaque pompiste impliqué à chaque ouverture de quart —
    // empêche un PIN mémorisé/partagé entre pompistes de rester valable indéfiniment. Hashés avant
    // la transaction (argon2 est asynchrone, incompatible avec un tableau $transaction) ; générés
    // seulement maintenant (pas avant les validations ci-dessus) pour ne pas en gaspiller si la
    // création du quart échoue au final.
    const codesPin = genererCodesPinUniques(attendantIds.length);
    const pinHashes = await Promise.all(codesPin.map((pin) => argon2.hash(pin)));

    let entry;
    try {
      const [entryCree] = await this.prisma.$transaction([
        this.prisma.cashEntry.create({
          data: {
            stationId: dto.stationId,
            quart: dto.quart,
            date,
            statut: "EN_COURS",
            responsableQuartId: dto.responsableQuartId,
            responsableGplId: dto.responsableGplId,
            pumpReadings: {
              create: dto.pumpReadings.map((r) => ({
                attendantId: r.attendantId,
                pumpId: r.pumpId,
                indexOuverture: r.indexOuverture,
              })),
            },
          },
          include: INCLUDE_COMPLET,
        }),
        ...attendantIds.map((id, i) =>
          this.prisma.attendant.update({
            where: { id },
            data: { pinHash: pinHashes[i], pinFailedAttempts: 0, pinLockedUntil: null },
          }),
        ),
      ]);
      entry = entryCree;
    } catch (e) {
      // Filet de sécurité contre la course : si deux requêtes passent la vérification findUnique en même
      // temps, seule la première insertion réussit et la seconde déclenche la contrainte unique en base
      // (P2002 sur stationId_quart_date), qu'on traduit ici en erreur métier plutôt qu'en 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new ConflictException("Ce quart a déjà été enregistré pour cette date et ne peut plus être ressaisi.");
      }
      throw e;
    }

    const attendantParId = new Map(attendants.map((a) => [a.id, a]));
    const pinsGeneres = attendantIds.map((id, i) => {
      const a = attendantParId.get(id)!;
      return { attendantId: id, prenom: a.prenom, nom: a.nom, pin: codesPin[i] };
    });

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Quart ouvert",
      detail: `Quart ${dto.quart} ouvert avec ${dto.pumpReadings.length} pompe(s) — en attente de clôture. Nouveaux PIN générés pour ${attendantIds.length} pompiste(s).`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: dto.stationId,
    });

    return { ...entry, pinsGeneres };
  }

  /**
   * Versement progressif mid-quart : le pompiste ne doit pas garder plus de 100 000 FCFA
   * dans sa "banane" sur la piste de vente, il reverse donc régulièrement son cash à la
   * gérante, pompe par pompe (fait avancer l'index courant de chaque pompe concernée —
   * montant / prix au litre du produit). Dans le même geste, il ou elle peut aussi déclarer
   * ses ventes carte (TPE) et, pour le/la responsable Gaz du quart, les bouteilles vendues
   * depuis le dernier versement. Rien n'attend la clôture du quart — c'est ce qui permet à
   * la Trésorerie et au Contrôle Interne de voir le cash physique et les ventes se
   * constituer en temps réel.
   */
  async enregistrerVersement(cashEntryId: string, dto: VersementProduitDto, actor: ActeurVersement, acteurLabelOverride?: string) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true } }, station: true },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    // Généralisé (au lieu de "actor.role === 'GERANTE'") : tout acteur rattaché à une
    // station précise — Gérante ou, désormais, un pompiste via l'espace dédié — ne peut
    // agir que sur sa propre station. Administrateur/Trésorerie ont stationId === null.
    if (actor.stationId && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez saisir un versement que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé, aucun versement ne peut plus y être ajouté.");
    }

    const attendantsImpliques = new Set([
      entry.responsableQuartId, entry.responsableGplId,
      ...entry.pumpReadings.map((r) => r.attendantId),
    ]);
    if (!attendantsImpliques.has(dto.attendantId)) {
      throw new BadRequestException("Ce pompiste ne fait pas partie de ce quart.");
    }
    const attendant = entry.pumpReadings.find((r) => r.attendantId === dto.attendantId)?.attendant
      ?? (await this.prisma.attendant.findUnique({ where: { id: dto.attendantId } }))!;

    const remisesDto = (dto.remises ?? []).filter((r) => r.montant > 0 || (r.montantTpe ?? 0) > 0);
    // Une remise ne peut être attribuée qu'au pompiste réellement affecté à cette pompe sur
    // ce quart — empêche de créditer (par erreur ou volontairement) la pompe d'un autre.
    const remisePompeEtrangere = remisesDto.find((r) => {
      const pumpReading = entry.pumpReadings.find((pr) => pr.id === r.pumpReadingId);
      return pumpReading && pumpReading.attendantId !== dto.attendantId;
    });
    if (remisePompeEtrangere) {
      throw new ForbiddenException("Une remise ne peut être saisie que pour une pompe affectée à ce pompiste sur ce quart.");
    }
    const qteGpl125Pleine = dto.quantiteGpl125Pleine ?? 0;
    const qteGpl125Consigne = dto.quantiteGpl125Consigne ?? 0;
    const qteGpl125ConsigneRecharge = dto.quantiteGpl125ConsigneRecharge ?? 0;
    const qteGpl35Pleine = dto.quantiteGpl35Pleine ?? 0;
    const qteGpl35Consigne = dto.quantiteGpl35Consigne ?? 0;
    const qteGpl35ConsigneRecharge = dto.quantiteGpl35ConsigneRecharge ?? 0;
    const aUneVenteGpl = qteGpl125Pleine + qteGpl125Consigne + qteGpl125ConsigneRecharge + qteGpl35Pleine + qteGpl35Consigne + qteGpl35ConsigneRecharge > 0;
    // Seul le/la responsable Gaz désigné(e) à l'ouverture du quart peut déclarer une vente Gaz.
    if (aUneVenteGpl && dto.attendantId !== entry.responsableGplId) {
      throw new ForbiddenException("Seul le/la responsable désigné(e) des ventes Gaz peut déclarer une vente Gaz sur ce quart.");
    }
    // Une vente Gaz est presque toujours payée cash, mais une vente TPE-Gaz est possible.
    const modePaiementGpl = dto.modePaiementGpl ?? "CASH";

    if (remisesDto.length === 0 && !aUneVenteGpl) {
      throw new BadRequestException("Renseignez au moins un montant remis ou TPE pour une pompe, ou une vente de gaz.");
    }

    const prixConfig = await this.pricesService.get();

    const remisesAEnregistrer = remisesDto.map((r) => {
      const pumpReading = entry.pumpReadings.find((pr) => pr.id === r.pumpReadingId);
      if (!pumpReading) throw new BadRequestException("Cette pompe ne fait pas partie de ce quart.");
      const prixLitre = prixLitreDuProduit(pumpReading.pump.produit, prixConfig);
      const montantTpe = r.montantTpe ?? 0;
      // L'index courant reflète le carburant réellement délivré par cette pompe — donc le cash ET
      // le TPE de cette remise (un client qui paie par carte fait quand même tourner le compteur).
      // Note : on ne calcule plus ici l'index courant absolu (il dépendrait d'une lecture
      // potentiellement périmée) — voir l'incrément SQL atomique juste en dessous.
      const litres = (r.montant + montantTpe) / prixLitre;
      return {
        pumpReadingId: pumpReading.id,
        pumpCode: pumpReading.pump.code,
        produit: pumpReading.pump.produit,
        montant: r.montant,
        montantTpe,
        litres,
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

    const resultatsTransaction = await this.prisma.$transaction([
      ...remisesAEnregistrer.flatMap((r) => [
        this.prisma.remiseCaisse.create({
          data: { pumpReadingId: r.pumpReadingId, montant: r.montant, montantTpe: r.montantTpe, litres: r.litres },
        }),
        // Incrément atomique calculé par Postgres lui-même (COALESCE gère la toute première
        // remise, où indexCourant vaut encore NULL) — élimine la course entre deux remises
        // quasi simultanées sur la même pompe qu'un read-then-write en JS ne peut pas éviter.
        this.prisma.$executeRaw`
          UPDATE pump_readings SET "indexCourant" = COALESCE("indexCourant", "indexOuverture") + ${r.litres}
          WHERE id = ${r.pumpReadingId}
        `,
      ]),
      ...(aUneVenteGpl
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
              },
            }),
          ]
        : []),
      this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET }),
    ]);
    // Le dernier élément est toujours le findUnique final, quel que soit le nombre de remises/le
    // versement optionnel qui le précèdent dans le tableau.
    // Le tableau mélange désormais des résultats `$executeRaw` (number, pour les incréments
    // atomiques d'indexCourant) avec les créations/mises à jour Prisma classiques — seul le tout
    // dernier élément (le findUnique final) nous intéresse ici, jamais un `number`.
    const entryMaj = resultatsTransaction[resultatsTransaction.length - 1] as Exclude<(typeof resultatsTransaction)[number], number>;
    if (!entryMaj) throw new NotFoundException("Quart introuvable après enregistrement du versement.");

    // Signalement a posteriori (pas de blocage, voir PLAFOND_BANANE_FCFA ci-dessus) : cette
    // remise révèle que le pompiste a tenu plus que le plafond autorisé avant de la remettre.
    for (const r of remisesAEnregistrer) {
      if (r.montant + r.montantTpe > PLAFOND_BANANE_FCFA) {
        await this.auditService.record({
          categorie: "POMPISTE",
          action: "Anomalie : plafond banane dépassé",
          detail: `${attendant.prenom} ${attendant.nom} — pompe ${r.pumpCode} — ${fcfa(r.montant + r.montantTpe)} remis en une fois (plafond ${fcfa(PLAFOND_BANANE_FCFA)})`,
          acteurUserId: actor.sub,
          acteurLabel: acteurLabelOverride ?? actor.role,
          stationId: entry.stationId,
        });
      }
    }

    const detailParts = [
      remisesAEnregistrer.length > 0 && `Cash : ${remisesAEnregistrer.map((r) => `${r.pumpCode} ${fcfa(r.montant)}`).join(", ")}`,
      montantTpeTotal > 0 && `TPE : ${remisesAEnregistrer.filter((r) => r.montantTpe > 0).map((r) => `TPE-(${r.pumpCode}) ${fcfa(r.montantTpe)}`).join(", ")}`,
      aUneVenteGpl && `Gaz ${fcfa(montantGpl)} (${modePaiementGpl === "TPE" ? "TPE" : "Cash"})`,
    ].filter(Boolean);
    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Versement en cours de quart enregistré",
      detail: `${attendant.prenom} ${attendant.nom} — ${detailParts.join(" — ")}`,
      acteurUserId: actor.sub,
      acteurLabel: acteurLabelOverride ?? actor.role,
      stationId: entry.stationId,
    });

    // Récapitulatif du versement qui vient d'être enregistré (par opposition à entryMaj,
    // qui reflète l'état complet du quart) — sert à imprimer un ticket côté pompiste sans
    // avoir à recalculer ces montants/litres une seconde fois côté appelant.
    const dernierVersement = {
      horodatage: new Date().toISOString(),
      quart: entry.quart,
      date: entry.date,
      station: { nom: entry.station.nom, ville: entry.station.ville, adresse: entry.station.adresse },
      pompiste: { nom: attendant.nom, prenom: attendant.prenom },
      lignes: remisesAEnregistrer.map((r) => ({
        pumpCode: r.pumpCode,
        produit: r.produit,
        montant: r.montant,
        montantTpe: r.montantTpe,
        litres: r.litres,
      })),
      gaz: aUneVenteGpl
        ? {
            quantiteGpl125Pleine: qteGpl125Pleine,
            quantiteGpl125Consigne: qteGpl125Consigne,
            quantiteGpl125ConsigneRecharge: qteGpl125ConsigneRecharge,
            quantiteGpl35Pleine: qteGpl35Pleine,
            quantiteGpl35Consigne: qteGpl35Consigne,
            quantiteGpl35ConsigneRecharge: qteGpl35ConsigneRecharge,
            montant: montantGpl,
            modePaiement: modePaiementGpl,
          }
        : null,
    };

    return { ...entryMaj, dernierVersement };
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
    // Incrément atomique par le DELTA (plutôt qu'un recalcul de la somme totale des remises, qui
    // resterait lui-même sujet à une course si une autre remise s'ajoute entre la lecture et
    // l'écriture) — même principe que l'incrément SQL d'enregistrerVersement() ci-dessus.
    const delta = nouvellesLitres - Number(remise.litres);

    await this.prisma.$transaction([
      this.prisma.remiseCaisse.update({ where: { id: remiseId }, data: { montant: dto.montant, montantTpe, litres: nouvellesLitres } }),
      this.prisma.$executeRaw`
        UPDATE pump_readings SET "indexCourant" = COALESCE("indexCourant", "indexOuverture") + ${delta}
        WHERE id = ${pumpReading.id}
      `,
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

    // Signalement a posteriori (voir PLAFOND_BANANE_FCFA) : la valeur corrigée peut, elle
    // aussi, révéler un dépassement qui ne serait pas apparu avec le montant d'origine.
    if (dto.montant + montantTpe > PLAFOND_BANANE_FCFA) {
      await this.auditService.record({
        categorie: "POMPISTE",
        action: "Anomalie : plafond banane dépassé",
        detail: `${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} — pompe ${pumpReading.pump.code} — ${fcfa(dto.montant + montantTpe)} remis en une fois (plafond ${fcfa(PLAFOND_BANANE_FCFA)})`,
        acteurUserId: actor.sub,
        acteurLabel: actor.role,
        stationId: entry.stationId,
      });
    }

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Acquitte une alerte "plafond banane dépassé" (voir PLAFOND_BANANE_FCFA) — passage de la
   * feuille d'alertes de la gérante à "traité". N'efface ni ne modifie la remise elle-même
   * (montant, TPE, litres, index de pompe inchangés) : seule une marque de traitement est posée,
   * conservée pour l'audit. Fonctionne même si le quart est déjà CLOTURE (contrairement à
   * modifierRemise) — traiter une alerte n'est pas une correction financière.
   */
  async traiterAlerteRemise(cashEntryId: string, remiseId: string, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { pump: true, attendant: true, remises: true } } },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez traiter une alerte que pour votre propre station.");
    }

    const pumpReading = entry.pumpReadings.find((r) => r.remises.some((rm) => rm.id === remiseId));
    if (!pumpReading) throw new NotFoundException("Remise introuvable pour ce quart.");
    const remise = pumpReading.remises.find((rm) => rm.id === remiseId)!;

    if (Number(remise.montant) + Number(remise.montantTpe) <= PLAFOND_BANANE_FCFA) {
      throw new BadRequestException("Cette remise ne dépasse pas le plafond — rien à traiter.");
    }
    if (remise.alerteTraiteeLe) {
      throw new BadRequestException("Cette alerte a déjà été traitée.");
    }

    await this.prisma.remiseCaisse.update({
      where: { id: remiseId },
      data: { alerteTraiteeLe: new Date(), alerteTraiteeParUserId: actor.sub },
    });

    await this.auditService.record({
      categorie: "POMPISTE",
      action: "Anomalie remise traitée",
      detail: `${pumpReading.attendant.prenom} ${pumpReading.attendant.nom} — pompe ${pumpReading.pump.code} — ${fcfa(Number(remise.montant) + Number(remise.montantTpe))}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Corrige un versement Gaz déjà enregistré (erreur de saisie ; le TPE se corrige désormais
   * par pompe via modifierRemise). Un champ omis dans le corps de la requête reste inchangé ;
   * le Gaz n'est recalculé que si l'une de ses quantités est fournie.
   */
  async modifierVersement(cashEntryId: string, versementId: string, dto: ModifierVersementDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { versements: { include: { attendant: true } } },
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

    await this.prisma.versementProduit.update({
      where: { id: versementId },
      data: {
        quantiteGpl125Pleine, quantiteGpl125Consigne, quantiteGpl125ConsigneRecharge,
        quantiteGpl35Pleine, quantiteGpl35Consigne, quantiteGpl35ConsigneRecharge,
        montantGpl,
        modePaiement,
      },
    });

    const detailParts = [
      montantGpl !== ancienMontantGpl && `Gaz ${fcfa(ancienMontantGpl)} → ${fcfa(montantGpl)}`,
      modePaiement !== ancienModePaiement && `Mode de paiement Gaz ${ancienModePaiement === "TPE" ? "TPE" : "Cash"} → ${modePaiement === "TPE" ? "TPE" : "Cash"}`,
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

  /** Supprime un versement Gaz saisi par erreur. */
  async supprimerVersement(cashEntryId: string, versementId: string, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { versements: { include: { attendant: true } } },
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
    ].filter(Boolean);

    await this.prisma.versementProduit.delete({ where: { id: versementId } });

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
   * physique, le TPE et le Gaz sont entièrement dérivés des versements
   * progressifs déjà enregistrés pendant le quart (remises + VersementProduit)
   * — il n'y a plus rien d'autre à saisir ici que les index.
   */
  async cloturer(cashEntryId: string, dto: CloturerCashEntryDto, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: {
        pumpReadings: { include: { pump: true, remises: true } },
        versements: true,
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
    // billetage manuel obligatoire) + les ventes Gaz payées cash. TPE = somme du TPE propre à
    // chaque pompe (RemiseCaisse) + les éventuels versements TPE historiques (VersementProduit,
    // saisis avant que le TPE ne devienne propre à chaque pompe) + les ventes Gaz payées TPE.
    const montantGplCash = entry.versements.reduce((s, v) => s + (v.modePaiement === "CASH" ? Number(v.montantGpl) : 0), 0);
    const montantGplTpe = entry.versements.reduce((s, v) => s + (v.modePaiement === "TPE" ? Number(v.montantGpl) : 0), 0);
    const montant = entry.pumpReadings.reduce((s, r) => s + r.remises.reduce((s2, rm) => s2 + Number(rm.montant), 0), 0) + montantGplCash;
    const montantTpe =
      entry.pumpReadings.reduce((s, r) => s + r.remises.reduce((s2, rm) => s2 + Number(rm.montantTpe), 0), 0) +
      entry.versements.reduce((s, v) => s + Number(v.montantTpe), 0) +
      montantGplTpe;
    const montantGpl = montantGplCash + montantGplTpe;
    const quantiteGpl125Pleine = entry.versements.reduce((s, v) => s + v.quantiteGpl125Pleine, 0);
    const quantiteGpl125Consigne = entry.versements.reduce((s, v) => s + v.quantiteGpl125Consigne, 0);
    const quantiteGpl125ConsigneRecharge = entry.versements.reduce((s, v) => s + v.quantiteGpl125ConsigneRecharge, 0);
    const quantiteGpl35Pleine = entry.versements.reduce((s, v) => s + v.quantiteGpl35Pleine, 0);
    const quantiteGpl35Consigne = entry.versements.reduce((s, v) => s + v.quantiteGpl35Consigne, 0);
    const quantiteGpl35ConsigneRecharge = entry.versements.reduce((s, v) => s + v.quantiteGpl35ConsigneRecharge, 0);

    // Comptage de vérification optionnel : n'alimente plus le cash physique officiel, sert
    // uniquement à signaler un écart de comptage à surveiller.
    const denominations = dto.denominations ?? [];
    const totalBillets = denominations.filter((d) => d.type === "BILLET").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const totalPieces = denominations.filter((d) => d.type === "PIECE").reduce((s, d) => s + d.valeurFaciale * d.quantite, 0);
    const ecartComptage = denominations.length > 0 ? totalBillets + totalPieces - montant : null;

    // Cash Global = tout ce qui a été reçu (cash + TPE carburant ; le Gaz est déjà compté dans
    // montant/montantTpe selon son mode de paiement). Comparé au Total théorique
    // (Carburant+Gaz), le Gaz s'annule des deux côtés : l'écart se recentre ainsi sur le seul
    // écart carburant (cash/TPE remis vs. index de pompe réel).
    const montantGlobal = montant + montantTpe;
    const ecart = montantGlobal - (montantCarburant + montantGpl);

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
          ecart,
          denominations: {
            create: denominations.filter((d) => d.quantite > 0).map((d) => ({
              type: d.type,
              valeurFaciale: d.valeurFaciale,
              quantite: d.quantite,
              sousTotal: d.valeurFaciale * d.quantite,
            })),
          },
        },
      }),
    ]);

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Quart clôturé",
      detail:
        `Quart ${entry.quart} — Cash physique ${fcfa(montant)} (dont Gaz cash ${fcfa(montantGplCash)}) + TPE ${fcfa(montantTpe)} (dont Gaz TPE ${fcfa(montantGplTpe)}) = Global ${fcfa(montantGlobal)} — ` +
        `Carburant+Gaz calculé ${fcfa(montantCarburant + montantGpl)} — Écart ${fcfa(ecart)}` +
        (ecartComptage !== null && Math.abs(ecartComptage) > 0.01
          ? ` — ⚠ Comptage de vérification différent des remises de ${fcfa(ecartComptage)}`
          : ""),
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return this.prisma.cashEntry.findUnique({ where: { id: cashEntryId }, include: INCLUDE_COMPLET });
  }

  /**
   * Annule un quart ouvert par erreur (mauvaise date, mauvais type de quart...) avant toute
   * saisie réelle. Contrairement à la clôture, c'est une vraie suppression — mais strictement
   * limitée à un quart EN_COURS n'ayant reçu aucune remise ni aucune vente : impossible
   * d'effacer la moindre donnée financière réelle par ce biais. Une station ne pouvant avoir
   * qu'un seul quart EN_COURS à la fois, c'est le seul moyen de débloquer l'ouverture du bon
   * quart après une erreur de saisie à l'ouverture (cf. cahier §17 : aucune suppression
   * autorisée — ceci n'en est pas une puisqu'aucune donnée financière n'existe encore).
   */
  async annuler(cashEntryId: string, actor: JwtPayload) {
    const entry = await this.prisma.cashEntry.findUnique({
      where: { id: cashEntryId },
      include: { pumpReadings: { include: { remises: true } }, versements: true },
    });
    if (!entry) throw new NotFoundException("Quart introuvable.");
    if (actor.role === "GERANTE" && actor.stationId !== entry.stationId) {
      throw new ForbiddenException("Vous ne pouvez annuler un quart que pour votre propre station.");
    }
    if (entry.statut !== "EN_COURS") {
      throw new BadRequestException("Ce quart est déjà clôturé et ne peut plus être annulé.");
    }
    const aDejaDesDonnees = entry.pumpReadings.some((r) => r.remises.length > 0) || entry.versements.length > 0;
    if (aDejaDesDonnees) {
      throw new BadRequestException(
        "Ce quart a déjà des remises ou des ventes enregistrées et ne peut plus être annulé — clôturez-le normalement pour ne pas perdre ces données.",
      );
    }

    await this.prisma.$transaction([
      this.prisma.pumpReading.deleteMany({ where: { cashEntryId } }),
      this.prisma.cashEntry.delete({ where: { id: cashEntryId } }),
    ]);

    await this.auditService.record({
      categorie: "ENCAISSEMENT",
      action: "Quart annulé (ouvert par erreur)",
      detail: `Quart ${QUART_LABEL[entry.quart]} du ${entry.date.toLocaleDateString("fr-FR")} — annulé avant toute saisie, aucune donnée financière perdue.`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: entry.stationId,
    });

    return { id: cashEntryId };
  }
}
