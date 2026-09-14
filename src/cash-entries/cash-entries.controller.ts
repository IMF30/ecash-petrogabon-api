import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CashEntriesService } from "./cash-entries.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { CloturerCashEntryDto } from "./dto/cloturer-cash-entry.dto";
import { VersementProduitDto } from "./dto/versement-produit.dto";
import { ModifierRemiseDto } from "./dto/modifier-remise.dto";
import { ModifierVersementDto } from "./dto/modifier-versement.dto";
import { ReassignerPompeDto } from "./dto/reassigner-pompe.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("cash-entries")
@UseGuards(JwtAuthGuard, RolesGuard)
export class CashEntriesController {
  constructor(private readonly cashEntriesService: CashEntriesService) {}

  @Get()
  findAll(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.findAll(stationId, user);
  }

  /** Quarts ouverts, cash physique en cours de constitution — vue temps réel. */
  @Get("en-cours")
  findEnCours(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.findEnCours(stationId, user);
  }

  @Post()
  @Roles("GERANTE", "ADMINISTRATEUR")
  create(@Body() dto: CreateCashEntryDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.create(dto, user);
  }

  @Post(":id/versements")
  @Roles("GERANTE", "ADMINISTRATEUR")
  enregistrerVersement(@Param("id") id: string, @Body() dto: VersementProduitDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.enregistrerVersement(id, dto, user);
  }

  @Patch(":id/remises/:remiseId")
  @Roles("GERANTE", "ADMINISTRATEUR")
  modifierRemise(@Param("id") id: string, @Param("remiseId") remiseId: string, @Body() dto: ModifierRemiseDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.modifierRemise(id, remiseId, dto, user);
  }

  @Patch(":id/versements/:versementId")
  @Roles("GERANTE", "ADMINISTRATEUR")
  modifierVersement(@Param("id") id: string, @Param("versementId") versementId: string, @Body() dto: ModifierVersementDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.modifierVersement(id, versementId, dto, user);
  }

  @Delete(":id/remises/:remiseId")
  @Roles("GERANTE", "ADMINISTRATEUR")
  supprimerRemise(@Param("id") id: string, @Param("remiseId") remiseId: string, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.supprimerRemise(id, remiseId, user);
  }

  @Delete(":id/versements/:versementId")
  @Roles("GERANTE", "ADMINISTRATEUR")
  supprimerVersement(@Param("id") id: string, @Param("versementId") versementId: string, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.supprimerVersement(id, versementId, user);
  }

  @Patch(":id/reassigner-pompe")
  @Roles("GERANTE", "ADMINISTRATEUR")
  reassignerPompe(@Param("id") id: string, @Body() dto: ReassignerPompeDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.reassignerPompe(id, dto, user);
  }

  @Patch(":id/cloturer")
  @Roles("GERANTE", "ADMINISTRATEUR")
  cloturer(@Param("id") id: string, @Body() dto: CloturerCashEntryDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.cloturer(id, dto, user);
  }
}
