import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { PricesService } from "./prices.service";
import { UpdatePriceConfigDto } from "./dto/update-price-config.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("price-config")
@UseGuards(JwtAuthGuard, RolesGuard)
export class PricesController {
  constructor(private readonly pricesService: PricesService) {}

  @Get()
  get() {
    return this.pricesService.get();
  }

  @Patch()
  @Roles("ADMINISTRATEUR")
  update(@Body() dto: UpdatePriceConfigDto, @CurrentUser() user: JwtPayload) {
    return this.pricesService.update(dto, user);
  }
}
