import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from "class-validator";
import { Role, StatutCompte } from "@prisma/client";

export class CreateUserDto {
  @IsString() prenom!: string;
  @IsString() nom!: string;
  @IsString() identifiant!: string;
  @IsEmail() email!: string;
  @IsOptional() @IsString() telephone?: string;
  @IsEnum(Role) role!: Role;
  @IsOptional() @IsString() stationId?: string;
  @IsOptional() @IsEnum(StatutCompte) statut?: StatutCompte;

  @IsString() @MinLength(8) password!: string;
}
