// Politique de mot de passe pour les comptes Utilisateur (Admin, Gérante, Réseau, GRC...) —
// niveau modéré : bloque les mots de passe triviaux ("aaaaaaaaaa") sans imposer une
// complexité excessive à des utilisatrices peu familières avec l'informatique. Le PIN
// pompiste (distinct, voir PompisteAuthService) a ses propres règles.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_MESSAGE =
  "Le mot de passe doit contenir au moins 10 caractères, avec au moins une lettre et un chiffre.";
