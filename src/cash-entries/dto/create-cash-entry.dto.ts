import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsDateString, IsEnum, IsNumber, IsString, Min, ValidateNested } from "class-validator";
import { Quart } from "@prisma/client";

class PumpReadingInputDto {
  @IsString() attendantId!: string;
  @IsString() pumpId!: string;
  @IsNumber() @Min(0) indexOuverture!: number;
}

/**
 * Démarre un quart : ne connaît que les responsables et l'index d'ouverture de
 * chaque pompe. Le reste (billetage, TPE, GPL, lubrifiants, index de fermeture)
 * n'est saisi qu'à la clôture — voir CloturerCashEntryDto.
 */
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
}
