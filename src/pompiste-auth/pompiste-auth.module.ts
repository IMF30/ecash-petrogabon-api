import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PompisteAuthService } from "./pompiste-auth.service";
import { PompisteAuthController } from "./pompiste-auth.controller";
import { PompisteAuthGuard } from "./guards/pompiste-auth.guard";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [PompisteAuthController],
  providers: [PompisteAuthService, PompisteAuthGuard],
  exports: [PompisteAuthGuard],
})
export class PompisteAuthModule {}
