/**
 * Decides the editor plugin set once per page load (plugins cannot switch at
 * runtime). Input type wins over viewport width: a narrow desktop window with
 * a mouse stays on the desktop UI, while a wide tablet in landscape still gets
 * the touch UI. Width is only a fallback for engines without pointer queries.
 */
export function isMobileDevice(): boolean {
  const coarse = window.matchMedia("(pointer: coarse)");
  const fine = window.matchMedia("(pointer: fine)");
  if (!coarse.matches && !fine.matches) {
    return window.matchMedia("(max-width: 720px)").matches;
  }
  return coarse.matches && !fine.matches;
}
