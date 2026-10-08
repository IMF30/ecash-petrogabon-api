-- AlterTable
ALTER TABLE "deposits" ADD COLUMN     "certifieLe" TIMESTAMP(3),
ADD COLUMN     "certifieParUserId" TEXT,
ADD COLUMN     "necessiteCertification" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_certifieParUserId_fkey" FOREIGN KEY ("certifieParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
