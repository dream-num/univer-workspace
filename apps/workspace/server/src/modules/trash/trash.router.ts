import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { TrashModule } from "./trash.types.js";

export function createTrashRouter(options: {
  readonly identity: IdentityModule;
  readonly trash: TrashModule;
}): Router {
  const router = Router();

  router.post(
    "/nodes/:nodeId/trash",
    (request, response) => {
      const session = options.identity.requireSession(
        request.headers.cookie
      );
      response
        .status(201)
        .json(
          options.trash.trashNode(
            session.user.id,
            request.params.nodeId
          )
        );
    }
  );
  router.get("/spaces/:spaceId/trash", (request, response) => {
    const session = options.identity.requireSession(
      request.headers.cookie
    );
    response.json(
      options.trash.list(session.user.id, request.params.spaceId, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  router.post(
    "/trash-batches/:trashBatchId/restore",
    (request, response) => {
      const session = options.identity.requireSession(
        request.headers.cookie
      );
      response.json(
        options.trash.restore(
          session.user.id,
          request.params.trashBatchId
        )
      );
    }
  );
  router.delete(
    "/trash-batches/:trashBatchId",
    (request, response) => {
      const session = options.identity.requireSession(
        request.headers.cookie
      );
      options.trash.removePermanently(
        session.user.id,
        request.params.trashBatchId
      );
      response.status(204).end();
    }
  );

  return router;
}
