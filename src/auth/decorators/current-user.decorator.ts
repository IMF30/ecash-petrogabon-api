import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { JwtPayload } from "../types";

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): JwtPayload => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});
