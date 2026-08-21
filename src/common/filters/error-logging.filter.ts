import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import { ErrorLogsService } from "../../error-logs/error-logs.service";
import { AuthenticatedRequest } from "../../auth/types";

/**
 * Filtre global : laisse passer les HttpException volontaires (400, 403, 404,
 * 409...) telles quelles, mais journalise toute erreur inattendue (bug non
 * géré) dans ErrorLog pour que l'Administrateur puisse la diagnostiquer.
 */
@Catch()
export class ErrorLoggingFilter implements ExceptionFilter {
  private readonly logger = new Logger("ExceptionFilter");

  constructor(private readonly errorLogsService: ErrorLogsService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & AuthenticatedRequest>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const body = isHttpException
      ? exception.getResponse()
      : { statusCode: status, error: "Internal Server Error", message: "Une erreur inattendue est survenue." };

    if (!isHttpException || status >= 500) {
      const error = exception instanceof Error ? exception : new Error(String(exception));
      this.logger.error(error.message, error.stack);
      this.errorLogsService
        .record({
          source: "BACKEND",
          message: error.message,
          stack: error.stack,
          path: request?.originalUrl ?? request?.url,
          method: request?.method,
          statusCode: status,
          userId: request?.user?.sub ?? null,
          // Le rôle plutôt que le nom : suffisant pour le diagnostic, évite de stocker
          // une donnée personnelle supplémentaire dans les logs d'erreur.
          userLabel: request?.user?.role ?? null,
        })
        .catch((e) => this.logger.error("Échec de la journalisation d'erreur", e));
    }

    response.status(status).json(body);
  }
}
