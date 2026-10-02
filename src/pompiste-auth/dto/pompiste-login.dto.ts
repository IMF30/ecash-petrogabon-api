import { IsString } from "class-validator";

export class PompisteLoginDto {
  @IsString() stationId!: string;
  @IsString() attendantId!: string;
  @IsString() pin!: string;
}
