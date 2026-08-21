import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { JwtPayload } from "../auth/types";

// Champs renvoyés par l'API : passwordHash n'y figure jamais, pour ne pas exposer
// le hash du mot de passe même par accident dans les réponses.
const PUBLIC_FIELDS = {
  id: true,
  prenom: true,
  nom: true,
  identifiant: true,
  email: true,
  telephone: true,
  role: true,
  stationId: true,
  statut: true,
  mustChangePassword: true,
  derniereConnexion: true,
  createdAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: { nom: "asc" } });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: PUBLIC_FIELDS });
    if (!user) throw new NotFoundException("Utilisateur introuvable.");
    return user;
  }

  async create(dto: CreateUserDto, actor: JwtPayload) {
    const exists = await this.prisma.user.findFirst({
      where: { OR: [{ identifiant: dto.identifiant }, { email: dto.email }] },
    });
    if (exists) throw new ConflictException("Identifiant ou email déjà utilisé.");

    const passwordHash = await argon2.hash(dto.password);
    const created = await this.prisma.user.create({
      data: {
        prenom: dto.prenom,
        nom: dto.nom,
        identifiant: dto.identifiant,
        email: dto.email,
        telephone: dto.telephone,
        role: dto.role,
        stationId: dto.stationId,
        statut: dto.statut,
        passwordHash,
        // Comme pour une réinitialisation (cf. update() ci-dessous) : un mot de passe
        // initial fixé par l'administrateur doit être changé dès la première connexion.
        mustChangePassword: true,
      },
      select: PUBLIC_FIELDS,
    });

    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: "Utilisateur créé",
      detail: `${created.prenom} ${created.nom} — ${created.role}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.stationId,
    });
    return created;
  }

  async update(id: string, dto: UpdateUserDto, actor: JwtPayload) {
    const before = await this.findOne(id);
    const { password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (password) {
      data.passwordHash = await argon2.hash(password);
      // Un mot de passe imposé par l'administrateur doit être changé par l'utilisateur
      // dès sa prochaine connexion (politique de sécurité).
      data.mustChangePassword = true;
    }

    const updated = await this.prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: password ? "Mot de passe réinitialisé par l'administrateur" : "Utilisateur modifié",
      // En cas de réinitialisation de mot de passe, on ne journalise pas le détail des champs
      // (describeChanges) : le mot de passe lui-même n'y figure jamais, mais on évite aussi
      // de mélanger un changement de sécurité avec un éventuel changement de profil.
      detail: password
        ? `${updated.prenom} ${updated.nom} — ${updated.role}`
        : `${updated.prenom} ${updated.nom} — ${updated.role} — ${describeChanges(before, rest)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.stationId,
    });
    return updated;
  }
}
