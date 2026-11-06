import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { ActivityModule } from "./activity.service.js";

export function createActivityRouter(options: {
  readonly identity: IdentityModule;
  readonly activity: ActivityModule;
}): Router {
  const router = Router();
  router.get("/spaces/:spaceId/activity", async (request, response) => {
    const { user } = options.identity.requireSession(request.headers.cookie);
    response.json(await options.activity.get(user.id, request.params.spaceId, { timeZone: request.query.timeZone }));
  });
  return router;
}
