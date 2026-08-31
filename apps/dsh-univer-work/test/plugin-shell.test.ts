import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { Context } from "@deepseek-ai/cordis";
import { describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

describe("dsh-univer-work plugin shell", () => {
  it("keeps the package, patch, and built Host entry names aligned", async () => {
    const manifest = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dsh: { bundle: { patch: string } };
      main: string;
      name: string;
      private: boolean;
      version: string;
    };
    const patch = await readFile(
      new URL(`../${manifest.dsh.bundle.patch}`, import.meta.url),
      "utf8",
    );
    const host = (await import(
      new URL(`../${manifest.main}`, import.meta.url).href
    )) as typeof import("../src/index.js");

    expect(packageRoot).toMatch(/apps[/\\]dsh-univer-work[/\\]?$/);
    expect(manifest).toMatchObject({
      name: "dsh-univer-work",
      private: true,
      version: "0.0.0",
    });
    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.dsh.bundle.patch).toBe("./cordis.patch.yml");
    expect(patch.match(/^\s+- id: dsh-univer-work$/gm)).toHaveLength(1);
    expect(patch.match(/^\s+name: dsh-univer-work$/gm)).toHaveLength(1);
    expect(patch).toContain("origin: !!js process.env.UNIVER_WORKSPACE_ORIGIN ?? ''");
    expect(patch).not.toMatch(/^\s+disabled:/m);
    expect(Object.keys(host).sort()).toEqual(["Config", "apply", "inject", "name"]);
    expect(host.name).toBe(manifest.name);
  }, 30_000);

  it("loads the built entry and waits for its Cordis fiber cleanup", async () => {
    const host = (await import(
      new URL("../dist/index.js", import.meta.url).href
    )) as typeof import("../src/index.js");
    const ctx = new Context();
    ctx.provide("credentials", {} as Context["credentials"]);
    ctx.provide("tools", { register: () => () => undefined } as unknown as Context["tools"]);
    ctx.provide("skills", { register: () => () => undefined } as unknown as Context["skills"]);
    ctx.provide("fs", { sandboxMode: undefined } as unknown as Context["fs"]);
    let active = false;
    let finishCleanup: (() => void) | undefined;

    const fiber = ctx.plugin({
      name: host.name,
      inject: host.inject,
      apply(child: Context) {
          host.apply(child, { origin: "https://workspace.test" });
          child.effect(
            () => {
              active = true;
              return () =>
                new Promise<void>((resolve) => {
                  finishCleanup = () => {
                    active = false;
                    resolve();
                  };
                });
            },
            "dsh-univer-work test cleanup witness",
          );
      },
    });

    await fiber;
    expect(active).toBe(true);

    const disposal = fiber.dispose();
    await expect.poll(() => finishCleanup).toBeTypeOf("function");
    expect(active).toBe(true);
    finishCleanup?.();
    await disposal;
    expect(active).toBe(false);

    await ctx.fiber.dispose();
  });
});
