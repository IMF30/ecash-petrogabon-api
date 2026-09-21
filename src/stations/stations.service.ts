import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Produit } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AuditService } from "../audit/audit.service";
import { describeChanges } from "../common/describe-changes";
import { CreateStationDto } from "./dto/create-station.dto";
import { UpdateStationDto } from "./dto/update-station.dto";
import { JwtPayload } from "../auth/types";

/**
 * Parc de pompes standard attribué à chaque nouvelle station, aligné sur la
 * configuration de référence PK8 (24 pompes Gasoil + 12 pompes Essence + 6
 * pompes Pétrole).
 */
export const DEFAULT_PUMP_CODES: { code: string; produit: Produit }[] = [
  ...["G1", "G2", "G3", "G4", "G5", "G6"].flatMap((g) => [
    { code: `${g}-A`, produit: "GASOIL" as Produit },
    { code: `${g}-B`, produit: "GASOIL" as Produit },
  ]),
  ...["G7", "G8", "G9"].flatMap((g) => [
    { code: `${g}-A`, produit: "GASOIL" as Produit },
    { code: `${g}-B`, produit: "GASOIL" as Produit },
    { code: `${g}-C`, produit: "GASOIL" as Produit },
    { code: `${g}-D`, produit: "GASOIL" as Produit },
  ]),
  ...["S1", "S2", "S3", "S4", "S5", "S6"].flatMap((s) => [
    { code: `${s}-A`, produit: "ESSENCE" as Produit },
    { code: `${s}-B`, produit: "ESSENCE" as Produit },
  ]),
  ...["P1", "P2", "P3"].flatMap((p) => [
    { code: `${p}-A`, produit: "PETROLE" as Produit },
    { code: `${p}-B`, produit: "PETROLE" as Produit },
  ]),
];

/**
 * Regroupe une liste de pompes par distributeur (îlot physique), déduit du numéro dans le code
 * (ex. "S1-A" et "G1-B" partagent le numéro 1 → "Distributeur 1"). Le Pétrole ne se mélange
 * jamais avec l'Essence/Gasoil : une pompe Pétrole a toujours son propre distributeur dédié
 * (ex. "P1-A" → "Distributeur Pétrole 1"), même si son numéro coïncide avec un distributeur
 * essence/gasoil existant. Une pompe dont le code ne suit pas ce format reçoit aussi son propre
 * distributeur dédié, pour ne jamais rien laisser orphelin.
 */
export function regrouperPompesParDistributeur(
  pompes: { code: string; produit: Produit }[],
): Map<string, { code: string; produit: Produit }[]> {
  const groupes = new Map<string, { code: string; produit: Produit }[]>();
  for (const pompe of pompes) {
    const numero = pompe.code.match(/^[A-Za-z]+(\d+)-/)?.[1];
    let nomDistributeur: string;
    if (numero === undefined) {
      nomDistributeur = `Distributeur ${pompe.code}`;
    } else if (pompe.produit === "PETROLE") {
      nomDistributeur = `Distributeur Pétrole ${numero}`;
    } else {
      nomDistributeur = `Distributeur ${numero}`;
    }
    const liste = groupes.get(nomDistributeur) ?? [];
    liste.push(pompe);
    groupes.set(nomDistributeur, liste);
  }
  return groupes;
}

@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  findAll() {
    return this.prisma.station.findMany({ orderBy: { code: "asc" } });
  }

  async findOne(id: string) {
    const station = await this.prisma.station.findUnique({ where: { id } });
    if (!station) throw new NotFoundException("Station introuvable.");
    return station;
  }

  async create(dto: CreateStationDto, actor: JwtPayload) {
    const created = await this.prisma.station.create({ data: dto });
    // Toute nouvelle station reçoit automatiquement le parc de pompes par défaut (voir
    // DEFAULT_PUMP_CODES), déjà organisées en distributeurs (îlots physiques).
    const groupes = regrouperPompesParDistributeur(DEFAULT_PUMP_CODES);
    for (const [nom, pompes] of groupes) {
      const distributeur = await this.prisma.distributeur.create({ data: { nom, stationId: created.id } });
      await this.prisma.pump.createMany({
        data: pompes.map((p) => ({ ...p, stationId: created.id, distributeurId: distributeur.id })),
      });
    }
    await this.auditService.record({
      categorie: "STATION",
      action: "Station créée",
      detail: `${created.code} — ${created.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: created.id,
    });
    return created;
  }

  async update(id: string, dto: UpdateStationDto, actor: JwtPayload) {
    const before = await this.findOne(id);
    const updated = await this.prisma.station.update({ where: { id }, data: dto });
    await this.auditService.record({
      categorie: "STATION",
      action: "Station modifiée",
      detail: `${updated.code} — ${updated.nom} — ${describeChanges(before, dto)}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: updated.id,
    });
    return updated;
  }

  async remove(id: string, actor: JwtPayload) {
    const station = await this.findOne(id);

    // Une station reçoit son parc de pompes dès sa création (voir create() ci-dessus) : la
    // suppression n'est donc réaliste que pour une station fraîchement créée et jamais utilisée.
    // Sans ce contrôle explicite, la contrainte de clé étrangère en base ferait échouer la
    // suppression avec une erreur 500 générique dès qu'une donnée est rattachée.
    const [users, attendants, pumps, distributeurs, cashEntries, deposits] = await Promise.all([
      this.prisma.user.count({ where: { stationId: id } }),
      this.prisma.attendant.count({ where: { stationId: id } }),
      this.prisma.pump.count({ where: { stationId: id } }),
      this.prisma.distributeur.count({ where: { stationId: id } }),
      this.prisma.cashEntry.count({ where: { stationId: id } }),
      this.prisma.deposit.count({ where: { stationId: id } }),
    ]);
    if (users + attendants + pumps + distributeurs + cashEntries + deposits > 0) {
      throw new BadRequestException(
        "Cette station a des données associées (utilisateurs, personnel, pompes, encaissements ou versements) et ne peut pas être supprimée — désactivez-la plutôt (statut Hors Service).",
      );
    }

    await this.prisma.station.delete({ where: { id } });
    await this.auditService.record({
      categorie: "STATION",
      action: "Station supprimée",
      detail: `${station.code} — ${station.nom}`,
      acteurUserId: actor.sub,
      acteurLabel: actor.role,
      stationId: null,
    });
    return { id };
  }
}
