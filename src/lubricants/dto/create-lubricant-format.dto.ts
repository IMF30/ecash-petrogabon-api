import { IsNumber, IsString, Min } from "class-validator";

export class CreateLubricantFormatDto {
  @IsString() contenance!: string;
  @IsNumber() @Min(0) prixUnitaire!: number;
}
