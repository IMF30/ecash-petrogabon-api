import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { DenominationType } from "@prisma/client";

class DenominationInputDto {
  @IsEnum(DenominationType) type!: DenominationType;
  @IsNumber() @Min(0) valeurFaciale!: number;
  @IsInt() @Min(0) quantite!: number;
}

export class CreateDepositDto {
  @IsString() numeroBordereau!: string;
  @IsString() bankId!: string;
  @IsOptional() @IsString() stationId?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => DenominationInputDto)
  denominations!: DenominationInputDto[];
}
