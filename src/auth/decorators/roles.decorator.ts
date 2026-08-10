import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

export const ROLES_KEY = "roles";

/** Restreint une route aux rôles listés. Sans ce décorateur, toute route protégée par JwtAuthGuard reste accessible à tous les rôles authentifiés. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
