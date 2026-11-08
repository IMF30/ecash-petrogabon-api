-- Informations publiques des stations, exposées à l'application client EKALI
-- (carte des stations, disponibilité des produits). Colonnes facultatives ou avec
-- valeur par défaut : aucune station existante n'est affectée.
ALTER TABLE "stations" ADD COLUMN "latitude" DECIMAL(9,6);
ALTER TABLE "stations" ADD COLUMN "longitude" DECIMAL(9,6);
ALTER TABLE "stations" ADD COLUMN "telephone" TEXT;
ALTER TABLE "stations" ADD COLUMN "horaireOuverture" TEXT NOT NULL DEFAULT '06:00';
ALTER TABLE "stations" ADD COLUMN "horaireFermeture" TEXT NOT NULL DEFAULT '22:00';
