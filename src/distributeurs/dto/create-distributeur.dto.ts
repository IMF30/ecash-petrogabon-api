import { IsString } from "class-validator";

export class CreateDistributeurDto {
  @IsString() nom!: string;
  @IsString() stationId!: string;
}
