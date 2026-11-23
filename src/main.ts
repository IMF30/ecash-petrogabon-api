import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser = require("cookie-parser");
import helmet from "helmet";
import { AppModule } from "./app.module";

/**
 * Vérifie au démarrage que les secrets obligatoires sont bien configurés, plutôt que de
 * démarrer "avec succès" et de laisser chaque route qui en a besoin planter silencieusement
 * au premier appel (exactement ce qui est arrivé avec JWT_POMPISTE_SECRET manquant en prod :
 * un mauvais PIN rejette proprement avant d'en avoir besoin, mais un PIN correct plante à la
 * signature du jeton — un échec confus, visible seulement pour certains utilisateurs, sur une
 * seule route). Un démarrage qui refuse de se lancer est immédiatement visible dans les logs
 * de déploiement ; une route qui plante une fois sur deux ne l'est pas.
 */
function verifierVariablesObligatoires() {
  const requises = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_POMPISTE_SECRET"];
  const manquantes = requises.filter((nom) => !process.env[nom]);
  if (manquantes.length > 0) {
    throw new Error(`Variables d'environnement obligatoires manquantes : ${manquantes.join(", ")}`);
  }
  // Un secret JWT court (ou laissé à "CHANGE_ME" depuis .env.example) se casse par force brute
  // hors ligne à partir d'un seul jeton intercepté, ce qui permet de forger un jeton
  // Administrateur. On refuse de démarrer en production avec un secret faible.
  if (process.env.NODE_ENV === "production") {
    const faibles = ["JWT_ACCESS_SECRET", "JWT_POMPISTE_SECRET"].filter(
      (nom) => (process.env[nom] ?? "").length < 32 || process.env[nom] === "CHANGE_ME",
    );
    if (faibles.length > 0) {
      throw new Error(`Secrets trop faibles (32 caractères minimum) : ${faibles.join(", ")}`);
    }
    if (process.env.JWT_ACCESS_SECRET === process.env.JWT_POMPISTE_SECRET) {
      throw new Error("JWT_ACCESS_SECRET et JWT_POMPISTE_SECRET doivent être différents.");
    }
    if ((process.env.INTERNAL_PROXY_SECRET ?? "").length < 32) {
      console.warn(
        "INTERNAL_PROXY_SECRET absent ou trop court : la limite de tentatives de connexion sera partagée par tous les utilisateurs passant par le frontend.",
      );
    }
  }
}

async function bootstrap() {
  verifierVariablesObligatoires();
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // En-têtes de sécurité de base (X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy...) — cette API ne sert que du JSON à un client de confiance
  // (le proxy Next.js), donc contentSecurityPolicy (pensée pour du HTML) est
  // désactivée pour éviter de casser des réponses ou outils qui n'en ont pas besoin.
  app.use(helmet({ contentSecurityPolicy: false }));

  // Nombre FIXE de proxys de confiance devant l'API (1 = le frontal d'Azure App Service).
  // L'ancienne valeur `true` retenait l'entrée la plus à gauche de X-Forwarded-For — or les
  // proxys AJOUTENT à cet en-tête sans effacer ce que le client a envoyé : un attaquant
  // pouvait donc choisir lui-même son « IP » à chaque requête et contourner la limite de
  // 5 tentatives de connexion par minute. Avec un nombre fixe de sauts, Express retient
  // l'adresse ajoutée par le dernier proxy de confiance, non falsifiable.
  // Le trafic relayé par le serveur Next.js est identifié autrement (en-tête secret,
  // voir common/client-ip-throttler.guard.ts).
  const hops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  app.set("trust proxy", Number.isInteger(hops) && hops >= 0 ? hops : 1);

  // Nécessaire pour lire request.cookies.access_token dans JwtAuthGuard
  // (le cookie httpOnly est posé par le proxy Next.js, pas par cette API).
  app.use(cookieParser());
  // whitelist: supprime les propriétés non déclarées dans les DTO (évite qu'un client
  // injecte des champs non prévus, ex. un rôle ou un id). forbidNonWhitelisted: au lieu
  // de les supprimer silencieusement, rejette la requête en 400 — une tentative d'envoyer
  // un champ non attendu (bug client ou sonde d'un attaquant) doit être visible, pas masquée.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`ECASH-PetroGabon API démarrée sur http://localhost:${port}`);
}

bootstrap();
