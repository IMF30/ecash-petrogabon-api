import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { DepositsService } from "./deposits.service";
import { ValidateDepositDto } from "./dto/validate-deposit.dto";
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
  findAll(@Query("stationId") stationId?: string) {
    return this.depositsService.findDeposits(stationId);
  }

  @Post("validate")
  @Roles("GERANTE", "ADMINISTRATEUR")
  validate(@Body() dto: ValidateDepositDto, @CurrentUser() user: JwtPayload) {
    return this.depositsService.validate(dto, user);
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.depositsService.findDepositById(id);
  }
}
