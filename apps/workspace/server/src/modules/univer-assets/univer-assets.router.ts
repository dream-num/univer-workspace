import { ErrorCode } from "@univerjs/protocol";
import { Router, type Request, type Response } from "express";
import { contentDisposition } from "../../integrations/blob/blob-http.js";
import { receiveSingleMultipartFile } from "../../integrations/blob/multipart.js";
import type { IdentityModule } from "../identity/index.js";
import {
  MAX_UNIVER_ASSET_BYTES,
  type UniverAssetsModule,
  type UniverAssetScope,
} from "./univer-assets.service.js";

const OK_ERROR = { code: ErrorCode.OK, message: "" };

export function createUniverAssetsRouter(options: {
  readonly identity: IdentityModule;
  readonly assets: UniverAssetsModule;
}): Router {
  const router = Router();
  const userId = (request: Request) =>
    options.identity.requireSession(request.headers.cookie).user.id;

  router.post("/stream/file/upload", async (request, response) => {
    const result = await uploadMultipart(
      request,
      options.assets,
      userId(request),
      { kind: "trunk" }
    );
    response.status(201).json(result);
  });
  router.post(
    "/worktrees/:worktreeId/stream/file/upload",
    async (request, response) => {
      const result = await uploadMultipart(
        request,
        options.assets,
        userId(request),
        {
          kind: "worktree",
          worktreeId: required(request.params.worktreeId),
        }
      );
      response.status(201).json(result);
    }
  );

  router.get("/file/:fileId/sign-url", async (request, response) => {
    const url = await options.assets.resolveContentUrl(
      userId(request),
      { kind: "trunk" },
      required(request.params.fileId)
    );
    response.setHeader("Cache-Control", "private, no-store");
    response.json({ error: OK_ERROR, url });
  });
  router.get(
    "/worktrees/:worktreeId/file/:fileId/sign-url",
    async (request, response) => {
      const url = await options.assets.resolveContentUrl(
        userId(request),
        {
          kind: "worktree",
          worktreeId: required(request.params.worktreeId),
        },
        required(request.params.fileId)
      );
      response.setHeader("Cache-Control", "private, no-store");
      response.json({ error: OK_ERROR, url });
    }
  );

  router.get("/file/:fileId/content", async (request, response) => {
    await sendContent(
      request,
      response,
      options.assets,
      userId(request),
      { kind: "trunk" },
      required(request.params.fileId)
    );
  });
  router.get(
    "/worktrees/:worktreeId/file/:fileId/content",
    async (request, response) => {
      await sendContent(
        request,
        response,
        options.assets,
        userId(request),
        {
          kind: "worktree",
          worktreeId: required(request.params.worktreeId),
        },
        required(request.params.fileId)
      );
    }
  );

  return router;
}

async function uploadMultipart(
  request: Request,
  assets: UniverAssetsModule,
  userId: string,
  scope: UniverAssetScope
): Promise<{ readonly FileId: string }> {
  return await receiveSingleMultipartFile(
    request,
    MAX_UNIVER_ASSET_BYTES,
    async (file) =>
      assets.upload(userId, scope, {
        size: request.query.size,
        source: request.query.source,
        assign: request.query.assign,
        filename: file.filename,
        declaredMediaType: file.mediaType || null,
        body: file.stream,
      })
  );
}

async function sendContent(
  request: Request,
  response: Response,
  assets: UniverAssetsModule,
  userId: string,
  scope: UniverAssetScope,
  assetId: string
): Promise<void> {
  const opened = await assets.openContent(
    userId,
    scope,
    assetId,
    request.headers.range
  );
  const length =
    opened.totalByteSize === 0 ? 0 : opened.end - opened.start + 1;
  response.status(opened.partial ? 206 : 200);
  response.setHeader("Content-Type", opened.asset.media_type);
  response.setHeader("Content-Length", String(length));
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("ETag", `"${opened.asset.etag}"`);
  response.setHeader(
    "Content-Disposition",
    contentDisposition("inline", opened.asset.original_filename)
  );
  response.setHeader("Cache-Control", "private, no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Content-Security-Policy", "sandbox; default-src 'none'");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  if (opened.partial) {
    response.setHeader(
      "Content-Range",
      `bytes ${opened.start}-${opened.end}/${opened.totalByteSize}`
    );
  }
  opened.stream.on("error", (error) => response.destroy(error));
  opened.stream.pipe(response);
}

function required(value: string | undefined): string {
  if (!value) throw new Error("Express route parameter is missing.");
  return value;
}
