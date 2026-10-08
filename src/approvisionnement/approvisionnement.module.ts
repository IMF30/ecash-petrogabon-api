import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ApprovisionnementService } from "./approvisionnement.service";
import { ApprovisionnementController } from "./approvisionnement.controller";
import { AuditModule } from "../audit/audit.module";
import { PricesModule } from "../prices/prices.module";

@Module({
  imports: [JwtModule.register({}), AuditModule, PricesModule],
  controllers: [ApprovisionnementController],
  providers: [ApprovisionnementService],
})
export class ApprovisionnementModule {}
