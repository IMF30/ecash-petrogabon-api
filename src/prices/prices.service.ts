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
}
