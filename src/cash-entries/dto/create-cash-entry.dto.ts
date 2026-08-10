import { Type } from "class-transformer";
import { IsArray, IsEnum, IsInt, IsNumber, IsString, Min, ValidateNested } from "class-validator";
import { DenominationType, Quart } from "@prisma/client";

class DenominationInputDto {
  @IsEnum(DenominationType) type!: DenominationType;
  @IsNumber() @Min(0) valeurFaciale!: number;
  @IsInt() @Min(0) quantite!: number;
}

export class CreateCashEntryDto {
  @IsString() attendantId!: string;
  @IsString() stationId!: string;
  @IsEnum(Quart) quart!: Quart;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DenominationInputDto)
  denominations!: DenominationInputDto[];
}
