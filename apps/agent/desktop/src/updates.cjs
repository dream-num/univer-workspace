const { join } = require("node:path");
const { REPOSITORY, TAG_PREFIX, selectRelease, releaseFeed, releaseChannel } = require("./policy.cjs");
const { downloadResumable } = require("./update-download.cjs");
const { failureInfo } = require("./diagnostics.cjs");
const { serveUpdate } = require("./update-feed.cjs");

function selectAsset(info, feed, platform = process.platform, arch = process.arch, assets = []) {
  const extension = { win32: ".exe", darwin: ".zip", linux: ".AppImage" }[platform];
  const files = (info.files ?? []).map(file => ({ ...file, url: new URL(file.url, feed).href }));
  const file = files.find(file => {
    const url = new URL(file.url);
    return file.url.startsWith(feed) && !url.search && !url.hash &&
      url.pathname.endsWith(extension) &&
      (platform !== "darwin" || url.pathname.includes(arch));
  });
  // NSIS release feeds omit size. GitHub's asset inventory supplies the exact
  // length required for range validation; do not reject existing release feeds.
  if (file && file.size === undefined)
    file.size = assets.find(asset => asset.browser_download_url === file.url)?.size;
  if (!file || info.packages || !Number.isSafeInteger(file.size) || file.size <= 0 ||
      typeof file.sha512 !== "string" || Buffer.from(file.sha512, "base64").length !== 64)
    throw new Error("Invalid release artifact");
  return file;
}

// One controller owns both UI/manual and background activity. Renderer messages
// never supply versions, URLs, paths, or installer arguments.
function createUpdateController({ app, autoUpdater, net, updatesEnabled, beforeInstall,
  show = () => {}, changed = () => {}, download = downloadResumable, serve = serveUpdate }) {
  let state = { phase: "idle", currentVersion: app.getVersion() };
  let selected, active, controller;
  const publish = (patch) => {
    state = { ...state, ...(patch.phase !== state.phase ? { code: undefined, httpStatus: undefined } : {}), ...patch };
    changed(state);
  };
  const run = (task) => {
    if (active) return active;
    active = Promise.resolve().then(task).finally(() => { active = undefined; });
    return active;
  };
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.disableWebInstaller = true;
  autoUpdater.allowDowngrade = false;
  autoUpdater.allowPrerelease = releaseChannel(app.getVersion()) !== "latest";
  // Do not expose signed redirect URLs, request headers or raw SDK errors.
  autoUpdater.on("error", error => {
    if (state.phase === "installing") publish({ phase: "install-error", failure: failureInfo(error) });
  });

  const check = (manual = true) => {
    if (manual) show();
    if (active || ["available", "paused", "download-error", "ready"].includes(state.phase))
      return active ?? Promise.resolve();
    return run(async () => {
      if (!app.isPackaged || !updatesEnabled) { publish({ phase: "disabled" }); return; }
      publish({ phase: "checking", failure: undefined });
      try {
        const releases = [];
        const signal = AbortSignal.timeout(20000);
        for (let page = 1; ; page++) {
          const response = await net.fetch(
            `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
            { headers: { Accept: "application/vnd.github+json" }, signal });
          if (!response.ok) throw Object.assign(new Error("Release service unavailable"), { code: "RELEASE_HTTP_ERROR", httpStatus: response.status });
          const batch = await response.json();
          if (!Array.isArray(batch)) throw new Error("Invalid release response");
          releases.push(...batch);
          if (batch.length < 100) break;
        }
        const latest = selectRelease(releases, app.getVersion());
        if (!latest) { publish({ phase: "current" }); return; }
        const feed = releaseFeed(latest);
        const version = latest.tag_name.slice(TAG_PREFIX.length);
        const channel = releaseChannel(version);
        autoUpdater.setFeedURL({ provider: "generic", url: feed, channel });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable) { publish({ phase: "current" }); return; }
        if (result.updateInfo.version !== version) throw new Error("Release metadata version mismatch");
        selected = { version, channel, file: selectAsset(result.updateInfo, feed, process.platform, process.arch, latest.assets) };
        publish({ phase: "available", version, notes: typeof latest.body === "string" ? latest.body.slice(0, 20000) : "" });
        show();
      } catch (error) { publish({ phase: "check-error", failure: failureInfo(error) }); }
    });
  };
  const startDownload = () => {
    if (active || !selected || !["available", "paused", "download-error"].includes(state.phase))
      return active ?? Promise.resolve();
    return run(async () => {
      controller = new AbortController();
      publish({ phase: "downloading", attempt: undefined, failure: undefined });
      let feed;
      try {
        const path = await download({ ...selected.file,
          directory: join(app.getPath("userData"), "update-downloads"),
          fetch: net.fetch.bind(net), signal: controller.signal,
          onProgress: progress => publish({ phase: "downloading", ...progress }),
          onRetry: retry => publish({ phase: "retrying", ...retry }),
          onVerify: () => publish({ phase: "verifying" }),
        });
        controller.signal.throwIfAborted();
        publish({ phase: "staging" });
        feed = await serve({ ...selected, path });
        autoUpdater.setFeedURL({ provider: "generic", url: feed.url, channel: selected.channel });
        const result = await autoUpdater.checkForUpdates();
        if (!result?.isUpdateAvailable || result.updateInfo.version !== selected.version)
          throw new Error("Staged metadata mismatch");
        await autoUpdater.downloadUpdate();
        publish({ phase: "ready" });
      } catch (error) {
        publish({ phase: controller.signal.aborted ? "paused" : "download-error",
          failure: controller.signal.aborted ? undefined : failureInfo(error) });
      } finally {
        await feed?.close();
        controller = undefined;
      }
    });
  };
  const pause = () => {
    if (["downloading", "retrying", "verifying"].includes(state.phase)) controller?.abort();
  };
  const install = () => {
    if (active || state.phase !== "ready") return active ?? Promise.resolve();
    return run(async () => {
      publish({ phase: "installing", installError: false });
      try { await beforeInstall(); autoUpdater.quitAndInstall(false, true); }
      catch (error) { publish({ phase: "ready", installError: true, failure: failureInfo(error) }); }
    });
  };
  return { check, download: startDownload, pause, install, getState: () => state };
}
module.exports = { createUpdateController, selectAsset };
