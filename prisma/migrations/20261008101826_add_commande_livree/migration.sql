-- AlterEnum
ALTER TYPE "StatutCommande" ADD VALUE 'LIVREE';

-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "livreeLe" TIMESTAMP(3),
ADD COLUMN     "livreeParUserId" TEXT;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_livreeParUserId_fkey" FOREIGN KEY ("livreeParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
