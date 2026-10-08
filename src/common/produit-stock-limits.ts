import { BadRequestException } from "@nestjs/common";
import { ProduitStock } from "@prisma/client";

// Garde-fou anti-erreur de frappe (ex. un zéro de trop) — PAS une contrainte métier réelle :
// très large marge au-dessus de toute cuve ou stock réel d'une station.
export const MAX_QUANTITE_PRODUIT_STOCK: Record<ProduitStock, number> = {
  ESSENCE: 100_000,
  GASOIL: 100_000,
  PETROLE: 100_000,
  GPL_12_5: 2_000,
  GPL_35: 2_000,
};

export function assertQuantiteRaisonnable(produit: ProduitStock, quantite: number): void {
  const max = MAX_QUANTITE_PRODUIT_STOCK[produit];
  if (quantite > max) {
    throw new BadRequestException(`Quantité trop élevée pour ${produit} (max ${max}).`);
  }
}
