const {
  REPOSITORY,
  TAG_PREFIX,
  selectRelease,
  releaseFeed,
  releaseChannel,
} = require("./policy.cjs");

// One checker owns the update lifecycle, including background/manual concurrency.
function createUpdateChecker({
  app,
  autoUpdater,
  dialog,
  net,
  window,
  updatesEnabled,
  beforeInstall,
}) {
  let updateBusy = false;
  return async function checkUpdates(manual) {
    if (updateBusy) return;
    if (!app.isPackaged || !updatesEnabled) {
      if (manual)
        await dialog.showMessageBox(window, {
          message:
            "Automatic updates are enabled in official release builds. Preview installers can be updated from GitHub Releases.",
        });
      return;
    }
    updateBusy = true;
    let acceptedDownload = false;
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.allowDowngrade = false;
    autoUpdater.allowPrerelease = releaseChannel(app.getVersion()) !== "latest";
    const onError = () => {}; // Report one controlled error below, not raw signed URLs.
    autoUpdater.on("error", onError);
    try {
      const releases = [];
      const signal = AbortSignal.timeout(20000);
      for (let page = 1; ; page++) {
        const response = await net.fetch(
          `https://api.github.com/repos/${REPOSITORY}/releases?per_page=100&page=${page}`,
          { headers: { Accept: "application/vnd.github+json" }, signal },
        );
        if (!response.ok) throw new Error("Release service unavailable");
        const batch = await response.json();
        if (!Array.isArray(batch)) throw new Error("Invalid release response");
        releases.push(...batch);
        if (batch.length < 100) break;
      }
      const latest = selectRelease(releases, app.getVersion());
      if (!latest) {
        if (manual) await dialog.showMessageBox(window, { message: "You are up to date." });
        return;
      }
      autoUpdater.setFeedURL({
        provider: "generic",
        url: releaseFeed(latest),
        channel: releaseChannel(latest.tag_name.slice(TAG_PREFIX.length)),
      });
      const info = await autoUpdater.checkForUpdates();
      if (!info?.isUpdateAvailable) return;
      if (info.updateInfo.version !== latest.tag_name.slice(TAG_PREFIX.length))
        throw new Error("Release metadata version mismatch");
      const accepted = await dialog.showMessageBox(window, {
        type: "info",
        message: `Install Workspace Agent ${info.updateInfo.version}?`,
        detail:
          "The application and local service will restart. Finish active tasks before continuing.",
        buttons: ["Download and restart", "Later"],
        defaultId: 1,
        cancelId: 1,
      });
      if (accepted.response !== 0) return;
      acceptedDownload = true;
      await autoUpdater.downloadUpdate();
      await beforeInstall();
      autoUpdater.quitAndInstall(false, true);
    } catch {
      if (manual || acceptedDownload)
        await dialog.showMessageBox(window, {
          type: "error",
          message:
            "Unable to update. Try again later or download an installer from GitHub Releases.",
        });
    } finally {
      autoUpdater.off("error", onError);
      updateBusy = false;
    }
  };
}
module.exports = { createUpdateChecker };
