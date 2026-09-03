import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser = require("cookie-parser");
import helmet from "helmet";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // En-têtes de sécurité de base (X-Content-Type-Options, X-Frame-Options,
  // Referrer-Policy...) — cette API ne sert que du JSON à un client de confiance
  // (le proxy Next.js), donc contentSecurityPolicy (pensée pour du HTML) est
  // désactivée pour éviter de casser des réponses ou outils qui n'en ont pas besoin.
  app.use(helmet({ contentSecurityPolicy: false }));

  // En production, l'API tourne derrière plusieurs sauts de proxy (Cloudflare
  // puis le load-balancer de Render) — le nombre exact varie et n'est pas
  // documenté. "1" (un seul saut de confiance) s'est révélé insuffisant en
  // conditions réelles : req.ip retombait sur l'IP d'un proxy intermédiaire,
  // différente selon le nœud qui traite la requête, ce qui dispersait les
  // requêtes d'un même client sur plusieurs compteurs de débit au lieu d'un
  // seul (vérifié : x-ratelimit-remaining variait de façon incohérente entre
  // requêtes successives). `true` fait confiance à toute la chaîne devant
  // l'appli et retient l'IP la plus à gauche de X-Forwarded-For (le client
  // d'origine) — sûr ici car seuls Cloudflare et Render se trouvent entre
  // l'internet et ce conteneur, aucun n'est contrôlable par un attaquant.
  app.set("trust proxy", true);

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
