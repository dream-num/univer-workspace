import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { ViewsModule } from "./views.service.js";

export function createViewsRouter(options: {
  readonly identity: IdentityModule;
  readonly views: ViewsModule;
}): Router {
  const router = Router();
  router.get("/recent-resources", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.views.listRecent(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
    );
  });
  router.get("/owned-by-me", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.views.listOwned(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
    );
  });
  router.get("/html-views", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.views.listHtmlViews(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
        spaceId: request.query.spaceId,
      }),
    );
  });
  router.get("/shared-with-me", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.views.listShared(session.user.id, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
    );
  });
  return router;
}
