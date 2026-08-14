import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { NodesModule } from "./nodes.service.js";

export function createNodesRouter(options: {
  readonly identity: IdentityModule;
  readonly nodes: NodesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/spaces/:spaceId/nodes", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.nodes.listSpaceRoot(
        session.user.id,
        requiredParameter(request.params.spaceId),
        { cursor: request.query.cursor, limit: request.query.limit }
      )
    );
  });

  router.post("/nodes", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.status(201).json(
      options.nodes.create(session.user.id, request.body)
    );
  });

  router.get("/nodes/:nodeId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.nodes.get(
        session.user.id,
        requiredParameter(request.params.nodeId)
      )
    );
  });

  router.get("/nodes/:nodeId/children", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.nodes.listChildren(
        session.user.id,
        requiredParameter(request.params.nodeId),
        { cursor: request.query.cursor, limit: request.query.limit }
      )
    );
  });

  router.patch("/nodes/:nodeId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.nodes.update(
        session.user.id,
        requiredParameter(request.params.nodeId),
        request.body
      )
    );
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
