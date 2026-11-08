import { Module } from "@nestjs/common";
import { StockModule } from "../stock/stock.module";
import { EkaliIntegrationController } from "./ekali.controller";
import { EkaliApiKeyGuard } from "./ekali-api-key.guard";

/** Intégrations avec les autres applications PetroGabon (EKALI). */
@Module({
  imports: [StockModule],
  controllers: [EkaliIntegrationController],
  providers: [EkaliApiKeyGuard],
})
export class IntegrationsModule {}
