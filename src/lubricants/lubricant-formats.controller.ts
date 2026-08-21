import { Body, Controller, Param, Patch, UseGuards } from "@nestjs/common";
import { LubricantsService } from "./lubricants.service";
import { UpdateLubricantFormatDto } from "./dto/update-lubricant-format.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("lubricant-formats")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LubricantFormatsController {
  constructor(private readonly lubricantsService: LubricantsService) {}

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateLubricantFormatDto, @CurrentUser() user: JwtPayload) {
    return this.lubricantsService.updateFormat(id, dto, user);
  }
}
