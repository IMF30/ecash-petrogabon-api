import { IsString, Matches, MinLength } from "class-validator";
import { PASSWORD_MIN_LENGTH, PASSWORD_MESSAGE, PASSWORD_REGEX } from "../../common/password-policy";

export class ChangePasswordDto {
  @IsString() currentPassword!: string;
  @IsString() @MinLength(PASSWORD_MIN_LENGTH) @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE }) newPassword!: string;
}
