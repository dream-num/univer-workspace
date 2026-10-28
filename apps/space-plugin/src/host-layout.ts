/** Exact official release identity; the DOM is checked independently of CSS artifact hashes. */
export const navigationHost = {
  version: '0.2.1-rc.3',
  commit: 'be72761',
  fullCommit: 'be72761ee1a6736ebcdf4f3739363b083ae53c98',
} as const;
export function supportsHostNavigation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const graph = value as {
    release?: { version?: unknown; commit?: unknown };
    entries?: { id?: unknown }[];
  };
  return (
    graph.release?.version === navigationHost.version &&
    (graph.release.commit === navigationHost.commit || graph.release.commit === navigationHost.fullCommit) &&
    Array.isArray(graph.entries) &&
    graph.entries.some(
      (e) => e && e.id === '@deepseek-ai/dsh-client-ui-sidebar',
    ) &&
    graph.entries.some((e) => e && e.id === '@deepseek-ai/dsh-client-ui-layout')
  );
}
export function installHostNavigation(
  marker: HTMLElement,
  options: {
    graph: unknown;
    active(): string | null;
    toggle(): void;
    collapsed(value: boolean): void;
  },
) {
  if (!supportsHostNavigation(options.graph)) return null;
  // The public sidebar.footer.action Slot is our anchor. In this release the
  // sidebar owns a direct nav, followed by the workspace region and footer.
  // Desktop platform builds can change every CSS-module hash at the same commit.
  let root: HTMLElement | null = marker.parentElement;
  while (root && !root.querySelector(':scope > nav')) root = root.parentElement;
  const nav = root?.querySelector<HTMLElement>(':scope > nav');
  const region = nav?.nextElementSibling as HTMLElement | null;
  const foot = region?.nextElementSibling as HTMLElement | null;
  let sidebarCol: HTMLElement | null = root ?? null;
  let frame = root?.parentElement;
  while (frame && !frame.querySelector(':scope > [data-shell-overlay]')) {
    sidebarCol = frame;
    frame = frame.parentElement;
  }
  const footerActions = foot && [...foot.children].find(child => child.contains(marker)) as HTMLElement | undefined;
  const newSession = nav?.previousElementSibling as HTMLElement | null;
  if (
    !root ||
    !nav ||
    !region ||
    !foot ||
    !frame ||
    !foot.contains(marker) ||
    !footerActions ||
    region.tagName !== 'DIV' ||
    !newSession?.matches('button[aria-label]') ||
    !nav.querySelector('button[aria-label]') ||
    !foot.querySelector('button[aria-haspopup="menu"]') ||
    foot.nextElementSibling !== null ||
    !frame.querySelector(':scope > [data-shell-overlay]') ||
    !/^[0-9.]+px\s+minmax\(/.test(frame.style.gridTemplateColumns)
  )
    return null;
  const previous = new Map<HTMLElement, Map<string, string | null>>();
  const previousColumns = frame.style.getPropertyValue(
    '--space-closed-columns',
  );
  const previousOpenColumns = frame.style.getPropertyValue(
    '--space-open-columns',
  );
  function attr(element: HTMLElement, name: string, value: string) {
    let saved = previous.get(element);
    if (!saved) {
      saved = new Map();
      previous.set(element, saved);
    }
    if (!saved.has(name)) saved.set(name, element.getAttribute(name));
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
  }
  attr(root, 'data-space-host-navigation', navigationHost.version);
  attr(frame, 'data-space-host-frame', navigationHost.version);
  attr(nav, 'aria-label', 'Activity bar');
  attr(region, 'role', 'complementary');
  const activity = document.createElement('div'),
    header = document.createElement('div');
  activity.dataset.spaceActivityMount = '';
  header.dataset.spaceToggleMount = '';
  nav.prepend(activity);
  root.prepend(header);
  let closed = false,
    disposed = false;
  function sync() {
    // Owned markers isolate styles; native handlers and DOM order stay intact.
    attr(nav!, 'data-space-host-part', 'panelList');
    attr(region!, 'data-space-host-part', 'regionArea');
    attr(foot!, 'data-space-host-part', 'footArea');
    attr(footerActions!, 'data-space-host-part', 'footerActions');
    attr(newSession!, 'data-space-host-part', 'newSession');
    attr(sidebarCol!, 'data-space-host-part', 'sidebarCol');
    for (const row of root!.querySelectorAll<HTMLElement>(':scope > [data-window-drag]'))
      attr(row, 'data-space-host-part', row.querySelector('[aria-hidden="true"]') ? 'logoRow' : 'topStrip');
    for (const child of nav!.children) {
      if (child === activity) continue;
      if (child.tagName !== 'BUTTON') attr(child as HTMLElement, 'data-space-host-part', 'moreAnchor');
      for (const row of child.tagName === 'BUTTON' ? [child as HTMLElement] : child.querySelectorAll<HTMLElement>('button[aria-label]')) {
        attr(row, 'data-space-host-part', 'panelRow');
        const glyph = row.firstElementChild, title = row.lastElementChild;
        if (glyph) attr(glyph as HTMLElement, 'data-space-host-part', 'panelGlyph');
        if (title && title !== glyph) attr(title as HTMLElement, 'data-space-host-part', 'panelTitle');
      }
    }
    closed = frame!.dataset.sidebarCollapsed === 'true';
    attr(root!, 'data-space-secondary-collapsed', String(closed));
    attr(
      region!,
      'aria-label',
      options.active() === 'space-plugin'
        ? 'Space navigation'
        : 'Chat navigation',
    );
    attr(
      root!,
      'data-space-mode',
      options.active() === null
        ? 'chat'
        : options.active() === 'space-plugin'
          ? 'space'
          : 'panel',
    );
    attr(
      frame!,
      'data-space-mode',
      options.active() === null
        ? 'chat'
        : options.active() === 'space-plugin'
          ? 'space'
          : 'panel',
    );
    attr(frame!, 'data-space-secondary-collapsed', String(closed));
    // Keep Host width preferences intact. Only its rendered closed/irrelevant
    // secondary track becomes zero; a constant outer rail reserves 52px.
    const columns = frame!.style.gridTemplateColumns;
    const rendered = columns.replace(/^[0-9.]+px/, '0px');
    if (frame!.style.getPropertyValue('--space-closed-columns') !== rendered)
      frame!.style.setProperty('--space-closed-columns', rendered);
    // The public layout API exposes toggle, not width. Raise only Space's
    // default 280px track to the reference 288px; keep larger user sizes.
    const openColumns = columns.replace(
      /^[0-9.]+px/,
      (width) => `${Math.max(288, parseFloat(width))}px`,
    );
    if (frame!.style.getPropertyValue('--space-open-columns') !== openColumns)
      frame!.style.setProperty('--space-open-columns', openColumns);
    const trigger = foot!.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    if (trigger) {
      attr(trigger, 'data-space-system-settings', '');
      attr(trigger, 'title', 'DSH menu');
    }
    for (const button of nav!.querySelectorAll<HTMLElement>(
      'button[data-space-host-part="panelRow"][aria-label]',
    ))
      attr(button, 'title', button.getAttribute('aria-label')!);
    options.collapsed(closed);
  }
  const observer = new MutationObserver(sync);
  observer.observe(frame, {
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed', 'style'],
  });
  // Augment the actual user click on our public Space launcher. Its native
  // handler still selects the panel; no click is synthesized or intercepted.
  const onClick = (event: MouseEvent) => {
    const button =
      event.target instanceof Element
        ? event.target.closest('button[data-space-host-part="panelRow"]')
        : null;
    if (
      button?.getAttribute('aria-label') === 'Space' &&
      (closed || options.active() === 'space-plugin')
    ) {
      const before = closed;
      queueMicrotask(() => {
        if (!disposed && closed === before) options.toggle();
      });
    }
  };
  const navObserver = new MutationObserver(sync);
  navObserver.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['aria-label'],
  });
  nav.addEventListener('click', onClick);
  sync();
  return {
    activity,
    header,
    sync,
    dispose() {
      disposed = true;
      observer.disconnect();
      navObserver.disconnect();
      nav.removeEventListener('click', onClick);
      activity.remove();
      header.remove();
      if (previousColumns)
        frame!.style.setProperty('--space-closed-columns', previousColumns);
      else frame!.style.removeProperty('--space-closed-columns');
      if (previousOpenColumns)
        frame!.style.setProperty('--space-open-columns', previousOpenColumns);
      else frame!.style.removeProperty('--space-open-columns');
      for (const [element, attrs] of previous)
        for (const [name, value] of attrs)
          value === null
            ? element.removeAttribute(name)
            : element.setAttribute(name, value);
    },
  };
}
