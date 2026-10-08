import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApprovisionnementService } from "./approvisionnement.service";
import { CreateCommandeDto } from "./dto/create-commande.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("commandes")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ApprovisionnementController {
  constructor(private readonly approvisionnementService: ApprovisionnementService) {}

  @Get()
  @Roles("GERANTE", "RESEAU", "GRC", "ADMINISTRATEUR")
  findAll(
    @Query("stationId") stationId: string | undefined,
    @Query("statut") statut: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.approvisionnementService.findCommandes(stationId, statut, user);
  }

  @Post()
  @Roles("GERANTE")
  create(@Body() dto: CreateCommandeDto, @CurrentUser() user: JwtPayload) {
    return this.approvisionnementService.create(dto, user);
  }

  @Get(":id")
  @Roles("GERANTE", "RESEAU", "GRC", "ADMINISTRATEUR")
  findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.approvisionnementService.findCommandeById(id, user);
  }

  @Patch(":id/traiter")
  @Roles("GRC")
  traiter(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.approvisionnementService.traiter(id, user);
  }

  @Patch(":id/livrer")
  @Roles("GERANTE")
  livrer(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.approvisionnementService.livrer(id, user);
  }

  @Patch(":id/approuver")
  @Roles("ADMINISTRATEUR")
  approuver(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.approvisionnementService.approuver(id, user);
  }
}
