import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { SpacesModule } from "./spaces.service.js";

export function createSpacesRouter(options: {
  readonly identity: IdentityModule;
  readonly spaces: SpacesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/spaces", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(options.spaces.list(session.user.id));
  });

  router.post("/team-spaces", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response
      .status(201)
      .json(
        options.spaces.createTeamSpace(session.user.id, {
          name: request.body?.name,
          slug: request.body?.slug,
          publicRead: request.body?.publicRead,
        })
      );
  });

  router.get("/spaces/lookup", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(options.spaces.lookup(session.user.id, request.query.owner, request.query.slug));
  });

  router.get("/spaces/:spaceId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.spaces.get(session.user.id, requiredParameter(request.params.spaceId))
    );
  });

  router.patch("/spaces/:spaceId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(
      options.spaces.update(
        session.user.id,
        requiredParameter(request.params.spaceId),
        {
          name: request.body?.name,
          slug: request.body?.slug,
          publicRead: request.body?.publicRead,
          description: request.body?.description,
        }
      )
    );
  });

  router.get("/spaces/:spaceId/star", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(options.spaces.getStar(session.user.id, requiredParameter(request.params.spaceId)));
  });

  router.put("/spaces/:spaceId/star", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(options.spaces.setStar(session.user.id, requiredParameter(request.params.spaceId), true));
  });

  router.delete("/spaces/:spaceId/star", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    response.json(options.spaces.setStar(session.user.id, requiredParameter(request.params.spaceId), false));
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
