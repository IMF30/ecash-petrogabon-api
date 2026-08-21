import { IsOptional, IsString } from "class-validator";

export class CreateLubricantProductDto {
  @IsString() nom!: string;
  @IsString() type!: string;
  @IsOptional() @IsString() viscosite?: string;
}
