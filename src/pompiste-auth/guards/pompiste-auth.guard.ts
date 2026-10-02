import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PompisteJwtPayload } from "../types";

/**
 * Équivalent de JwtAuthGuard pour l'espace pompiste : vérifie le cookie
 * `pompiste_access_token` (posé par le proxy Next.js dédié), signé avec un secret
 * distinct (JWT_POMPISTE_SECRET) de celui des comptes Utilisateur — les deux espaces
 * d'authentification sont volontairement cloisonnés. Attache le payload décodé à
 * `request.pompiste` (jamais `request.user`, pour éviter toute confusion avec
 * JwtAuthGuard/RolesGuard sur les routes existantes).
 */
@Injectable()
export class PompisteAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.pompiste_access_token;

    if (!token) {
      throw new UnauthorizedException("Aucun jeton d'accès pompiste fourni.");
    }

    try {
      const payload = this.jwtService.verify<PompisteJwtPayload>(token, {
        secret: process.env.JWT_POMPISTE_SECRET,
      });
      if (payload.type !== "POMPISTE") {
        throw new UnauthorizedException("Jeton d'accès invalide.");
      }
      request.pompiste = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Jeton d'accès pompiste invalide ou expiré.");
    }
  }
}
