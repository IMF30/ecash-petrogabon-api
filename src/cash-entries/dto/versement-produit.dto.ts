import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";

class RemiseInputDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(1) montant!: number;
}

class LubricantSaleInputDto {
  @IsString() lubricantFormatId!: string;
  @IsInt() @Min(1) quantite!: number;
}

/**
 * Versement progressif d'un pompiste en cours de quart : cash remis pompe par
 * pompe (comme avant), et désormais aussi, dans le même geste, ses ventes
 * carte (TPE) et, pour le/la responsable Gaz/Lubrifiants du quart, les
 * bouteilles ou bidons vendus depuis le dernier versement. Au moins un champ
 * doit être renseigné.
 */
export class VersementProduitDto {
  @IsString() attendantId!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RemiseInputDto)
  remises?: RemiseInputDto[];

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
