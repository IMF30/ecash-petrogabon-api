import { Injectable } from "@nestjs/common";
import { CategorieAudit } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

export interface RecordAuditInput {
  categorie: CategorieAudit;
  action: string;
  detail: string;
  acteurUserId?: string | null;
  acteurLabel: string;
  stationId?: string | null;
}

/**
 * Journal d'audit — ajout seul (cahier §17 : « Aucune suppression autorisée »).
 * Aucune méthode de mise à jour ou de suppression n'est exposée ici, volontairement.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditInput) {
    return this.prisma.auditLog.create({ data: input });
  }

  async findAll(filters: { categorie?: CategorieAudit; stationId?: string; search?: string }) {
    return this.prisma.auditLog.findMany({
      where: {
        categorie: filters.categorie,
        stationId: filters.stationId,
        ...(filters.search
          ? {
              OR: [
                { action: { contains: filters.search, mode: "insensitive" } },
                { detail: { contains: filters.search, mode: "insensitive" } },
                { acteurLabel: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      include: { station: true },
      orderBy: { date: "desc" },
      take: 500,
    });
  }
}
