/**
 * Seed minimal pour un environnement de production fraîchement provisionné :
 * crée UNIQUEMENT le compte Administrateur initial, sans aucune autre donnée
 * de démonstration (pas de stations, banques, pompistes, prix...).
 *
 * Usage : DATABASE_URL=... npx ts-node --transpile-only prisma/seed-admin-only.ts
 */
import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const identifiant = process.env.ADMIN_IDENTIFIANT ?? "freddy";
  const email = process.env.ADMIN_EMAIL ?? "freddy.ibinga@petrogabon.com";
  const prenom = process.env.ADMIN_PRENOM ?? "Freddy";
  const nom = process.env.ADMIN_NOM ?? "Ibinga";
  const password = process.env.ADMIN_TEMP_PW;
  if (!password) throw new Error("ADMIN_TEMP_PW manquant dans l'environnement.");

  const existing = await prisma.user.findUnique({ where: { identifiant } });
  if (existing) {
    console.log(`Le compte "${identifiant}" existe déjà — aucune action.`);
    return;
  }

  const passwordHash = await argon2.hash(password);
  const created = await prisma.user.create({
    data: {
      identifiant,
      email,
      prenom,
      nom,
      passwordHash,
      role: "ADMINISTRATEUR",
      statut: "ACTIF",
      mustChangePassword: true,
    },
  });

  console.log(`Compte Administrateur créé : ${created.prenom} ${created.nom} (${created.identifiant}).`);
  console.log("Mot de passe temporaire à communiquer à l'intéressé — changement obligatoire à la première connexion.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
