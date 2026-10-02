import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CashEntriesService } from "../cash-entries/cash-entries.service";
import { PompisteJwtPayload } from "../pompiste-auth/types";
import { PompisteVersementDto } from "./dto/pompiste-versement.dto";

@Injectable()
export class PompisteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cashEntriesService: CashEntriesService,
  ) {}

  /** Retrouve le quart EN_COURS de la station où ce pompiste est réellement impliqué. */
  private async trouverQuartImplique(pompiste: PompisteJwtPayload) {
    const entry = await this.prisma.cashEntry.findFirst({
      where: {
        stationId: pompiste.stationId,
        statut: "EN_COURS",
        OR: [
          { responsableQuartId: pompiste.sub },
          { responsableGplId: pompiste.sub },
          { pumpReadings: { some: { attendantId: pompiste.sub } } },
        ],
      },
      include: {
        pumpReadings: { include: { pump: true, remises: { orderBy: { createdAt: "asc" } } } },
        versements: { where: { attendantId: pompiste.sub }, orderBy: { createdAt: "asc" } },
      },
    });
    return entry;
  }

  async quartActuel(pompiste: PompisteJwtPayload) {
    const entry = await this.trouverQuartImplique(pompiste);
    if (!entry) return { quart: null };

    return {
      quart: {
        id: entry.id,
        quart: entry.quart,
        date: entry.date,
        estResponsableGpl: entry.responsableGplId === pompiste.sub,
        pompes: entry.pumpReadings
          .filter((r) => r.attendantId === pompiste.sub)
          .map((r) => ({
            pumpReadingId: r.id,
            code: r.pump.code,
            produit: r.pump.produit,
            totalRemisCash: r.remises.reduce((s, rm) => s + Number(rm.montant), 0),
            totalRemisTpe: r.remises.reduce((s, rm) => s + Number(rm.montantTpe), 0),
          })),
        ventesGpl: entry.responsableGplId === pompiste.sub ? entry.versements : [],
      },
    };
  }

  async enregistrerVersement(pompiste: PompisteJwtPayload, dto: PompisteVersementDto) {
    const entry = await this.trouverQuartImplique(pompiste);
    if (!entry) {
      throw new NotFoundException("Aucun quart en cours ne vous concerne actuellement.");
    }
    return this.cashEntriesService.enregistrerVersement(
      entry.id,
      { ...dto, attendantId: pompiste.sub },
      { sub: pompiste.sub, role: "POMPISTE", stationId: pompiste.stationId },
      "POMPISTE",
    );
  }
}
