-- CreateTable
CREATE TABLE "versements_produit" (
    "id" TEXT NOT NULL,
    "cashEntryId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "montantTpe" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "quantiteGpl125Pleine" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl125Consigne" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl125ConsigneRecharge" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35Pleine" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35Consigne" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35ConsigneRecharge" INTEGER NOT NULL DEFAULT 0,
    "montantGpl" DECIMAL(12,2) NOT NULL DEFAULT 0,

    CONSTRAINT "versements_produit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versement_lubricant_sales" (
    "id" TEXT NOT NULL,
    "versementId" TEXT NOT NULL,
    "lubricantFormatId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "montantCalcule" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "versement_lubricant_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "versements_produit_cashEntryId_idx" ON "versements_produit"("cashEntryId");

-- CreateIndex
CREATE INDEX "versements_produit_attendantId_idx" ON "versements_produit"("attendantId");

-- CreateIndex
CREATE INDEX "versement_lubricant_sales_versementId_idx" ON "versement_lubricant_sales"("versementId");

-- AddForeignKey
ALTER TABLE "versements_produit" ADD CONSTRAINT "versements_produit_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versements_produit" ADD CONSTRAINT "versements_produit_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versement_lubricant_sales" ADD CONSTRAINT "versement_lubricant_sales_versementId_fkey" FOREIGN KEY ("versementId") REFERENCES "versements_produit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "versement_lubricant_sales" ADD CONSTRAINT "versement_lubricant_sales_lubricantFormatId_fkey" FOREIGN KEY ("lubricantFormatId") REFERENCES "lubricant_formats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
