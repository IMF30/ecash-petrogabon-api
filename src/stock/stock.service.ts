import { BadRequestException, Injectable } from "@nestjs/common";
import { ProduitStock } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateJaugeageDto } from "./dto/create-jaugeage.dto";
import { UpsertSeuilDto } from "./dto/upsert-seuil.dto";
import { JwtPayload } from "../auth/types";
import { assertQuantiteRaisonnable } from "../common/produit-stock-limits";

const PRODUITS_STOCK: ProduitStock[] = ["ESSENCE", "GASOIL", "PETROLE", "GPL_12_5", "GPL_35"];
const PRODUITS_CARBURANT = ["ESSENCE", "GASOIL", "PETROLE"] as const;
type ProduitCarburant = (typeof PRODUITS_CARBURANT)[number];

function estCarburant(produit: ProduitStock): produit is ProduitCarburant {
  return (PRODUITS_CARBURANT as readonly string[]).includes(produit);
}

@Injectable()
export class StockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async createJaugeage(dto: CreateJaugeageDto, actor: JwtPayload) {
    const stationId = actor.stationId;
    if (!stationId) throw new BadRequestException("Station introuvable pour ce jaugeage.");
    assertQuantiteRaisonnable(dto.produit, dto.quantite);

    const created = await this.prisma.jaugeage.create({
      data: {
        stationId,
        produit: dto.produit,
        quantite: dto.quantite,
        commentaire: dto.commentaire,
        createdByUserId: actor.sub,
      },
    });

    await this.auditService.record({
      categorie: "STOCK",
      action: "Jaugeage saisi",
      detail: `${dto.produit} — ${dto.quantite}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId,
    });

    return created;
  }

  // Réservé au rôle GERANTE (scope forcé à sa propre station, jamais paramétrable) — voir
  // StockController : seul un GRC/RESEAU consulte d'autres stations, via getStock().
  findJaugeages(actor: JwtPayload) {
    return this.prisma.jaugeage.findMany({
      where: { stationId: actor.stationId ?? undefined },
      orderBy: { dateReleve: "desc" },
      take: 200,
    });
  }

  async getStock(stationId: string | undefined, actor: JwtPayload) {
    const scopedStationId = actor.role === "GERANTE" ? (actor.stationId ?? undefined) : stationId;
    if (!scopedStationId) throw new BadRequestException("Station requise pour consulter le stock.");

    return Promise.all(PRODUITS_STOCK.map((produit) => this.calculerStockProduit(scopedStationId, produit)));
  }

  async upsertSeuil(dto: UpsertSeuilDto, actor: JwtPayload) {
    const stationId = actor.stationId;
    if (!stationId) throw new BadRequestException("Station introuvable pour ce seuil.");

    const seuil = await this.prisma.seuilStock.upsert({
      where: { stationId_produit: { stationId, produit: dto.produit } },
      update: { seuil: dto.seuil },
      create: { stationId, produit: dto.produit, seuil: dto.seuil },
    });

    await this.auditService.record({
      categorie: "STOCK",
      action: "Seuil d'alerte mis à jour",
      detail: `${dto.produit} — seuil ${dto.seuil}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId,
    });

    return seuil;
  }

  // Réseau-wide — toutes les stations EN_SERVICE, tous produits dont le seuil est dépassé.
  // Réutilise calculerStockProduit() : même logique de calcul que GET /stock, pas de duplication.
  async getAlertesReseau() {
    const stations = await this.prisma.station.findMany({ where: { statut: "EN_SERVICE" } });
    const parStation = await Promise.all(
      stations.map(async (s) => {
        const stocks = await Promise.all(PRODUITS_STOCK.map((produit) => this.calculerStockProduit(s.id, produit)));
        return stocks
          .filter((st) => st.enAlerte)
          .map((st) => ({
            stationId: s.id,
            stationNom: s.nom,
            produit: st.produit,
            stockActuel: st.stockActuel,
            seuil: st.seuil,
          }));
      }),
    );
    return parStation.flat();
  }

  // Stock théorique à jour = dernier jaugeage de ce produit − ventes depuis ce relevé + quantités
  // des commandes LIVREE (réception confirmée par la gérante — "Traitée" par le GRC ne suffit pas,
  // voir ApprovisionnementService.livrer) reçues depuis. Sans jaugeage antérieur, on part de 0 —
  // le stock n'est fiable qu'après un premier relevé manuel, comme pour un vrai suivi de cuve.
  private async calculerStockProduit(stationId: string, produit: ProduitStock) {
    const dernierReleve = await this.prisma.jaugeage.findFirst({
      where: { stationId, produit },
      orderBy: { dateReleve: "desc" },
    });
    const depuis = dernierReleve?.dateReleve ?? new Date(0);
    const baseQuantite = dernierReleve ? Number(dernierReleve.quantite) : 0;

    const [ventes, commandesRecues, seuilStock] = await Promise.all([
      this.ventesDepuis(stationId, produit, depuis),
      this.prisma.commande.aggregate({
        where: { stationId, produit, statut: "LIVREE", livreeLe: { gt: depuis } },
        _sum: { quantite: true },
      }),
      this.prisma.seuilStock.findUnique({ where: { stationId_produit: { stationId, produit } } }),
    ]);

    const recu = Number(commandesRecues._sum.quantite ?? 0);
    const stockActuel = baseQuantite - ventes + recu;
    const seuil = seuilStock ? Number(seuilStock.seuil) : null;

    return {
      produit,
      dernierReleve: dernierReleve ? { quantite: baseQuantite, date: dernierReleve.dateReleve } : null,
      ventesDepuis: ventes,
      recuDepuis: recu,
      stockActuel,
      seuil,
      // Un stock négatif est toujours une anomalie, même sans seuil réglé par la gérante — sinon
      // une station qui n'a jamais configuré de seuil pourrait rester dans le rouge sans que
      // personne ne le sache (cf. audit).
      enAlerte: stockActuel < 0 || (seuil != null && stockActuel <= seuil),
    };
  }

  private async ventesDepuis(stationId: string, produit: ProduitStock, depuis: Date): Promise<number> {
    if (estCarburant(produit)) {
      const agg = await this.prisma.pumpReading.aggregate({
        where: {
          pump: { stationId, produit },
          cashEntry: { stationId, statut: "CLOTURE", date: { gt: depuis } },
        },
        _sum: { litresVendus: true },
      });
      return Number(agg._sum.litresVendus ?? 0);
    }

    // Gaz : toute vente (Pleine, Consigne, Consigne+Recharge) remet une bouteille pleine au
    // client et décrémente donc le stock de bouteilles pleines, quel que soit le type de vente.
    const agg = await this.prisma.cashEntry.aggregate({
      where: { stationId, statut: "CLOTURE", date: { gt: depuis } },
      _sum: {
        quantiteGpl125Pleine: true,
        quantiteGpl125Consigne: true,
        quantiteGpl125ConsigneRecharge: true,
        quantiteGpl35Pleine: true,
        quantiteGpl35Consigne: true,
        quantiteGpl35ConsigneRecharge: true,
      },
    });
    const s = agg._sum;
    return produit === "GPL_12_5"
      ? Number(s.quantiteGpl125Pleine ?? 0) + Number(s.quantiteGpl125Consigne ?? 0) + Number(s.quantiteGpl125ConsigneRecharge ?? 0)
      : Number(s.quantiteGpl35Pleine ?? 0) + Number(s.quantiteGpl35Consigne ?? 0) + Number(s.quantiteGpl35ConsigneRecharge ?? 0);
  }
}
