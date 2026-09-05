import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import css from "./ConversationSurfaceResizeHandle.module.scss";

const MIN_SURFACE = 360;
const MIN_CONVERSATION = 360;

export function ConversationSurfaceResizeHandle(props: {
  readonly left: number;
  readonly width: number;
  readonly viewportWidth: number;
  readonly onWidthChange: (width: number) => void;
}): JSX.Element {
  const origin = useRef<{ x: number; width: number; pointerId: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const maxWidth = Math.max(MIN_SURFACE, props.viewportWidth - props.left - MIN_CONVERSATION);
  const onPointerDown = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    origin.current = { x: event.clientX, width: props.width, pointerId: event.pointerId };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    const start = origin.current;
    if (start === null || start.pointerId !== event.pointerId) return;
    props.onWidthChange(Math.max(MIN_SURFACE, Math.min(maxWidth, start.width + event.clientX - start.x)));
  };
  const stop = (event: ReactPointerEvent<HTMLButtonElement>): void => {
    if (origin.current?.pointerId === event.pointerId) {
      origin.current = null;
      setDragging(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  return <button type="button" aria-label="调整预览与会话宽度" className={css.handle}
    style={{ left: props.left + props.width }}
    data-dragging={dragging} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
    onPointerUp={stop} onPointerCancel={stop} />;
}
