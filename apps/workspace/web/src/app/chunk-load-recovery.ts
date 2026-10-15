const reloadKey = "univer-workspace-chunk-reload";
const loadFailure =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function installChunkLoadRecovery(buildId: string): void {
  let reloading = false;
  window.addEventListener("vite:preloadError", (event) => {
    const payload = (event as Event & { payload?: Error }).payload;
    if (reloading || !loadFailure.test(payload?.message ?? "")) return;

    // The entry's hashed URL limits recovery to one reload per build and tab.
    try {
      if (window.sessionStorage.getItem(reloadKey) === buildId) return;
      window.sessionStorage.setItem(reloadKey, buildId);
    } catch {
      return;
    }

    reloading = true;
    event.preventDefault();
    window.location.reload();
  });
}
