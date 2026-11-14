import { useSyncExternalStore } from "react";

const storageKey = "univer-workspace-debug-mode";
const changeEvent = "univer-workspace-debug-mode-change";
let writeFailed = false;
export function readDebugMode(read: () => string | null): boolean {
  try { return read() === "1"; } catch { return false; }
}
function snapshot() { return !writeFailed && readDebugMode(() => window.localStorage.getItem(storageKey)); }
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === storageKey || event.key === null) { writeFailed = false; listener(); } };
  window.addEventListener("storage", storage);
  window.addEventListener(changeEvent, listener);
  return () => { window.removeEventListener("storage", storage); window.removeEventListener(changeEvent, listener); };
}
function setDebugMode(on: boolean) {
  try { window.localStorage.setItem(storageKey, on ? "1" : "0"); writeFailed = false; }
  catch { writeFailed = true; }
  window.dispatchEvent(new Event(changeEvent));
}
export function useDebugMode(): [boolean, (on: boolean) => void] {
  return [useSyncExternalStore(subscribe, snapshot, () => false), setDebugMode];
}
