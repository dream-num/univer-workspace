/** Published npm Host build identity; the public release tag has a different SHA.
 * DOM structure is checked independently of CSS artifact hashes. */
export const navigationHost = {
  version: '0.2.2-rc.1',
  commit: 'c59d10a',
} as const;
// The signed macOS rc.5 Desktop Host reports this release in its boot graph.
export const desktopNavigationHost = {
  version: '0.2.2-rc.5',
  commit: '3f85d88',
} as const;

export function identifyNavigationHost(value: unknown) {
  if (!value || typeof value !== 'object') return;
  const graph = value as {
    release?: { version?: unknown; commit?: unknown };
    entries?: { id?: unknown }[];
  };
  if (
    !Array.isArray(graph.entries) ||
    !graph.entries.some(e => e?.id === '@deepseek-ai/dsh-client-ui-sidebar') ||
    !graph.entries.some(e => e?.id === '@deepseek-ai/dsh-client-ui-layout')
  ) return;
  return [navigationHost, desktopNavigationHost].find(
    host => graph.release?.version === host.version && graph.release.commit === host.commit,
  );
}
export function supportsHostNavigation(value: unknown): boolean {
  return identifyNavigationHost(value) !== undefined;
}

function findRc1Sidebar(marker: HTMLElement) {
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
    !root || !nav || !region || !foot || !frame || !sidebarCol || !footerActions ||
    region.tagName !== 'DIV' || !newSession?.matches('button[aria-label]') ||
    !nav.querySelector('button[aria-label]')
  ) return null;
  return { root, nav, region, foot, frame, sidebarCol, footerActions, newSession,
    scrollRegion: null, scrollport: null };
}

function findRc5Sidebar(marker: HTMLElement) {
  // rc.5 puts both nav and workspaces in a shared scrollport. Anchor at the
  // public slots so localized labels and platform-specific CSS hashes can vary.
  const sidebar = marker.closest<HTMLElement>('[data-slot="sidebar"]');
  const root = sidebar?.firstElementChild as HTMLElement | null;
  const nav = root?.querySelector<HTMLElement>(':scope > div > div > nav');
  const scrollport = nav?.parentElement;
  const scrollRegion = scrollport?.parentElement;
  const region = nav?.nextElementSibling as HTMLElement | null;
  const footerActions = marker.closest('[data-slot="sidebar.footer.action"]')?.parentElement;
  const foot = footerActions?.parentElement;
  const sidebarCol = sidebar?.parentElement;
  const frame = sidebarCol?.parentElement;
  const newSession = scrollRegion?.previousElementSibling as HTMLElement | null;
  if (
    !root || !nav || !region || !foot || !frame || !sidebarCol || !footerActions ||
    !scrollport || !scrollRegion || scrollRegion.parentElement !== root || foot.parentElement !== root ||
    !region.querySelector('[data-slot="sidebar.workspaces"]') ||
    !newSession?.querySelector('[data-slot="sidebar.session.action"] button[aria-label]') ||
    !nav.querySelector('button[aria-label] > span[aria-hidden="true"]')
  ) return null;
  return { root, nav, region, foot, frame, sidebarCol, footerActions, newSession, scrollRegion, scrollport };
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
  const host = identifyNavigationHost(options.graph);
  if (!host) return null;
  const sidebar = host === desktopNavigationHost ? findRc5Sidebar(marker) : findRc1Sidebar(marker);
  if (!sidebar) return null;
  const { root, nav, region, foot, frame, sidebarCol, footerActions, newSession, scrollRegion, scrollport } = sidebar;
  if (
    foot.nextElementSibling || !foot.querySelector('button[aria-haspopup="menu"]') ||
    !frame.querySelector(':scope > [data-shell-overlay]') ||
    !/^[0-9.]+px\s+minmax\(/.test(frame.style.gridTemplateColumns)
  ) return null;
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
  attr(root, 'data-space-host-navigation', host.version);
  attr(frame, 'data-space-host-frame', host.version);
  attr(nav, 'aria-label', 'Activity bar');
  attr(region, 'role', 'complementary');
  if (scrollRegion && scrollport) {
    attr(scrollRegion, 'data-space-host-part', 'scrollRegion');
    attr(scrollport, 'data-space-host-part', 'scrollport');
  }
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
    attr(nav, 'data-space-host-part', 'panelList');
    attr(region, 'data-space-host-part', 'regionArea');
    attr(foot, 'data-space-host-part', 'footArea');
    attr(footerActions, 'data-space-host-part', 'footerActions');
    attr(newSession, 'data-space-host-part', 'newSession');
    attr(sidebarCol, 'data-space-host-part', 'sidebarCol');
    for (const row of root.querySelectorAll<HTMLElement>(':scope > [data-window-drag]'))
      attr(row, 'data-space-host-part', row.querySelector('[aria-hidden="true"]') ? 'logoRow' : 'topStrip');
    for (const child of nav.children) {
      if (child === activity) continue;
      if (scrollport) {
        const glyph = child.querySelector<HTMLElement>('button[aria-label] > span[aria-hidden="true"]');
        const row = glyph?.parentElement;
        if (!glyph || !row) continue;
        attr(child as HTMLElement, 'data-space-host-part', 'panelEntry');
        attr(row, 'data-space-host-part', 'panelRow');
        const title = glyph.nextElementSibling;
        attr(glyph, 'data-space-host-part', 'panelGlyph');
        if (title) attr(title as HTMLElement, 'data-space-host-part', 'panelTitle');
        continue;
      }
      if (child.tagName !== 'BUTTON') attr(child as HTMLElement, 'data-space-host-part', 'moreAnchor');
      for (const row of child.tagName === 'BUTTON' ? [child as HTMLElement] : child.querySelectorAll<HTMLElement>('button[aria-label]')) {
        attr(row, 'data-space-host-part', 'panelRow');
        const glyph = row.firstElementChild, title = row.lastElementChild;
        if (glyph) attr(glyph as HTMLElement, 'data-space-host-part', 'panelGlyph');
        if (title && title !== glyph) attr(title as HTMLElement, 'data-space-host-part', 'panelTitle');
      }
    }
    closed = frame.dataset.sidebarCollapsed === 'true';
    attr(root, 'data-space-secondary-collapsed', String(closed));
    attr(
      region,
      'aria-label',
      options.active() === 'space-plugin'
        ? 'Space navigation'
        : 'Chat navigation',
    );
    attr(
      root,
      'data-space-mode',
      options.active() === null
        ? 'chat'
        : options.active() === 'space-plugin'
          ? 'space'
          : 'panel',
    );
    attr(
      frame,
      'data-space-mode',
      options.active() === null
        ? 'chat'
        : options.active() === 'space-plugin'
          ? 'space'
          : 'panel',
    );
    attr(frame, 'data-space-secondary-collapsed', String(closed));
    // Keep Host width preferences intact. Only its rendered closed/irrelevant
    // secondary track becomes zero; a constant outer rail reserves 52px.
    const columns = frame.style.gridTemplateColumns;
    const rendered = columns.replace(/^[0-9.]+px/, '0px');
    if (frame.style.getPropertyValue('--space-closed-columns') !== rendered)
      frame.style.setProperty('--space-closed-columns', rendered);
    // The public layout API exposes toggle, not width. Raise only Space's
    // default 280px track to the reference 288px; keep larger user sizes.
    const openColumns = columns.replace(
      /^[0-9.]+px/,
      (width) => `${Math.max(288, parseFloat(width))}px`,
    );
    if (frame.style.getPropertyValue('--space-open-columns') !== openColumns)
      frame.style.setProperty('--space-open-columns', openColumns);
    const trigger = foot.querySelector<HTMLElement>('button[aria-haspopup="menu"]');
    if (trigger) {
      attr(trigger, 'data-space-system-settings', '');
      attr(trigger, 'title', 'DSH menu');
    }
    for (const button of nav.querySelectorAll<HTMLElement>(
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
        frame.style.setProperty('--space-closed-columns', previousColumns);
      else frame.style.removeProperty('--space-closed-columns');
      if (previousOpenColumns)
        frame.style.setProperty('--space-open-columns', previousOpenColumns);
      else frame.style.removeProperty('--space-open-columns');
      for (const [element, attrs] of previous)
        for (const [name, value] of attrs)
          value === null
            ? element.removeAttribute(name)
            : element.setAttribute(name, value);
    },
  };
}
