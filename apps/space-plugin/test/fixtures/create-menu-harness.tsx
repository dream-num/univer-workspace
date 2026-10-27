import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ContentBrowser } from '../../src/components/content-browser.js';
import { Navigation } from '../../src/components/navigation.js';

// Browser-test carrier for the real components. The HTTP fixture supplies a
// controllable delayed response; it is not a replacement for live Host tests.
const events: Array<Record<string, unknown>> = [];
const record = (event: string, details: object = {}) =>
  events.push({ event, ms: Number(performance.now().toFixed(2)), ...details });
const initial: any = {
  status: { state: 'connected', endpoint: location.origin, user: { id: 'test-user' } },
  spaces: [{ id: 'personal', name: 'Personal', type: 'personal', capabilities: { createAtRoot: true } }],
  all: [], recent: [], recentCursor: null, page: null, location: 'home', trash: [], action: null,
  sharing: null, space: '', parent: '', content: null, context: null, sessionId: null,
  sessionTitle: '', sessions: [], error: '', busy: false, settings: false, ai: false, query: '',
  filter: 'all', discovery: 'Suggested', chatMode: 'compact', pins: [], spaceTab: 'Overview', notice: '',
  hostNavigation: 'active',
};
function App() {
  const [state, setState] = useState(initial);
  const [editor, setEditor] = useState(false);
  const face: any = {
    update: (patch: object) => setState((prev: any) => ({ ...prev, ...patch })),
    store: { getSnapshot: () => state },
    home: () => setEditor(false),
    create: async (input: any) => {
      record('handler.create', { kind: input.kind });
      setState((prev: any) => ({ ...prev, busy: true, error: '' }));
      try {
        const response = await fetch('/fixture/create', {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
        });
        record('response.create', { status: response.status });
        if (!response.ok) {
          setState((prev: any) => ({ ...prev, error: 'Create failed' }));
          return false;
        }
        const result = await response.json();
        record('navigation.updated', { id: result.id });
        setEditor(true);
        return true;
      } finally {
        setState((prev: any) => ({ ...prev, busy: false }));
      }
    },
  };
  (window as any).__menuTest = {
    events,
    setBusy: (busy: boolean) => setState((prev: any) => ({ ...prev, busy })),
    setEditor,
    setAllowed: (allowed: boolean) => setState((prev: any) => ({
      ...prev, spaces: [{ ...prev.spaces[0], capabilities: { createAtRoot: allowed } }],
    })),
  };
  return <div className="sp-shell" style={{ display: 'flex', minHeight: 700 }}>
    <Navigation face={face} v={state} />
    <main style={{ flex: 1 }}>
      {editor ? <div data-testid="editor-fixture">Editor fixture</div> : <ContentBrowser face={face} v={state} />}
    </main>
  </div>;
}
for (const type of ['pointerdown', 'pointerup', 'click', 'focusin', 'focusout']) {
  document.addEventListener(type, (event: any) => {
    const item = event.target?.closest?.('button,summary');
    if (item?.closest('.sp-primary, .sp-nav-create, .sp-create-dialog'))
      record(type, { target: item.textContent?.trim(), disabled: !!item.disabled, open: !!item.closest('details')?.open });
  }, true);
}
new MutationObserver((records) => {
  for (const mutation of records) {
    const target = mutation.target as HTMLElement;
    if (mutation.type === 'attributes' && target.matches('details.sp-menu'))
      record('menu.open', { open: target.hasAttribute('open') });
    if (mutation.type === 'childList') for (const node of mutation.addedNodes)
      if (node instanceof HTMLElement && (node.matches('[role="dialog"]') || node.querySelector('[role="dialog"]')))
        record('dialog.mounted');
  }
}).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['open'] });
createRoot(document.getElementById('root')!).render(<App />);
