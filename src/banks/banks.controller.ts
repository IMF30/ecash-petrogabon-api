import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { BanksService } from "./banks.service";
import { CreateBankDto } from "./dto/create-bank.dto";
import { UpdateBankDto } from "./dto/update-bank.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("banks")
@UseGuards(JwtAuthGuard, RolesGuard)
export class BanksController {
  constructor(private readonly banksService: BanksService) {}

  @Get()
  findAll() {
    return this.banksService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.banksService.findOne(id);
  }

  @Post()
  @Roles("ADMINISTRATEUR")
  create(@Body() dto: CreateBankDto, @CurrentUser() user: JwtPayload) {
    return this.banksService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateBankDto, @CurrentUser() user: JwtPayload) {
    return this.banksService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("ADMINISTRATEUR")
  remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.banksService.remove(id, user);
  }
}
