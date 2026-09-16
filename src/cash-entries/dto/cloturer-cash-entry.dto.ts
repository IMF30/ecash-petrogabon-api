import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { DenominationType } from "@prisma/client";

class DenominationInputDto {
  @IsEnum(DenominationType) type!: DenominationType;
  @IsNumber() @Min(0) valeurFaciale!: number;
  @IsInt() @Min(0) quantite!: number;
}

class PumpReadingClotureDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(0) indexFermeture!: number;
}

/**
 * Clôture un quart EN_COURS : relevés réels de fermeture par pompe. Le cash
 * physique, le TPE et le Gaz sont désormais entièrement dérivés des
 * versements progressifs saisis pendant le quart (remises et
 * VersementProduit) — plus aucune saisie manuelle de ces montants ici.
 * `denominations` reste un comptage optionnel de vérification (n'alimente
 * plus le cash physique officiel, sert seulement à signaler un écart).
 */
export class CloturerCashEntryDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PumpReadingClotureDto)
  pumpReadings!: PumpReadingClotureDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DenominationInputDto)
  denominations?: DenominationInputDto[];
}
