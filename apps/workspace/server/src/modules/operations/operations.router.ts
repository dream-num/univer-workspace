import { Router } from "express";
import type { IdentityModule } from "../identity/index.js";
import type { OperationsModule } from "./operations.service.js";

export function createOperationsRouter(options: {
  readonly identity: IdentityModule;
  readonly operations: OperationsModule;
}): Router {
  const router = Router();
  router.get("/operations/:operationId", (request, response) => {
    const session = options.identity.requireSession(request.headers.cookie);
    const operation = options.operations.get(
      session.user.id,
      parameter(request.params.operationId)
    );
    if (operation.state === "pending") response.set("Retry-After", "2");
    response.json(operation);
  });
  router.post(
    "/operations/:operationId/retry",
    async (request, response) => {
      const session = options.identity.requireSession(request.headers.cookie);
      response.status(202).json(
        await options.operations.retry(
          session.user.id,
          parameter(request.params.operationId)
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
