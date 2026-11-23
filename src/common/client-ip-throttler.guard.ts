import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { createHash, timingSafeEqual } from "crypto";

/** En-têtes posés par le serveur Next.js (ecash-app) lorsqu'il relaie une requête vers l'API. */
export const PROXY_SECRET_HEADER = "x-ecash-proxy-secret";
export const CLIENT_IP_HEADER = "x-ecash-client-ip";

function secretValide(recu: unknown): boolean {
  const attendu = process.env.INTERNAL_PROXY_SECRET ?? "";
  if (attendu.length < 32 || typeof recu !== "string" || !recu) return false;
  const a = createHash("sha256").update(recu).digest();
  const b = createHash("sha256").update(attendu).digest();
  return timingSafeEqual(a, b);
}

/**
 * Limiteur de débit dont la clé est la VRAIE adresse IP du client final.
 *
 * Problème corrigé : toutes les connexions passent par le serveur Next.js (Route Handlers
 * /api/auth/* et proxy /api/backend/*). Vue de l'API, l'adresse source était donc soit
 * celle du serveur Next (un seul compteur partagé par TOUT le réseau : 6 échecs de connexion
 * n'importe où bloquaient la connexion de tout le monde pendant une minute), soit, avec
 * `trust proxy = true`, la valeur la plus à gauche de X-Forwarded-For — que n'importe quel
 * client peut écrire lui-même pour contourner la limite (une IP inventée par requête).
 *
 * Désormais :
 *  - si la requête vient du serveur Next (en-tête secret partagé INTERNAL_PROXY_SECRET
 *    valide), on utilise l'IP client qu'il a déterminée et transmise (x-ecash-client-ip) ;
 *  - sinon (appel direct à l'API), `req.ip`, calculé par Express avec un nombre de sauts de
 *    proxy de confiance FIXE (TRUST_PROXY_HOPS, cf. main.ts) — donc non falsifiable.
 */
@Injectable()
export class ClientIpThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const headers = req.headers ?? {};
    if (secretValide(headers[PROXY_SECRET_HEADER])) {
      const ip = headers[CLIENT_IP_HEADER];
      if (typeof ip === "string" && ip.length > 0 && ip.length <= 64) return ip;
    }
    return req.ip ?? req.socket?.remoteAddress ?? "inconnu";
  }
}
