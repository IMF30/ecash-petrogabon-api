import { IsNumber, IsString, Min } from "class-validator";

/** Un pompiste reverse du cash à la gérante pendant le quart (sa "banane" ne doit pas dépasser 100 000 FCFA). */
export class RemiseCaisseDto {
  @IsString() pumpReadingId!: string;
  @IsNumber() @Min(1) montant!: number;
}
