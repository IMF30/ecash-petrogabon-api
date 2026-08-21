import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtPayload } from "../types";

// request.user n'existe que si JwtAuthGuard a été appliqué sur la route ;
// utiliser ce décorateur sans ce guard renverrait undefined.
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
