import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { DepositsService } from "./deposits.service";
import { DepositsController } from "./deposits.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
