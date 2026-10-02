import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { PompisteJwtPayload } from "../types";

// request.pompiste n'existe que si PompisteAuthGuard a été appliqué sur la route.
export const CurrentPompiste = createParamDecorator((_: unknown, ctx: ExecutionContext): PompisteJwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.pompiste;
});
