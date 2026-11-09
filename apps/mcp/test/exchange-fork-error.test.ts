import { EventEmitter } from "node:events";
import { mkdtemp, access } from "node:fs/promises";
import { expect, it, vi } from "vitest";
import { runConversionJob } from "../src/executor/jobs/run.js";

const { forkMock } = vi.hoisted(() => ({ forkMock: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: forkMock }));
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, mkdtemp: vi.fn(actual.mkdtemp) };
});

it("settles an EMFILE fork failure and removes the job directory", async () => {
  forkMock.mockImplementation(() => {
    throw Object.assign(new Error("too many files /private/path"), {
      code: "EMFILE",
      syscall: "spawn",
    });
  });
  await expect(
    runConversionJob(
      { kind: "import", bytes: new Uint8Array(), options: { fileName: "x.xlsx", type: 2 } },
      { license: "", licenseKey: "" },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ code: "workspace-job-crashed" });
  const directory = await vi.mocked(mkdtemp).mock.results[0]!.value;
  await expect(access(directory)).rejects.toThrow();
});

it("settles an asynchronous spawn error even if close never follows", async () => {
  forkMock.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { send() {}, kill() {} });
    queueMicrotask(() =>
      child.emit("error", Object.assign(new Error("EMFILE"), { code: "EMFILE" })),
    );
    return child;
  });
  await expect(
    runConversionJob(
      { kind: "import", bytes: new Uint8Array(), options: { fileName: "x.xlsx", type: 2 } },
      { license: "", licenseKey: "" },
      AbortSignal.timeout(1000),
    ),
  ).rejects.toMatchObject({ code: "workspace-job-crashed" });
  const directory = await vi.mocked(mkdtemp).mock.results.at(-1)!.value;
  await expect(access(directory)).rejects.toThrow();
});
