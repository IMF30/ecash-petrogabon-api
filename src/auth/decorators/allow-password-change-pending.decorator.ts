import { SetMetadata } from "@nestjs/common";

export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = "allowPasswordChangePending";

/**
 * Marque une route comme accessible même quand mustChangePassword est vrai
 * (le changement de mot de passe lui-même, et la lecture du profil courant
 * dont le frontend a besoin pour afficher cet écran). Toute autre route
 * protégée par JwtAuthGuard est bloquée tant que ce flag n'est pas retombé.
 */
export const AllowPasswordChangePending = () => SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
