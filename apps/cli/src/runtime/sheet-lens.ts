import type { DaemonRequestHandler, JsonValue } from "@univer-cli/daemon";
import {
  parseWorkspaceRuntimeTarget,
  WorkspaceSheetLensEngine,
  type SheetLensRequest,
  type WorkspaceContentRuntimeOperations,
} from "@univerjs/univer-workspace-client-core";
import { whoami, WorkspaceHttp } from "@univerjs/univer-workspace-client-core/product";
import { workspaceError } from "../errors.js";
import { readWorkspaceSession } from "../features/auth/session.js";
import { isWorkspaceRecord } from "../transport/http.js";

export function createSheetLensHandler(options: {
  readonly runtime: Pick<WorkspaceContentRuntimeOperations, "exportUnitData">;
  readonly sessionPath: string;
}): DaemonRequestHandler {
  const engine = new WorkspaceSheetLensEngine({
    // The daemon serves one session, so workers stay shared with inspect and execute; the caller only keys the cache.
    exportUnitData: ({ target }) => options.runtime.exportUnitData({ target }),
    maxCachedBytes: 512 * 1024 * 1024,
  });
  return async (payload) => {
    if (!isWorkspaceRecord(payload) || !isSheetLensRequest(payload["request"])) {
      throw workspaceError("workspace-argument-invalid", "Invalid Sheet Lens request.");
    }
    const target = parseWorkspaceRuntimeTarget(payload["target"]);
    const session = await readWorkspaceSession({
      origin: target.origin,
      sessionPath: options.sessionPath,
    });
    if (!session)
      throw workspaceError(
        "workspace-authentication-required",
        "Log in to the current Workspace origin first.",
      );
    const userId =
      session.subject ??
      (
        await whoami(
          new WorkspaceHttp({
            origin: target.origin,
            cookie: session.cookie,
            role: "client",
          }),
        )
      ).subject.id;
    try {
      const result = await engine.run(
        target,
        { userId, grant: session.cookie },
        payload["request"],
      );
      return result as unknown as JsonValue;
    } catch (error) {
      // The daemon protocol transports code and message, but drops structured error detail.
      if (error instanceof Error && "hint" in error && typeof error.hint === "string") {
        throw Object.assign(new Error(`${error.message}\nHint: ${error.hint}`), {
          code: "code" in error ? error.code : "workspace-sheet-lens-failed",
        });
      }
      throw error;
    }
  };
}

function isSheetLensRequest(value: unknown): value is SheetLensRequest {
  if (!isWorkspaceRecord(value)) return false;
  const optionalString = (key: string) =>
    value[key] === undefined || typeof value[key] === "string";
  const optionalPositive = (key: string) =>
    value[key] === undefined ||
    (typeof value[key] === "number" && Number.isSafeInteger(value[key]) && value[key] > 0);
  switch (value["op"]) {
    case "outline":
      return (
        optionalString("at") &&
        optionalString("from") &&
        optionalPositive("budget") &&
        (value["depth"] === undefined ||
          value["depth"] === 0 ||
          value["depth"] === 1 ||
          value["depth"] === 2)
      );
    case "read":
      return (
        typeof value["range"] === "string" &&
        optionalPositive("max") &&
        (value["content"] === "both" ||
          value["content"] === "display" ||
          value["content"] === "formula" ||
          value["content"] === "style" ||
          value["content"] === "formula+style")
      );
    case "find":
      return (
        Array.isArray(value["terms"]) &&
        value["terms"].length > 0 &&
        value["terms"].every((term) => typeof term === "string" && term.length > 0) &&
        (value["in"] === "values" || value["in"] === "formulas") &&
        typeof value["caseSensitive"] === "boolean" &&
        optionalString("from") &&
        optionalPositive("max") &&
        (value["sheets"] === undefined ||
          (Array.isArray(value["sheets"]) &&
            value["sheets"].every((sheet) => typeof sheet === "string")))
      );
    default:
      return false;
  }
}
