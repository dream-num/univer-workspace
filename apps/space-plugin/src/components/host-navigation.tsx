import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Face } from '../client.js';
import { installHostNavigation } from '../host-layout.js';
import { Icon, iconButton } from './primitives.js';
/** A root-scoped footer Slot supplies a lifecycle anchor; native navigation stays mounted. */
export function HostNavigationBridge(
  props: Face & {
    toggleSidebar(): void;
    currentPanel(): string | null;
    usePanelInfo(
      select: (info: { activePanelId: string | null }) => string | null,
    ): string | null;
  },
) {
  const marker = useRef<HTMLSpanElement>(null),
    active = props.usePanelInfo((info) => info.activePanelId);
  const [targets, setTargets] =
      useState<ReturnType<typeof installHostNavigation>>(null),
    [collapsed, setCollapsed] = useState(false);
  useLayoutEffect(() => {
    const installed = installHostNavigation(marker.current!, {
      graph: (window as unknown as { __DSH_BOOT__?: unknown }).__DSH_BOOT__,
      active: props.currentPanel,
      toggle: props.toggleSidebar,
      collapsed: setCollapsed,
    });
    setTargets(installed);
    props.update({ hostNavigation: installed ? 'active' : 'unsupported' });
    return () => installed?.dispose();
  }, []);
  useLayoutEffect(() => {
    targets?.sync();
  }, [targets, active]);
  return (
    <>
      <span hidden ref={marker} data-space-navigation-anchor />
      {targets &&
        createPortal(
          <div className="sp-shell sp-global-activities">
            <button
              type="button"
              className={
                iconButton +
                ' sp-activity-chat' +
                (active === null ? ' sp-selected' : '')
              }
              aria-label="Chat"
              aria-current={active === null ? 'page' : undefined}
              aria-expanded={active === null && !collapsed}
              title="Chat"
              onClick={() => {
                if (active === null) props.toggleSidebar();
                else {
                  props.back();
                  if (collapsed) props.toggleSidebar();
                }
              }}
            >
              <Icon name="chat" />
            </button>
          </div>,
          targets.activity,
        )}
      {targets &&
        createPortal(
          <div className="sp-shell sp-secondary-controls" data-window-drag>
            <button
              type="button"
              className={iconButton}
              aria-label="Toggle secondary sidebar"
              aria-expanded={!collapsed}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={props.toggleSidebar}
            >
              <Icon name="panel" />
            </button>
          </div>,
          targets.header,
        )}
    </>
  );
}
