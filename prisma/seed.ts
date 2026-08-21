import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  console.log("Seed : stations...");
  const pk8 = await prisma.station.upsert({
    where: { code: "PK8" },
    update: {},
    create: {
      code: "PK8",
      nom: "Station-Service PK8",
      ville: "Libreville",
      adresse: "PK8, Libreville, Gabon",
      statut: "EN_SERVICE",
    },
  });

  const stationsAutres = [
    { code: "ST-001", nom: "PetroGabon Libreville Centre", ville: "Libreville", adresse: "Boulevard Triomphal, Centre-Ville", statut: "EN_SERVICE" as const },
    { code: "ST-002", nom: "PetroGabon Port-Gentil Nord", ville: "Port-Gentil", adresse: "Route de l'Aéroport", statut: "EN_SERVICE" as const },
    { code: "ST-003", nom: "PetroGabon Franceville Est", ville: "Franceville", adresse: "Avenue de la Gare", statut: "HORS_SERVICE" as const },
  ];
  for (const s of stationsAutres) {
    await prisma.station.upsert({ where: { code: s.code }, update: {}, create: s });
  }

  console.log("Seed : banques...");
  const banques = [
    { code: "BGFI", nom: "BGFI Bank", type: "Acquéreur Principal", swift: "BGFIGAXX", contact: "treasury@bgfi.ga", statut: "ACTIF" as const },
    { code: "AFG", nom: "AFG Bank", type: "Partenaire Secondaire", swift: "AF6BGAXX", contact: "ops@afg-bank.com", statut: "ACTIF" as const },
    { code: "ORABANK", nom: "ORABANK", type: "Connexion Historique", swift: "ORABGAXX", contact: "support@orabank.net", statut: "INACTIF" as const },
    { code: "UBA", nom: "UBA", type: "Partenaire Régional", swift: "UNBAGALC", contact: "corporate@uba.ga", statut: "ACTIF" as const },
  ];
  for (const b of banques) {
    await prisma.bank.upsert({ where: { code: b.code }, update: {}, create: b });
  }

  console.log("Seed : pompistes...");
  const pompistes = [
    { nom: "Mba", prenom: "Jean-Claude", telephone: "+241 077 12 34 56", embauche: new Date("2021-05-12"), quart: "MATIN" as const, statut: "ACTIF" as const },
    { nom: "Bongo", prenom: "Alice", telephone: "+241 066 98 76 54", embauche: new Date("2022-11-03"), quart: "MATIN" as const, statut: "ACTIF" as const },
    { nom: "Ondo", prenom: "Marc", telephone: "+241 074 45 67 89", embauche: new Date("2020-01-21"), quart: "SOIR" as const, statut: "ACTIF" as const },
    { nom: "Nzamba", prenom: "Sophie", telephone: "+241 062 11 22 33", embauche: new Date("2023-08-15"), quart: "NUIT" as const, statut: "INACTIF" as const },
  ];
  for (const p of pompistes) {
    const existing = await prisma.attendant.findFirst({ where: { nom: p.nom, prenom: p.prenom } });
    if (!existing) await prisma.attendant.create({ data: { ...p, stationId: pk8.id } });
  }

  console.log("Seed : pompes...");
  const codesPompes = [
    "S1-A", "G1-A", "S1-B", "G1-B",
    "S2-A", "G2-A", "S2-B", "G2-B",
    "S3-A", "G3-A", "S3-B", "G3-B",
    "S4-A", "G4-A", "S4-B", "G4-B",
    "S5-A", "G5-A", "S5-B", "G5-B",
    "S6-A", "G6-A", "S6-B", "G6-B",
    "G7-A", "G7-B", "G7-C", "G7-D",
    "G8-A", "G8-B", "G8-C", "G8-D",
    "G9-A", "G9-B", "G9-C", "G9-D",
  ];
  for (const code of codesPompes) {
    await prisma.pump.upsert({
      where: { stationId_code: { stationId: pk8.id, code } },
      update: {},
      create: { stationId: pk8.id, code, produit: code.startsWith("S") ? "ESSENCE" : "GASOIL" },
    });
  }

  console.log("Seed : lubrifiants OKAN...");
  const PRIX_PAR_CONTENANCE: Record<string, number> = {
    "1L": 4000,
    "5L": 17000,
    "20L": 60000,
    "200L": 500000,
  };
  const lubrifiants = [
    { nom: "OKAN SX 10W40", type: "Huile moteur semi-synthétique essence/diesel", viscosite: "10W40", formats: ["1L", "5L"] },
    { nom: "OKAN MX 15W-40", type: "Huile moteur minérale diesel", viscosite: "15W-40", formats: ["5L", "200L"] },
    { nom: "OKAN TM 85W140", type: "Huile de transmission extrême pression minérale", viscosite: "85W140", formats: ["200L"] },
    { nom: "OKAN TM 80W90", type: "Huile de transmission extrême pression minérale", viscosite: "80W90", formats: ["1L", "20L", "200L"] },
    { nom: "OKAN TM 80W", type: "Huile de transmission extrême pression minérale (monograde)", viscosite: "80W", formats: ["200L"] },
    { nom: "OKAN OUTBOARD 2T", type: "Huile moteur hors-bord 2 temps entièrement synthétique", viscosite: null, formats: ["1L", "200L"] },
  ];
  for (const l of lubrifiants) {
    const produit = await prisma.lubricantProduct.upsert({
      where: { nom: l.nom },
      update: {},
      create: { nom: l.nom, type: l.type, viscosite: l.viscosite },
    });
    for (const contenance of l.formats) {
      await prisma.lubricantFormat.upsert({
        where: { lubricantProductId_contenance: { lubricantProductId: produit.id, contenance } },
        update: {},
        create: { lubricantProductId: produit.id, contenance, prixUnitaire: PRIX_PAR_CONTENANCE[contenance] },
      });
    }
  }

  console.log("Seed : prix réseau (carburant + GPL)...");
  const priceConfigExistant = await prisma.priceConfig.findFirst();
  if (!priceConfigExistant) {
    await prisma.priceConfig.create({ data: {} });
  }

  console.log("Seed : utilisateurs...");
  const motDePasseDemo = await argon2.hash("Demo1234!");
  const utilisateurs = [
    { prenom: "Jean", nom: "Dupont", identifiant: "jdupont", email: "jean.dupont@petrogabon.ga", telephone: "+241 01 23 45 67", role: "GERANTE" as const, stationId: pk8.id },
    { prenom: "Marie", nom: "Laurent", identifiant: "mlaurent", email: "marie.laurent@petrogabon.ga", telephone: "+241 02 34 56 78", role: "TRESORERIE" as const, stationId: null },
    { prenom: "Paul", nom: "Koffi", identifiant: "pkoffi", email: "paul.koffi@petrogabon.ga", telephone: "+241 03 45 67 89", role: "CONTROLE_INTERNE" as const, stationId: null },
    { prenom: "Sarah", nom: "Ali", identifiant: "sali", email: "sarah.ali@petrogabon.ga", telephone: "+241 04 56 78 90", role: "ADMINISTRATEUR" as const, stationId: null },
  ];
  for (const u of utilisateurs) {
    await prisma.user.upsert({
      where: { identifiant: u.identifiant },
      update: {},
      create: { ...u, passwordHash: motDePasseDemo },
    });
  }

  console.log("Seed terminé. Mot de passe de démo pour tous les comptes : Demo1234!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
