const { createHash } = require("node:crypto");
const { createReadStream } = require("node:fs");
const { mkdir, open, readdir, rm, stat } = require("node:fs/promises");
const { join } = require("node:path");
const { failureInfo } = require("./diagnostics.cjs");
const { setTimeout: delay } = require("node:timers/promises");

// Application-owned cache, separate from electron-updater's disposable pending
// directory. Identity uses the immutable release URL and its published checksum,
// never GitHub's expiring redirect URL. No updater internals are patched.
async function downloadResumable({
  url, sha512, size, directory, fetch, signal, onProgress = () => {},
  onRetry = () => {}, onVerify = () => {}, retryDelays = [1000, 3000, 8000],
  idleTimeout = 30000,
}) {
  if (!Number.isSafeInteger(size) || size <= 0 ||
      typeof sha512 !== "string" || Buffer.from(sha512, "base64").length !== 64)
    throw new Error("Invalid update integrity metadata");
  await mkdir(directory, { recursive: true });
  const key = createHash("sha256").update(`${url}\n${sha512}`).digest("hex");
  const name = `${key}.part`;
  for (const entry of await readdir(directory)) {
    if (/^[a-f0-9]{64}\.part$/.test(entry) && entry !== name)
      await rm(join(directory, entry), { force: true });
  }
  const path = join(directory, name);
  let transferred = await stat(path).then(s => s.size, error => {
    if (error.code === "ENOENT") return 0;
    throw error;
  });
  if (transferred > size) {
    await rm(path, { force: true });
    transferred = 0;
  }
  const started = Date.now();
  let received = 0, lastReport = 0, lastTransferred = 0;
  const report = (force = false) => {
    if (!force && lastTransferred > 0 && Date.now() - lastReport < 200) return;
    lastReport = Date.now();
    lastTransferred = transferred;
    onProgress({ transferred, total: size, percent: transferred / size * 100,
      bytesPerSecond: received / Math.max(1, (Date.now() - started) / 1000) });
  };
  report(true);
  let retries = 0;
  while (transferred < size) {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let timer;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(Object.assign(new Error("Download stalled"), { code: "UPDATE_STALLED" })), idleTimeout);
    };
    let file;
    try {
      refresh();
      const end = Math.min(size - 1, transferred + 8 * 1024 * 1024 - 1);
      const response = await fetch(url, {
        headers: { Range: `bytes=${transferred}-${end}`, "Accept-Encoding": "identity" },
        signal: requestSignal, cache: "no-store",
      });
      let expectedEnd;
      if (response.status === 206) {
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
        if (!range || +range[1] !== transferred || +range[2] > end ||
            +range[2] < transferred || +range[3] !== size)
          throw Object.assign(new Error("Invalid download range"), { code: "UPDATE_INVALID_RANGE" });
        expectedEnd = +range[2] + 1;
      } else if (response.status === 200) {
        // A server may ignore Range. Replace the partial file; never append a
        // complete response to it. The final checksum remains authoritative.
        transferred = 0;
        expectedEnd = size;
      } else {
        throw Object.assign(new Error("Download HTTP error"), { code: "UPDATE_HTTP_ERROR", httpStatus: response.status });
      }
      file = await open(path, response.status === 200 || transferred === 0 ? "w" : "a");
      for await (const chunk of response.body) {
        requestSignal.throwIfAborted();
        refresh();
        if (transferred + chunk.length > expectedEnd) throw Object.assign(new Error("Oversized download response"), { code: "UPDATE_OVERSIZED" });
        let written = 0;
        while (written < chunk.length) {
          const result = await file.write(chunk, written, chunk.length - written);
          written += result.bytesWritten;
          transferred += result.bytesWritten;
          received += result.bytesWritten;
        }
        report();
      }
      if (transferred !== expectedEnd) throw Object.assign(new Error("Incomplete download response"), { code: "UPDATE_INCOMPLETE" });
    } catch (error) {
      controller.abort();
      clearTimeout(timer);
      if (file) { await file.close(); file = undefined; }
      signal?.throwIfAborted();
      if (retries >= retryDelays.length || ["ENOSPC", "EACCES", "EPERM"].includes(error.code)) throw error;
      const wait = retryDelays[retries++];
      onRetry({ attempt: retries, seconds: wait / 1000, ...failureInfo(error) });
      await delay(wait, undefined, { signal });
    } finally {
      clearTimeout(timer);
      controller.abort();
      await file?.close();
    }
  }
  signal?.throwIfAborted();
  report(true);
  onVerify();
  const hash = createHash("sha512");
  for await (const chunk of createReadStream(path)) {
    signal?.throwIfAborted();
    hash.update(chunk);
  }
  if (hash.digest("base64") !== sha512) {
    await rm(path, { force: true });
    throw Object.assign(new Error("Update checksum mismatch"), { code: "UPDATE_CHECKSUM_MISMATCH" });
  }
  return path;
}

module.exports = { downloadResumable };
