import { IsEnum, IsInt, IsOptional, Min } from "class-validator";
import { ModePaiement } from "@prisma/client";

/**
 * Corrige un versement Gaz déjà enregistré (erreur de saisie). Le TPE n'est plus porté par
 * ce type de versement : il est désormais propre à chaque pompe et se corrige via
 * PATCH /cash-entries/:id/remises/:remiseId. Chaque champ omis reste inchangé.
 */
export class ModifierVersementDto {
  @IsOptional() @IsInt() @Min(0) quantiteGpl125Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125ConsigneRecharge?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35ConsigneRecharge?: number;
  @IsOptional() @IsEnum(ModePaiement) modePaiementGpl?: ModePaiement;
}
