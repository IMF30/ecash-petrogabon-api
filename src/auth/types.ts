import { Role } from "@prisma/client";

export interface JwtPayload {
  sub: string;
  role: Role;
  // null pour les rôles non rattachés à une station précise (ex. ADMINISTRATEUR, TRESORERIE) ;
  // sinon utilisé pour restreindre les données visibles à la station de la GERANTE/du CONTROLE_INTERNE.
  stationId: string | null;
  // true tant que l'utilisateur n'a pas changé son mot de passe provisoire ;
  // n'empêche pas la connexion, sert uniquement à forcer l'écran de changement côté frontend.
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
  cookies: Record<string, string>;
}
