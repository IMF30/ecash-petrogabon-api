import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { Role, StatutCompte } from "@prisma/client";
import { PASSWORD_MIN_LENGTH, PASSWORD_MESSAGE, PASSWORD_REGEX } from "../../common/password-policy";

export class CreateUserDto {
  @IsString() prenom!: string;
  @IsString() nom!: string;
  @IsString() identifiant!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telephone?: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsEnum(StatutCompte) statut?: StatutCompte;

  @IsString() @MinLength(PASSWORD_MIN_LENGTH) @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE }) password!: string;
}
