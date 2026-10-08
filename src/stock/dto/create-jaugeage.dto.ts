import { IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { ProduitStock } from "@prisma/client";

export class CreateJaugeageDto {
  @IsEnum(ProduitStock) produit!: ProduitStock;
  @IsNumber() @Min(0) quantite!: number;
  @IsOptional() @IsString() commentaire?: string;
}
