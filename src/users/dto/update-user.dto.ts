import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { Role, StatutCompte } from "@prisma/client";

export class UpdateUserDto {
  @IsOptional() @IsString() prenom?: string;
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() identifiant?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() telephone?: string;
  @IsOptional() @IsEnum(Role) role?: Role;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsEnum(StatutCompte) statut?: StatutCompte;

  @IsOptional() @IsString() @MinLength(8) password?: string;
}
