import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Menu, button } from '../../src/components/primitives.js';
import { FloatingMenu } from '../../src/components/floating-menu.js';
import { ContentBrowser } from '../../src/components/content-browser.js';

function App() {
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [count, setCount] = useState(5);
  const [dark, setDark] = useState(false);
  const [context, setContext] = useState<{ anchor: HTMLElement; x: number; y: number } | null>(null);
  const [real, setReal] = useState(false);
  const [selected, setSelected] = useState('');
  (window as any).__floatingTest = { setPosition, setCount, setDark, setReal, selected };
  const node: any = { id: 'fixture-node', name: 'Fixture Doc', spaceId: 'personal', type: 'resource',
    resource: { id: 'fixture-resource', unitId: 'fixture-unit', kind: 'unit', unitType: 'doc' }, capabilities: { rename: true } };
  const state: any = { status: { state: 'connected' }, spaces: [{ id: 'personal', name: 'Personal', type: 'personal', accessRole: 'owner' }],
    all: [node], recent: [], page: null, location: 'home', discovery: 'Your items', filter: 'all',
    space: '', parent: '', query: '', pins: [], busy: false, selected: [], notice: '' };
  return <>
    <div className="sp-shell" data-testid="host" style={{ position: 'absolute', left: 60, top: 40,
      width: 600, height: 420, overflow: 'auto', '--dsw-alias-bg-base': dark ? '#181a1b' : '#fff',
      '--dsw-alias-label-primary': dark ? '#f1f1f1' : '#0d0d0d' } as React.CSSProperties}>
      {real ? <ContentBrowser v={state} face={{ update: (patch: object) => setSelected(JSON.stringify(patch)), open() {}, action: (...args: any[]) => setSelected(JSON.stringify(args)) } as any} /> :
        <div style={{ height: 1200, position: 'relative' }}>
          <div style={{ position: 'absolute', left: position.x, top: position.y }}>
            <button id="before">Before</button>
            <Menu label="Fixture menu" trigger="Open menu" className="sp-create-menu">
              {Array.from({ length: count }, (_, i) => <button key={i} role="menuitem" className={button + ' tw-w-full'}
                disabled={i === 1} onClick={() => setSelected(`Item ${i}`)}>Item {i}</button>)}
            </Menu>
            <button id="after">After</button>
            <button id="point" onContextMenu={(event) => {
              event.preventDefault(); setContext({ anchor: event.currentTarget, x: event.clientX, y: event.clientY });
            }}>Point menu</button>
          </div>
        </div>}
      {context && <FloatingMenu anchor={context.anchor} point={context} label="Point actions" initialFocus="first"
        onClose={() => setContext(null)}>
        {Array.from({ length: count }, (_, i) => <button key={i} role="menuitem" className={button + ' tw-w-full'}
          disabled={i === 1} onClick={() => setSelected(`Point ${i}`)}>Point {i}</button>)}
      </FloatingMenu>}
    </div>
    <button id="outside" style={{ position: 'absolute', top: 500 }}>Outside host</button>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
