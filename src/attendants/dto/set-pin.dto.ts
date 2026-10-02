import { IsString, Length, Matches } from "class-validator";

export class SetPinDto {
  @IsString() @Length(4, 6) @Matches(/^\d+$/, { message: "Le code PIN ne doit contenir que des chiffres." })
  pin!: string;
}
