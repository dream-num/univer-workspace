import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { ForksModule } from "./forks.service.js";

export function createForksRouter(options: {
  readonly identity: IdentityModule;
  readonly forks: ForksModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.post("/forks", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    const result = await options.forks.create(session.user.id, {
      upstreamSpaceId: request.body?.upstreamSpaceId,
      name: request.body?.name,
    });
    response.status(result.status).json(result.body);
  });

  router.get("/forks", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.forks.list(session.user.id));
  });

  router.get("/forks/lookup", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.forks.lookup(session.user.id, request.query.owner, request.query.name));
  });

  router.get("/forks/:forkId", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.forks.get(session.user.id, request.params.forkId));
  });

  router.delete("/forks/:forkId", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.forks.delete(session.user.id, request.params.forkId));
  });

  return router;
}
