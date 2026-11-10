import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import {
  CHAT_DEFAULT_SIZE,
  chatSafeArea,
  chatPlacementAt,
  constrainChat,
  dockChat,
  type ChatBounds,
  type ChatFrame,
  type ChatPlacement,
} from '../chat-docking.js';

type DragMode = 'move' | 'left' | 'right' | 'height';
interface Drag {
  id: number;
  target: HTMLElement;
  x: number;
  y: number;
  frame: ChatFrame;
  mode: DragMode;
  moved: boolean;
  placement: ChatPlacement;
}

/** Owns pointer capture and geometry only. DSH continues owning every input and
 * transcript node. Canvas/iframe bounds exclude native ribbon and footer UI. */
export function useChatDocking(
  panel: RefObject<HTMLElement>,
  seat: RefObject<HTMLDivElement>,
  expanded: boolean,
  visible: boolean,
  scope: string,
) {
  const [placement, setPlacement] = useState<ChatPlacement>('bottom');
  const [size, setSize] = useState(CHAT_DEFAULT_SIZE);
  const [bounds, setBounds] = useState<ChatBounds>({
    left: 0,
    top: 52,
    width: 0,
    height: 0,
  });
  const [contentHeight, setContentHeight] = useState(58);
  const [moving, setMoving] = useState<ChatFrame | null>(null);
  const [preview, setPreview] = useState<ChatPlacement | null>(null);
  const drag = useRef<Drag>();
  const latest = useRef({ bounds, placement, size, expanded, contentHeight });
  latest.current = { bounds, placement, size, expanded, contentHeight };
  const didDrag = useRef(false);
  const cleanup = useRef(() => {});
  const cancel = () => {
    const current = drag.current;
    drag.current = undefined;
    cleanup.current();
    if (current?.target.hasPointerCapture(current.id))
      current.target.releasePointerCapture(current.id);
    setMoving(null);
    setPreview(null);
  };
  useLayoutEffect(() => {
    const root = seat.current?.parentElement;
    if (!root || !visible) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const origin = root.getBoundingClientRect();
        const body = root.querySelector<HTMLElement>('.sp-page-body');
        const candidates = [
          ...(body?.querySelectorAll<HTMLElement>(
            'canvas[data-u-comp="render-canvas"],iframe',
          ) ?? []),
        ]
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.width > 100 && rect.height > 100);
        const canvas =
          candidates.sort(
            (a, b) => b.width * b.height - a.width * a.height,
          )[0] ??
          body?.getBoundingClientRect() ??
          origin;
        const controls =
          body?.dataset.viewerKind === 'board'
            ? [...body.querySelectorAll<HTMLElement>('[data-u-comp="button"]')]
            : [
                ...(body?.querySelectorAll<HTMLElement>('.sp-html-inspect') ??
                  []),
              ];
        const usable = chatSafeArea(
          canvas,
          controls.map((element) => element.getBoundingClientRect()),
        );
        const target = {
          ...usable,
          right: usable.left + usable.width,
          bottom: usable.top + usable.height,
        };
        const next = {
          left: Math.max(0, target.left - origin.left),
          top: Math.max(52, target.top - origin.top),
          width: Math.max(
            0,
            Math.min(target.right, origin.right) -
              Math.max(target.left, origin.left),
          ),
          height: Math.max(
            0,
            Math.min(target.bottom, origin.bottom) -
              Math.max(target.top, origin.top + 52),
          ),
        };
        setBounds((previous) =>
          JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
        );
        const height = panel.current?.getBoundingClientRect().height;
        if (height)
          setContentHeight((previous) =>
            Math.abs(previous - height) < 1 ? previous : height,
          );
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    if (bodyElement(root)) observer.observe(bodyElement(root)!);
    if (panel.current) observer.observe(panel.current);
    const mutations = new MutationObserver(measure);
    const body = root.querySelector('.sp-page-body');
    if (body) mutations.observe(body, { childList: true, subtree: true });
    window.addEventListener('resize', measure);
    measure();
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      mutations.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [visible, scope, expanded]);
  useEffect(() => {
    cancel();
  }, [visible, scope]);
  useEffect(
    () => () => {
      cleanup.current();
      const d = drag.current;
      if (d?.target.hasPointerCapture(d.id))
        d.target.releasePointerCapture(d.id);
    },
    [],
  );

  const frame =
    moving ??
    dockChat(
      placement,
      { width: size.width, height: expanded ? size.height : contentHeight },
      bounds,
    );
  const begin = (event: ReactPointerEvent<HTMLElement>, mode: DragMode) => {
    if (event.button !== 0 || !visible) return;
    cancel();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    didDrag.current = false;
    drag.current = {
      id: event.pointerId,
      target: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      frame,
      mode,
      moved: false,
      placement,
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      const current = latest.current;
      const dx = e.clientX - d.x,
        dy = e.clientY - d.y;
      if (Math.hypot(dx, dy) < 4 && !d.moved) return;
      d.moved = true;
      didDrag.current = true;
      if (d.mode === 'move') {
        setMoving(
          constrainChat(
            { ...d.frame, left: d.frame.left + dx, top: d.frame.top + dy },
            current.bounds,
          ),
        );
        setPreview(
          chatPlacementAt(
            e.clientX - seat.current!.getBoundingClientRect().left,
            e.clientY - seat.current!.getBoundingClientRect().top,
            current.bounds,
          ),
        );
      } else {
        const width = Math.max(
          Math.min(280, current.bounds.width - 20),
          d.frame.width +
            (d.mode === 'left' ? -dx : d.mode === 'right' ? dx : 0),
        );
        const height = Math.max(
          160,
          d.frame.height + (d.placement.startsWith('top') ? dy : -dy),
        );
        setSize((previous) => ({
          width:
            d.mode === 'height'
              ? previous.width
              : Math.min(width, current.bounds.width - 20),
          height:
            d.mode === 'height'
              ? Math.min(height, current.bounds.height - 20)
              : previous.height,
        }));
      }
    };
    const end = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.id) return;
      if (d.mode === 'move' && d.moved) {
        const origin = seat.current!.getBoundingClientRect();
        setPlacement(
          chatPlacementAt(
            e.clientX - origin.left,
            e.clientY - origin.top,
            latest.current.bounds,
          ),
        );
      }
      cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        cancel();
      }
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key, true);
    cleanup.current = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', key, true);
    };
  };
  return {
    frame,
    bounds,
    placement,
    preview: preview ? dockChat(preview, frame, bounds) : null,
    dragging: !!moving,
    begin,
    cancel,
    consumeDrag: () => {
      const value = didDrag.current;
      didDrag.current = false;
      return value;
    },
    setPlacement,
    resize: (width: number, height = size.height) =>
      setSize({ width: Math.max(280, width), height: Math.max(160, height) }),
  };
}
function bodyElement(root: HTMLElement) {
  return root.querySelector<HTMLElement>('.sp-page-body');
}
