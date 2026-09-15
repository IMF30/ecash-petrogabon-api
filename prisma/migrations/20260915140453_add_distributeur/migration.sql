-- AlterTable
ALTER TABLE "pumps" ADD COLUMN     "distributeurId" TEXT;

-- CreateTable
CREATE TABLE "distributeurs" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "distributeurs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "distributeurs_stationId_idx" ON "distributeurs"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "distributeurs_stationId_nom_key" ON "distributeurs"("stationId", "nom");

-- CreateIndex
CREATE INDEX "pumps_distributeurId_idx" ON "pumps"("distributeurId");

-- AddForeignKey
ALTER TABLE "distributeurs" ADD CONSTRAINT "distributeurs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_distributeurId_fkey" FOREIGN KEY ("distributeurId") REFERENCES "distributeurs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
