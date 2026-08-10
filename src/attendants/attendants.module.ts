import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AttendantsService } from "./attendants.service";
import { AttendantsController } from "./attendants.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AttendantsController],
  providers: [AttendantsService],
  exports: [AttendantsService],
})
export class AttendantsModule {}
