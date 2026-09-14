import { IsString } from "class-validator";

/** Réaffecte une pompe à un autre pompiste en cours de quart (ex. malaise du pompiste initial). */
export class ReassignerPompeDto {
  @IsString() pumpReadingId!: string;
  @IsString() nouvelAttendantId!: string;
}
