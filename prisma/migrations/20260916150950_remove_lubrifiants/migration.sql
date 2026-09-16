/*
  Warnings:

  - You are about to drop the column `montantLubrifiants` on the `cash_entries` table. All the data in the column will be lost.
  - You are about to drop the column `responsableLubrifiantsId` on the `cash_entries` table. All the data in the column will be lost.
  - You are about to drop the `lubricant_formats` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lubricant_products` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `lubricant_sales` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `versement_lubricant_sales` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "cash_entries" DROP CONSTRAINT "cash_entries_responsableLubrifiantsId_fkey";

-- DropForeignKey
ALTER TABLE "lubricant_formats" DROP CONSTRAINT "lubricant_formats_lubricantProductId_fkey";

-- DropForeignKey
ALTER TABLE "lubricant_sales" DROP CONSTRAINT "lubricant_sales_cashEntryId_fkey";

-- DropForeignKey
ALTER TABLE "lubricant_sales" DROP CONSTRAINT "lubricant_sales_lubricantFormatId_fkey";

-- DropForeignKey
ALTER TABLE "versement_lubricant_sales" DROP CONSTRAINT "versement_lubricant_sales_lubricantFormatId_fkey";

-- DropForeignKey
ALTER TABLE "versement_lubricant_sales" DROP CONSTRAINT "versement_lubricant_sales_versementId_fkey";

-- AlterTable
ALTER TABLE "cash_entries" DROP COLUMN "montantLubrifiants",
DROP COLUMN "responsableLubrifiantsId";

-- DropTable
DROP TABLE "lubricant_formats";

-- DropTable
DROP TABLE "lubricant_products";

-- DropTable
DROP TABLE "lubricant_sales";

-- DropTable
DROP TABLE "versement_lubricant_sales";

-- DropEnum
DROP TYPE "StatutProduit";
