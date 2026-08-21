import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { DepositsService } from "./deposits.service";
import { CreateDepositDto } from "./dto/create-deposit.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("deposits")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Get()
  findAll(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.depositsService.findDeposits(stationId, user);
  }

  @Post()
  @Roles("GERANTE", "ADMINISTRATEUR")
  create(@Body() dto: CreateDepositDto, @CurrentUser() user: JwtPayload) {
    return this.depositsService.create(dto, user);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.depositsService.findDepositById(id, user);
  }
}
