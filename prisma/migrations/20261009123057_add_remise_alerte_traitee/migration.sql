-- AlterTable
ALTER TABLE "remises_caisse" ADD COLUMN     "alerteTraiteeLe" TIMESTAMP(3),
ADD COLUMN     "alerteTraiteeParUserId" TEXT;

-- AddForeignKey
ALTER TABLE "remises_caisse" ADD CONSTRAINT "remises_caisse_alerteTraiteeParUserId_fkey" FOREIGN KEY ("alerteTraiteeParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
