import { Controller, Get, ParseEnumPipe, Query, UseGuards } from "@nestjs/common";
import { CategorieAudit } from "@prisma/client";
import { AuditService } from "./audit.service";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";

@Controller("audit-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  // Journal d'audit métier (actions des utilisateurs) : consultable par l'ADMINISTRATEUR
  // et par le CONTROLE_INTERNE, dont le rôle est justement de vérifier ces actions.
  @Get()
  @Roles("ADMINISTRATEUR", "CONTROLE_INTERNE")
  async findAll(
    @Query("categorie", new ParseEnumPipe(CategorieAudit, { optional: true })) categorie?: CategorieAudit,
    @Query("stationId") stationId?: string,
    @Query("search") search?: string,
  ) {
    // ?search=a&search=b arrive sous forme de tableau et faisait planter la requête Prisma (500).
    return this.auditService.findAll({
      categorie,
      stationId: typeof stationId === "string" ? stationId : undefined,
      search: typeof search === "string" ? search : undefined,
    });
  }
}
