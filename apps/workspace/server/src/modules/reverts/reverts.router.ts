import { json, Router, type Request, type Response } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import { personInBrowser, type IdentityModule } from "../identity/index.js";
import type { RevertScope, RevertsModule } from "./reverts.types.js";

export function createRevertsRouter(options: {
  readonly identity: IdentityModule;
  readonly reverts: RevertsModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "64kb" }));

  const plan = (scope: (request: Request) => RevertScope) => async (request: Request, response: Response) => {
    const actor = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.reverts.plan(actor.user.id, personInBrowser(actor), scope(request)));
  };
  const revert = (scope: (request: Request) => RevertScope) => async (request: Request, response: Response) => {
    const actor = await options.identity.requireSession(request.headers.cookie);
    const result = await options.reverts.revert(
      actor.user.id,
      personInBrowser(actor),
      scope(request),
      request.headers["idempotency-key"],
      request.body,
    );
    if (result.status === 202) {
      response.location(`/api/operations/${encodeURIComponent(result.body.operation.id)}`);
    }
    response.status(result.status).json(result.body);
  };
  const pullRequest = (request: Request): RevertScope => ({ kind: "pullRequest", worktreeId: String(request.params.worktreeId) });
  const issue = (request: Request): RevertScope => {
    const number = Number(request.params.number);
    if (!Number.isSafeInteger(number) || number < 1) {
      throw new ApplicationError("INVALID_INPUT", 400, "Issue number must be a positive integer.", "number");
    }
    return { kind: "issue", spaceId: String(request.params.spaceId), number };
  };

  router.get("/worktrees/:worktreeId/revert", plan(pullRequest));
  router.post("/worktrees/:worktreeId/revert", revert(pullRequest));
  router.get("/spaces/:spaceId/issues/:number/revert", plan(issue));
  router.post("/spaces/:spaceId/issues/:number/revert", revert(issue));
  return router;
}
