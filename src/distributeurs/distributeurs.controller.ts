import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { DistributeursService } from "./distributeurs.service";
import { CreateDistributeurDto } from "./dto/create-distributeur.dto";
import { UpdateDistributeurDto } from "./dto/update-distributeur.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("distributeurs")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DistributeursController {
  constructor(private readonly distributeursService: DistributeursService) {}

  @Get()
  findAll(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.distributeursService.findAll(stationId, user);
  }

  // La GERANTE peut créer un distributeur pour sa station, mais le renommer ou le supprimer
  // reste réservé à l'ADMINISTRATEUR (même convention que pour les pompes).
  @Post()
  @Roles("ADMINISTRATEUR", "GERANTE")
  create(@Body() dto: CreateDistributeurDto, @CurrentUser() user: JwtPayload) {
    return this.distributeursService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateDistributeurDto, @CurrentUser() user: JwtPayload) {
    return this.distributeursService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("ADMINISTRATEUR")
  remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.distributeursService.remove(id, user);
  }
}
