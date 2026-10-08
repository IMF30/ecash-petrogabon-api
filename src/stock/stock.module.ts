import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { StockService } from "./stock.service";
import { StockController } from "./stock.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [StockController],
  providers: [StockService],
})
export class StockModule {}
