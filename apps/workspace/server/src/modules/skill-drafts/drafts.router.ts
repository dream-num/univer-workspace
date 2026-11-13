import { json, Router, type RequestHandler } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import type { IdentityModule } from "../identity/index.js";
import type { SkillSourcesModule } from "./sources.service.js";
import type { SkillDraftsModule } from "./drafts.service.js";

export function createSkillDraftsRouter(options: {
  identity: IdentityModule;
  drafts: SkillDraftsModule;
  sources: SkillSourcesModule;
}): Router {
  const router = Router();
  router.post("/skill-sources/read", parseBody("16kb"), async (request, response) => {
    const actor = options.identity.requireSession(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(await options.sources.read(actor.user.id, request.body));
  });
  router.post(
    "/skill-drafts",
    parseBody("125mb"),
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
  router.get("/skill-drafts/:draftId", (request, response) => {
    const actor = options.identity.requireSession(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ draft: options.drafts.get(actor.user.id, String(request.params.draftId)) });
  });
  router.get("/skill-drafts/:draftId/content", async (request, response) => {
    const actor = options.identity.requireSession(request.headers.cookie);
    const opened = await options.drafts.openContent(
      actor.user.id,
      String(request.params.draftId),
      request.query.path,
      request.query.version,
    );
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
    router.post(`/skill-drafts/:draftId/${action}`, async (request, response) => {
      const actor = options.identity.requireInteractiveSession(request.headers.cookie);
      response.setHeader("Cache-Control", "private, no-store");
      response.json({
        draft: await options.drafts[action](actor.user.id, String(request.params.draftId)),
      });
    });
  }
  return router;
}

function parseBody(limit: string): RequestHandler {
  const parse = json({ limit });
  return (request, response, next) => parse(request, response, (error: unknown) => {
    if (!error) return next();
    const tooLarge = typeof error === "object" && error !== null && "type" in error && error.type === "entity.too.large";
    next(new ApplicationError(tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT", tooLarge ? 413 : 400, "Invalid Skill JSON body."));
  });
}
