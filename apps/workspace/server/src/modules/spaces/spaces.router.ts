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
          publicRead: request.body?.publicRead,
        })
      );
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
          publicRead: request.body?.publicRead,
        }
      )
    );
  });

  return router;
}

function requiredParameter(value: string | undefined): string {
  if (value === undefined) throw new Error("Express route parameter is missing");
  return value;
}
