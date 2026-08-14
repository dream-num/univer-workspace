import { json, Router } from "express";
import { contentDisposition } from "../../integrations/blob/blob-http.js";
import type { IdentityModule } from "../identity/index.js";
import type { BlobsModule } from "./blobs.service.js";

export function createBlobsRouter(options: {
  readonly identity: IdentityModule;
  readonly blobs: BlobsModule;
}): Router {
  const router = Router();
  const session = (cookie: string | undefined) =>
    options.identity.requireSession(cookie).user.id;

  router.post(
    "/blob-upload-sessions",
    json({ limit: "1mb" }),
    (request, response) => {
      const result = options.blobs.createUpload(
        session(request.headers.cookie),
        request.headers["idempotency-key"],
        request.body
      );
      response.status(result.status).json(result.body);
    }
  );
  router.get("/blob-upload-sessions/:uploadId", (request, response) => {
    response.json(
      options.blobs.getUpload(
        session(request.headers.cookie),
        required(request.params.uploadId)
      )
    );
  });
  router.put(
    "/blob-upload-sessions/:uploadId/content",
    async (request, response) => {
      await options.blobs.upload(
        session(request.headers.cookie),
        required(request.params.uploadId),
        request.headers["content-length"],
        request
      );
      response.status(204).end();
    }
  );
  router.post(
    "/blob-upload-sessions/:uploadId/complete",
    async (request, response) => {
      const result = await options.blobs.complete(
        session(request.headers.cookie),
        required(request.params.uploadId)
      );
      response.status(result.status).json(result.body);
    }
  );
  router.delete("/blob-upload-sessions/:uploadId", (request, response) => {
    options.blobs.abort(
      session(request.headers.cookie),
      required(request.params.uploadId)
    );
    response.status(204).end();
  });

  for (const disposition of ["content", "download"] as const) {
    router.get(
      `/blob-resources/:resourceId/${disposition}`,
      async (request, response) => {
        const opened = await options.blobs.openContent(
          session(request.headers.cookie),
          required(request.params.resourceId),
          request.headers.range
        );
        const etag = `"${opened.access.etag}"`;
        if (request.headers["if-none-match"] === etag) {
          response.status(304).setHeader("ETag", etag).end();
          opened.stream.destroy();
          return;
        }
        const length =
          opened.totalByteSize === 0 ? 0 : opened.end - opened.start + 1;
        response.status(opened.partial ? 206 : 200);
        response.setHeader("Content-Type", opened.access.mediaType);
        response.setHeader("Content-Length", String(length));
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("ETag", etag);
        response.setHeader(
          "Content-Disposition",
          contentDisposition(
            disposition === "download" ? "attachment" : "inline",
            opened.access.originalFilename
          )
        );
        response.setHeader("X-Content-Type-Options", "nosniff");
        if (opened.partial) {
          response.setHeader(
            "Content-Range",
            `bytes ${opened.start}-${opened.end}/${opened.totalByteSize}`
          );
        }
        opened.stream.on("error", (error) => response.destroy(error));
        opened.stream.pipe(response);
      }
    );
  }
  return router;
}

function required(value: string | undefined): string {
  if (!value) throw new Error("Express route parameter is missing.");
  return value;
}
