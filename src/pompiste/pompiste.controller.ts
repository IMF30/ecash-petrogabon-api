import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PompisteService } from "./pompiste.service";
import { PompisteAuthGuard } from "../pompiste-auth/guards/pompiste-auth.guard";
import { CurrentPompiste } from "../pompiste-auth/decorators/current-pompiste.decorator";
import { PompisteJwtPayload } from "../pompiste-auth/types";
import { PompisteVersementDto } from "./dto/pompiste-versement.dto";

@Controller("pompiste")
@UseGuards(PompisteAuthGuard)
export class PompisteController {
  constructor(private readonly pompisteService: PompisteService) {}

  @Get("quart-actuel")
  quartActuel(@CurrentPompiste() pompiste: PompisteJwtPayload) {
    return this.pompisteService.quartActuel(pompiste);
  }

  @Post("versements")
  enregistrerVersement(@CurrentPompiste() pompiste: PompisteJwtPayload, @Body() dto: PompisteVersementDto) {
    return this.pompisteService.enregistrerVersement(pompiste, dto);
  }
}
