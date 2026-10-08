import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { UpdatePriceConfigDto } from "./dto/update-price-config.dto";
import { JwtPayload } from "../auth/types";

/** Id fixe : PriceConfig est un singleton (un seul enregistrement pour tout le
 *  réseau). Utiliser un id connu plutôt que findFirst()+create() rend get()
 *  atomique via upsert — deux appels concurrents au premier démarrage ne
 *  peuvent plus créer deux lignes en course. */
const SINGLETON_ID = "singleton";

/**
 * Prix carburant + GPL : un seul enregistrement pour tout le réseau
 * (identiques pour toutes les stations). `get()` crée l'enregistrement par
 * défaut s'il n'existe pas encore (installation neuve).
 */
@Injectable()
export class PricesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async get() {
    return this.prisma.priceConfig.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
    });
  }

  async update(dto: UpdatePriceConfigDto, actor: JwtPayload) {
    const before = await this.get();
    const updated = await this.prisma.priceConfig.update({ where: { id: before.id }, data: dto });
    // Snapshot structuré des 9 prix APRÈS fusion — permet de reconstruire "quel était le prix en
    // vigueur à telle date" sans dépendre du texte libre du Journal d'Audit ci-dessous.
    await this.prisma.priceHistory.create({
      data: {
        prixLitreEssence: updated.prixLitreEssence,
        prixLitreGasoil: updated.prixLitreGasoil,
        prixLitrePetrole: updated.prixLitrePetrole,
        prixGpl125Pleine: updated.prixGpl125Pleine,
        prixGpl125Consigne: updated.prixGpl125Consigne,
        prixGpl125ConsigneRecharge: updated.prixGpl125ConsigneRecharge,
        prixGpl35Pleine: updated.prixGpl35Pleine,
        prixGpl35Consigne: updated.prixGpl35Consigne,
        prixGpl35ConsigneRecharge: updated.prixGpl35ConsigneRecharge,
        changeParUserId: actor.sub,
      },
    });
    await this.auditService.record({
      categorie: "STATION",
      action: "Prix réseau modifiés",
      detail: describeChanges(before, dto),
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return updated;
  }

  findHistorique() {
    return this.prisma.priceHistory.findMany({
      include: { changeParUser: { select: { id: true, prenom: true, nom: true, role: true } } },
      orderBy: { effectiveFrom: "desc" },
      take: 200,
    });
  }
}
