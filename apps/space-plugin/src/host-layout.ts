/** Exact official Web release/build tested by this integration. Unknown builds remain native. */
export const navigationHost = {
  version: '0.2.1-rc.3',
  commit: 'be72761',
  // Desktop and npm Web publish distinct CSS artifacts for this same release.
  artifacts: [
    { sidebar: 'kB3qhq', layout: 'PIRFFq' },
    { sidebar: 'hHd-Xa', layout: 'pI_x6G' },
  ],
} as const;
export function supportsHostNavigation(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const graph = value as {
    release?: { version?: unknown; commit?: unknown };
    entries?: { id?: unknown }[];
  };
  return (
    graph.release?.version === navigationHost.version &&
    graph.release.commit === navigationHost.commit &&
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
  const artifact = navigationHost.artifacts.find(({ sidebar, layout }) =>
    marker.closest(`.${sidebar}_root`)?.closest(`.${layout}_frame`),
  );
  if (!artifact) return null;
  const prefix = artifact.sidebar;
  const root = marker.closest<HTMLElement>(`.${prefix}_root`);
  const nav = root?.querySelector<HTMLElement>(
    `:scope > nav.${prefix}_panelList`,
  );
  const region = root?.querySelector<HTMLElement>(
    `:scope > .${prefix}_regionArea`,
  );
  const foot = root?.querySelector<HTMLElement>(`:scope > .${prefix}_footArea`);
  const frame = root?.closest<HTMLElement>(`.${artifact.layout}_frame`);
  if (
    !root ||
    !nav ||
    !region ||
    !foot ||
    !frame ||
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
    // Mark the known artifact once at its boundary; no generated classes leak
    // into navigation CSS. These lookups remain private, version-gated risks.
    const parts = [
      'logoRow',
      'topStrip',
      'panelList',
      'panelRow',
      'panelTitle',
      'panelGlyph',
      'moreAnchor',
      'footArea',
      'footerActions',
      'regionArea',
      'newSession',
    ];
    for (const part of parts)
      for (const element of root!.querySelectorAll<HTMLElement>(
        `.${prefix}_${part}`,
      ))
        attr(element, 'data-space-host-part', part);
    const sidebarCol = frame!.querySelector<HTMLElement>(
      `.${artifact!.layout}_sidebarCol`,
    );
    if (sidebarCol) attr(sidebarCol, 'data-space-host-part', 'sidebarCol');
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
    const trigger = foot!.querySelector<HTMLElement>(
      `.${prefix}_settingsArea button[aria-haspopup="menu"]`,
    );
    if (trigger) {
      attr(trigger, 'data-space-system-settings', '');
      attr(trigger, 'title', 'DSH menu');
    }
    for (const button of nav!.querySelectorAll<HTMLElement>(
      `button.${prefix}_panelRow[aria-label]`,
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
        ? event.target.closest(`button.${prefix}_panelRow`)
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
