import { Controller, Get, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { PrismaService } from "../prisma/prisma.service";
import { StockService } from "../stock/stock.service";
import { EkaliApiKeyGuard } from "./ekali-api-key.guard";

/**
 * Lecture seule pour l'application client EKALI : stations + disponibilité des produits.
 * N'expose AUCUNE quantité, aucune donnée financière ni nominative — uniquement ce qu'un
 * client peut voir sur une carte des stations. EKALI met la réponse en cache de son côté.
 */
@Controller("integrations/ekali")
@UseGuards(EkaliApiKeyGuard)
export class EkaliIntegrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly stockService: StockService,
  ) {}

  @Get("disponibilite")
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async disponibilite() {
    const stations = await this.prisma.station.findMany({
      orderBy: { nom: "asc" },
      select: {
        id: true, code: true, nom: true, ville: true, adresse: true, statut: true,
        latitude: true, longitude: true, telephone: true,
        horaireOuverture: true, horaireFermeture: true, updatedAt: true,
      },
    });

    const resultat = await Promise.all(
      stations.map(async (s) => ({
        id: s.id,
        code: s.code,
        nom: s.nom,
        ville: s.ville,
        adresse: s.adresse,
        enService: s.statut === "EN_SERVICE",
        latitude: s.latitude == null ? null : Number(s.latitude),
        longitude: s.longitude == null ? null : Number(s.longitude),
        telephone: s.telephone,
        horaires: { ouverture: s.horaireOuverture, fermeture: s.horaireFermeture },
        // Une station hors service n'a pas de disponibilité à afficher
        produits: s.statut === "EN_SERVICE" ? await this.stockService.disponibiliteStation(s.id) : [],
      })),
    );

    return { genereLe: new Date().toISOString(), stations: resultat };
  }
}
