import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { StationsModule } from "./stations/stations.module";
import { AttendantsModule } from "./attendants/attendants.module";
import { PumpsModule } from "./pumps/pumps.module";
import { LubricantsModule } from "./lubricants/lubricants.module";
import { PricesModule } from "./prices/prices.module";
import { BanksModule } from "./banks/banks.module";
import { CashEntriesModule } from "./cash-entries/cash-entries.module";
import { DepositsModule } from "./deposits/deposits.module";
import { ErrorLogsModule } from "./error-logs/error-logs.module";
import { CommonModule } from "./common/common.module";

@Module({
  imports: [
    // Limite par défaut appliquée à TOUTES les routes (ThrottlerGuard est enregistré
    // globalement dans CommonModule) : assez large pour ne pas gêner un usage normal
    // du tableau de bord. Les routes sensibles (ex. connexion, POST /error-logs)
    // se resserrent individuellement via @Throttle({ default: { limit, ttl } }).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    StationsModule,
    AttendantsModule,
    PumpsModule,
    LubricantsModule,
    PricesModule,
    BanksModule,
    CashEntriesModule,
    DepositsModule,
    ErrorLogsModule,
    CommonModule,
  ],
})
export class AppModule {}
