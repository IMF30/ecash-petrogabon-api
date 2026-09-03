import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { UsersService } from "./users.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { JwtPayload } from "../auth/types";

// La gestion des comptes utilisateurs (création, rôles, mots de passe) reste réservée à
// l'ADMINISTRATEUR. La consultation (liste, détail — jamais le passwordHash, cf. PUBLIC_FIELDS
// dans le service) est ouverte à l'ADMINISTRATEUR et au CONTROLE_INTERNE (seuls consommateurs
// réels : gestion des comptes et KPI "Utilisateurs Système"). La GERANTE et la TRESORERIE
// n'ont aucun besoin métier de parcourir l'annuaire complet des comptes du réseau (noms,
// emails, téléphones de tous les autres utilisateurs) — contrairement aux ressources en
// lecture réellement cross-module (attendants, pumps, banks…), ce n'est pas ouvert à tout rôle.
@Controller("users")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("ADMINISTRATEUR", "CONTROLE_INTERNE")
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
  @Roles("ADMINISTRATEUR")
  create(@Body() dto: CreateUserDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.create(dto, user);
  }

  @Patch(":id")
  @Roles("ADMINISTRATEUR")
  update(@Param("id") id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: JwtPayload) {
    return this.usersService.update(id, dto, user);
  }
}
