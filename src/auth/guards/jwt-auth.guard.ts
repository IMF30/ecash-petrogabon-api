import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Reflector } from "@nestjs/core";
import { JwtPayload } from "../types";
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY } from "../decorators/allow-password-change-pending.decorator";

/**
 * Vérifie le cookie `access_token` (posé par le proxy Next.js) et attache
 * le payload décodé à `request.user`. Ne fait aucun aller-retour base de
 * données — la vérification de signature/expiration suffit pour l'autorisation.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
  ) {}

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

      // Tant que l'utilisateur doit changer son mot de passe, toute route est bloquée
      // sauf celles explicitement marquées @AllowPasswordChangePending() (le changement
      // de mot de passe lui-même, et la lecture du profil courant) — sans quoi la
      // contrainte n'était vérifiée que côté middleware Next.js, donc contournable
      // par un appel direct à l'API.
      if (payload.mustChangePassword) {
        const allowed = this.reflector.getAllAndOverride<boolean | undefined>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, [
          context.getHandler(),
          context.getClass(),
        ]);
        if (!allowed) {
          throw new ForbiddenException("Vous devez d'abord changer votre mot de passe.");
        }
      }

      return true;
    } catch (e) {
      if (e instanceof ForbiddenException) throw e;
      throw new UnauthorizedException("Jeton d'accès invalide ou expiré.");
    }
  }
}
