import { IsEnum, IsOptional, IsString } from "class-validator";
import { StatutStation } from "@prisma/client";

export class CreateStationDto {
  @IsString() code!: string;
  @IsString() nom!: string;
  @IsString() ville!: string;
  @IsString() adresse!: string;

  @IsOptional() @IsEnum(StatutStation) statut?: StatutStation;

  @IsOptional() @IsString() quartMatinDebut?: string;
  @IsOptional() @IsString() quartMatinFin?: string;
  @IsOptional() @IsString() quartSoirDebut?: string;
  @IsOptional() @IsString() quartSoirFin?: string;
  @IsOptional() @IsString() quartNuitDebut?: string;
  @IsOptional() @IsString() quartNuitFin?: string;
}
