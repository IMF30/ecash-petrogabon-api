import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class UpdateProfileDto {
  @IsString() @MinLength(1) prenom!: string;
  @IsString() @MinLength(1) nom!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telephone?: string;
}
