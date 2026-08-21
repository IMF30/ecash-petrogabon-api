-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMINISTRATEUR', 'TRESORERIE', 'CONTROLE_INTERNE', 'GERANTE');

-- CreateEnum
CREATE TYPE "Quart" AS ENUM ('MATIN', 'SOIR', 'NUIT');

-- CreateEnum
CREATE TYPE "StatutCompte" AS ENUM ('ACTIF', 'INACTIF');

-- CreateEnum
CREATE TYPE "StatutPompiste" AS ENUM ('ACTIF', 'INACTIF');

-- CreateEnum
CREATE TYPE "StatutStation" AS ENUM ('EN_SERVICE', 'HORS_SERVICE');

-- CreateEnum
CREATE TYPE "StatutBanque" AS ENUM ('ACTIF', 'INACTIF');

-- CreateEnum
CREATE TYPE "DenominationType" AS ENUM ('BILLET', 'PIECE');

-- CreateEnum
CREATE TYPE "Produit" AS ENUM ('ESSENCE', 'GASOIL');

-- CreateEnum
CREATE TYPE "StatutPompe" AS ENUM ('ACTIF', 'INACTIF');

-- CreateEnum
CREATE TYPE "StatutProduit" AS ENUM ('ACTIF', 'INACTIF');

-- CreateEnum
CREATE TYPE "CategorieAudit" AS ENUM ('CONNEXION', 'ENCAISSEMENT', 'VERSEMENT', 'UTILISATEUR', 'STATION', 'BANQUE', 'POMPISTE');

-- CreateEnum
CREATE TYPE "ErrorLogSource" AS ENUM ('BACKEND', 'FRONTEND');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "identifiant" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "telephone" TEXT,
    "role" "Role" NOT NULL,
    "statut" "StatutCompte" NOT NULL DEFAULT 'ACTIF',
    "stationId" TEXT,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "derniereConnexion" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stations" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "ville" TEXT NOT NULL,
    "adresse" TEXT NOT NULL,
    "statut" "StatutStation" NOT NULL DEFAULT 'EN_SERVICE',
    "quartMatinDebut" TEXT NOT NULL DEFAULT '06:00',
    "quartMatinFin" TEXT NOT NULL DEFAULT '14:00',
    "quartSoirDebut" TEXT NOT NULL DEFAULT '14:00',
    "quartSoirFin" TEXT NOT NULL DEFAULT '22:00',
    "quartNuitDebut" TEXT NOT NULL DEFAULT '22:00',
    "quartNuitFin" TEXT NOT NULL DEFAULT '06:00',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendants" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT NOT NULL,
    "telephone" TEXT NOT NULL,
    "embauche" TIMESTAMP(3) NOT NULL,
    "quart" "Quart" NOT NULL,
    "statut" "StatutPompiste" NOT NULL DEFAULT 'ACTIF',
    "stationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_config" (
    "id" TEXT NOT NULL,
    "prixLitreEssence" DECIMAL(10,2) NOT NULL DEFAULT 750,
    "prixLitreGasoil" DECIMAL(10,2) NOT NULL DEFAULT 700,
    "prixGpl125Pleine" DECIMAL(10,2) NOT NULL DEFAULT 6000,
    "prixGpl125Consigne" DECIMAL(10,2) NOT NULL DEFAULT 4500,
    "prixGpl125ConsigneRecharge" DECIMAL(10,2) NOT NULL DEFAULT 1500,
    "prixGpl35Pleine" DECIMAL(10,2) NOT NULL DEFAULT 15000,
    "prixGpl35Consigne" DECIMAL(10,2) NOT NULL DEFAULT 11000,
    "prixGpl35ConsigneRecharge" DECIMAL(10,2) NOT NULL DEFAULT 4000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "banks" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "swift" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "statut" "StatutBanque" NOT NULL DEFAULT 'ACTIF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "banks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pumps" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "produit" "Produit" NOT NULL,
    "statut" "StatutPompe" NOT NULL DEFAULT 'ACTIF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pumps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lubricant_products" (
    "id" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "viscosite" TEXT,
    "statut" "StatutProduit" NOT NULL DEFAULT 'ACTIF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lubricant_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lubricant_formats" (
    "id" TEXT NOT NULL,
    "lubricantProductId" TEXT NOT NULL,
    "contenance" TEXT NOT NULL,
    "prixUnitaire" DECIMAL(10,2) NOT NULL,
    "statut" "StatutProduit" NOT NULL DEFAULT 'ACTIF',

    CONSTRAINT "lubricant_formats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_entries" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "quart" "Quart" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responsableQuartId" TEXT NOT NULL,
    "responsableGplId" TEXT NOT NULL,
    "responsableLubrifiantsId" TEXT NOT NULL,
    "totalBillets" DECIMAL(14,2) NOT NULL,
    "totalPieces" DECIMAL(14,2) NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "montantTpe" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "montantGlobal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "quantiteGpl125Pleine" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl125Consigne" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl125ConsigneRecharge" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35Pleine" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35Consigne" INTEGER NOT NULL DEFAULT 0,
    "quantiteGpl35ConsigneRecharge" INTEGER NOT NULL DEFAULT 0,
    "montantGpl" DECIMAL(14,2) NOT NULL,
    "montantCarburant" DECIMAL(14,2) NOT NULL,
    "montantLubrifiants" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "ecart" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "cash_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "denominations" (
    "id" TEXT NOT NULL,
    "cashEntryId" TEXT NOT NULL,
    "type" "DenominationType" NOT NULL,
    "valeurFaciale" DECIMAL(10,2) NOT NULL,
    "quantite" INTEGER NOT NULL,
    "sousTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "denominations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump_readings" (
    "id" TEXT NOT NULL,
    "cashEntryId" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "pumpId" TEXT NOT NULL,
    "indexOuverture" DECIMAL(12,2) NOT NULL,
    "indexFermeture" DECIMAL(12,2) NOT NULL,
    "litresVendus" DECIMAL(12,2) NOT NULL,
    "montantCalcule" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "pump_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lubricant_sales" (
    "id" TEXT NOT NULL,
    "cashEntryId" TEXT NOT NULL,
    "lubricantFormatId" TEXT NOT NULL,
    "quantite" INTEGER NOT NULL,
    "montantCalcule" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "lubricant_sales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "numeroBordereau" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposit_denominations" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "type" "DenominationType" NOT NULL,
    "valeurFaciale" DECIMAL(10,2) NOT NULL,
    "quantite" INTEGER NOT NULL,
    "sousTotal" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "deposit_denominations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "categorie" "CategorieAudit" NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "acteurUserId" TEXT,
    "acteurLabel" TEXT NOT NULL,
    "stationId" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" "ErrorLogSource" NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "path" TEXT,
    "method" TEXT,
    "statusCode" INTEGER,
    "userId" TEXT,
    "userLabel" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identifiant_key" ON "users"("identifiant");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "stations_code_key" ON "stations"("code");

-- CreateIndex
CREATE INDEX "attendants_stationId_idx" ON "attendants"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "banks_code_key" ON "banks"("code");

-- CreateIndex
CREATE INDEX "pumps_stationId_idx" ON "pumps"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "pumps_stationId_code_key" ON "pumps"("stationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "lubricant_products_nom_key" ON "lubricant_products"("nom");

-- CreateIndex
CREATE UNIQUE INDEX "lubricant_formats_lubricantProductId_contenance_key" ON "lubricant_formats"("lubricantProductId", "contenance");

-- CreateIndex
CREATE INDEX "cash_entries_stationId_date_idx" ON "cash_entries"("stationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "cash_entries_stationId_quart_date_key" ON "cash_entries"("stationId", "quart", "date");

-- CreateIndex
CREATE INDEX "pump_readings_cashEntryId_idx" ON "pump_readings"("cashEntryId");

-- CreateIndex
CREATE INDEX "pump_readings_attendantId_idx" ON "pump_readings"("attendantId");

-- CreateIndex
CREATE UNIQUE INDEX "pump_readings_cashEntryId_pumpId_key" ON "pump_readings"("cashEntryId", "pumpId");

-- CreateIndex
CREATE INDEX "lubricant_sales_cashEntryId_idx" ON "lubricant_sales"("cashEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "lubricant_sales_cashEntryId_lubricantFormatId_key" ON "lubricant_sales"("cashEntryId", "lubricantFormatId");

-- CreateIndex
CREATE INDEX "deposits_stationId_createdAt_idx" ON "deposits"("stationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_bankId_numeroBordereau_key" ON "deposits"("bankId", "numeroBordereau");

-- CreateIndex
CREATE INDEX "audit_logs_categorie_date_idx" ON "audit_logs"("categorie", "date");

-- CreateIndex
CREATE INDEX "audit_logs_stationId_date_idx" ON "audit_logs"("stationId", "date");

-- CreateIndex
CREATE INDEX "error_logs_source_date_idx" ON "error_logs"("source", "date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendants" ADD CONSTRAINT "attendants_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pumps" ADD CONSTRAINT "pumps_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lubricant_formats" ADD CONSTRAINT "lubricant_formats_lubricantProductId_fkey" FOREIGN KEY ("lubricantProductId") REFERENCES "lubricant_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_responsableQuartId_fkey" FOREIGN KEY ("responsableQuartId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_responsableGplId_fkey" FOREIGN KEY ("responsableGplId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_responsableLubrifiantsId_fkey" FOREIGN KEY ("responsableLubrifiantsId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denominations" ADD CONSTRAINT "denominations_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_readings" ADD CONSTRAINT "pump_readings_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_readings" ADD CONSTRAINT "pump_readings_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_readings" ADD CONSTRAINT "pump_readings_pumpId_fkey" FOREIGN KEY ("pumpId") REFERENCES "pumps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lubricant_sales" ADD CONSTRAINT "lubricant_sales_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lubricant_sales" ADD CONSTRAINT "lubricant_sales_lubricantFormatId_fkey" FOREIGN KEY ("lubricantFormatId") REFERENCES "lubricant_formats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_denominations" ADD CONSTRAINT "deposit_denominations_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

