import { IsDateString, IsEnum, IsOptional, IsString } from "class-validator";
import { Quart, StatutPompiste } from "@prisma/client";

export class CreateAttendantDto {
  @IsString() nom!: string;
  @IsString() prenom!: string;
  @IsString() telephone!: string;
  @IsDateString() embauche!: string;
  @IsEnum(Quart) quart!: Quart;
  @IsString() stationId!: string;

  @IsOptional() @IsEnum(StatutPompiste) statut?: StatutPompiste;
}
