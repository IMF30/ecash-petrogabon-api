import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ErrorLogSource } from "@prisma/client";
import { ErrorLogsService } from "./error-logs.service";
import { ReportErrorLogDto } from "./dto/report-error-log.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("error-logs")
@UseGuards(JwtAuthGuard, RolesGuard)
export class ErrorLogsController {
  constructor(private readonly errorLogsService: ErrorLogsService) {}

  @Get()
  @Roles("ADMINISTRATEUR")
  findAll(@Query("source") source?: ErrorLogSource, @Query("search") search?: string) {
    return this.errorLogsService.findAll({ source, search });
  }

  /**
   * Tout rôle authentifié peut signaler une erreur JS rencontrée dans son navigateur.
   * Limite resserrée par rapport au défaut : ce point d'entrée ne devrait recevoir
   * qu'un signalement occasionnel, pas un flux continu (la déduplication côté
   * navigateur — GlobalErrorReporter — n'est qu'un confort, pas une garantie).
   */
  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  report(@Body() dto: ReportErrorLogDto, @CurrentUser() user: JwtPayload) {
    return this.errorLogsService.record({
      source: "FRONTEND",
      message: dto.message,
      stack: dto.stack,
      path: dto.path,
      userId: user.sub,
      userLabel: user.role,
    });
  }
}
