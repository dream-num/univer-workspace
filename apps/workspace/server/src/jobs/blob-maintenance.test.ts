import { expect, it, vi } from "vitest";
import { startBlobMaintenance } from "./blob-maintenance.js";

it("waits for both draft expiry tasks and Blob maintenance on concurrent disposal", async () => {
  const entered = deferred<void>();
  const htmlExpiry = deferred<number>();
  const skillExpiry = deferred<number>();
  const cleaning = deferred<number>();
  const drafts = { expireDue: vi.fn(() => { entered.resolve(); return htmlExpiry.promise; }) };
  const skillDrafts = { expireDue: vi.fn(() => skillExpiry.promise) };
  const blobs = { runMaintenance: vi.fn(() => cleaning.promise) };
  const job = startBlobMaintenance(blobs, { drafts, skillDrafts });
  await entered.promise;
  const finished = vi.fn();
  const first = job.dispose().then(finished);
  const second = job.dispose().then(finished);
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  expect(skillDrafts.expireDue).not.toHaveBeenCalled();
  htmlExpiry.resolve(1);
  await Promise.resolve();
  expect(skillDrafts.expireDue).toHaveBeenCalledOnce();
  expect(blobs.runMaintenance).not.toHaveBeenCalled();
  skillExpiry.resolve(1);
  await Promise.resolve();
  expect(blobs.runMaintenance).toHaveBeenCalledOnce();
  expect(finished).not.toHaveBeenCalled();
  cleaning.resolve(1);
  await Promise.all([first, second]);
  expect(finished).toHaveBeenCalledTimes(2);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
