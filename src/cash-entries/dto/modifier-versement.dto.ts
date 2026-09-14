import { Type } from "class-transformer";
import { IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

class LubricantSaleInputDto {
  @IsString() lubricantFormatId!: string;
  @IsInt() @Min(1) quantite!: number;
}

/**
 * Corrige un versement déjà enregistré (TPE, Gaz et/ou Lubrifiants — erreur de saisie).
 * Chaque champ omis reste inchangé ; `lubricantSales`, s'il est fourni, remplace entièrement
 * la liste des ventes de lubrifiant de ce versement.
 */
export class ModifierVersementDto {
  @IsOptional() @IsNumber() @Min(0) montantTpe?: number;

  @IsOptional() @IsInt() @Min(0) quantiteGpl125Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125ConsigneRecharge?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35ConsigneRecharge?: number;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LubricantSaleInputDto)
  lubricantSales?: LubricantSaleInputDto[];
}
