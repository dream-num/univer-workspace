import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { WorktreesModule } from "./worktrees.types.js";

export function createWorktreesRouter(options: {
  readonly identity: IdentityModule;
  readonly worktrees: WorktreesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/worktrees", async (request, response) => {
    const user = options.identity.requireSession(
      request.headers.cookie
    ).user;
    response.json(
      await options.worktrees.list(user.id, {
        scope: request.query.scope,
        kind: request.query.kind,
        teamSpaceId: request.query.teamSpaceId,
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  router.post("/worktrees", async (request, response) => {
    const user = options.identity.requireSession(
      request.headers.cookie
    ).user;
    const result = await options.worktrees.create(
      user.id,
      request.headers["idempotency-key"],
      request.body
    );
    response.status(result.status).json(result.body);
  });
  router.get("/worktrees/:worktreeId", async (request, response) => {
    const user = options.identity.requireSession(
      request.headers.cookie
    ).user;
    response.json(
      await options.worktrees.get(user.id, request.params.worktreeId)
    );
  });
  router.patch(
    "/worktrees/:worktreeId",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.update(
          user.id,
          request.params.worktreeId,
          request.body
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/units",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      const result = await options.worktrees.addUnit(
        user.id,
        request.params.worktreeId,
        request.headers["idempotency-key"],
        request.body
      );
      response.status(result.status).json(result.body);
    }
  );
  router.post(
    "/worktrees/:worktreeId/units/:unitId/open",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.openUnit(
          user.id,
          request.params.worktreeId,
          request.params.unitId,
          request.body
        )
      );
    }
  );
  router.get(
    "/worktrees/:worktreeId/units/:unitId/comparison",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.compareUnit(
          user.id,
          request.params.worktreeId,
          request.params.unitId
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/units/:unitId/changesets",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.submitChangeset(
          user.id,
          request.params.worktreeId,
          request.params.unitId,
          request.body
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/ready",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.markReady(
          user.id,
          request.params.worktreeId
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/reopen",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.reopen(
          user.id,
          request.params.worktreeId
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/merge",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.merge(
          user.id,
          request.params.worktreeId,
          request.headers["idempotency-key"]
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/discard",
    async (request, response) => {
      const user = options.identity.requireSession(
        request.headers.cookie
      ).user;
      response.json(
        await options.worktrees.discard(
          user.id,
          request.params.worktreeId,
          request.headers["idempotency-key"]
        )
      );
    }
  );

  return router;
}
