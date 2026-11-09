import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { executorCapabilitiesSchema, opSpecs } from "../../src/shared/executor-protocol.js";
import { rendererOpSpecs } from "../../src/shared/renderer-protocol.js";
import {
  encodeFrame,
  envelope,
  executorToken,
  fixture,
  FRAME_CONTENT_TYPE,
  rendererToken,
  rpcHeader,
  send,
} from "./harness.js";

const externalUrl = process.env.MCP_CONTRACT_URL;
const externalRole = process.env.MCP_CONTRACT_ROLE;
const externalToken = process.env.MCP_CONTRACT_TOKEN;
if (externalUrl && (!externalToken || !["executor", "renderer"].includes(externalRole ?? "")))
  throw new Error(
    "Set MCP_CONTRACT_ROLE=executor|renderer and MCP_CONTRACT_TOKEN with MCP_CONTRACT_URL",
  );
const roles: ("executor" | "renderer")[] = externalUrl
  ? externalRole === "executor"
    ? ["executor"]
    : ["renderer"]
  : ["executor", "renderer"];

for (const role of roles)
  describe(`${role} backend protocol §15${externalUrl ? " deployed" : " in-process"}`, () => {
    let local: Awaited<ReturnType<typeof fixture>> | undefined;
    let base: string;
    let token: string;
    const op = role === "executor" ? "htmlView.validate" : "measureText";
    const spec =
      role === "executor" ? opSpecs[op as "htmlView.validate"] : rendererOpSpecs.measureText;
    const header = () => rpcHeader(role, op);
    beforeAll(async () => {
      if (externalUrl) {
        base = externalUrl;
        token = externalToken!;
      } else {
        local = await fixture();
        base = role === "executor" ? local.executorUrl : local.rendererUrl;
        token = role === "executor" ? executorToken : rendererToken;
      }
    });
    afterAll(async () => local?.close());

    async function rejected(
      status: number,
      code: string,
      options: Parameters<typeof send>[3],
      name = op,
    ) {
      const before = local
        ? {
            writes: local.state.writes,
            workspace: local.state.workspaceCalls,
            measurements: local.state.measurements,
          }
        : undefined;
      const response = await send(base, token, name, options);
      expect(response.status).toBe(status);
      expect(response.contentType).toContain("application/json");
      expect(JSON.parse(response.bytes.toString())).toEqual({
        error: { code, message: expect.any(String), detail: null },
      });
      if (before)
        expect({
          writes: local!.state.writes,
          workspace: local!.state.workspaceCalls,
          measurements: local!.state.measurements,
        }).toEqual(before);
    }

    it("§3.1, §10 capability endpoint authenticates and returns the role's catalog", async () => {
      const response = await send(base, token, "capabilities", { method: "GET" });
      expect(response.status).toBe(200);
      const capabilities = executorCapabilitiesSchema.parse(JSON.parse(response.bytes.toString()));
      expect(capabilities.v).toBe(1);
      const catalog = role === "executor" ? opSpecs : rendererOpSpecs;
      for (const operation of capabilities.operations)
        expect(Object.hasOwn(catalog, operation)).toBe(true);
      expect(capabilities.operations).toContain(op);
      for (const authorization of ["", "Bearer incorrect-contract-token"])
        await rejected(
          401,
          `workspace-${role}-unauthorized`,
          { method: "GET", headers: { authorization } },
          "capabilities",
        );
    });

    it("§4.2, §4.4, §11 accepts a valid frame and distinguishes application errors from transport rejection", async () => {
      const result = await send(base, token, op, { body: encodeFrame(header()) });
      expect(result.status).toBe(200);
      expect(result.contentType).toBe(FRAME_CONTENT_TYPE);
      const parsed = envelope(result.bytes);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) throw new Error("Expected an application error");
      expect(Object.keys(parsed.error).sort()).toEqual(["code", "detail", "message", "outcome"]);
      expect(parsed.error).toMatchObject({
        code: "workspace-argument-invalid",
        outcome: "tool_error",
      });
      expect(parsed.meta.executor).toBe("none");
    });

    it.each([
      ["less than four bytes", Buffer.alloc(3)],
      ["zero header length", Buffer.alloc(4)],
      ["truncated header", Buffer.from([0, 0, 0, 5, 123])],
      ["invalid UTF-8", Buffer.from([0, 0, 0, 3, 34, 255, 34])],
      ["invalid JSON", Buffer.from([0, 0, 0, 1, 123])],
    ])("§4.2 rejects %s", async (_label, body) => {
      await rejected(400, `workspace-${role}-frame-invalid`, { body });
    });

    it("§4.1, §4.3, §4.4 rejects the wrong content type, mismatched operation and forbidden payload", async () => {
      await rejected(415, `workspace-${role}-frame-invalid`, {
        body: encodeFrame(header()),
        headers: { "content-type": "application/json" },
      });
      await rejected(400, `workspace-${role}-frame-invalid`, {
        body: encodeFrame({ ...header(), op: role === "executor" ? "content.execute" : "lint" }),
      });
      await rejected(400, `workspace-${role}-frame-invalid`, {
        body: encodeFrame(header(), new Uint8Array([1])),
      });
    });

    it("§4.5 rejects an excessive Content-Length before executing", async () => {
      await rejected(413, "workspace-request-too-large", {
        headers: { "content-length": String(spec.limits.requestBytes + 1) },
      });
    });

    it("§4.5 counts chunked bytes without Content-Length before executing", async () => {
      const chunks = Array.from(
        { length: Math.ceil((spec.limits.requestBytes + 1) / 65536) },
        () => ({ bytes: Buffer.alloc(65536) }),
      );
      await rejected(413, "workspace-request-too-large", { chunks });
    });

    it("§12 rejects both HTTP and frame protocol version mismatches", async () => {
      await rejected(426, `workspace-${role}-version-mismatch`, {
        body: encodeFrame(header()),
        headers: { "x-mcp-rpc-version": "2" },
      });
      await rejected(426, `workspace-${role}-version-mismatch`, {
        body: encodeFrame({ ...header(), v: 2 }),
      });
    });

    it("§2.1, §2.2, §11.1 rejects unknown operations and GET on a catalog operation", async () => {
      await rejected(
        404,
        `workspace-${role}-operation-unknown`,
        { body: encodeFrame(header()) },
        "not-an-operation",
      );
      await rejected(404, `workspace-${role}-operation-unknown`, { method: "GET" });
    });

    it.each([0, spec.limits.budgetMs + 1])(
      "§6.3 rejects deadlineMs=%s without executing",
      async (deadlineMs) => {
        await rejected(400, `workspace-${role}-frame-invalid`, {
          body: encodeFrame({ ...header(), deadlineMs }),
        });
      },
    );

    it.skipIf(!!externalUrl)(
      "§10 rejects the other call direction's actual token (deployed mode needs the other role's secret)",
      async () => {
        await rejected(401, `workspace-${role}-unauthorized`, {
          body: encodeFrame(header()),
          headers: {
            authorization: `Bearer ${role === "executor" ? rendererToken : executorToken}`,
          },
        });
      },
    );
  });
