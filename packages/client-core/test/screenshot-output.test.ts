import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UnitScreenshotResult } from "@univer-cli/unit-screenshot";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceApplicationError } from "../src/errors.js";
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

  it("starts no output for an owner signal aborted before publication", async () => {
    const cwd = await temporaryDirectory();
    const feature = featureWith(cwd);
    const controller = new AbortController();
    const reason = new Error("owner-cancel-before-publication");
    controller.abort(reason);

    await expect(
      feature.writeImages({
        result: result([{ bytes: Uint8Array.from([1]), name: "view.png" }]),
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(existsSync(join(cwd, "screenshots"))).toBe(false);
  });

  it("awaits private temporary cleanup when cancellation precedes the first link", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);
    const controller = new AbortController();
    const reason = new Error("owner-cancel-after-private-write");
    const signal = interceptSignal(controller, () => {
      if (
        existsSync(directory) &&
        readdirSync(directory).some(
          (name) => name.startsWith(".view.png.") && name.endsWith(".tmp"),
        )
      ) {
        controller.abort(reason);
      }
    });

    await expect(
      feature.writeImages({
        destination: "shots",
        result: result([{ bytes: Uint8Array.from([1]), name: "view.png" }]),
        signal,
      }),
    ).rejects.toBe(reason);
    expect(await readdir(directory)).toEqual([]);
  });

  it("reports one confirmed output when cancellation follows its link", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);
    const controller = new AbortController();
    const reason = new Error("owner-cancel-after-first-link");
    const signal = interceptSignal(controller, () => {
      if (existsSync(join(directory, "first.png"))) controller.abort(reason);
    });

    const error = await rejectedApplicationError(
      feature.writeImages({
        destination: "shots",
        result: result([
          { bytes: Uint8Array.from([1]), name: "first.png" },
          { bytes: Uint8Array.from([2]), name: "second.png" },
        ]),
        signal,
      }),
    );
    expect({ code: error.code, detail: error.detail }).toEqual({
      code: "workspace-screenshot-output-partial",
      detail: {
        totalOutputCount: 2,
        committedOutputCount: 1,
        committedOutputs: [{ location: join(directory, "first.png"), name: "first.png" }],
        causeCode: "ABORTED",
      },
    });
    expect(JSON.stringify(error)).not.toContain(reason.message);
    expect(await readdir(directory)).toEqual(["first.png"]);
  });

  it("reports every confirmed output and starts no later output after cancellation", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);
    const controller = new AbortController();
    const signal = interceptSignal(controller, () => {
      if (existsSync(join(directory, "second.png"))) {
        controller.abort(new Error("owner-cancel-after-second-link"));
      }
    });

    const error = await rejectedApplicationError(
      feature.writeImages({
        destination: "shots",
        result: result([
          { bytes: Uint8Array.from([1]), name: "first.png" },
          { bytes: Uint8Array.from([2]), name: "second.png" },
          { bytes: Uint8Array.from([3]), name: "third.png" },
        ]),
        signal,
      }),
    );
    expect({ code: error.code, detail: error.detail }).toEqual({
      code: "workspace-screenshot-output-partial",
      detail: {
        totalOutputCount: 3,
        committedOutputCount: 2,
        committedOutputs: [
          { location: join(directory, "first.png"), name: "first.png" },
          { location: join(directory, "second.png"), name: "second.png" },
        ],
        causeCode: "ABORTED",
      },
    });
    expect(await readdir(directory)).toEqual(["first.png", "second.png"]);
  });

  it("classifies an exclusive-link race after a commit without replacing the winner", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const second = join(directory, "second.png");
    const feature = featureWith(cwd);
    const controller = new AbortController();
    const signal = interceptSignal(controller, () => {
      if (existsSync(join(directory, "first.png")) && !existsSync(second)) {
        writeFileSync(second, "concurrent-winner");
      }
    });

    const error = await rejectedApplicationError(
      feature.writeImages({
        destination: "shots",
        result: result([
          { bytes: Uint8Array.from([1]), name: "first.png" },
          { bytes: Uint8Array.from([2]), name: "second.png" },
        ]),
        signal,
      }),
    );
    expect({ code: error.code, detail: error.detail }).toEqual({
      code: "workspace-screenshot-output-partial",
      detail: {
        totalOutputCount: 2,
        committedOutputCount: 1,
        committedOutputs: [{ location: join(directory, "first.png"), name: "first.png" }],
        causeCode: "workspace-screenshot-output-exists",
      },
    });
    expect(await readFile(second, "utf8")).toBe("concurrent-winner");
    expect(await readdir(directory)).toEqual(["first.png", "second.png"]);
  });

  it("sanitizes a generic late write failure after a confirmed output", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);
    const signal = new AbortController().signal;

    const error = await rejectedApplicationError(
      feature.writeImages({
        destination: "shots",
        result: result([
          { bytes: Uint8Array.from([1]), name: "first.png" },
          { bytes: undefined as unknown as Uint8Array, name: "second.png" },
        ]),
        signal,
      }),
    );
    expect({ code: error.code, detail: error.detail }).toEqual({
      code: "workspace-screenshot-output-partial",
      detail: {
        totalOutputCount: 2,
        committedOutputCount: 1,
        committedOutputs: [{ location: join(directory, "first.png"), name: "first.png" }],
        causeCode: "workspace-screenshot-output-failed",
      },
    });
    expect(error.message).toBe(
      "Some screenshot outputs were committed. Inspect the listed files before retrying.",
    );
    expect(error.cause).toBeUndefined();
    expect(error.stack).not.toContain("data argument must be");
    expect(JSON.stringify(error)).not.toContain("data argument must be");
    expect(await readdir(directory)).toEqual(["first.png"]);
  });

  it("may return complete confirmed output before a later caller abort", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);
    const controller = new AbortController();

    await expect(
      feature.writeImages({
        destination: "shots",
        result: result([{ bytes: Uint8Array.from([1]), name: "view.png" }]),
        signal: controller.signal,
      }),
    ).resolves.toEqual([{ location: join(directory, "view.png"), name: "view.png" }]);
    controller.abort(new Error("late-caller-abort"));
    expect(await readdir(directory)).toEqual(["view.png"]);
  });

  it("keeps the existing unsignalled non-transactional failure behavior", async () => {
    const cwd = await temporaryDirectory();
    const directory = join(cwd, "shots");
    const feature = featureWith(cwd);

    await expect(
      feature.writeImages({
        destination: "shots",
        result: result([
          { bytes: Uint8Array.from([1]), name: "first.png" },
          { bytes: undefined as unknown as Uint8Array, name: "second.png" },
        ]),
      }),
    ).rejects.not.toBeInstanceOf(WorkspaceApplicationError);
    expect(await readdir(directory)).toEqual(["first.png"]);
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

function interceptSignal(controller: AbortController, onCheck: () => void): AbortSignal {
  const signal = controller.signal;
  const throwIfAborted = signal.throwIfAborted.bind(signal);
  Object.defineProperty(signal, "throwIfAborted", {
    value: () => {
      onCheck();
      throwIfAborted();
    },
  });
  return signal;
}

async function rejectedApplicationError(
  operation: Promise<unknown>,
): Promise<WorkspaceApplicationError> {
  try {
    await operation;
  } catch (error) {
    expect(error).toBeInstanceOf(WorkspaceApplicationError);
    return error as WorkspaceApplicationError;
  }
  throw new Error("Expected the screenshot write to reject");
}
