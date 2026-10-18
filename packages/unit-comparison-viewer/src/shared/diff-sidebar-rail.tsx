import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactElement } from "react";
import { Badge } from "../ui/badge.js";
import { cn } from "../ui/cn.js";

const RAIL_WIDTH_CLASS = "w-11";

/**
 * Collapse affordance that lives in a diff sidebar header. The header already names the panel it
 * governs, so the button reuses that name and reports state through aria-expanded.
 */
export function DiffSidebarCollapseButton(input: {
  readonly label: string;
  readonly onCollapse: () => void;
}): ReactElement {
  return (
    <button
      aria-expanded
      aria-label={input.label}
      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-[1023px]:hidden"
      title={input.label}
      type="button"
      onClick={input.onCollapse}
    >
      <ChevronLeft aria-hidden="true" className="size-3.5" />
    </button>
  );
}

/**
 * Slim rail left behind by a collapsed diff sidebar: same label, same count, one click to restore.
 * Hidden below the comparison breakpoint, where the sidebar itself is already hidden.
 */
export function DiffSidebarRail(input: {
  readonly label: string;
  readonly count: number;
  readonly onExpand: () => void;
}): ReactElement {
  return (
    <button
      aria-expanded={false}
      aria-label={input.label}
      className={cn(
        RAIL_WIDTH_CLASS,
        "flex min-h-0 flex-col items-center gap-2 overflow-hidden border-r bg-card py-3 text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring max-[1023px]:hidden",
      )}
      title={input.label}
      type="button"
      onClick={input.onExpand}
    >
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="[writing-mode:vertical-rl] text-[11px] font-bold tracking-[0.08em] uppercase">
        {input.label}
      </span>
      <Badge>{input.count}</Badge>
    </button>
  );
}

/** Collapsed grid template, so every comparison view allocates the same rail width. */
export const DIFF_SIDEBAR_RAIL_GRID_CLASS = RAIL_WIDTH_CLASS;
