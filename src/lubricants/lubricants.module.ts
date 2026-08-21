import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { LubricantsService } from "./lubricants.service";
import { LubricantProductsController } from "./lubricant-products.controller";
import { LubricantFormatsController } from "./lubricant-formats.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [JwtModule.register({}), AuditModule],
  controllers: [LubricantProductsController, LubricantFormatsController],
  providers: [LubricantsService],
  exports: [LubricantsService],
})
export class LubricantsModule {}
