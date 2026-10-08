import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, Min } from "class-validator";
import { ProduitStock } from "@prisma/client";

export class CreateCommandeDto {
  @IsEnum(ProduitStock) produit!: ProduitStock;
  @IsNumber() @Min(0.01) quantite!: number;
  @IsDateString() dateLivraisonSouhaitee!: string;
  @IsOptional() @IsString() commentaire?: string;
}
