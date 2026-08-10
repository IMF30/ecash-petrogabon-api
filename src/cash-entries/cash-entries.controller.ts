import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { CashEntriesService } from "./cash-entries.service";
import { CreateCashEntryDto } from "./dto/create-cash-entry.dto";
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
  findAll(@Query("stationId") stationId?: string) {
    return this.cashEntriesService.findAll(stationId);
  }

  @Post()
  @Roles("GERANTE", "ADMINISTRATEUR")
  create(@Body() dto: CreateCashEntryDto, @CurrentUser() user: JwtPayload) {
    return this.cashEntriesService.create(dto, user);
  }
}
