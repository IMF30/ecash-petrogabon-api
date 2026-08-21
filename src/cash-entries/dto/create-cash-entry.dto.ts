import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsInt, IsNumber, IsString, Min, ValidateNested } from "class-validator";
import { DenominationType, Quart } from "@prisma/client";

class DenominationInputDto {
  @IsEnum(DenominationType) type!: DenominationType;
  @IsNumber() @Min(0) valeurFaciale!: number;
  @IsInt() @Min(0) quantite!: number;
}

class PumpReadingInputDto {
  @IsString() attendantId!: string;
  @IsString() pumpId!: string;
  @IsNumber() @Min(0) indexOuverture!: number;
  @IsNumber() @Min(0) indexFermeture!: number;
}

class LubricantSaleInputDto {
  @IsString() lubricantFormatId!: string;
  @IsInt() @Min(1) quantite!: number;
}

export class CreateCashEntryDto {
  @IsString() stationId!: string;
  @IsEnum(Quart) quart!: Quart;
  @IsDateString() date!: string;

  @IsString() responsableQuartId!: string;
  @IsString() responsableGplId!: string;
  @IsString() responsableLubrifiantsId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PumpReadingInputDto)
  pumpReadings!: PumpReadingInputDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DenominationInputDto)
  denominations!: DenominationInputDto[];

  @IsNumber() @Min(0) montantTpe!: number;

  @IsInt() @Min(0) quantiteGpl125Pleine!: number;
  @IsInt() @Min(0) quantiteGpl125Consigne!: number;
  @IsInt() @Min(0) quantiteGpl125ConsigneRecharge!: number;
  @IsInt() @Min(0) quantiteGpl35Pleine!: number;
  @IsInt() @Min(0) quantiteGpl35Consigne!: number;
  @IsInt() @Min(0) quantiteGpl35ConsigneRecharge!: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LubricantSaleInputDto)
  lubricantSales!: LubricantSaleInputDto[];
}
