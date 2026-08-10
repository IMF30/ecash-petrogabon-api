import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { JwtPayload } from "./types";
import { PrismaService } from "../prisma/prisma.service";

/**
 * Réponses en JSON pur (aucun cookie posé ici) — c'est le Route Handler
 * Next.js qui appelle ces endpoints et transforme les jetons en cookies
 * httpOnly côté navigateur (cf. plan d'architecture).
 */
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Post("login")
  @UseGuards(ThrottlerGuard)
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifiant, dto.password);
  }

  @Post("refresh")
  async refresh(@Body("refreshToken") refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body("refreshToken") refreshToken: string | undefined) {
    await this.authService.logout(refreshToken);
  }

  @Patch("password")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  async me(@CurrentUser() user: JwtPayload) {
    const record = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!record) return null;
    return {
      id: record.id,
      prenom: record.prenom,
      nom: record.nom,
      identifiant: record.identifiant,
      email: record.email,
      role: record.role,
      stationId: record.stationId,
    };
  }
}
