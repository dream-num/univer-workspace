import { json, Router } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityModule } from "../identity/index.js";
import type { HtmlViewDraftsModule } from "./drafts.service.js";

export function createHtmlViewDraftsRouter(options: {
  identity: IdentityModule;
  drafts: HtmlViewDraftsModule;
}): Router {
  const router = Router();
  const parseJson = json({ limit: "2mb" });
  router.post(
    "/html-view-drafts",
    (request, response, next) =>
      parseJson(request, response, (error: unknown) => {
        if (!error) return next();
        const tooLarge =
          typeof error === "object" &&
          error !== null &&
          "type" in error &&
          error.type === "entity.too.large";
        next(
          new ApplicationError(
            tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
            tooLarge ? 413 : 400,
            "Invalid draft JSON body.",
          ),
        );
      }),
    async (request, response) => {
      const actor = options.identity.requireSession(request.headers.cookie);
      const result = await options.drafts.submit(
        actor.user.id,
        request.headers["idempotency-key"],
        request.body,
      );
      response.status(result.status).json({ draft: result.draft });
    },
  );
  router.get("/html-view-drafts/:draftId", (request, response) => {
    const actor = options.identity.requireSession(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ draft: options.drafts.get(actor.user.id, String(request.params.draftId)) });
  });
  router.get("/html-view-drafts/:draftId/content", async (request, response) => {
    const actor = options.identity.requireSession(request.headers.cookie);
    const opened = await options.drafts.openContent(actor.user.id, String(request.params.draftId));
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Content-Security-Policy", "sandbox");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("Content-Length", opened.byteSize);
    opened.stream.on("error", () => response.destroy());
    response.on("close", () => opened.stream.destroy());
    opened.stream.pipe(response);
  });
  for (const action of ["publish", "reject"] as const) {
    router.post(`/html-view-drafts/:draftId/${action}`, (request, response) => {
      const actor = options.identity.requireInteractiveSession(request.headers.cookie);
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        draft: options.drafts[action](actor.user.id, String(request.params.draftId)),
      });
    });
  }
  return router;
}
