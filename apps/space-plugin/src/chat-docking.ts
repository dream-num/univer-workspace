export type ChatPlacement =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom' | 'bottom-right';
export interface ChatBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface ChatSize {
  width: number;
  height: number;
}
export interface ChatFrame extends ChatBounds {}
export const CHAT_GAP = 10;
export const CHAT_DEFAULT_SIZE: ChatSize = { width: 572, height: 640 };

/** Canvas toolbars can float inside the render canvas. Reserve their occupied
 * edge, using measured public button bounds rather than SDK CSS class names. */
export function chatSafeArea(
  viewport: ChatBounds,
  controls: ChatBounds[],
): ChatBounds {
  let left = viewport.left,
    top = viewport.top;
  let right = left + viewport.width,
    bottom = top + viewport.height;
  for (const rect of controls) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    const distances = [
      rect.top - viewport.top,
      viewport.top + viewport.height - rect.top - rect.height,
      rect.left - viewport.left,
      viewport.left + viewport.width - rect.left - rect.width,
    ];
    const distance = Math.min(...distances);
    if (distance < 0 || distance > 80) continue;
    // A wide corner control (for example Pages' Inspect action) occupies a
    // horizontal toolbar band; reserving a whole side column would shift chat.
    const edge =
      rect.width > rect.height * 1.5 && distances[0] <= 80
        ? 0
        : distances.indexOf(distance);
    if (edge === 0) top = Math.max(top, rect.top + rect.height + 8);
    else if (edge === 1) bottom = Math.min(bottom, rect.top - 8);
    else if (edge === 2) left = Math.max(left, rect.left + rect.width + 8);
    else right = Math.min(right, rect.left - 8);
  }
  return {
    left,
    top,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

/** Docking stays relative to the usable viewer viewport, never the OS window. */
export function chatSize(size: ChatSize, bounds: ChatBounds): ChatSize {
  return {
    width: Math.max(0, Math.min(size.width, bounds.width - CHAT_GAP * 2)),
    height: Math.max(0, Math.min(size.height, bounds.height - CHAT_GAP * 2)),
  };
}
export function dockChat(
  placement: ChatPlacement,
  size: ChatSize,
  bounds: ChatBounds,
): ChatFrame {
  const fitted = chatSize(size, bounds);
  const left = placement.endsWith('left')
    ? bounds.left + CHAT_GAP
    : placement === 'bottom'
      ? bounds.left + (bounds.width - fitted.width) / 2
      : bounds.left + bounds.width - fitted.width - CHAT_GAP;
  const top = placement.startsWith('top')
    ? bounds.top + CHAT_GAP
    : bounds.top + bounds.height - fitted.height - CHAT_GAP;
  return {
    ...fitted,
    left: Math.max(bounds.left, left),
    top: Math.max(bounds.top, top),
  };
}
export function constrainChat(frame: ChatFrame, bounds: ChatBounds): ChatFrame {
  const size = chatSize(frame, bounds);
  return {
    ...size,
    left: Math.max(
      bounds.left,
      Math.min(frame.left, bounds.left + bounds.width - size.width),
    ),
    top: Math.max(
      bounds.top,
      Math.min(frame.top, bounds.top + bounds.height - size.height),
    ),
  };
}
/** The bottom-center target is distinct; other releases choose a corner by
 * pointer quadrant. A free drag is transient and does not resize the editor. */
export function chatPlacementAt(
  x: number,
  y: number,
  bounds: ChatBounds,
): ChatPlacement {
  const center = bounds.left + bounds.width / 2;
  if (
    y >= bounds.top + bounds.height - 64 &&
    Math.abs(x - center) < bounds.width * 0.2
  )
    return 'bottom';
  return `${y < bounds.top + bounds.height / 2 ? 'top' : 'bottom'}-${x < center ? 'left' : 'right'}`;
}
