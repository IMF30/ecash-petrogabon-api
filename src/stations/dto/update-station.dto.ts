import { IsEnum, IsOptional, IsString } from "class-validator";
import { StatutStation } from "@prisma/client";
import { StationInfosPubliquesDto } from "./station-infos-publiques";

export class UpdateStationDto extends StationInfosPubliquesDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() ville?: string;
  @IsOptional() @IsString() adresse?: string;
  @IsOptional() @IsEnum(StatutStation) statut?: StatutStation;

  @IsOptional() @IsString() quartMatinDebut?: string;
  @IsOptional() @IsString() quartMatinFin?: string;
  @IsOptional() @IsString() quartSoirDebut?: string;
  @IsOptional() @IsString() quartSoirFin?: string;
  @IsOptional() @IsString() quartNuitDebut?: string;
  @IsOptional() @IsString() quartNuitFin?: string;
}
