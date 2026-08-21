import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

// La gestion des comptes utilisateurs (création, rôles, mots de passe) est réservée
// à l'ADMINISTRATEUR pour l'ensemble du contrôleur, aucune autre route ne l'ouvre à un autre rôle.
@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATEUR")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  findAll() {
    return this.usersService.findAll();
  }

  @Get(":id")
  findOne(@Param("id") id: string) {
    return this.usersService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateUserDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.create(dto, user);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.update(id, dto, user);
  }
}
