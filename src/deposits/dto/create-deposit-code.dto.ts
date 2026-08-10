import { IsNumber, IsString, Min } from "class-validator";

export class CreateDepositCodeDto {
  @IsString() stationId!: string;
  @IsString() bankId!: string;
  @IsNumber() @Min(1) montant!: number;
}
