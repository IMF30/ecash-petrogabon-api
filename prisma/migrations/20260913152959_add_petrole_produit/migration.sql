-- AlterEnum
ALTER TYPE "Produit" ADD VALUE 'PETROLE';

-- AlterTable
ALTER TABLE "price_config" ADD COLUMN     "prixLitrePetrole" DECIMAL(10,2) NOT NULL DEFAULT 650;
