import { json, Router } from "express";
import { ANONYMOUS_USER_ID, type IdentityModule } from "../identity/index.js";
import type { ResourcesModule } from "./resources.service.js";

export function createResourcesRouter(options: {
  readonly identity: IdentityModule;
  readonly resources: ResourcesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.post("/resources", async (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    const result = await options.resources.create(
      session.user.id,
      request.headers["idempotency-key"],
      request.body
    );
    if (result.status === 202) {
      response
        .status(202)
        .location(
          `/api/operations/${encodeURIComponent(result.body.operation.id)}`
        )
        .json(result.body);
      return;
    }
    response.status(result.status).json(result.body);
  });

  router.get("/resources/:resourceId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.resources.get(
        session.user.id,
        requiredParameter(request.params.resourceId)
      )
    );
  });

  router.get("/unit-resources/:unitId", (request, response) => {
    const session = options.identity.getSession(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      options.resources.getByUnit(
        session.authenticated ? session.user.id : ANONYMOUS_USER_ID,
        requiredParameter(request.params.unitId)
      )
    );
  });

  router.post("/resources/:resourceId/open", (request, response) => {
    const session = options.identity.getSession(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      options.resources.open(
        session.authenticated ? session.user.id : ANONYMOUS_USER_ID,
        requiredParameter(request.params.resourceId)
      )
    );
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
