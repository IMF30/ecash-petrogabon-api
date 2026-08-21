import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateLubricantProductDto } from "./dto/create-lubricant-product.dto";
import { CreateLubricantFormatDto } from "./dto/create-lubricant-format.dto";
import { UpdateLubricantFormatDto } from "./dto/update-lubricant-format.dto";
import { JwtPayload } from "../auth/types";

@Injectable()
export class LubricantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAllProducts() {
    return this.prisma.lubricantProduct.findMany({
      include: { formats: { orderBy: { contenance: "asc" } } },
      orderBy: { nom: "asc" },
    });
  }

  async createProduct(dto: CreateLubricantProductDto, actor: JwtPayload) {
    const created = await this.prisma.lubricantProduct.create({ data: dto, include: { formats: true } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Produit lubrifiant créé",
      detail: created.nom,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      // Le catalogue lubrifiants (produits/formats) est commun à toutes les stations,
      // d'où stationId à null ici et dans les autres écritures d'audit de ce service.
      stationId: null,
    });
    return created;
  }

  async createFormat(productId: string, dto: CreateLubricantFormatDto, actor: JwtPayload) {
    const product = await this.prisma.lubricantProduct.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException("Produit lubrifiant introuvable.");

    const created = await this.prisma.lubricantFormat.create({
      data: { lubricantProductId: productId, contenance: dto.contenance, prixUnitaire: dto.prixUnitaire },
    });
    await this.auditService.record({
      categorie: "STATION",
      action: "Format lubrifiant créé",
      detail: `${product.nom} — ${created.contenance}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return created;
  }

  async updateFormat(id: string, dto: UpdateLubricantFormatDto, actor: JwtPayload) {
    const format = await this.prisma.lubricantFormat.findUnique({ where: { id }, include: { lubricantProduct: true } });
    if (!format) throw new NotFoundException("Format lubrifiant introuvable.");

    const updated = await this.prisma.lubricantFormat.update({ where: { id }, data: dto });
    await this.auditService.record({
      categorie: "STATION",
      action: "Format lubrifiant modifié",
      detail: `${format.lubricantProduct.nom} — ${format.contenance} — ${describeChanges(format, dto)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      // stationId null : le catalogue lubrifiants (produits/formats) est commun à toutes
      // les stations, il n'appartient à aucune station en particulier.
      stationId: null,
    });
    return updated;
  }
}
