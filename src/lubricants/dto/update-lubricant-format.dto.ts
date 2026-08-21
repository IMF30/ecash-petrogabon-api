import { IsEnum, IsNumber, IsOptional, Min } from "class-validator";
import { StatutProduit } from "@prisma/client";

export class UpdateLubricantFormatDto {
  @IsOptional() @IsNumber() @Min(0) prixUnitaire?: number;
  @IsOptional() @IsEnum(StatutProduit) statut?: StatutProduit;
}
