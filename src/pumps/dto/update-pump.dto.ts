import { IsEnum, IsOptional, IsString } from "class-validator";
import { Produit, StatutPompe } from "@prisma/client";

export class UpdatePumpDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsEnum(Produit) produit?: Produit;
  @IsOptional() @IsEnum(StatutPompe) statut?: StatutPompe;
}
