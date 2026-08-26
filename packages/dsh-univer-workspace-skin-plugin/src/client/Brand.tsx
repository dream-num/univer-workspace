/**
 * Sidebar brand mark and name for the Univer Workspace skin.
 *
 * The brand mark is a self-contained inline SVG (blue rounded square with a
 * "U" letterform); the name is the fixed product identity "Univer Workspace".
 */
import { createElement } from "react";
import type { PropsRuntime } from "@deepseek-ai/dsh-client-ui-slots";

/** The inline SVG brand mark. */
function brandMarkSvg(size: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><text x="16" y="21" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="16" font-weight="700" fill="#ffffff" text-anchor="middle">U</text></svg>`;
}

/** Render the brand mark in the expanded brand row and collapsed rail. */
export function WorkspaceBrandMark({ size }: PropsRuntime<"sidebar.brand.mark">) {
  return createElement("span", {
    "aria-hidden": "true",
    style: { display: "inline-flex", width: size, height: size },
    dangerouslySetInnerHTML: { __html: brandMarkSvg(size) },
  });
}

/** Render the brand name beside the expanded mark. */
export function WorkspaceBrandName(_props: PropsRuntime<"sidebar.brand.name">) {
  return createElement("span", {
    style: { fontWeight: 600, whiteSpace: "nowrap" },
  }, "Univer Workspace");
}
