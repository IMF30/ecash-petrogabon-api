import { IsString, MinLength } from "class-validator";

export class LoginDto {
  @IsString()
  identifiant!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
