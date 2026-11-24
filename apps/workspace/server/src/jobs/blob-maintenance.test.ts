import { expect, it, vi } from "vitest";
import { startBlobMaintenance } from "./blob-maintenance.js";

it("waits for draft expiry, Asset recovery and Blob maintenance on concurrent disposal", async () => {
  const entered = deferred<void>();
  const htmlExpiry = deferred<number>();
  const skillExpiry = deferred<number>();
  const assetRecovery = deferred<void>();
  const cleaning = deferred<number>();
  const drafts = { expireDue: vi.fn(() => { entered.resolve(); return htmlExpiry.promise; }) };
  const skillDrafts = { expireDue: vi.fn(() => skillExpiry.promise) };
  const univerAssets = { recoverInterruptedUploads: vi.fn(() => assetRecovery.promise) };
  const blobs = { runMaintenance: vi.fn(() => cleaning.promise) };
  const job = startBlobMaintenance(blobs, { drafts, skillDrafts, univerAssets });
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
  expect(univerAssets.recoverInterruptedUploads).not.toHaveBeenCalled();
  skillExpiry.resolve(1);
  await Promise.resolve();
  expect(univerAssets.recoverInterruptedUploads).toHaveBeenCalledOnce();
  expect(blobs.runMaintenance).not.toHaveBeenCalled();
  assetRecovery.resolve();
  await Promise.resolve();
  expect(blobs.runMaintenance).toHaveBeenCalledOnce();
  expect(finished).not.toHaveBeenCalled();
  cleaning.resolve(1);
  await Promise.all([first, second]);
  expect(finished).toHaveBeenCalledTimes(2);
});

it("runs Blob maintenance when Asset recovery keeps failing", async () => {
  const failure = new Error("publish failed");
  const univerAssets = { recoverInterruptedUploads: vi.fn(() => Promise.reject(failure)) };
  const ran = deferred<number>();
  const blobs = { runMaintenance: vi.fn(() => { ran.resolve(1); return ran.promise; }) };
  const onError = vi.fn();
  const job = startBlobMaintenance(blobs, { univerAssets, onError });
  await ran.promise;
  await job.dispose();
  expect(onError).toHaveBeenCalledWith(failure);
  expect(blobs.runMaintenance).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
