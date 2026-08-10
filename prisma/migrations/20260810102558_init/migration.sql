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
CREATE TYPE "StatutDeposit" AS ENUM ('VALIDE');

-- CreateEnum
CREATE TYPE "CategorieAudit" AS ENUM ('CONNEXION', 'ENCAISSEMENT', 'VERSEMENT', 'CODE', 'UTILISATEUR', 'STATION', 'BANQUE', 'POMPISTE');

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
CREATE TABLE "cash_entries" (
    "id" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "quart" "Quart" NOT NULL,
    "totalBillets" DECIMAL(14,2) NOT NULL,
    "totalPieces" DECIMAL(14,2) NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

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
CREATE TABLE "deposit_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "generatedByUserId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "deposit_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "depositCodeId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "montant" DECIMAL(14,2) NOT NULL,
    "validatedByUserId" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statut" "StatutDeposit" NOT NULL DEFAULT 'VALIDE',

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" TEXT NOT NULL,
    "depositId" TEXT NOT NULL,
    "numeroTransaction" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
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
CREATE INDEX "cash_entries_stationId_date_idx" ON "cash_entries"("stationId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "deposit_codes_code_key" ON "deposit_codes"("code");

-- CreateIndex
CREATE INDEX "deposit_codes_stationId_usedAt_idx" ON "deposit_codes"("stationId", "usedAt");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_depositCodeId_key" ON "deposits"("depositCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_depositId_key" ON "receipts"("depositId");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_numeroTransaction_key" ON "receipts"("numeroTransaction");

-- CreateIndex
CREATE INDEX "audit_logs_categorie_date_idx" ON "audit_logs"("categorie", "date");

-- CreateIndex
CREATE INDEX "audit_logs_stationId_date_idx" ON "audit_logs"("stationId", "date");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendants" ADD CONSTRAINT "attendants_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "attendants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_entries" ADD CONSTRAINT "cash_entries_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "denominations" ADD CONSTRAINT "denominations_cashEntryId_fkey" FOREIGN KEY ("cashEntryId") REFERENCES "cash_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_codes" ADD CONSTRAINT "deposit_codes_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_codes" ADD CONSTRAINT "deposit_codes_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposit_codes" ADD CONSTRAINT "deposit_codes_generatedByUserId_fkey" FOREIGN KEY ("generatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_depositCodeId_fkey" FOREIGN KEY ("depositCodeId") REFERENCES "deposit_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "banks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deposits" ADD CONSTRAINT "deposits_validatedByUserId_fkey" FOREIGN KEY ("validatedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_depositId_fkey" FOREIGN KEY ("depositId") REFERENCES "deposits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
