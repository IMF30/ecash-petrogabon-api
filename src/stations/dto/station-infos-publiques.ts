import { IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from "class-validator";

const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Champs publics d'une station (exposés à l'application client EKALI).
 * Les coordonnées acceptent `null` pour pouvoir être effacées.
 */
export class StationInfosPubliquesDto {
  @IsOptional() @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(-90) @Max(90)
  latitude?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null)
  @IsNumber({ maxDecimalPlaces: 6 }) @Min(-180) @Max(180)
  longitude?: number | null;

  @IsOptional() @ValidateIf((_, v) => v !== null)
  @IsString() @MaxLength(30)
  telephone?: string | null;

  @IsOptional() @Matches(HEURE, { message: "horaireOuverture doit être au format HH:MM" })
  horaireOuverture?: string;

  @IsOptional() @Matches(HEURE, { message: "horaireFermeture doit être au format HH:MM" })
  horaireFermeture?: string;
}
