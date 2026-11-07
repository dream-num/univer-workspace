import React, { useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { autoUpdate, computePosition, flip, hide, offset, shift, size } from '@floating-ui/dom';

export function focusMenuItem(menu: HTMLElement | null, key: string) {
  const items = Array.from(menu?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  const current = items.indexOf(menu?.ownerDocument.activeElement as HTMLButtonElement);
  const index = key === 'Home' ? 0 : key === 'End' ? items.length - 1 :
    current < 0 ? (key === 'ArrowDown' ? 0 : items.length - 1) :
      (current + (key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[index]?.focus();
}

/** One positioning lifecycle for Space-owned dropdowns and point menus.
 * File Tree and native/Univer menus retain their own positioning contracts.
 */
export function FloatingMenu({ anchor, point, label, align = 'right', className = '', children,
  initialFocus, menuRef, onClose,
}: {
  anchor: HTMLElement;
  point?: { x: number; y: number };
  label: string;
  align?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
  initialFocus?: 'first' | 'last';
  menuRef?: React.RefObject<HTMLDivElement>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [portal] = React.useState(() => anchor.ownerDocument.createElement('div'));
  // Keep the Tailwind scope and menu-specific selector context. CSS neutralizes
  // the shell layout on this portal; no native Conversation nodes enter it.
  portal.className = `sp-shell sp-menu-portal ${className}`;
  useLayoutEffect(() => {
    const doc = anchor.ownerDocument, win = doc.defaultView!;
    const menu = ref.current!;
    const host = anchor.closest<HTMLElement>('.sp-shell') ?? doc.documentElement;
    doc.body.append(portal);
    let active = true, sequence = 0;
    let focused = false;
    // A point remains relative to its original row when the content scrolls.
    const origin = anchor.getBoundingClientRect();
    const reference = point ? {
      contextElement: anchor,
      getBoundingClientRect: () => {
        const rect = anchor.getBoundingClientRect();
        return new DOMRect(point.x + rect.x - origin.x, point.y + rect.y - origin.y, 0, 0);
      },
    } : anchor;
    const update = async () => {
      const run = ++sequence;
      if (!active) return;
      if (!anchor.isConnected) { closeRef.current(); return; }
      const theme = win.getComputedStyle(anchor);
      for (const name of Array.from(theme)) {
        if (name.startsWith('--sp-') || name.startsWith('--dsw-'))
          portal.style.setProperty(name, theme.getPropertyValue(name));
      }
      portal.style.font = theme.font;
      portal.style.colorScheme = theme.colorScheme;
      portal.style.direction = theme.direction;
      const options = { boundary: host, rootBoundary: 'viewport' as const, padding: 8 };
      const result = await computePosition(reference, menu, {
        strategy: 'fixed', placement: align === 'left' || point ? 'bottom-start' : 'bottom-end',
        middleware: [offset(point ? 0 : 4), flip(options), shift({ ...options, crossAxis: true }),
          size({ ...options, apply({ availableWidth, availableHeight }) {
            if (!active || run !== sequence) return;
            menu.style.maxWidth = `${Math.max(0, availableWidth)}px`;
            menu.style.maxHeight = `${Math.max(0, availableHeight)}px`;
          } }),
          // Placement may escape nested scroll boxes, but the reference must
          // remain visible through its own clipping ancestors (e.g. Navigation).
          hide({ boundary: 'clippingAncestors' }),
        ],
      });
      if (!active || run !== sequence) return;
      if (result.middlewareData.hide?.referenceHidden) { closeRef.current(); return; }
      Object.assign(menu.style, { left: `${result.x}px`, top: `${result.y}px`, visibility: 'visible' });
      menu.dataset.placement = result.placement;
      if (!focused && initialFocus) {
        focused = true;
        focusMenuItem(menu, initialFocus === 'last' ? 'End' : 'Home');
      }
    };
    const cleanup = autoUpdate(reference, menu, update, { animationFrame: true });
    const hostResize = new ResizeObserver(update);
    hostResize.observe(host);
    // Resolve local theme switches even when they do not change geometry.
    const themeChanges = new MutationObserver(update);
    for (let parent: HTMLElement | null = anchor; parent; parent = parent.parentElement)
      themeChanges.observe(parent, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node) && !anchor.contains(event.target as Node)) closeRef.current();
    };
    const blur = () => { if (doc.activeElement?.tagName === 'IFRAME') closeRef.current(); };
    doc.addEventListener('pointerdown', outside);
    win.addEventListener('blur', blur);
    win.visualViewport?.addEventListener('resize', update);
    win.visualViewport?.addEventListener('scroll', update);
    return () => {
      active = false;
      cleanup(); hostResize.disconnect(); themeChanges.disconnect();
      doc.removeEventListener('pointerdown', outside);
      win.removeEventListener('blur', blur);
      win.visualViewport?.removeEventListener('resize', update);
      win.visualViewport?.removeEventListener('scroll', update);
      portal.remove();
    };
  }, [anchor, point?.x, point?.y, align, portal, initialFocus]);
  return createPortal(<div ref={(element) => {
    ref.current = element;
    if (menuRef) (menuRef as React.MutableRefObject<HTMLDivElement | null>).current = element;
  }} role="menu" aria-label={label} className={'sp-menu-body sp-floating-menu' + (point ? ' sp-context-menu' : '')}
    style={{ position: 'fixed', left: 0, top: 0, visibility: 'hidden' }}
    onClick={(event) => {
      if ((event.target as HTMLElement).closest('button:not(:disabled)')) closeRef.current();
    }}
    onKeyDown={(event) => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation(); focusMenuItem(ref.current, event.key);
      } else if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); closeRef.current(); anchor.focus();
      } else if (event.key === 'Tab') {
        // The portal sits at the end of body. Resume tab order at the trigger,
        // rather than making native Conversation controls the menu's next item.
        event.preventDefault(); event.stopPropagation();
        const items = Array.from(anchor.ownerDocument.querySelectorAll<HTMLElement>(
          'button, a[href], input, select, textarea, summary, [tabindex]',
        )).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') &&
          element.getClientRects().length > 0 && !portal.contains(element) && !element.closest('[inert]'));
        const index = items.indexOf(anchor);
        closeRef.current();
        (items[index + (event.shiftKey ? -1 : 1)] ?? anchor).focus();
      }
    }}>{children}</div>, portal);
}
