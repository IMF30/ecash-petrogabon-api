import { IsEnum, IsNumber, Min } from "class-validator";
import { ProduitStock } from "@prisma/client";

export class UpsertSeuilDto {
  @IsEnum(ProduitStock) produit!: ProduitStock;
  @IsNumber() @Min(0) seuil!: number;
}
