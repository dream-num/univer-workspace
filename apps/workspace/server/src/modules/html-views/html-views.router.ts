import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { HtmlViewsModule } from "./html-views.service.js";

export function createHtmlViewsRouter(options: {
  readonly identity: IdentityModule;
  readonly htmlViews: HtmlViewsModule;
}) {
  const router = Router();
  router.get("/html-views/:resourceId/sources/:unitId", async (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    const scope = await options.htmlViews.open(session.user.id, request.params.resourceId);
    await options.htmlViews.authorize(session.user.id, scope, request.params.unitId);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ unitId: request.params.unitId, editorMode: "edit" });
  });
  return router;
}
