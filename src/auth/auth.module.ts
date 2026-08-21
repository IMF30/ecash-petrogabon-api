import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  // JwtModule est enregistré sans options : AuthService et JwtAuthGuard passent
  // explicitement leur propre secret (JWT_ACCESS_SECRET) à chaque sign/verify,
  // car le secret et la durée de vie diffèrent entre access et refresh token.
  imports: [JwtModule.register({}), AuditModule],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
