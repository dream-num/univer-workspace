import { describe, expect, it } from "vitest";
import { parseExecutorConfig } from "../src/shared/config-executor.js";
import { parseGatewayConfig } from "../src/shared/config.js";
import { testStagingDirectory } from "./staging-directory.js";

const executor = {
  WORKSPACE_ORIGIN: "https://workspace.test",
  MCP_INTERNAL_TOKEN: "internal-token-".repeat(4),
};
const gateway = {
  WORKSPACE_ORIGIN: executor.WORKSPACE_ORIGIN,
  MCP_PUBLIC_URL: "https://mcp.test/mcp",
  MCP_STAGING_DIRECTORY: testStagingDirectory(),
  MCP_OAUTH_CLIENT_ID: "client",
  MCP_OAUTH_CLIENT_SECRET: "secret",
};
const linkedGateway = {
  ...gateway,
  MCP_EXECUTOR_URLS: "http://executor:3000",
  MCP_INTERNAL_TOKEN: executor.MCP_INTERNAL_TOKEN,
};

describe("executor allowlist configuration", () => {
  it("requires an allowlist for the production executor and executor-linked gateway", () => {
    expect(() => parseExecutorConfig({ ...executor, NODE_ENV: "production" })).toThrow(
      /MCP_EXECUTOR_ALLOWED_USER_IDS/,
    );
    expect(() => parseGatewayConfig({ ...linkedGateway, NODE_ENV: "production" })).toThrow(
      /MCP_EXECUTOR_ALLOWED_USER_IDS/,
    );
    expect(parseGatewayConfig({ ...gateway, NODE_ENV: "production" }).executor).toBeNull();
    const allowed = {
      NODE_ENV: "production",
      MCP_EXECUTOR_ALLOWED_USER_IDS: " alice , bob,alice ",
    };
    expect([
      ...parseExecutorConfig({ ...executor, ...allowed }).MCP_EXECUTOR_ALLOWED_USER_IDS!,
    ]).toEqual(["alice", "bob"]);
    expect([
      ...parseGatewayConfig({ ...linkedGateway, ...allowed }).MCP_EXECUTOR_ALLOWED_USER_IDS!,
    ]).toEqual(["alice", "bob"]);
  });

  it.each(["", " ", ",", "alice,", ",alice", "alice, ,bob", "alice,,bob"])(
    "rejects an empty allowlist or entry %j in both roles in every environment",
    (value) => {
      for (const NODE_ENV of ["development", "production"]) {
        const env = { NODE_ENV, MCP_EXECUTOR_ALLOWED_USER_IDS: value };
        expect(() => parseExecutorConfig({ ...executor, ...env })).toThrow(
          /MCP_EXECUTOR_ALLOWED_USER_IDS/,
        );
        expect(() => parseGatewayConfig({ ...linkedGateway, ...env })).toThrow(
          /MCP_EXECUTOR_ALLOWED_USER_IDS/,
        );
      }
    },
  );

  it("keeps unrestricted local configuration and the gateway production passthrough refusal", () => {
    expect(parseExecutorConfig(executor).MCP_EXECUTOR_ALLOWED_USER_IDS).toBeUndefined();
    expect(parseGatewayConfig(linkedGateway).MCP_EXECUTOR_ALLOWED_USER_IDS).toBeUndefined();
    for (const MCP_DEV_SESSION_PASSTHROUGH of ["1", "0", "false", " "]) {
      const env = {
        NODE_ENV: "production",
        MCP_DEV_SESSION_PASSTHROUGH,
        MCP_EXECUTOR_ALLOWED_USER_IDS: "alice",
      };
      expect(() => parseGatewayConfig({ ...linkedGateway, ...env })).toThrow(
        /forbids non-empty MCP_DEV_SESSION_PASSTHROUGH/,
      );
    }
  });
});
