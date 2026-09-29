import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { IssuesModule } from "./issues.types.js";

export function createIssuesRouter(options: {
  readonly identity: IdentityModule;
  readonly issues: IssuesModule;
}): Router {
  const router = Router();
  const userId = (cookie: string | undefined) => options.identity.requireSession(cookie).user.id;

  router.get("/issues", (request, response) => {
    response.json(options.issues.listMine(userId(request.headers.cookie), request.query));
  });
  router.get("/spaces/:spaceId/issues", (request, response) => {
    response.json(options.issues.list(userId(request.headers.cookie), request.params.spaceId, request.query));
  });
  router.post("/spaces/:spaceId/issues", (request, response) => {
    response
      .status(201)
      .json(options.issues.create(userId(request.headers.cookie), request.params.spaceId, request.body));
  });
  router.get("/spaces/:spaceId/issues/:number", (request, response) => {
    response.json(options.issues.get(userId(request.headers.cookie), request.params.spaceId, request.params.number));
  });
  router.patch("/spaces/:spaceId/issues/:number", (request, response) => {
    response.json(
      options.issues.update(userId(request.headers.cookie), request.params.spaceId, request.params.number, request.body),
    );
  });
  router.get("/spaces/:spaceId/issues/:number/timeline", (request, response) => {
    response.json(
      options.issues.timeline(userId(request.headers.cookie), request.params.spaceId, request.params.number, {
        cursor: request.query.cursor,
        limit: request.query.limit,
      }),
    );
  });
  router.post("/spaces/:spaceId/issues/:number/comments", (request, response) => {
    response
      .status(201)
      .json(
        options.issues.createComment(
          userId(request.headers.cookie),
          request.params.spaceId,
          request.params.number,
          request.body,
        ),
      );
  });
  router.patch("/issue-comments/:commentId", (request, response) => {
    response.json(options.issues.updateComment(userId(request.headers.cookie), request.params.commentId, request.body));
  });
  router.delete("/issue-comments/:commentId", (request, response) => {
    options.issues.deleteComment(userId(request.headers.cookie), request.params.commentId);
    response.status(204).end();
  });
  router.get("/spaces/:spaceId/issue-labels", (request, response) => {
    response.json(options.issues.listLabels(userId(request.headers.cookie), request.params.spaceId));
  });
  router.post("/spaces/:spaceId/issue-labels", (request, response) => {
    response
      .status(201)
      .json(options.issues.createLabel(userId(request.headers.cookie), request.params.spaceId, request.body));
  });
  router.patch("/issue-labels/:labelId", (request, response) => {
    response.json(options.issues.updateLabel(userId(request.headers.cookie), request.params.labelId, request.body));
  });
  router.delete("/issue-labels/:labelId", (request, response) => {
    options.issues.deleteLabel(userId(request.headers.cookie), request.params.labelId);
    response.status(204).end();
  });

  return router;
}
