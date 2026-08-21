import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PricesService } from "./prices.service";
import { PricesController } from "./prices.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [PricesController],
  providers: [PricesService],
  exports: [PricesService],
})
export class PricesModule {}
