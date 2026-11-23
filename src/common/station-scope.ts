import { ForbiddenException } from "@nestjs/common";
import { JwtPayload } from "../auth/types";

/**
 * Station sur laquelle un acteur a le droit d'opérer, pour les routes de lecture/création
 * filtrées par station.
 *
 * - GERANTE : toujours SA station, quel que soit le `stationId` demandé (query string ou corps).
 *   Une gérante sans station rattachée est refusée — auparavant, l'ancien motif
 *   `actor.stationId ?? undefined` retirait purement et simplement le filtre, et une gérante
 *   sans station voyait (et pouvait créer pour) TOUTES les stations du réseau.
 * - Autres rôles (réseau) : le `stationId` demandé, ou `undefined` = tout le réseau.
 */
export function stationScope(actor: JwtPayload, requested: string | undefined): string | undefined {
  if (actor.role === "GERANTE") {
    if (!actor.stationId) {
      throw new ForbiddenException("Votre compte Gérante n'est rattaché à aucune station — contactez un administrateur.");
    }
    return actor.stationId;
  }
  return requested;
}

/** Comme stationScope, mais la station est obligatoire (création d'une ressource rattachée à une station). */
export function stationRequise(actor: JwtPayload, requested: string | undefined): string {
  const stationId = stationScope(actor, requested);
  if (!stationId) {
    throw new ForbiddenException("Une station doit être précisée pour cette opération.");
  }
  return stationId;
}
