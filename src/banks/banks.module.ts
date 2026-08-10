import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { BanksService } from "./banks.service";
import { BanksController } from "./banks.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [BanksController],
  providers: [BanksService],
  exports: [BanksService],
})
export class BanksModule {}
