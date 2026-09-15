import { IsNumber, IsOptional, Min } from "class-validator";

/** Corrige le montant cash et/ou TPE d'une remise en caisse déjà enregistrée (erreur de saisie). */
export class ModifierRemiseDto {
  @IsNumber() @Min(0) montant!: number;
  @IsOptional() @IsNumber() @Min(0) montantTpe?: number;
}
