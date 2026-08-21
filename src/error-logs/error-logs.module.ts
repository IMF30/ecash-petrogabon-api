import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { ErrorLogsService } from "./error-logs.service";
import { ErrorLogsController } from "./error-logs.controller";

@Module({
  imports: [JwtModule.register({})],
  controllers: [ErrorLogsController],
  providers: [ErrorLogsService],
  exports: [ErrorLogsService],
})
export class ErrorLogsModule {}
