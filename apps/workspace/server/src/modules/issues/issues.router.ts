import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { IssuesModule } from "./issues.types.js";

export function createIssuesRouter(options: {
  readonly identity: IdentityModule;
  readonly issues: IssuesModule;
}): Router {
  const router = Router();
  const userId = async (cookie: string | undefined) => (await options.identity.requireSession(cookie)).user.id;

  router.get("/issues", async (request, response) => {
    response.json(await options.issues.listMine(await userId(request.headers.cookie), request.query));
  });
  router.get("/spaces/:spaceId/issues", async (request, response) => {
    response.json(await options.issues.list(await userId(request.headers.cookie), request.params.spaceId, request.query));
  });
  router.post("/spaces/:spaceId/issues", async (request, response) => {
    const { user, writeSource } = await options.identity.requireSession(request.headers.cookie);
    response
      .status(201)
      .json(await options.issues.create(user.id, request.params.spaceId, request.body, writeSource));
  });
  router.get("/spaces/:spaceId/issues/:number", async (request, response) => {
    response.json(await options.issues.get(await userId(request.headers.cookie), request.params.spaceId, request.params.number));
  });
  router.patch("/spaces/:spaceId/issues/:number", async (request, response) => {
    response.json(
      await options.issues.update(await userId(request.headers.cookie), request.params.spaceId, request.params.number, request.body),
    );
  });
  router.get("/spaces/:spaceId/issues/:number/timeline", async (request, response) => {
    response.json(
      await options.issues.timeline(await userId(request.headers.cookie), request.params.spaceId, request.params.number, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
    );
  });
  router.post("/spaces/:spaceId/issues/:number/comments", async (request, response) => {
    response
      .status(201)
      .json(
        await options.issues.createComment(
          await userId(request.headers.cookie),
          request.params.spaceId,
          request.params.number,
          request.body,
        ),
      );
  });
  router.post("/spaces/:spaceId/issues/:number/verdicts", async (request, response) => {
    response.json(
      await options.issues.verdict(await userId(request.headers.cookie), request.params.spaceId, request.params.number, request.body),
    );
  });
  router.patch("/issue-comments/:commentId", async (request, response) => {
    response.json(await options.issues.updateComment(await userId(request.headers.cookie), request.params.commentId, request.body));
  });
  router.delete("/issue-comments/:commentId", async (request, response) => {
    await options.issues.deleteComment(await userId(request.headers.cookie), request.params.commentId);
    response.status(204).end();
  });
  router.get("/spaces/:spaceId/issue-labels", async (request, response) => {
    response.json(await options.issues.listLabels(await userId(request.headers.cookie), request.params.spaceId));
  });
  router.post("/spaces/:spaceId/issue-labels", async (request, response) => {
    response
      .status(201)
      .json(await options.issues.createLabel(await userId(request.headers.cookie), request.params.spaceId, request.body));
  });
  router.patch("/issue-labels/:labelId", async (request, response) => {
    response.json(await options.issues.updateLabel(await userId(request.headers.cookie), request.params.labelId, request.body));
  });
  router.delete("/issue-labels/:labelId", async (request, response) => {
    await options.issues.deleteLabel(await userId(request.headers.cookie), request.params.labelId);
    response.status(204).end();
  });

  return router;
}
