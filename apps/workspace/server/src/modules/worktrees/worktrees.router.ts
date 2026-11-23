import { json, Router, type RequestHandler } from "express";
import { ApplicationError } from "../../middleware/errors.js";
import { personInBrowser, type IdentityModule } from "../identity/index.js";
import type { WorktreesModule } from "./worktrees.types.js";

interface WorktreeRouteDependencies {
  readonly identity: IdentityModule;
  readonly worktrees: WorktreesModule;
}

export function createAddWorktreeUnitHandler(
  options: WorktreeRouteDependencies
): RequestHandler<{ worktreeId: string }> {
  const parseUnitJson = json({ limit: "2mb" });
  return async (request, response) => {
    const { user } = await options.identity.requireSession(request.headers.cookie);
    await new Promise<void>((resolve, reject) => {
      parseUnitJson(request, response, (error: unknown) => {
        if (!error) {
          resolve();
          return;
        }
        const tooLarge =
          typeof error === "object" &&
          error !== null &&
          "type" in error &&
          error.type === "entity.too.large";
        reject(
          new ApplicationError(
            tooLarge ? "PAYLOAD_TOO_LARGE" : "INVALID_INPUT",
            tooLarge ? 413 : 400,
            tooLarge ? "Worktree Unit requests are limited to 2 MiB." : "Invalid Unit JSON body."
          )
        );
      });
    });
    const result = await options.worktrees.addUnit(
      user.id,
      request.params.worktreeId,
      request.headers["idempotency-key"],
      request.body
    );
    response.status(result.status).json(result.body);
  };
}

export function createWorktreesRouter(options: WorktreeRouteDependencies): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/worktrees", async (request, response) => {
    const user = (await options.identity.requireSession(
      request.headers.cookie
    )).user;
    response.json(
      await options.worktrees.list(user.id, {
        scope: request.query.scope,
        search: request.query.search,
        order: request.query.order,
        kind: request.query.kind,
        teamSpaceId: request.query.teamSpaceId,
        state: request.query.state,
        cursor: request.query.cursor,
        limit: request.query.limit,
      })
    );
  });
  router.post("/worktrees", async (request, response) => {
    const { user, writeSource } = await options.identity.requireSession(
      request.headers.cookie
    );
    const result = await options.worktrees.create(
      user.id,
      request.headers["idempotency-key"],
      request.body,
      writeSource
    );
    response.status(result.status).json(result.body);
  });
  router.get("/worktrees/:worktreeId", async (request, response) => {
    const user = (await options.identity.requireSession(
      request.headers.cookie
    )).user;
    response.json(
      await options.worktrees.get(user.id, request.params.worktreeId, true)
    );
  });
  router.get("/worktrees/:worktreeId/checks", async (request, response) => {
    const user = (await options.identity.requireSession(request.headers.cookie)).user;
    response.json(await options.worktrees.checks(user.id, request.params.worktreeId));
  });
  router.put("/worktrees/:worktreeId/checks/:name", async (request, response) => {
    const user = (await options.identity.requireSession(request.headers.cookie)).user;
    response.json(
      await options.worktrees.reportCheck(user.id, request.params.worktreeId, request.params.name, request.body),
    );
  });
  router.get("/spaces/:spaceId/worktrees/:number", async (request, response) => {
    const user = (await options.identity.requireSession(
      request.headers.cookie
    )).user;
    response.json(
      await options.worktrees.getByNumber(
        user.id,
        request.params.spaceId,
        request.params.number
      )
    );
  });
  router.patch(
    "/worktrees/:worktreeId",
    async (request, response) => {
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
      response.json(
        await options.worktrees.update(
          user.id,
          request.params.worktreeId,
          request.body
        )
      );
    }
  );
  router.post("/worktrees/:worktreeId/units/:unitId/removal", async (request, response) => {
    const user = (await options.identity.requireSession(request.headers.cookie)).user;
    response.json(
      await options.worktrees.setUnitRemoved(
        user.id,
        request.params.worktreeId,
        request.params.unitId,
        request.body,
      ),
    );
  });
  router.post(
    "/worktrees/:worktreeId/units/:unitId/open",
    async (request, response) => {
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
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
  router.post(
    "/worktrees/:worktreeId/units/:unitId/changesets",
    async (request, response) => {
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
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
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
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
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
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
      const actor = await options.identity.requireSession(
        request.headers.cookie
      );
      response.json(
        await options.worktrees.merge(
          actor.user.id,
          request.params.worktreeId,
          request.headers["idempotency-key"],
          personInBrowser(actor),
          request.body
        )
      );
    }
  );
  router.post(
    "/worktrees/:worktreeId/discard",
    async (request, response) => {
      const user = (await options.identity.requireSession(
        request.headers.cookie
      )).user;
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
