import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { LubricantsService } from "./lubricants.service";
import { CreateLubricantProductDto } from "./dto/create-lubricant-product.dto";
import { CreateLubricantFormatDto } from "./dto/create-lubricant-format.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

@Controller("lubricant-products")
@UseGuards(JwtAuthGuard, RolesGuard)
export class LubricantProductsController {
  constructor(private readonly lubricantsService: LubricantsService) {}

  @Get()
  findAll() {
    return this.lubricantsService.findAllProducts();
  }

  @Post()
  @Roles("ADMINISTRATEUR")
  create(@Body() dto: CreateLubricantProductDto, @CurrentUser() user: JwtPayload) {
    return this.lubricantsService.createProduct(dto, user);
  }

  @Post(":id/formats")
  @Roles("ADMINISTRATEUR")
  createFormat(@Param("id") id: string, @Body() dto: CreateLubricantFormatDto, @CurrentUser() user: JwtPayload) {
    return this.lubricantsService.createFormat(id, dto, user);
  }
}
