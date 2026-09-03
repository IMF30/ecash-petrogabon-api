-- CreateEnum
CREATE TYPE "StatutQuart" AS ENUM ('EN_COURS', 'CLOTURE');

-- AlterTable
-- Les lignes existantes précèdent la notion EN_COURS/CLOTURE et sont déjà des
-- quarts complets : elles doivent être rétro-remplies à CLOTURE, pas au défaut
-- applicatif EN_COURS (qui ne vaut que pour les nouveaux quarts ouverts).
ALTER TABLE "cash_entries" ADD COLUMN     "statut" "StatutQuart" NOT NULL DEFAULT 'CLOTURE';
ALTER TABLE "cash_entries" ALTER COLUMN "statut" SET DEFAULT 'EN_COURS';

-- AlterTable
ALTER TABLE "cash_entries" ALTER COLUMN "totalBillets" SET DEFAULT 0,
ALTER COLUMN "totalPieces" SET DEFAULT 0,
ALTER COLUMN "montant" SET DEFAULT 0,
ALTER COLUMN "montantGpl" SET DEFAULT 0,
ALTER COLUMN "montantCarburant" SET DEFAULT 0,
ALTER COLUMN "ecart" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "pump_readings" ADD COLUMN     "indexCourant" DECIMAL(12,2),
ALTER COLUMN "indexFermeture" DROP NOT NULL,
ALTER COLUMN "litresVendus" DROP NOT NULL,
ALTER COLUMN "montantCalcule" DROP NOT NULL;

-- CreateTable
CREATE TABLE "remises_caisse" (
    "id" TEXT NOT NULL,
    "pumpReadingId" TEXT NOT NULL,
    "montant" DECIMAL(12,2) NOT NULL,
    "litres" DECIMAL(12,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remises_caisse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "remises_caisse_pumpReadingId_idx" ON "remises_caisse"("pumpReadingId");

-- AddForeignKey
ALTER TABLE "remises_caisse" ADD CONSTRAINT "remises_caisse_pumpReadingId_fkey" FOREIGN KEY ("pumpReadingId") REFERENCES "pump_readings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
