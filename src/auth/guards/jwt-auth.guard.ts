import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { JwtPayload } from "../types";

/**
 * Vérifie le cookie `access_token` (posé par le proxy Next.js) et attache
 * le payload décodé à `request.user`. Ne fait aucun aller-retour base de
 * données — la vérification de signature/expiration suffit pour l'autorisation.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const token = request.cookies?.access_token;

    if (!token) {
      throw new UnauthorizedException("Aucun jeton d'accès fourni.");
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_ACCESS_SECRET,
      });
      request.user = payload;
      return true;
    } catch {
      throw new UnauthorizedException("Jeton d'accès invalide ou expiré.");
    }
  }
}
