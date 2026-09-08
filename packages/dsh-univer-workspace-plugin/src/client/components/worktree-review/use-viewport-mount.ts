/**
 * Viewport-aware Viewer mounting for the middle Worktree review surface. An
 * expanded accordion item mounts its Univer runtime only when it approaches
 * the viewport; once mounted it is retained in a bounded LRU (the confirmed
 * policy) so scrolling away does not immediately rebuild expensive runtimes.
 * Manual collapse, Unit removal, and LRU eviction are the only unmount paths.
 * @module dsh-univer-workspace-plugin/client/components/worktree-review/use-viewport-mount
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { LruSet } from "./worktree-review-model.ts";

/** How far outside the viewport an expanded item may be before it mounts. */
const PREFETCH_MARGIN = "240px 0px";

export interface ViewportMount {
  readonly shouldMount: (unitId: string) => boolean;
  readonly register: (unitId: string, element: HTMLElement | null) => void;
}

export function useViewportMount(
  scrollRootRef: RefObject<HTMLElement | null>,
  unitIds: readonly string[],
  expandedIds: ReadonlySet<string>,
  capacity: number,
): ViewportMount {
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const lruRef = useRef(new LruSet(capacity));
  const expandedRef = useRef(expandedIds);
  expandedRef.current = expandedIds;
  const [mountedVersion, setMountedVersion] = useState(0);

  // Manual collapse, Unit removal, and Worktree switches unmount immediately.
  useEffect(() => {
    const lru = lruRef.current;
    let changed = false;
    for (const key of lru.keys()) {
      if (!expandedIds.has(key) || !unitIds.includes(key)) {
        lru.delete(key);
        changed = true;
      }
    }
    if (changed) setMountedVersion((value) => value + 1);
  }, [expandedIds, unitIds]);

  useEffect(() => {
    const root = scrollRootRef.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const unitId = (entry.target as HTMLElement).dataset.reviewUnitId;
          if (unitId === undefined || !expandedRef.current.has(unitId)) continue;
          const alreadyMounted = lruRef.current.has(unitId);
          const evicted = lruRef.current.touch(unitId);
          if (!alreadyMounted || evicted.length > 0) changed = true;
        }
        if (changed) setMountedVersion((value) => value + 1);
      },
      { root, rootMargin: PREFETCH_MARGIN },
    );
    observerRef.current = observer;
    for (const element of elementsRef.current.values()) observer.observe(element);
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [scrollRootRef]);

  const register = useCallback(
    (unitId: string, element: HTMLElement | null) => {
      const elements = elementsRef.current;
      const previous = elements.get(unitId);
      if (previous !== undefined) {
        observerRef.current?.unobserve(previous);
        elements.delete(unitId);
      }
      if (element === null) return;
      elements.set(unitId, element);
      observerRef.current?.observe(element);

      // Chromium normally schedules an IntersectionObserver callback after
      // observe(), but a newly mounted scroll root can miss that first tick.
      // Touch an already visible item synchronously so the default-expanded
      // first Unit never remains a placeholder indefinitely.
      const root = scrollRootRef.current;
      if (root === null || !expandedRef.current.has(unitId)) return;
      const rootRect = root.getBoundingClientRect();
      const elementRect = element.getBoundingClientRect();
      const nearViewport =
        elementRect.bottom >= rootRect.top - 240 && elementRect.top <= rootRect.bottom + 240;
      if (nearViewport) {
        lruRef.current.touch(unitId);
        setMountedVersion((value) => value + 1);
      }
    },
    [scrollRootRef],
  );

  // mountedVersion re-reads the LRU after observer/expansion mutations.
  const shouldMount = useCallback(
    (unitId: string) => expandedIds.has(unitId) && lruRef.current.has(unitId),
    [expandedIds, mountedVersion],
  );

  return { shouldMount, register };
}
