import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStaticSiteRouter } from "./static-site.js";

let directory: string;
let server: Server;
let origin: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "static-site-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(directory, "assets", "index-abc123.js"), "export {};");
  writeFileSync(join(directory, "favicon.ico"), "icon");

  const app = express();
  app.use(createStaticSiteRouter(directory));
  server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(directory, { recursive: true, force: true });
});

describe("static site caching", () => {
  it("caches content-hashed assets as immutable", async () => {
    const response = await fetch(`${origin}/assets/index-abc123.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("answers a missing asset with 404 instead of the app shell", async () => {
    const response = await fetch(`${origin}/assets/index-stale99.js`);

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it.each(["/", "/index.html", "/worktrees?view=agent"])(
    "revalidates the app shell at %s",
    async (path) => {
      const response = await fetch(`${origin}${path}`);

      expect(response.status).toBe(200);
      expect(await response.text()).toContain("<title>app</title>");
      expect(response.headers.get("cache-control")).toBe("public, max-age=0");
    }
  );

  it("revalidates unhashed public files", async () => {
    const response = await fetch(`${origin}/favicon.ico`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0");
  });
});
