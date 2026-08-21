import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser = require("cookie-parser");
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // En production, l'API tourne derrière un reverse-proxy (Render). Sans ça,
  // req.ip renvoie l'adresse du proxy pour toutes les requêtes, ce qui casse
  // le rate-limiting par IP de ThrottlerGuard (tous les utilisateurs partageraient
  // la même limite). "1" = on ne fait confiance qu'au premier proxy immédiat.
  app.set("trust proxy", 1);

  // Nécessaire pour lire request.cookies.access_token dans JwtAuthGuard
  // (le cookie httpOnly est posé par le proxy Next.js, pas par cette API).
  app.use(cookieParser());
  // whitelist: supprime silencieusement les propriétés non déclarées dans les DTO
  // (évite qu'un client injecte des champs non prévus, ex. un rôle ou un id).
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`ECASH-PetroGabon API démarrée sur http://localhost:${port}`);
}

bootstrap();
