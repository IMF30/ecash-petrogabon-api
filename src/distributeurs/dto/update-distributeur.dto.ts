import { IsString } from "class-validator";

export class UpdateDistributeurDto {
  @IsString() nom!: string;
}
