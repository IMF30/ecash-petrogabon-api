import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AttendantsService } from "./attendants.service";
import { CreateAttendantDto } from "./dto/create-attendant.dto";
import { UpdateAttendantDto } from "./dto/update-attendant.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("attendants")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AttendantsController {
  constructor(private readonly attendantsService: AttendantsService) {}

  @Get()
  findAll(@Query("stationId") stationId: string | undefined, @CurrentUser() user: JwtPayload) {
    return this.attendantsService.findAll(stationId, user);
  }

  @Get("current-shift")
  currentShift(@Query("stationId") stationId: string) {
    return this.attendantsService.currentShift(stationId);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.attendantsService.findOne(id, user);
  }

  @Post()
  @Roles("ADMINISTRATEUR", "GERANTE")
  create(@Body() dto: CreateAttendantDto, @CurrentUser() user: JwtPayload) {
    return this.attendantsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateAttendantDto, @CurrentUser() user: JwtPayload) {
    return this.attendantsService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("ADMINISTRATEUR")
  remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.attendantsService.remove(id, user);
  }
}
