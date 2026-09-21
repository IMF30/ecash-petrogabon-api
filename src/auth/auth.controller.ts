import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, UseGuards } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { UpdateProfileDto } from "./dto/update-profile.dto";
import { JwtAuthGuard } from "./guards/jwt-auth.guard";
import { CurrentUser } from "./decorators/current-user.decorator";
import { AllowPasswordChangePending } from "./decorators/allow-password-change-pending.decorator";
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
  // Resserre la limite par défaut (100/min, cf. app.module.ts) à 5/min/IP sur cette
  // route précise, pour freiner le brute-force sur les mots de passe.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.identifiant, dto.password);
  }

  @Post("refresh")
  // Les refresh tokens sont des secrets aléatoires de 48 octets (non devinables), mais
  // on limite quand même le débit de tentatives de recherche par empreinte en base,
  // en défense en profondeur plutôt que de s'appuyer uniquement sur les 100/min globaux.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(@Body("refreshToken") refreshToken: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post("logout")
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Body("refreshToken") refreshToken: string | undefined) {
    await this.authService.logout(refreshToken);
  }

  @Patch("password")
  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangePending()
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: JwtPayload) {
    await this.authService.changePassword(user.sub, dto.currentPassword, dto.newPassword);
  }

  @Patch("profile")
  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangePending()
  async updateProfile(@Body() dto: UpdateProfileDto, @CurrentUser() user: JwtPayload) {
    return this.authService.updateProfile(user.sub, dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  @AllowPasswordChangePending()
  async me(@CurrentUser() user: JwtPayload) {
    const record = await this.prisma.user.findUnique({ where: { id: user.sub } });
    if (!record) return null;
    return {
      id: record.id,
      prenom: record.prenom,
      nom: record.nom,
      identifiant: record.identifiant,
      email: record.email,
      telephone: record.telephone,
      role: record.role,
      stationId: record.stationId,
      mustChangePassword: record.mustChangePassword,
    };
  }
}
