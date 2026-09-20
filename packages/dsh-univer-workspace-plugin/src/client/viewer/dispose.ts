/** Finish every cleanup even if one SDK service throws during document close. */
export function disposeViewerResources(...actions: Array<() => void>): void {
  for (const action of actions) {
    try { action(); }
    catch (error) { console.error("Workspace viewer cleanup failed", error); }
  }
}
