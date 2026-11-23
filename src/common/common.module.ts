import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ErrorLogsModule } from "../error-logs/error-logs.module";
import { ClientIpThrottlerGuard } from "./client-ip-throttler.guard";
import { ErrorLoggingFilter } from "./filters/error-logging.filter";

// Filtre d'exception global : capture les erreurs serveur inattendues (5xx, bugs non gérés)
// et les enregistre dans le journal d'erreurs techniques (ErrorLogsService), en complément
// du signalement manuel des erreurs frontend via POST /error-logs.
//
// ThrottlerGuard en garde globale : toute route est désormais limitée en débit (voir la
// limite par défaut dans ThrottlerModule.forRoot, app.module.ts), pas seulement la connexion
// comme auparavant. Les routes plus sensibles resserrent leur propre limite via @Throttle(...).
@Module({
  imports: [ErrorLogsModule],
  providers: [
    { provide: APP_FILTER, useClass: ErrorLoggingFilter },
    // Clé = IP réelle du client final, voir ClientIpThrottlerGuard.
    { provide: APP_GUARD, useClass: ClientIpThrottlerGuard },
  ],
})
export class CommonModule {}
