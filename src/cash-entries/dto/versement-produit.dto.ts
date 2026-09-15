import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

class RemiseInputDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(0) montant!: number;
  // TPE propre à cette pompe (ex. TPE-(S1-A)) — chaque pompe a son propre montant carte,
  // saisi dans le même geste que son cash remis.
  @IsOptional() @IsNumber() @Min(0) montantTpe?: number;
}

class LubricantSaleInputDto {
  @IsString() lubricantFormatId!: string;
  @IsInt() @Min(1) quantite!: number;
}

/**
 * Versement progressif d'un pompiste en cours de quart : cash remis pompe par
 * pompe, chaque pompe portant aussi son propre montant TPE (ex. TPE-(S1-A)),
 * et, pour le/la responsable Gaz/Lubrifiants du quart, les bouteilles ou
 * bidons vendus depuis le dernier versement. Au moins un champ doit être
 * renseigné.
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

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LubricantSaleInputDto)
  lubricantSales?: LubricantSaleInputDto[];
}
