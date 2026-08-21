import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PumpsService } from "./pumps.service";
import { CreatePumpDto } from "./dto/create-pump.dto";
import { UpdatePumpDto } from "./dto/update-pump.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("pumps")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PumpsController {
  constructor(private readonly pumpsService: PumpsService) {}

  @Get()
  findAll(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.pumpsService.findAll(stationId, user);
  }

  // La GERANTE peut ajouter une pompe à sa station, mais toute modification ultérieure
  // (ex. changement de produit distribué) reste réservée à l'ADMINISTRATEUR.
  @Post()
  @Roles("ADMINISTRATEUR", "GERANTE")
  create(@Body() dto: CreatePumpDto, @CurrentUser() user: JwtPayload) {
    return this.pumpsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdatePumpDto, @CurrentUser() user: JwtPayload) {
    return this.pumpsService.update(id, dto, user);
  }
}
