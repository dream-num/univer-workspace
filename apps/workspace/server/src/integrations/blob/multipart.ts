import Busboy from "busboy";
import type { Request } from "express";
import type { Readable } from "node:stream";
import { ApplicationError } from "../../middleware/errors.js";

export function receiveSingleMultipartFile<T>(
  request: Request,
  maxBytes: number,
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
        // Browser FormData serializes non-ASCII filenames as UTF-8 bytes in
        // the filename parameter. Busboy otherwise decodes that parameter as
        // latin1, which corrupts names such as "AI转型.pptx".
        defParamCharset: "utf8",
        limits: {
          files: 1,
          fields: 0,
          parts: 1,
          fileSize: maxBytes,
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
      stream.once("limit", () => {
        parseError ??= new ApplicationError(
          "PAYLOAD_TOO_LARGE",
          413,
          `The uploaded file exceeds the ${maxBytes} byte limit.`,
          "file"
        );
      });
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
