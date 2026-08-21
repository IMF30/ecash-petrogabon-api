import { IsEnum, IsString } from "class-validator";
import { Produit } from "@prisma/client";

export class CreatePumpDto {
  @IsString() code!: string;
  @IsEnum(Produit) produit!: Produit;
  @IsString() stationId!: string;
}
