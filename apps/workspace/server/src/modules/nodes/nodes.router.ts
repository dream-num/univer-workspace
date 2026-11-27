import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { NodesModule } from "./nodes.service.js";

export function createNodesRouter(options: {
  readonly identity: IdentityModule;
  readonly nodes: NodesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/spaces/:spaceId/nodes", async (request, response) => {
    const reader = await options.identity.getReader(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      await options.nodes.listSpaceRoot(
        reader.userId,
        requiredParameter(request.params.spaceId),
        { cursor: request.query.cursor, limit: request.query.limit }
      )
    );
  });

  router.post("/nodes", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.status(201).json(
      await options.nodes.create(session.user.id, request.body)
    );
  });

  router.get("/nodes/:nodeId", async (request, response) => {
    const reader = await options.identity.getReader(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      await options.nodes.get(
        reader.userId,
        requiredParameter(request.params.nodeId)
      )
    );
  });

  router.get("/nodes/:nodeId/children", async (request, response) => {
    const reader = await options.identity.getReader(request.headers.cookie);
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      await options.nodes.listChildren(
        reader.userId,
        requiredParameter(request.params.nodeId),
        { cursor: request.query.cursor, limit: request.query.limit }
      )
    );
  });

  router.patch("/nodes/:nodeId", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.nodes.update(
        session,
        requiredParameter(request.params.nodeId),
        request.body
      )
    );
  });

  router.post("/nodes/:nodeId/reports", async (request, response) => {
    const reader = await options.identity.getReader(request.headers.cookie);
    response.setHeader("Cache-Control", "no-store");
    response.status(201).json(
      await options.nodes.report(
        reader.userId,
        requiredParameter(request.params.nodeId),
        request.body,
        request.ip
      )
    );
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
