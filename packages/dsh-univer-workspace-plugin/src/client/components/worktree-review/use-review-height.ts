import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

export type ReviewHeightPreset = "compact" | "auto" | "fill";
const MIN_HEIGHT = 280;

/** Size the preview against its scroll viewport, independent of scroll position. */
export function useReviewHeight(
  scrollRoot: RefObject<HTMLElement | null>,
  item: RefObject<HTMLElement | null>,
  expanded: boolean,
  single: boolean,
) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(600);
  const [choice, setChoice] = useState<ReviewHeightPreset | number>("auto");
  const drag = useRef<{ pointerId: number; startY: number; height: number } | null>(null);

  useEffect(() => {
    const root = scrollRoot.current;
    const card = item.current;
    const viewer = viewerRef.current;
    const stream = card?.parentElement;
    if (!expanded || !root || !card || !viewer || !stream) return;
    const measure = () => {
      const style = getComputedStyle(stream);
      const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
      const chrome = card.getBoundingClientRect().height - viewer.getBoundingClientRect().height;
      setAvailable(Math.max(MIN_HEIGHT, Math.floor(root.clientHeight - padding - chrome)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    observer.observe(card);
    return () => observer.disconnect();
  }, [scrollRoot, item, expanded]);

  const maximum = Math.max(1200, available);
  const clamp = (value: number) => Math.round(Math.max(MIN_HEIGHT, Math.min(maximum, value)));
  const height = typeof choice === "number"
    ? clamp(choice)
    : choice === "compact"
      ? Math.min(360, available)
      : choice === "fill" || single
        ? available
        : Math.min(available, Math.max(420, Math.round(available * 0.75)));

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startY: event.clientY, height };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current;
    if (active?.pointerId !== event.pointerId) return;
    setChoice(clamp(active.height + event.clientY - active.startY));
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === "ArrowUp" ? height - 32
      : event.key === "ArrowDown" ? height + 32
        : event.key === "Home" ? MIN_HEIGHT
          : event.key === "End" ? available
            : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setChoice(clamp(next));
  };

  return {
    viewerRef,
    height,
    preset: typeof choice === "number" ? "manual" as const : choice,
    setPreset: (preset: ReviewHeightPreset | "manual") => {
      if (preset !== "manual") setChoice(preset);
    },
    resizeProps: {
      role: "separator" as const,
      tabIndex: 0,
      "aria-orientation": "horizontal" as const,
      "aria-valuemin": MIN_HEIGHT,
      "aria-valuemax": maximum,
      "aria-valuenow": height,
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: () => { drag.current = null; },
      onKeyDown,
      onDoubleClick: () => setChoice("auto"),
    },
  };
}
