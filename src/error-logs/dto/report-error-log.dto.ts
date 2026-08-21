import { IsOptional, IsString, MaxLength } from "class-validator";

// Bornes larges mais finies : un message/pile d'appel légitime ne dépasse jamais ça,
// et ça empêche un appelant de stocker des payloads arbitrairement volumineux.
export class ReportErrorLogDto {
  @IsString() @MaxLength(2000) message!: string;
  @IsOptional() @IsString() @MaxLength(8000) stack?: string;
  @IsOptional() @IsString() @MaxLength(500) path?: string;
}
