const loadFailure =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i;

export function installChunkLoadRecovery(showRefreshPrompt: () => void): () => void {
  const onPreloadError = (event: Event) => {
    const payload = (event as Event & { payload?: Error }).payload;
    if (loadFailure.test(payload?.message ?? "")) showRefreshPrompt();
  };
  window.addEventListener("vite:preloadError", onPreloadError);
  return () => window.removeEventListener("vite:preloadError", onPreloadError);
}
