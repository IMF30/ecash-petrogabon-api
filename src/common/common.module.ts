import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard } from "@nestjs/throttler";
import { ErrorLogsModule } from "../error-logs/error-logs.module";
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
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class CommonModule {}
