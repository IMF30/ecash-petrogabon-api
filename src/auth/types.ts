import { Role } from "@prisma/client";

export interface JwtPayload {
  sub: string;
  role: Role;
  stationId: string | null;
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  cookies: Record<string, string>;
}
