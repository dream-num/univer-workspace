import { json, Router, type Request } from "express";
import { contentDisposition } from "../../integrations/blob/blob-http.js";
import { receiveSingleMultipartFile } from "../../integrations/blob/multipart.js";
import type { IdentityModule } from "../identity/index.js";
import {
  MAX_EXCHANGE_FILE_BYTES,
  type ExchangeModule,
} from "./exchange.service.js";

export function createExchangeRouter(options: {
  readonly identity: IdentityModule;
  readonly exchange: ExchangeModule;
}): Router {
  const router = Router();
  const userId = (request: Request) =>
    options.identity.requireSession(request.headers.cookie).user.id;

  router.post("/stream/file/upload", async (request, response, next) => {
    if (!options.exchange.acceptsUpload(request.query.source)) {
      next();
      return;
    }
    const authenticatedUserId = userId(request);
    const result = await receiveSingleMultipartFile(
      request,
      MAX_EXCHANGE_FILE_BYTES,
      async (file) =>
        options.exchange.upload(authenticatedUserId, {
          size: request.query.size,
          flate: request.query.flate,
          filename: file.filename,
          mediaType: file.mediaType,
          body: file.stream,
        })
    );
    response.status(201).json(result);
  });

  router.post(
    "/exchange/import",
    json({ limit: "1mb" }),
    async (request, response) => {
      response.json(
        await options.exchange.importFile(
          userId(request),
          "auto",
          request.body
        )
      );
    }
  );
  router.post(
    "/exchange/:type/import",
    json({ limit: "1mb" }),
    async (request, response) => {
      response.json(
        await options.exchange.importFile(
          userId(request),
          request.params.type,
          request.body
        )
      );
    }
  );
  router.post(
    "/exchange/:type/export",
    json({ limit: "1mb" }),
    async (request, response) => {
      response.json(
        await options.exchange.exportFile(
          userId(request),
          request.params.type,
          request.body
        )
      );
    }
  );
  router.get("/exchange/task/:taskId", (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.json(
      options.exchange.getTask(
        userId(request),
        required(request.params.taskId)
      )
    );
  });

  router.get("/file/:fileId/sign-url", async (request, response, next) => {
    const result = await options.exchange.signUrl(
      userId(request),
      required(request.params.fileId)
    );
    if (!result) {
      next();
      return;
    }
    response.setHeader("Cache-Control", "private, no-store");
    response.json(result);
  });
  router.get("/file/:fileId/content", async (request, response, next) => {
    const opened = await options.exchange.openFile(
      userId(request),
      required(request.params.fileId)
    );
    if (!opened) {
      next();
      return;
    }
    response.setHeader("Content-Type", opened.mediaType);
    response.setHeader("Content-Length", String(opened.byteSize));
    response.setHeader(
      "Content-Disposition",
      contentDisposition("attachment", opened.filename)
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    opened.stream.on("error", (error) => response.destroy(error));
    opened.stream.pipe(response);
  });

  return router;
}

function required(value: string | undefined): string {
  if (!value) throw new Error("Express route parameter is missing.");
  return value;
}
