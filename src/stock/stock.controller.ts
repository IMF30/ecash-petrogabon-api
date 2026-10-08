import { Body, Controller, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { StockService } from "./stock.service";
import { CreateJaugeageDto } from "./dto/create-jaugeage.dto";
import { UpsertSeuilDto } from "./dto/upsert-seuil.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Post("jaugeages")
  @Roles("GERANTE")
  createJaugeage(@Body() dto: CreateJaugeageDto, @CurrentUser() user: JwtPayload) {
    return this.stockService.createJaugeage(dto, user);
  }

  @Get("jaugeages")
  @Roles("GERANTE")
  findJaugeages(@CurrentUser() user: JwtPayload) {
    return this.stockService.findJaugeages(user);
  }

  @Get("stock")
  @Roles("GERANTE", "RESEAU", "CONTROLE_INTERNE")
  getStock(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.stockService.getStock(stationId, user);
  }

  @Patch("stock/seuil")
  @Roles("GERANTE")
  upsertSeuil(@Body() dto: UpsertSeuilDto, @CurrentUser() user: JwtPayload) {
    return this.stockService.upsertSeuil(dto, user);
  }

  @Get("stock/alertes")
  @Roles("RESEAU", "GRC")
  getAlertesReseau() {
    return this.stockService.getAlertesReseau();
  }
}
