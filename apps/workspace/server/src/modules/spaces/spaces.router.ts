import { json, Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { SpacesModule } from "./spaces.service.js";

export function createSpacesRouter(options: {
  readonly identity: IdentityModule;
  readonly spaces: SpacesModule;
}): Router {
  const router = Router();
  router.use(json({ limit: "1mb" }));

  router.get("/spaces", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.list(session.user.id));
  });

  router.post("/team-spaces", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response
      .status(201)
      .json(
        await options.spaces.createTeamSpace(session.user.id, {
          name: request.body?.name,
          slug: request.body?.slug,
          publicRead: request.body?.publicRead,
        })
      );
  });

  router.get("/spaces/lookup", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.lookup(session.user.id, request.query.owner, request.query.slug));
  });

  router.get("/spaces/starred", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.listStarred(session.user.id));
  });

  router.get("/spaces/explore", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.explore(session.user.id));
  });

  router.get("/spaces/pins", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.getPins(session.user.id));
  });

  router.put("/spaces/pins", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.setPins(session.user.id, request.body?.spaceIds));
  });

  router.delete("/spaces/pins", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.resetPins(session.user.id));
  });

  router.get("/spaces/:spaceId", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.spaces.get(session.user.id, requiredParameter(request.params.spaceId))
    );
  });

  router.patch("/spaces/:spaceId", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(
      await options.spaces.update(
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

  router.get("/spaces/:spaceId/star", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.getStar(session.user.id, requiredParameter(request.params.spaceId)));
  });

  router.put("/spaces/:spaceId/star", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.setStar(session.user.id, requiredParameter(request.params.spaceId), true));
  });

  router.delete("/spaces/:spaceId/star", async (request, response) => {
    const session = await options.identity.requireSession(request.headers.cookie);
    response.json(await options.spaces.setStar(session.user.id, requiredParameter(request.params.spaceId), false));
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
