/**
 * Conversation inset compatibility adapter for DSH `0.1.2-alpha.4`.
 *
 * alpha.4 exposes `shell.overlay` as a frame-wide additive slot but no public
 * conversation-left-inset seam, so the middle Workspace surface would cover
 * the native Conversation. The published DOM still marks the native
 * scrollport with `[data-conversation-scroll]`; giving its parent container a
 * `padding-left` is the only remaining compatibility path to make room for
 * the surface without touching DSH.
 *
 * Isolation contract:
 * - This module is the ONLY place that knows the conversation selector and
 *   the geometry. UI components call the narrow API below and never see a
 *   DOM selector.
 * - One host at a time; the original inline `padding-left`/`transition`
 *   (value AND priority) are captured before the first override and restored
 *   verbatim on clear, re-capture or unmount.
 * - Missing host fails safe: `applyConversationInset` returns `null`, nothing
 *   is mutated, and closing the surface still restores the Conversation.
 *
 * Deletion condition: remove this module once DSH publishes an official
 * conversation inset / auxiliary-pane seam and the Overlay migrates to it.
 * @module dsh-univer-workspace-plugin/client/layout/conversation-inset
 */

/** Width of the middle Resource surface and the native Conversation inset. */
export const RESOURCE_SURFACE_WIDTH = 640;

/** Minimum width reserved for the native DSH Conversation beside a Worktree page. */
export const CONVERSATION_MIN_WIDTH = 360;

/** Fallback when the plugin sidebar element cannot be measured. Mirrors the
 * `--uwh-sidebar-width` default used by the existing overlay styles. */
const SIDEBAR_FALLBACK_WIDTH = 280;

interface InsetSnapshot {
  readonly paddingLeft: string;
  readonly paddingLeftPriority: string;
  readonly transition: string;
  readonly transitionPriority: string;
}

let insetHost: HTMLElement | null = null;
let insetSnapshot: InsetSnapshot | null = null;

/** The native Conversation content column: scrollport's parent in alpha.4. */
function conversationHost(): HTMLElement | null {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") return null;
  const scrollport = document.querySelector("[data-conversation-scroll]");
  const host = scrollport?.parentElement;
  return host instanceof HTMLElement ? host : null;
}

/** Right edge of our own sidebar, which is where the surface starts. */
function workspaceSidebar(): HTMLElement | null {
  if (typeof document === "undefined" || typeof HTMLElement === "undefined") {
    return null;
  }
  const sidebar = document.querySelector(
    '[data-plugin="dsh-univer-workspace"][data-surface="sidebar"]',
  );
  return sidebar instanceof HTMLElement ? sidebar : null;
}

/** Right edge of our own sidebar, which is where the surface starts. */
export function measureSurfaceLeft(): number {
  const right = workspaceSidebar()?.getBoundingClientRect().right ?? 0;
  if (right > 0) return Math.round(right);
  return SIDEBAR_FALLBACK_WIDTH;
}

/**
 * Measure the flexible Worktree page between the plugin sidebar and the native
 * Conversation. The caller supplies viewport width so the calculation remains
 * deterministic in tests and updates on browser resize.
 */
export function measureWorktreeSurfaceWidth(viewportWidth: number, surfaceLeft: number): number {
  return Math.max(0, Math.round(viewportWidth - surfaceLeft - CONVERSATION_MIN_WIDTH));
}

/**
 * Publish the initial sidebar edge and every subsequent width change. The
 * returned disposer owns the observer lifetime.
 */
export function observeSurfaceLeft(listener: (left: number) => void): () => void {
  const sidebar = workspaceSidebar();
  listener(measureSurfaceLeft());
  if (sidebar === null || typeof ResizeObserver === "undefined") return () => {};

  const observer = new ResizeObserver(() => listener(measureSurfaceLeft()));
  observer.observe(sidebar);
  return () => observer.disconnect();
}

function restoreInsetHost(): void {
  if (insetHost === null || insetSnapshot === null) return;
  if (insetSnapshot.paddingLeft === "") {
    insetHost.style.removeProperty("padding-left");
  } else {
    insetHost.style.setProperty(
      "padding-left",
      insetSnapshot.paddingLeft,
      insetSnapshot.paddingLeftPriority,
    );
  }
  if (insetSnapshot.transition === "") {
    insetHost.style.removeProperty("transition");
  } else {
    insetHost.style.setProperty(
      "transition",
      insetSnapshot.transition,
      insetSnapshot.transitionPriority,
    );
  }
  insetHost = null;
  insetSnapshot = null;
}

function captureInsetHost(host: HTMLElement): void {
  if (insetHost === host && insetSnapshot !== null) return;
  restoreInsetHost();
  insetHost = host;
  insetSnapshot = {
    paddingLeft: host.style.getPropertyValue("padding-left"),
    paddingLeftPriority: host.style.getPropertyPriority("padding-left"),
    transition: host.style.getPropertyValue("transition"),
    transitionPriority: host.style.getPropertyPriority("transition"),
  };
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Push the native Conversation content right by `widthPx`. Repeat calls with
 * the same host only update the value; a replaced host is restored first and
 * re-captured. Returns the host, or `null` when the alpha.4 DOM is absent.
 */
export function applyConversationInset(widthPx: number, animate = true): HTMLElement | null {
  const host = conversationHost();
  if (host === null) {
    restoreInsetHost();
    return null;
  }
  captureInsetHost(host);
  if (widthPx <= 0) {
    restoreInsetHost();
    return host;
  }
  const transition = animate && !prefersReducedMotion() ? "padding-left 160ms ease-in-out" : "none";
  host.style.setProperty("transition", transition);
  host.style.setProperty("padding-left", `${Math.round(widthPx)}px`);
  return host;
}

/** Restore the captured inline styles exactly; safe to call at any time. */
export function clearConversationInset(): void {
  restoreInsetHost();
}
