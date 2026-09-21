export function isMobileDevice(): boolean {
  if (window.matchMedia("(pointer: coarse)").matches) return true;
  return window.matchMedia("(max-width: 720px)").matches;
}
