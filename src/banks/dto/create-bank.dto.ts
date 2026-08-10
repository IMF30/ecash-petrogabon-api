import { IsEnum, IsOptional, IsString } from "class-validator";
import { StatutBanque } from "@prisma/client";

export class CreateBankDto {
  @IsString() code!: string;
  @IsString() nom!: string;
  @IsString() type!: string;
  @IsString() swift!: string;
  @IsString() contact!: string;

  @IsOptional() @IsEnum(StatutBanque) statut?: StatutBanque;
}
