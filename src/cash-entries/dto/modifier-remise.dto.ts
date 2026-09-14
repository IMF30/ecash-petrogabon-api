import { IsNumber, Min } from "class-validator";

/** Corrige le montant d'une remise en caisse déjà enregistrée (erreur de saisie). */
export class ModifierRemiseDto {
  @IsNumber() @Min(1) montant!: number;
}
