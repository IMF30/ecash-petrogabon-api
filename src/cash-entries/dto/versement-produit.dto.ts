import { Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { ModePaiement } from "@prisma/client";

class RemiseInputDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(0) montant!: number;
  // TPE propre à cette pompe (ex. TPE-(S1-A)) — chaque pompe a son propre montant carte,
  // saisi dans le même geste que son cash remis.
  @IsOptional() @IsNumber() @Min(0) montantTpe?: number;
}

/**
 * Versement progressif d'un pompiste en cours de quart : cash remis pompe par
 * pompe, chaque pompe portant aussi son propre montant TPE (ex. TPE-(S1-A)),
 * et, pour le/la responsable Gaz du quart, les bouteilles vendues depuis le
 * dernier versement. Au moins un champ doit être renseigné.
 */
export class VersementProduitDto {
  @IsString() attendantId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemiseInputDto)
  remises?: RemiseInputDto[];

  @IsOptional() @IsInt() @Min(0) quantiteGpl125Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125ConsigneRecharge?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35ConsigneRecharge?: number;
  // Mode de paiement de la vente Gaz (CASH par défaut) — une vente TPE-Gaz est possible.
  // Sans effet si aucune quantité de Gaz n'est renseignée.
  @IsOptional() @IsEnum(ModePaiement) modePaiementGpl?: ModePaiement;
}
