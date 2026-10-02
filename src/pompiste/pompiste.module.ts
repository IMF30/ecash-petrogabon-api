import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PompisteService } from "./pompiste.service";
import { PompisteController } from "./pompiste.controller";
import { PompisteAuthModule } from "../pompiste-auth/pompiste-auth.module";
import { CashEntriesModule } from "../cash-entries/cash-entries.module";

@Module({
  // JwtModule doit être importé ici aussi (pas seulement dans PompisteAuthModule) : c'est
  // la convention du projet — chaque module dont un contrôleur utilise un guard basé sur
  // JwtService (ici PompisteAuthGuard) importe sa propre instance de JwtModule.register({}).
  imports: [JwtModule.register({}), PompisteAuthModule, CashEntriesModule],
  controllers: [PompisteController],
  providers: [PompisteService],
})
export class PompisteModule {}
