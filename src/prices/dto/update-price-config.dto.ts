import { IsNumber, IsOptional, Min } from "class-validator";

export class UpdatePriceConfigDto {
  @IsOptional() @IsNumber() @Min(0) prixLitreEssence?: number;
  @IsOptional() @IsNumber() @Min(0) prixLitreGasoil?: number;

  @IsOptional() @IsNumber() @Min(0) prixGpl125Pleine?: number;
  @IsOptional() @IsNumber() @Min(0) prixGpl125Consigne?: number;
  @IsOptional() @IsNumber() @Min(0) prixGpl125ConsigneRecharge?: number;
  @IsOptional() @IsNumber() @Min(0) prixGpl35Pleine?: number;
  @IsOptional() @IsNumber() @Min(0) prixGpl35Consigne?: number;
  @IsOptional() @IsNumber() @Min(0) prixGpl35ConsigneRecharge?: number;
}
