import { CanActivate, ExecutionContext, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "crypto";
import type { Request } from "express";

/**
 * Authentifie l'application EKALI (appel serveur à serveur) par une clé d'API envoyée
 * dans l'en-tête `X-Api-Key`. La clé attendue est la variable d'environnement
 * EKALI_API_KEY (32 caractères minimum). Sans clé configurée, l'intégration est
 * désactivée (503) plutôt qu'ouverte.
 */
@Injectable()
export class EkaliApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const attendue = process.env.EKALI_API_KEY ?? "";
    if (attendue.length < 32) {
      throw new ServiceUnavailableException("Intégration EKALI non configurée.");
    }
    const recue = context.switchToHttp().getRequest<Request>().header("x-api-key") ?? "";
    // Comparaison à temps constant sur des empreintes de même longueur
    const a = createHash("sha256").update(recue).digest();
    const b = createHash("sha256").update(attendue).digest();
    if (!recue || !timingSafeEqual(a, b)) {
      throw new UnauthorizedException("Clé d'API invalide.");
    }
    return true;
  }
}
