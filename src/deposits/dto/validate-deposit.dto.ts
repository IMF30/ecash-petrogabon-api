import { IsString, Length } from "class-validator";

export class ValidateDepositDto {
  @IsString() @Length(8, 8) code!: string;
  @IsString() bankId!: string;
}
