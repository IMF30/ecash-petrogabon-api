import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DistributeursService } from "./distributeurs.service";
import { DistributeursController } from "./distributeurs.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [DistributeursController],
  providers: [DistributeursService],
  exports: [DistributeursService],
})
export class DistributeursModule {}
