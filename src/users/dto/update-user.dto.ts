import { IsEmail, IsEnum, IsOptional, IsString, Matches, MinLength } from "class-validator";
import { Role, StatutCompte } from "@prisma/client";
import { PASSWORD_MIN_LENGTH, PASSWORD_MESSAGE, PASSWORD_REGEX } from "../../common/password-policy";

export class UpdateUserDto {
  @IsOptional() @IsString() prenom?: string;
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() identifiant?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsEnum(StatutCompte) statut?: StatutCompte;

  @IsOptional() @IsString() @MinLength(PASSWORD_MIN_LENGTH) @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE }) password?: string;
}
