import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { useI18n } from "../../shared/i18n";
import { Segmented } from "../../shared/ui";
import { cn } from "../../shared/utils/cn";
import type { WorktreeReviewMode } from "./worktree-review-presentation";

interface WorktreeReviewHeaderProps {
  readonly documentName: string;
  readonly icon?: ReactNode;
  readonly badge?: ReactNode;
  readonly resultBadge?: ReactNode;
  readonly view?:
    | {
        readonly value: WorktreeReviewMode;
        readonly onChange: (value: WorktreeReviewMode) => void;
      }
    | undefined;
  readonly actions: ReactNode;
}

/** The browser wraps one flow; measurement only decides whether symmetric columns fit. */
export function WorktreeReviewHeader({
  documentName,
  icon,
  badge,
  resultBadge,
  view,
  actions,
}: WorktreeReviewHeaderProps): ReactElement {
  const { t } = useI18n();
  const headerRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState<"measuring" | "centered" | "flow">("measuring");
  const [titleMinimum, setTitleMinimum] = useState(0);
  const flow = layout === "flow";

  useLayoutEffect(() => {
    const header = headerRef.current!;
    let width = header.clientWidth;
    let active = true;
    setLayout("measuring");
    const observer = new ResizeObserver(() => {
      if (width !== header.clientWidth) {
        width = header.clientWidth;
        setLayout("measuring");
      }
    });
    observer.observe(header);
    void document.fonts?.ready.then(() => {
      if (active) setLayout("measuring");
    });
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [documentName, icon, badge, resultBadge, view, actions, t]);

  useLayoutEffect(() => {
    if (layout !== "measuring") return;
    const header = headerRef.current!;
    const titleRow = header.querySelector<HTMLElement>("[data-header-title-row]")!;
    const name = header.querySelector<HTMLElement>("[data-header-name]")!;
    const nameWidth = name.getBoundingClientRect().width;
    // Measure the uncompressed row; only the filename may shrink to its CSS flex basis.
    const minimum = Math.ceil(
      titleRow.getBoundingClientRect().width -
        nameWidth +
        Math.min(nameWidth, parseFloat(getComputedStyle(name).flexBasis)),
    );
    setTitleMinimum(minimum);
    const center = header.querySelector<HTMLElement>("[data-header-view]");
    if (!center) {
      setLayout("flow");
      return;
    }
    const right = header.querySelector<HTMLElement>("[data-header-actions]")!;
    const style = getComputedStyle(header);
    const available =
      header.clientWidth -
      parseFloat(style.paddingLeft) -
      parseFloat(style.paddingRight);
    const required =
      center.getBoundingClientRect().width +
      2 * Math.max(minimum, right.scrollWidth) +
      2 * parseFloat(style.columnGap);
    setLayout(available >= required ? "centered" : "flow");
  }, [layout]);

  return (
    <header
      ref={headerRef}
      data-header-layout={layout}
      style={{ "--header-title-min": `${titleMinimum}px` } as CSSProperties}
      className={cn(
        "min-h-11 min-w-0 shrink-0 items-center gap-x-3 gap-y-1.5 border-b border-border px-5 py-1.5",
        flow
          ? "flex flex-wrap"
          : "grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] [&_button]:whitespace-nowrap",
      )}
    >
      <div
        data-testid="review-title"
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2.5",
          flow &&
            "min-w-[min(var(--header-title-min),100%)] flex-[1_1_var(--header-title-min)]",
        )}
      >
        <div
          data-header-title-row
          className={cn(
            "flex min-w-0 max-w-full items-center gap-2.5",
            layout === "measuring" && "w-max max-w-none shrink-0",
          )}
        >
          {icon && <span className="inline-flex shrink-0">{icon}</span>}
          <div className="flex min-w-0 items-center gap-1.5">
            <h3
              data-header-name
              title={documentName}
              className="m-0 max-w-max flex-[1_0_100px] overflow-hidden text-sm font-semibold tracking-tight"
            >
              <span className="block max-w-[280px] truncate">{documentName}</span>
            </h3>
            {badge}
          </div>
        </div>
        {resultBadge}
      </div>
      {view && (
        <div
          data-header-view
          data-testid="view-compare-center"
          className={cn(
            "flex-none",
            flow ? "max-w-full min-w-[min(174px,100%)]" : "w-max min-w-[174px]",
          )}
        >
          <Segmented<WorktreeReviewMode>
            size="sm"
            aria-label={t("readOnlyPreview")}
            className="grid w-full grid-cols-2 bg-muted/80 p-0.5 shadow-xs"
            itemClassName="h-auto min-h-7 min-w-0 whitespace-normal [overflow-wrap:anywhere] px-3 py-1 text-[13px]"
            value={view.value}
            onValueChange={view.onChange}
            options={[
              { label: t("reviewView"), value: "view" },
              { label: t("reviewCompare"), value: "compare" },
            ]}
          />
        </div>
      )}
      <div
        data-header-actions
        className={cn(
          "flex min-w-0 flex-none items-center justify-end gap-2 empty:hidden [&_button]:h-auto [&_button]:min-h-8 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:[overflow-wrap:anywhere] [&_button]:py-1.5",
          flow ? "ml-auto max-w-full flex-wrap" : "w-max flex-nowrap justify-self-end",
        )}
      >
        {actions}
      </div>
    </header>
  );
}
