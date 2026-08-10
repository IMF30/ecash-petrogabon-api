import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { Quart, StatutPompiste } from "@prisma/client";

export class UpdateAttendantDto {
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() prenom?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsDateString() embauche?: string;
  @IsOptional() @IsEnum(Quart) quart?: Quart;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsEnum(StatutPompiste) statut?: StatutPompiste;
}
