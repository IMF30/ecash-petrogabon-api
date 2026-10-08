-- CreateEnum
CREATE TYPE "ProduitStock" AS ENUM ('ESSENCE', 'GASOIL', 'PETROLE', 'GPL_12_5', 'GPL_35');

-- CreateEnum
CREATE TYPE "StatutCommande" AS ENUM ('EN_COURS', 'TRAITEE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CategorieAudit" ADD VALUE 'STOCK';
ALTER TYPE "CategorieAudit" ADD VALUE 'COMMANDE';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'GRC';

-- CreateTable
CREATE TABLE "jaugeages" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "produit" "ProduitStock" NOT NULL,
    "quantite" DECIMAL(12,2) NOT NULL,
    "dateReleve" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "commentaire" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "jaugeages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commandes" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "produit" "ProduitStock" NOT NULL,
    "quantite" DECIMAL(12,2) NOT NULL,
    "dateLivraisonSouhaitee" TIMESTAMP(3) NOT NULL,
    "commentaire" TEXT,
    "statut" "StatutCommande" NOT NULL DEFAULT 'EN_COURS',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "traiteParUserId" TEXT,
    "traiteLe" TIMESTAMP(3),

    CONSTRAINT "commandes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jaugeages_stationId_produit_dateReleve_idx" ON "jaugeages"("stationId", "produit", "dateReleve");

-- CreateIndex
CREATE INDEX "commandes_stationId_statut_idx" ON "commandes"("stationId", "statut");

-- CreateIndex
CREATE INDEX "commandes_statut_createdAt_idx" ON "commandes"("statut", "createdAt");

-- AddForeignKey
ALTER TABLE "jaugeages" ADD CONSTRAINT "jaugeages_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jaugeages" ADD CONSTRAINT "jaugeages_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_traiteParUserId_fkey" FOREIGN KEY ("traiteParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
