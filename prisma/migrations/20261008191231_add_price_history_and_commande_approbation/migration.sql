-- AlterTable
ALTER TABLE "commandes" ADD COLUMN     "approuveLe" TIMESTAMP(3),
ADD COLUMN     "approuveParUserId" TEXT,
ADD COLUMN     "necessiteApprobation" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "valeurEstimee" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "price_history" (
    "id" TEXT NOT NULL,
    "prixLitreEssence" DECIMAL(10,2) NOT NULL,
    "prixLitreGasoil" DECIMAL(10,2) NOT NULL,
    "prixLitrePetrole" DECIMAL(10,2) NOT NULL,
    "prixGpl125Pleine" DECIMAL(10,2) NOT NULL,
    "prixGpl125Consigne" DECIMAL(10,2) NOT NULL,
    "prixGpl125ConsigneRecharge" DECIMAL(10,2) NOT NULL,
    "prixGpl35Pleine" DECIMAL(10,2) NOT NULL,
    "prixGpl35Consigne" DECIMAL(10,2) NOT NULL,
    "prixGpl35ConsigneRecharge" DECIMAL(10,2) NOT NULL,
    "changeParUserId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "price_history_effectiveFrom_idx" ON "price_history"("effectiveFrom");

-- AddForeignKey
ALTER TABLE "price_history" ADD CONSTRAINT "price_history_changeParUserId_fkey" FOREIGN KEY ("changeParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commandes" ADD CONSTRAINT "commandes_approuveParUserId_fkey" FOREIGN KEY ("approuveParUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
