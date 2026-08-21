import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PumpsService } from "./pumps.service";
import { PumpsController } from "./pumps.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [PumpsController],
  providers: [PumpsService],
  exports: [PumpsService],
})
export class PumpsModule {}
