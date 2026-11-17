import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { CopiesModule } from "./copies.service.js";

export function createCopiesRouter(options: {
  readonly identity: IdentityModule;
  readonly copies: CopiesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.post("/nodes/:nodeId/copies", async (request, response) => {
    const result = await options.copies.copy(
      await options.identity.requireSession(request.headers.cookie),
      request.params.nodeId,
      request.headers["idempotency-key"],
      request.body
    );
    if (result.status === 202) {
      response.location(`/api/operations/${encodeURIComponent(result.body.operation.id)}`);
    }
    response.status(result.status).json(result.body);
  });

  return router;
}
