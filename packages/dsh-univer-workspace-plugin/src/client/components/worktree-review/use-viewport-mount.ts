/** Half-screen preloading with a one-screen retention zone for review editors. */
import { useCallback, useEffect, useRef, useState } from "react";
import { selectViewportUnits } from "./viewport-policy.ts";

export interface ViewportMount {
  readonly shouldMount: (unitId: string) => boolean;
  readonly register: (unitId: string, element: HTMLElement | null) => void;
}

export function useViewportMount(
  root: HTMLElement | null,
  unitIds: readonly string[],
  expandedIds: ReadonlySet<string>,
  capacity: number,
): ViewportMount {
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const [mounted, setMounted] = useState<ReadonlySet<string>>(new Set());
  const scheduleRef = useRef<() => void>(() => {});
  const expandedRef = useRef(expandedIds);
  expandedRef.current = expandedIds;

  useEffect(() => {
    setMounted((previous) => new Set([...previous].filter((id) => expandedIds.has(id) && unitIds.includes(id))));
    scheduleRef.current();
  }, [expandedIds, unitIds]);

  useEffect(() => {
    if (root === null) return;
    let frame: number | null = null;
    const update = () => {
      frame = null;
      const bounds = root.getBoundingClientRect();
      if (bounds.height <= 0) return;
      const items = [...elementsRef.current].flatMap(([unitId, element]) => {
        if (!expandedRef.current.has(unitId)) return [];
        const rect = element.getBoundingClientRect();
        return [{ unitId, distance: Math.max(0, bounds.top - rect.bottom, rect.top - bounds.bottom) }];
      });
      setMounted((previous) => {
        const next = selectViewportUnits(items, previous, bounds.height, capacity);
        return next.size === previous.size && [...next].every((id) => previous.has(id)) ? previous : next;
      });
    };
    const schedule = () => {
      if (frame === null) frame = requestAnimationFrame(update);
    };
    scheduleRef.current = schedule;
    root.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    if (root.firstElementChild !== null) observer.observe(root.firstElementChild);
    schedule();
    return () => {
      root.removeEventListener("scroll", schedule);
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      scheduleRef.current = () => {};
    };
  }, [root, capacity]);

  const register = useCallback((unitId: string, element: HTMLElement | null) => {
    if (element === null) elementsRef.current.delete(unitId);
    else elementsRef.current.set(unitId, element);
    scheduleRef.current();
  }, []);

  return {
    shouldMount: (unitId) => expandedIds.has(unitId) && mounted.has(unitId),
    register,
  };
}
