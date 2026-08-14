import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { PermissionsModule } from "./permissions.service.js";

export function createPermissionsRouter(options: {
  readonly identity: IdentityModule;
  readonly permissions: PermissionsModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/users/search", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.permissions.searchUsers(session.user.id, request.query.query)
    );
  });
  router.get("/team-spaces/:spaceId/members", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.permissions.listTeamMembers(
        session.user.id,
        parameter(request.params.spaceId)
      )
    );
  });
  router.put(
    "/team-spaces/:spaceId/members/:userId",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.json(
        options.permissions.upsertTeamMember(
          session.user.id,
          parameter(request.params.spaceId),
          parameter(request.params.userId),
          request.body
        )
      );
    }
  );
  router.delete(
    "/team-spaces/:spaceId/members/:userId",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      options.permissions.removeTeamMember(
        session.user.id,
        parameter(request.params.spaceId),
        parameter(request.params.userId)
      );
      response.status(204).end();
    }
  );
  router.get("/nodes/:nodeId/grants", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.permissions.listNodeGrants(
        session.user.id,
        parameter(request.params.nodeId)
      )
    );
  });
  router.put(
    "/nodes/:nodeId/grants/:userId",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.json(
        options.permissions.upsertNodeGrant(
          session.user.id,
          parameter(request.params.nodeId),
          parameter(request.params.userId),
          request.body
        )
      );
    }
  );
  router.delete(
    "/nodes/:nodeId/grants/:userId",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.json(
        options.permissions.removeNodeGrant(
          session.user.id,
          parameter(request.params.nodeId),
          parameter(request.params.userId)
        )
      );
    }
  );
  router.get(
    "/nodes/:nodeId/link-sharing",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.json(
        options.permissions.getNodeLinkSharing(
          session.user.id,
          parameter(request.params.nodeId)
        )
      );
    }
  );
  router.put(
    "/nodes/:nodeId/link-sharing",
    (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.json(
        options.permissions.updateNodeLinkSharing(
          session.user.id,
          parameter(request.params.nodeId),
          request.body
        )
      );
    }
  );
  return router;
}

function parameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
