import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CashEntriesService } from "./cash-entries.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
import { CloturerCashEntryDto } from "./dto/cloturer-cash-entry.dto";
import { RemiseCaisseDto } from "./dto/remise-caisse.dto";
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

  @Post(":id/remises")
  @Roles("GERANTE", "ADMINISTRATEUR")
  enregistrerRemise(@Param("id") id: string, @Body() dto: RemiseCaisseDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.enregistrerRemise(id, dto, user);
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
