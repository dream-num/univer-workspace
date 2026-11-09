import {
  WorkspaceApplicationError,
  workspaceError,
} from "@univerjs/univer-workspace-client-core/product";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { translateToolError } from "../src/gateway/tool-error.js";

describe("translateToolError", () => {
  it("keeps a Workspace error code and its detail", () => {
    expect(
      translateToolError(workspaceError("issue-not-found", "No Issue.", { number: 7 })),
    ).toEqual({
      outcome: "tool_error",
      code: "issue-not-found",
      message: "No Issue.",
      detail: { number: 7 },
    });
  });

  it("keeps authentication failures as auth_error", () => {
    expect(
      translateToolError(workspaceError("workspace-authentication-required", "Expired.")),
    ).toMatchObject({ outcome: "auth_error", code: "workspace-authentication-required" });
  });

  it("accepts any Error with a string code", () => {
    const error = Object.assign(new Error("boom"), {
      code: "custom-code",
      detail: { secret: "ignored" },
      details: { secret: "ignored" },
    });
    expect(translateToolError(error)).toEqual({
      outcome: "tool_error",
      code: "custom-code",
      message: "boom",
      detail: null,
    });
  });

  it("maps a ZodError to workspace-argument-invalid without the argument values", () => {
    const missing = z.object({ repo: z.string() }).safeParse({});
    const translated = translateToolError(missing.error);
    expect(translated).toMatchObject({
      outcome: "tool_error",
      code: "workspace-argument-invalid",
      detail: { issues: [{ path: "repo" }] },
    });
    const wrongType = translateToolError(
      z.object({ repo: z.enum(["a"]) }).safeParse({ repo: "secret-value-123" }).error,
    );
    expect(JSON.stringify(wrongType)).not.toContain("secret-value-123");
  });

  it("maps a network failure on a write to workspace-result-unknown", () => {
    const error = new WorkspaceApplicationError("workspace-result-unknown", "Lost.", {
      reason: "socket",
    });
    expect(translateToolError(error)).toMatchObject({
      outcome: "tool_error",
      code: "workspace-result-unknown",
      detail: { reason: "socket" },
    });
    expect(translateToolError(error).message).toContain("idempotency_key");
  });

  it("hides the message of an unknown error", () => {
    expect(translateToolError(new Error("db password is hunter2"))).toEqual({
      outcome: "internal_error",
      code: "workspace-internal-error",
      message: "Internal tool error.",
      detail: null,
    });
    expect(translateToolError("string failure").outcome).toBe("internal_error");
  });

  it("drops a detail that is not JSON", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(translateToolError(workspaceError("x-code", "m", circular)).detail).toBeNull();
  });
});

it("hides filesystem diagnostics and recursively removes sourcePath from MCP details", () => {
  const error = Object.assign(new Error("EACCES /secret/staging/file token=secret"), {
    code: "EACCES",
    syscall: "open",
    path: "/secret/staging/file",
  });
  expect(translateToolError(error)).toEqual({
    outcome: "internal_error",
    code: "workspace-internal-error",
    message: "Internal tool error.",
    detail: null,
  });
  expect(
    translateToolError(
      workspaceError("workspace-result-unknown", "Lost", {
        sourcePath: "/secret/staging/file",
        request: { sourcePath: "/secret/again", id: "kept" },
      }),
    ).detail,
  ).toEqual({ request: { id: "kept" } });
});

it("preserves non-system error codes beginning with E", () => {
  expect(translateToolError(workspaceError("EXPIRED", "Link expired."))).toMatchObject({
    outcome: "tool_error",
    code: "EXPIRED",
    message: "Link expired.",
  });
});

it("preserves Typst source-relative diagnostics while hiding absolute source paths", () => {
  expect(
    translateToolError(
      workspaceError("workspace-typst-invalid", "Bad source", {
        diagnostics: [
          { sourcePath: "page.typ", reason: "unsupported" },
          { sourcePath: "/tmp/private/page.typ", reason: "invalid" },
        ],
      }),
    ).detail,
  ).toEqual({
    diagnostics: [{ sourcePath: "page.typ", reason: "unsupported" }, { reason: "invalid" }],
  });
});
