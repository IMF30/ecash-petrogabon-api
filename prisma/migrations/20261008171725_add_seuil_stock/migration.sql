-- CreateTable
CREATE TABLE "seuils_stock" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "produit" "ProduitStock" NOT NULL,
    "seuil" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seuils_stock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seuils_stock_stationId_produit_key" ON "seuils_stock"("stationId", "produit");

-- AddForeignKey
ALTER TABLE "seuils_stock" ADD CONSTRAINT "seuils_stock_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
