import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { StationsService } from "./stations.service";
import { StationsController } from "./stations.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [StationsController],
  providers: [StationsService],
  exports: [StationsService],
})
export class StationsModule {}
