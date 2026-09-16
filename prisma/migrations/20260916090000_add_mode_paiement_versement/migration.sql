-- CreateEnum
CREATE TYPE "ModePaiement" AS ENUM ('CASH', 'TPE');

-- AlterTable
ALTER TABLE "versements_produit" ADD COLUMN "modePaiement" "ModePaiement" NOT NULL DEFAULT 'CASH';
