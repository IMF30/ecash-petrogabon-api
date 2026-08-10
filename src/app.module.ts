import { Module } from "@nestjs/common";
import { ThrottlerModule } from "@nestjs/throttler";
import { PrismaModule } from "./prisma/prisma.module";
import { AuditModule } from "./audit/audit.module";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { StationsModule } from "./stations/stations.module";
import { AttendantsModule } from "./attendants/attendants.module";
import { BanksModule } from "./banks/banks.module";
import { CashEntriesModule } from "./cash-entries/cash-entries.module";
import { DepositsModule } from "./deposits/deposits.module";

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 5 }]),
    PrismaModule,
    AuditModule,
    AuthModule,
    UsersModule,
    StationsModule,
    AttendantsModule,
    BanksModule,
    CashEntriesModule,
    DepositsModule,
  ],
})
export class AppModule {}
