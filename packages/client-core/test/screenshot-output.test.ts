import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnitScreenshotResult } from "@univer-cli/unit-screenshot";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceScreenshotFeature } from "../src/screenshot.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (path) => await rm(path, { recursive: true })),
  );
});

describe("Workspace screenshot PNG output", () => {
  it("writes exact typed-array view bytes through a private same-directory temporary file", async () => {
    const cwd = await temporaryDirectory();
    const feature = featureWith(cwd);
    const backing = Uint8Array.from([9, 1, 2, 3, 9]);

    await expect(
      feature.writeImages({
        destination: "nested/shots",
        result: result([{ bytes: new Uint8Array(backing.buffer, 1, 3), name: "view.png" }]),
      }),
    ).resolves.toEqual([
      { location: join(cwd, "nested", "shots", "view.png"), name: "view.png" },
    ]);
    expect(await readFile(join(cwd, "nested", "shots", "view.png"))).toEqual(
      Buffer.from([1, 2, 3]),
    );
    expect((await stat(join(cwd, "nested", "shots", "view.png"))).mode & 0o777).toBe(0o600);
    expect(await readdir(join(cwd, "nested", "shots"))).toEqual(["view.png"]);
  });

  it.each([".", "..", "../view.png", "child/view.png", "/absolute.png"])(
    "rejects unsafe image name %s before writing any image",
    async (name) => {
      const cwd = await temporaryDirectory();
      const feature = featureWith(cwd);
      await expect(
        feature.writeImages({
          result: result([
            { bytes: Uint8Array.from([1]), name: "first.png" },
            { bytes: Uint8Array.from([2]), name },
          ]),
        }),
      ).rejects.toMatchObject({ code: "workspace-screenshot-output-invalid" });
      expect(await readdir(join(cwd, "screenshots"))).toEqual([]);
    },
  );

  it("preserves a pre-existing destination and leaves no temporary file", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    await writeFile(join(cwd, "placeholder"), "x");
    const feature = featureWith(cwd);
    await feature.writeImages({ destination: "shots", result: result([]) });
    await writeFile(join(directory, "view.png"), "existing", { mode: 0o640 });

    await expect(
      feature.writeImages({
        destination: "shots",
        result: result([{ bytes: Uint8Array.from([1]), name: "view.png" }]),
      }),
    ).rejects.toMatchObject({ code: "workspace-screenshot-output-exists" });
    expect(await readFile(join(directory, "view.png"), "utf8")).toBe("existing");
    expect((await stat(join(directory, "view.png"))).mode & 0o777).toBe(0o640);
    expect(await readdir(directory)).toEqual(["view.png"]);
  });

  it("preserves one concurrent winner and cleans both temporary files", async () => {
    const cwd = await temporaryDirectory();
    const feature = featureWith(cwd);
    const first = feature.writeImages({
      destination: "race",
      result: result([{ bytes: new Uint8Array(4_000_000).fill(1), name: "view.png" }]),
    });
    const second = feature.writeImages({
      destination: "race",
      result: result([{ bytes: new Uint8Array(4_000_000).fill(2), name: "view.png" }]),
    });

    const settled = await Promise.allSettled([first, second]);
    expect(settled.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(settled.filter(({ status }) => status === "rejected")).toHaveLength(1);
    expect(settled.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "workspace-screenshot-output-exists" },
    });
    const bytes = await readFile(join(cwd, "race", "view.png"));
    expect(new Set(bytes).size).toBe(1);
    expect([1, 2]).toContain(bytes[0]);
    expect(await readdir(join(cwd, "race"))).toEqual(["view.png"]);
  });
});

function featureWith(cwd: string): WorkspaceScreenshotFeature {
  return new WorkspaceScreenshotFeature({
    cwd,
    env: {},
    license: "license",
    loader: { loadUnit: async () => ({ unitData: {}, unitType: "sheet" }) as never },
    renderPageRoot: "/render-runtime",
  });
}

function result(
  images: readonly { readonly bytes: Uint8Array; readonly name: string }[],
): UnitScreenshotResult {
  return {
    images: images.map(({ bytes, name }) => ({
      bytes,
      height: 1,
      mediaType: "image/png",
      name,
      width: 1,
    })),
    unitId: "book-1",
    unitType: "sheet",
  };
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "workspace-screenshot-output-"));
  temporaryDirectories.push(directory);
  return directory;
}
