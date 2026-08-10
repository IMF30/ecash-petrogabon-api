import { IsEnum, IsOptional, IsString } from "class-validator";
import { StatutBanque } from "@prisma/client";

export class UpdateBankDto {
  @IsOptional() @IsString() code?: string;
  @IsOptional() @IsString() nom?: string;
  @IsOptional() @IsString() type?: string;
  @IsOptional() @IsString() swift?: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsEnum(StatutBanque) statut?: StatutBanque;
}
