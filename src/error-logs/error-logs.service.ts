import { Injectable } from "@nestjs/common";
import { ErrorLogSource } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";

// Une erreur de connexion (base de données, service externe...) peut faire apparaître
// des identifiants en clair dans son message ou sa pile d'appel (ex. DATABASE_URL
// complète). On les masque avant stockage, puisque ce journal reste lisible par
// l'Administrateur et pourrait être partagé (support, ticket) sans y penser.
function redact(text: string): string {
  return text
    .replace(/(\w+:\/\/)([^:@/\s]+):([^@/\s]+)@/g, "$1***:***@")
    .replace(/Bearer\s+[A-Za-z0-9\-_.]+/gi, "Bearer ***")
    .replace(/eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g, "***jwt***");
}

export interface RecordErrorLogInput {
  source: ErrorLogSource;
  message: string;
  stack?: string | null;
  path?: string | null;
  method?: string | null;
  statusCode?: number | null;
  userId?: string | null;
  userLabel?: string | null;
  userAgent?: string | null;
}

/**
 * Journal d'erreurs techniques — réservé à l'Administrateur, pour le
 * diagnostic de bugs. Ajout seul, aucune méthode de suppression exposée.
 * À distinguer du journal d'audit (AuditService) : celui-ci trace les erreurs
 * techniques (exceptions, bugs front/back), pas les actions métier des utilisateurs.
 */
@Injectable()
export class ErrorLogsService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordErrorLogInput) {
    return this.prisma.errorLog.create({
      data: {
        ...input,
        message: redact(input.message),
        stack: input.stack ? redact(input.stack) : input.stack,
      },
    });
  }

  async findAll(filters: { source?: ErrorLogSource; search?: string }) {
    return this.prisma.errorLog.findMany({
      where: {
        source: filters.source,
        ...(filters.search
          ? {
              OR: [
                { message: { contains: filters.search, mode: "insensitive" } },
                { path: { contains: filters.search, mode: "insensitive" } },
                { userLabel: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { date: "desc" },
      // Même plafond que le journal d'audit : évite de charger tout l'historique d'un coup.
      take: 500,
    });
  }
}
