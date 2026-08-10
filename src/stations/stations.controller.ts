import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { StationsService } from "./stations.service";
import { CreateStationDto } from "./dto/create-station.dto";
import { UpdateStationDto } from "./dto/update-station.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("stations")
@UseGuards(JwtAuthGuard, RolesGuard)
export class StationsController {
  constructor(private readonly stationsService: StationsService) {}

  @Get()
  findAll() {
    return this.stationsService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.stationsService.findOne(id);
  }

  @Post()
  @Roles("ADMINISTRATEUR")
  create(@Body() dto: CreateStationDto, @CurrentUser() user: JwtPayload) {
    return this.stationsService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateStationDto, @CurrentUser() user: JwtPayload) {
    return this.stationsService.update(id, dto, user);
  }

  @Delete(":id")
  @Roles("ADMINISTRATEUR")
  remove(@Param("id") id: string, @CurrentUser() user: JwtPayload) {
    return this.stationsService.remove(id, user);
  }
}
