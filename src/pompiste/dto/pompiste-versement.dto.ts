import { Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { ModePaiement } from "@prisma/client";

class PompisteRemiseInputDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(0) montant!: number;
  @IsOptional() @IsNumber() @Min(0) montantTpe?: number;
}

/**
 * Identique à VersementProduitDto, à ceci près qu'il n'y a pas de champ `attendantId` :
 * il est toujours déduit du jeton pompiste (jamais accepté du client), pour qu'un
 * pompiste ne puisse déclarer une remise ou une vente qu'en son propre nom.
 */
export class PompisteVersementDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PompisteRemiseInputDto)
  remises?: PompisteRemiseInputDto[];

  @IsOptional() @IsInt() @Min(0) quantiteGpl125Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl125ConsigneRecharge?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Pleine?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35Consigne?: number;
  @IsOptional() @IsInt() @Min(0) quantiteGpl35ConsigneRecharge?: number;
  @IsOptional() @IsEnum(ModePaiement) modePaiementGpl?: ModePaiement;
}
