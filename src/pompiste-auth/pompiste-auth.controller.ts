import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { PompisteAuthService } from "./pompiste-auth.service";
import { PompisteLoginDto } from "./dto/pompiste-login.dto";

@Controller("pompiste-auth")
export class PompisteAuthController {
  constructor(private readonly pompisteAuthService: PompisteAuthService) {}

  /** Liste publique des stations actives — pour l'écran de sélection avant PIN. */
  @Get("stations")
  stations() {
    return this.pompisteAuthService.stationsActives();
  }

  /** Liste publique des pompistes actifs d'une station — pour l'écran de sélection avant PIN. */
  @Get("attendants")
  attendants(@Query("stationId") stationId: string) {
    return this.pompisteAuthService.attendantsActifs(stationId);
  }

  @Post("login")
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body() dto: PompisteLoginDto) {
    return this.pompisteAuthService.login(dto);
  }
}
