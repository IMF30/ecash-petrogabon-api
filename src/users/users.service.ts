import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import * as argon2 from "argon2";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { CreateUserDto } from "./dto/create-user.dto";
import { UpdateUserDto } from "./dto/update-user.dto";
import { JwtPayload } from "../auth/types";

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
    await this.findOne(id);
    const { password, ...rest } = dto;
    const data: Record<string, unknown> = { ...rest };
    if (password) {
      data.passwordHash = await argon2.hash(password);
      data.mustChangePassword = true;
    }

    const updated = await this.prisma.user.update({ where: { id }, data, select: PUBLIC_FIELDS });
    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: password ? "Mot de passe réinitialisé par l'administrateur" : "Utilisateur modifié",
      detail: `${updated.prenom} ${updated.nom} — ${updated.role}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.stationId,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const user = await this.findOne(id);
    try {
      await this.prisma.$transaction([
        this.prisma.refreshToken.deleteMany({ where: { userId: id } }),
        this.prisma.user.delete({ where: { id } }),
      ]);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
        throw new ConflictException(
          "Impossible de supprimer : cet utilisateur a généré ou validé des transactions. Désactivez plutôt le compte.",
        );
      }
      throw error;
    }
    await this.auditService.record({
      categorie: "UTILISATEUR",
      action: "Utilisateur supprimé",
      detail: `${user.prenom} ${user.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: user.stationId,
    });
    return { id };
  }
}
