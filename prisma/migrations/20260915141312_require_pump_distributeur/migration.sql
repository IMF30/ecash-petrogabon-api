/*
  Warnings:

  - Made the column `distributeurId` on table `pumps` required. This step will fail if there are existing NULL values in that column.

*/

-- Rétro-remplissage : avant de rendre la colonne obligatoire, on crée un distributeur pour
-- chaque pompe déjà existante qui n'en a pas encore, regroupée par numéro dans le code (ex.
-- "S1-A" et "G1-B" -> "Distributeur 1"). Le Pétrole ne se mélange jamais avec Essence/Gasoil,
-- même sur le même numéro : il reçoit toujours son propre distributeur ("Distributeur Pétrole
-- {n}"). Une pompe dont le code ne suit pas ce format (lettres + chiffres + tiret) reçoit un
-- distributeur dédié à son code, pour ne jamais rien laisser orphelin. Même logique que
-- `regrouperPompesParDistributeur` (stations.service.ts), appliquée ici en SQL pour couvrir
-- les pompes déjà présentes en base au moment où cette migration s'exécute (y compris en prod).
INSERT INTO "distributeurs" ("id", "stationId", "nom", "createdAt", "updatedAt")
SELECT
  substr(md5(random()::text || clock_timestamp()::text || grp."stationId" || grp.nom), 1, 25),
  grp."stationId",
  grp.nom,
  now(),
  now()
FROM (
  SELECT DISTINCT
    p."stationId",
    CASE
      WHEN substring(p.code from '^[A-Za-z]+(\d+)-') IS NULL THEN 'Distributeur ' || p.code
      WHEN p.produit = 'PETROLE' THEN 'Distributeur Pétrole ' || substring(p.code from '^[A-Za-z]+(\d+)-')
      ELSE 'Distributeur ' || substring(p.code from '^[A-Za-z]+(\d+)-')
    END AS nom
  FROM "pumps" p
  WHERE p."distributeurId" IS NULL
) grp
ON CONFLICT ("stationId", "nom") DO NOTHING;

UPDATE "pumps" p
SET "distributeurId" = d."id"
FROM "distributeurs" d
WHERE p."distributeurId" IS NULL
  AND d."stationId" = p."stationId"
  AND d."nom" = CASE
      WHEN substring(p.code from '^[A-Za-z]+(\d+)-') IS NULL THEN 'Distributeur ' || p.code
      WHEN p.produit = 'PETROLE' THEN 'Distributeur Pétrole ' || substring(p.code from '^[A-Za-z]+(\d+)-')
      ELSE 'Distributeur ' || substring(p.code from '^[A-Za-z]+(\d+)-')
    END;

-- DropForeignKey
ALTER TABLE "pumps" DROP CONSTRAINT "pumps_distributeurId_fkey";

-- AlterTable
ALTER TABLE "pumps" ALTER COLUMN "distributeurId" SET NOT NULL;

-- AddForeignKey
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_distributeurId_fkey" FOREIGN KEY ("distributeurId") REFERENCES "distributeurs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
