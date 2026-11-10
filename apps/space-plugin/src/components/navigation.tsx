import React, { useEffect, useSyncExternalStore } from 'react';
import type { Face } from '../client.js';
import { contentKinds, nodeKind, type Node, type State } from '../model.js';
import { CreateMenu, Icon, Menu, button, iconButton } from './primitives.js';
import { FileActions } from './file-actions.js';

/** Only the public sidebar.workspaces region changes; DSH owns its column and controls. */
export function HostNavigation(props: Face & { wide: boolean; expandSidebar(): void }) {
  const v = useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
  return (
    <div className="sp-shell sp-host-navigation" data-space-sidebar data-wide={props.wide}>
      <Navigation face={props} v={v} />
    </div>
  );
}
export function Navigation({ face, v }: { face: Face; v: State }) {
  const row = button + ' sp-nav-row';
  const selected = v.opening?.nodeId ?? v.content?.nodeId;
  const navigation = v.navigation;
  const setNavigation = (patch: Partial<State['navigation']>) =>
    face.update({ navigation: { ...face.store.getSnapshot().navigation, ...patch } });
  // Reveal the actual Page ancestry on selection, including opens from Recents.
  // A later explicit collapse is allowed while the same file remains selected.
  useEffect(() => {
    const ancestors: string[] = [];
    let current = v.all.find(node => node.id === selected);
    const seen = new Set<string>();
    while (current?.parentNodeId && !seen.has(current.id)) {
      seen.add(current.id);
      current = v.all.find(node => node.id === current!.parentNodeId);
      if (current && nodeKind(current) === 'site') ancestors.push(current.id);
    }
    const state = face.store.getSnapshot();
    const missing = ancestors.filter(id => !state.navigation.expandedPages.includes(id));
    const pinnedAncestor = ancestors.some(id => state.pins.includes(id));
    if (missing.length || (pinnedAncestor && !state.navigation.pinned))
      setNavigation({
        expandedPages: [...state.navigation.expandedPages, ...missing],
        ...(pinnedAncestor ? { pinned: true } : {}),
      });
  }, [selected, v.all]);
  const togglePage = (id: string) => {
    const expanded = face.store.getSnapshot().navigation.expandedPages;
    setNavigation({ expandedPages: expanded.includes(id) ? expanded.filter(key => key !== id) : [...expanded, id] });
  };
  const file = (node: Node, pinned: boolean, depth = 0, path: string[] = [], tree = pinned): React.ReactNode => {
    if (path.includes(node.id)) return null;
    const page = nodeKind(node) === 'site';
    const children = page && tree ? v.all.filter(child => child.parentNodeId === node.id && nodeKind(child) === 'site') : [];
    const expanded = navigation.expandedPages.includes(node.id);
    return (
      <React.Fragment key={node.id}>
        <div className={'sp-nav-file' + (selected === node.id ? ' sp-selected' : '')} style={{ '--sp-nav-depth': depth } as React.CSSProperties}>
          <button
            className={row + ' sp-nav-file-open'}
            title={node.name}
            aria-current={selected === node.id ? 'page' : undefined}
            onClick={() => node.resource ? face.open(node.id) : face.directory(node.spaceId ?? v.space, node.id)}
          >
            <span className="sp-nav-file-icon"><Icon name={page ? 'page' : nodeKind(node)} /></span>
            <span className="sp-nav-file-name">{node.name}</span>
          </button>
          {children.length > 0 && (
            <button
              className={button + ' sp-nav-page-toggle'}
              aria-label={`${expanded ? 'Collapse' : 'Expand'} pages inside ${node.name}`}
              aria-expanded={expanded}
              onClick={() => togglePage(node.id)}
            ><Icon name={expanded ? 'down' : 'chevron'} size={18} /></button>
          )}
          <div className="sp-nav-file-actions">
            {pinned && <button className={iconButton} aria-label={`Unpin ${node.name}`} title="Unpin" onClick={() => face.pin(node.id)}><Icon name="pin" size={14} /></button>}
            <Menu label={`Actions for ${node.name}`} trigger={<Icon name="more" size={14} />}>
              <FileActions face={face} v={v} node={node} />
            </Menu>
            {!pinned && page && <CreateMenu face={face} v={v} target={{ kind: 'site', parent: node }} />}
          </div>
        </div>
        {expanded && children.map(child => file(child, false, depth + 1, [...path, node.id], true))}
      </React.Fragment>
    );
  };
  const group = (key: 'pinned' | 'recent' | 'spaces', label: string, children: React.ReactNode, action?: React.ReactNode) => (
    <section className="sp-nav-group" aria-label={label}>
      <div className="sp-nav-group-heading">
        <button className={button + ' sp-nav-group-toggle'} aria-expanded={navigation[key]} onClick={() => setNavigation({ [key]: !navigation[key] })}>
          {label}<Icon name={navigation[key] ? 'down' : 'chevron'} size={12} />
        </button>
        {action && <span className="sp-nav-group-action">{action}</span>}
      </div>
      {navigation[key] && children}
    </section>
  );
  const pins = v.pins.map(id => v.all.find(node => node.id === id)).filter((node): node is Node => !!node);
  return (
    <nav aria-label="Space content navigation" className="sp-navigation">
      <div className="sp-nav-heading">
        <strong>Space</strong>
        <button className={iconButton} aria-label="Search content" title="Search" onClick={() => {
          face.home();
          requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.sp-browser .sp-search input')?.focus());
        }}><Icon name="search" size={20} /></button>
      </div>
      <div className="sp-nav-create"><CreateMenu face={face} v={v} sidebar /></div>
      <div className="sp-nav-scroll">
        <div className="sp-nav-types">
          {([['all', 'All'], ...contentKinds] as const).map(([filter, label]) => (
            <button key={filter} className={row + (v.location === 'home' && v.filter === filter && !v.content && !v.opening ? ' sp-selected' : '')}
              aria-current={v.location === 'home' && v.filter === filter && !v.content && !v.opening ? 'page' : undefined}
              onClick={() => face.home('home', filter)}><Icon name={filter === 'site' ? 'page' : filter} size={20} />{label}</button>
          ))}
        </div>
        {pins.length > 0 && group('pinned', 'Pinned', pins.map(node => file(node, true)))}
        {group('recent', 'Recents', <>
          {v.recent.slice(0, navigation.recentLimit).map(item => file({
            ...item.node,
            spaceId: item.location.space.id,
            resource: { ...item.resource, htmlView: v.all.find(node => node.id === item.node.id)?.resource?.htmlView },
          }, false))}
          {(v.recent.length > navigation.recentLimit || v.recentCursor) && <button className={button + ' sp-nav-show-more'} onClick={() => {
            setNavigation({ recentLimit: navigation.recentLimit + 5 });
            if (v.recent.length < navigation.recentLimit + 5 && v.recentCursor) face.moreRecent();
          }}>Show more</button>}
        </>)}
        {group('spaces', 'Spaces', v.spaces.map(space => (
          <button key={space.id} className={row + (v.space === space.id && v.location === 'space' && !v.content && !v.opening ? ' sp-selected' : '')}
            aria-current={v.space === space.id && v.location === 'space' && !v.content && !v.opening ? 'page' : undefined}
            onClick={() => face.directory(space.id)}><Icon name="workspace" size={20} /><span className="tw-truncate">{space.name}</span></button>
        )), <CreateMenu face={face} v={v} target={{ kind: 'space' }} />)}
      </div>
      <button className={row + ' sp-nav-trash' + (v.location === 'trash' ? ' sp-selected' : '')} aria-current={v.location === 'trash' ? 'page' : undefined} onClick={() => face.showTrash()}><Icon name="trash" size={20} />Trash</button>
    </nav>
  );
}
