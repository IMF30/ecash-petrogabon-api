import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { DepositsService } from "./deposits.service";
import { CreateDepositCodeDto } from "./dto/create-deposit-code.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("deposit-codes")
@UseGuards(JwtAuthGuard, RolesGuard)
export class DepositCodesController {
  constructor(private readonly depositsService: DepositsService) {}

  @Get()
  findAll(@Query("stationId") stationId?: string) {
    return this.depositsService.findCodes(stationId);
  }

  @Post()
  @Roles("TRESORERIE", "ADMINISTRATEUR")
  create(@Body() dto: CreateDepositCodeDto, @CurrentUser() user: JwtPayload) {
    return this.depositsService.createCode(dto, user);
  }
}
