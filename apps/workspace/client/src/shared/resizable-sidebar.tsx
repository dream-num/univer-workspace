import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";

interface ResizableSidebarOptions {
  readonly storageKey: string;
  readonly defaultWidth: number;
  readonly minWidth: number;
  readonly maxWidth: number;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => window.matchMedia(query).matches
  );

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function useResizableSidebar({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
}: ResizableSidebarOptions) {
  const [width, setWidthState] = useState(() =>
    storedNumber(
      `${storageKey}:width`,
      defaultWidth,
      minWidth,
      maxWidth
    )
  );
  const [collapsed, setCollapsedState] = useState(
    () => window.localStorage.getItem(`${storageKey}:collapsed`) === "true"
  );

  const setWidth = (value: number) => {
    const next = clamp(value, minWidth, maxWidth);
    setWidthState(next);
    window.localStorage.setItem(`${storageKey}:width`, String(next));
  };
  const setCollapsed = (value: boolean) => {
    setCollapsedState(value);
    window.localStorage.setItem(
      `${storageKey}:collapsed`,
      String(value)
    );
  };

  return {
    width,
    collapsed,
    setWidth,
    setCollapsed,
    toggleCollapsed: () => setCollapsed(!collapsed),
  };
}

export function SidebarResizeHandle({
  value,
  min,
  max,
  label,
  onChange,
  className = "",
}: {
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly onChange: (value: number) => void;
  readonly className?: string;
}) {
  const drag = useRef<{
    readonly pointerId: number;
    readonly startX: number;
    readonly startValue: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const finishDrag = (
    event: PointerEvent<HTMLButtonElement>
  ) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <button
      type="button"
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      data-dragging={dragging || undefined}
      className={`ui-resize-handle ${className}`.trim()}
      onPointerDown={(event) => {
        event.preventDefault();
        drag.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startValue: value,
        };
        setDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const activeDrag = drag.current;
        if (!activeDrag || activeDrag.pointerId !== event.pointerId) {
          return;
        }
        onChange(
          activeDrag.startValue + event.clientX - activeDrag.startX
        );
      }}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onLostPointerCapture={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "ArrowLeft" &&
          event.key !== "ArrowRight"
        ) {
          return;
        }
        event.preventDefault();
        onChange(value + (event.key === "ArrowLeft" ? -12 : 12));
      }}
    />
  );
}

function storedNumber(
  key: string,
  fallback: number,
  min: number,
  max: number
): number {
  const value = Number(window.localStorage.getItem(key));
  return Number.isFinite(value) && value > 0
    ? clamp(value, min, max)
    : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
