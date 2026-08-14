import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { ViewsModule } from "./views.service.js";

export function createViewsRouter(options: {
  readonly identity: IdentityModule;
  readonly views: ViewsModule;
}): Router {
  const router = Router();
  router.get("/recent-resources", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.views.listRecent(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  router.get("/owned-by-me", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.views.listOwned(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  router.get("/shared-with-me", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.views.listShared(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  return router;
}
