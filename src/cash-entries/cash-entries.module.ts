import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { CashEntriesService } from "./cash-entries.service";
import { CashEntriesController } from "./cash-entries.controller";
import { AuditModule } from "../audit/audit.module";
import { PricesModule } from "../prices/prices.module";

@Module({
  imports: [JwtModule.register({}), AuditModule, PricesModule],
  controllers: [CashEntriesController],
  providers: [CashEntriesService],
})
export class CashEntriesModule {}
