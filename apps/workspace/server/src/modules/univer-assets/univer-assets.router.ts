import Busboy from "busboy";
import type { Readable } from "node:stream";
import { ErrorCode } from "@univerjs/protocol";
import { Router, type Request, type Response } from "express";
import { contentDisposition } from "../../integrations/blob/blob-http.js";
import { ApplicationError } from "../../middleware/errors.js";
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
  return await receiveSingleFile(request, async (file) =>
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

function receiveSingleFile<T>(
  request: Request,
  accept: (file: {
    readonly filename: string;
    readonly mediaType: string;
    readonly stream: Readable;
  }) => Promise<T>
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: {
          files: 1,
          fields: 0,
          parts: 1,
          fileSize: MAX_UNIVER_ASSET_BYTES,
        },
      });
    } catch {
      reject(invalidMultipart());
      return;
    }
    let fileTask:
      | Promise<
          | { readonly ok: true; readonly value: T }
          | { readonly ok: false; readonly error: unknown }
        >
      | null = null;
    let parseError: unknown = null;
    parser.on("file", (field, stream, info) => {
      if (field !== "file" || fileTask) {
        parseError ??= invalidMultipart();
        stream.resume();
        return;
      }
      fileTask = accept({
        filename: info.filename,
        mediaType: info.mimeType,
        stream,
      }).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => {
          stream.resume();
          return { ok: false as const, error };
        }
      );
    });
    parser.on("field", () => {
      parseError ??= invalidMultipart();
    });
    parser.once("error", (error) => {
      parseError ??= error;
    });
    parser.once("close", () => {
      if (parseError) {
        reject(parseError);
        return;
      }
      if (!fileTask) {
        reject(invalidMultipart());
        return;
      }
      fileTask.then((result) => {
        if (result.ok) resolve(result.value);
        else reject(result.error);
      });
    });
    request.once("aborted", () => {
      parseError ??= invalidMultipart();
    });
    request.pipe(parser);
  });
}

function invalidMultipart(): ApplicationError {
  return new ApplicationError(
    "INVALID_INPUT",
    400,
    "A multipart file field named 'file' is required.",
    "file"
  );
}

function required(value: string | undefined): string {
  if (!value) throw new Error("Express route parameter is missing.");
  return value;
}
