import React, { useEffect, useRef, useState } from 'react';
import type { Face } from '../client.js';
import {
  contentKinds,
  kindName,
  nodeKind,
  type State,
  type Node,
} from '../model.js';
import {
  CreateMenu,
  Icon,
  Menu,
  button,
  iconButton,
  Empty,
} from './primitives.js';
import { FileActions } from './file-actions.js';
export function ContentBrowser({ face, v }: { face: Face; v: State }) {
  const [context, setContext] = useState<{
    node: Node;
    x: number;
    y: number;
  } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!context) return;
    contextRef.current
      ?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      ?.focus();
    const close = (event: PointerEvent) => {
      if (!contextRef.current?.contains(event.target as globalThis.Node))
        setContext(null);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [context]);
  const [selected, setSelected] = useState<string[]>([]),
    [grid, setGrid] = useState(false),
    [kind, setKind] = useState('all'),
    [sort, setSort] = useState<'activity' | 'name'>('activity'),
    [descending, setDescending] = useState(true);
  const folder = v.location === 'folder',
    space = v.location === 'space';
  const title = folder
    ? (v.page?.parentNode?.name ?? 'Folder')
    : space
      ? (v.page?.space?.name ??
        v.spaces.find((s) => s.id === v.space)?.name ??
        'Space')
      : v.location === 'recent'
        ? 'Recents'
        : (contentKinds.find(([key]) => key === v.filter)?.[1] ?? 'All');
  const source =
    folder || space
      ? (v.page?.nodes ?? [])
      : v.location === 'recent'
        ? v.recent.map((item) => ({
            ...item.node,
            resource: {
              ...item.resource,
              htmlView: v.all.find((node) => node.id === item.node.id)?.resource
                ?.htmlView,
            },
            spaceId: item.location.space.id,
          }))
        : v.all;
  const items = source.filter(
    (node) =>
      (v.location !== 'home' ||
        v.discovery !== 'Your items' ||
        v.spaces.some((s) => s.id === node.spaceId && s.accessRole === 'owner')) &&
      (v.discovery !== 'Shared with you' ||
        v.location !== 'home' ||
        v.sharedNodeIds?.includes(node.id)) &&
      (v.location !== 'home' || v.discovery !== 'Favorites') &&
      node.name.toLowerCase().includes(v.query.toLowerCase()) &&
      (v.filter === 'all' || nodeKind(node) === v.filter) &&
      (kind === 'all' || nodeKind(node) === kind),
  ).sort((a, b) => {
    const activity = (node: Node) => v.location === 'recent'
      ? v.recent.find((item) => item.node.id === node.id)?.lastOpenedAt ?? ''
      : node.updatedAt ?? '';
    const order = sort === 'name' ? a.name.localeCompare(b.name) : activity(a).localeCompare(activity(b));
    return (descending ? -order : order) || a.id.localeCompare(b.id);
  });
  const suggested = v.location === 'home' && v.filter === 'all' &&
    v.discovery === 'Suggested' && !v.query.trim();
  const showSource = v.location === 'home' && v.discovery === 'Suggested';
  useEffect(() => { setSelected([]); }, [v.discovery, v.filter, v.query]);
  const sortBy = (value: 'activity' | 'name') => {
    setSort(value);
    setDescending(sort === value ? !descending : value === 'activity');
  };
  const go = (node: Node) =>
    node.resource
      ? face.open(node.id)
      : face.directory(node.spaceId ?? v.space, node.id);
  const toggle = (id: string) =>
    setSelected((s) =>
      s.includes(id) ? s.filter((n) => n !== id) : [...s, id],
    );
  return (
    <div className="sp-browser">
      {space && (
        <div className="sp-space-top">
          <Menu
            label="Space menu"
            align="left"
            trigger={
              <>
                <Icon name="all" />
                {title}
                <Icon name="down" size={12} />
              </>
            }
          >
            <button
              role="menuitem"
              className={button + ' tw-w-full'}
              disabled={
                !v.spaces.find((s) => s.id === v.space)?.capabilities
                  ?.renameSpace
              }
              onClick={() =>
                face.update({
                  action: {
                    kind: 'rename-space',
                    space: v.spaces.find((s) => s.id === v.space),
                  },
                  error: '',
                })
              }
            >
              Rename
            </button>
          </Menu>
          <button
            className={button}
            onClick={() =>
              face.update({
                sharing: { kind: 'space', id: v.space, name: title },
              })
            }
          >
            <Icon name="share" />
            Share Space
          </button>
        </div>
      )}
      <div className={'sp-library' + (space ? ' sp-space-library' : '')}>
        <header className="sp-library-heading">
          <h1>
            {folder && (
              <>
                <button className={button} onClick={() => face.home()}>
                  All
                </button>
                <Icon name="chevron" />
                <button
                  className={button}
                  onClick={() => face.directory(v.space)}
                >
                  {v.spaces.find((item) => item.id === v.space)?.name ??
                    v.page?.space?.name ??
                    'Space'}
                </button>
                <Icon name="chevron" />
                {v.page?.breadcrumbs?.slice(0, -1).map((crumb) => (
                  <React.Fragment key={crumb.id}>
                    <button
                      className={button}
                      onClick={() => face.directory(v.space, crumb.id)}
                    >
                      {crumb.name}
                    </button>
                    <Icon name="chevron" />
                  </React.Fragment>
                ))}
              </>
            )}
            {title}
          </h1>
          <div className="sp-heading-actions">
            <label className="sp-search">
              <Icon name="search" size={16} />
              <input
                aria-label="Search loaded content"
                placeholder="Search"
                value={v.query}
                onChange={(e) => {
                  face.update({ query: e.target.value });
                  setSelected([]);
                }}
              />
              {v.query && (
                <button
                  className={iconButton}
                  aria-label="Clear search"
                  onClick={() => {
                    face.update({ query: '' });
                    setSelected([]);
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              )}
            </label>
            <div className="sp-primary">
              <CreateMenu face={face} v={v} />
            </div>
          </div>
        </header>
        <div className="sp-library-toolbar">
          <div
            className="sp-tabs"
            role="tablist"
            aria-label={space ? 'Space views' : 'Content views'}
          >
            {(space
              ? ['Overview', 'Content']
              : folder || v.location === 'recent'
                ? []
                : v.filter !== 'all'
                  ? ['All', 'Your items', 'Shared with you']
                  : ['Suggested', 'Favorites', 'Your items', 'Shared with you']
            ).map((tab) => (
              <button
                role="tab"
                aria-selected={
                  (space ? v.spaceTab : v.discovery) === tab ||
                  (v.filter !== 'all' &&
                    tab === 'All' &&
                    v.discovery === 'Suggested')
                }
                key={tab}
                className={
                  button +
                  ((space ? v.spaceTab : v.discovery) === tab ||
                  (v.filter !== 'all' &&
                    tab === 'All' &&
                    v.discovery === 'Suggested')
                    ? ' sp-selected'
                    : '')
                }
                onClick={() => {
                  space
                    ? face.update({ spaceTab: tab as 'Overview' | 'Content' })
                    : face.update({ discovery: tab });
                  setSelected([]);
                }}
              >
                {tab === 'Suggested' && v.query ? 'All results' : tab}
              </button>
            ))}
          </div>
          {(!space || v.spaceTab === 'Content') && (
            <div className="sp-view-actions">
              <Menu
                label="Open filters"
                trigger={<Icon name="filter" size={16} />}
              >
                <span className="tw-block tw-p-3 tw-text-xs tw-text-muted">
                  File type
                </span>
                {[
                  ['all', 'All types'],
                  ...contentKinds,
                  ['folder', 'Folders'],
                ].map(([value, label]) => (
                  <button
                    role="menuitemradio"
                    aria-checked={kind === value}
                    className={button + ' tw-w-full'}
                    key={value}
                    onClick={() => {
                      setKind(value);
                      setSelected([]);
                    }}
                  >
                    <Icon name={value} />
                    {label}
                    {kind === value && <Icon name="check" size={14} />}
                  </button>
                ))}
              </Menu>
              <button
                className={iconButton + (grid ? ' sp-selected' : '')}
                aria-label="Grid view"
                aria-pressed={grid}
                onClick={() => setGrid(true)}
              >
                <Icon name="grid" size={16} />
              </button>
              <button
                className={iconButton + (!grid ? ' sp-selected' : '')}
                aria-label="List view"
                aria-pressed={!grid}
                onClick={() => setGrid(false)}
              >
                <Icon name="list" size={16} />
              </button>
            </div>
          )}
        </div>
        {space && v.spaceTab === 'Overview' ? (
          <section className="sp-about">
            <h2>About {title}</h2>
            <p>
              This Space contains {v.page?.nodes.length ?? 0} items you can
              access.
            </p>
            <button
              className={button + ' tw-bg-hover'}
              onClick={() => face.update({ spaceTab: 'Content' })}
            >
              Browse content <Icon name="chevron" size={14} />
            </button>
          </section>
        ) : (
          <>
            {suggested && (
              <section className="sp-home-create" aria-label="Create together in Space">
                <div className="sp-home-section-heading"><h2>Create together in Space</h2><CreateMenu face={face} v={v} shortcut={{ kind: 'templates', className: button + ' sp-browse-templates', children: <>Browse templates<Icon name="chevron" size={14} /></> }} /></div>
                <p>Start with a blank file and work with your team.</p>
                <div className="sp-starter-strip">
                  {(['doc', 'sheet', 'site', 'slide'] as const).map((type) => (
                    <CreateMenu key={type} face={face} v={v} shortcut={{
                      kind: type, className: 'sp-starter-card', children: <>
                        <span className={'sp-starter-preview sp-starter-' + type} aria-hidden="true">
                          <span className="sp-starter-paper"><Icon name={type} size={24} /><span /><span /><span /></span>
                        </span>
                        <strong>Blank {type === 'site' ? 'page' : type === 'doc' ? 'document' : type === 'sheet' ? 'spreadsheet' : 'presentation'}</strong>
                        <span>{kindName(type)}</span>
                      </>,
                    }} />
                  ))}
                </div>
              </section>
            )}
            {suggested &&
              v.pins.length > 0 && (
                <section aria-label="Pinned pages" className="sp-pinned-section">
                  <h2>Pinned</h2>
                  <div className="sp-pins">
                  {v.all
                    .filter((n) => v.pins.includes(n.id))
                    .map((node) => (
                      <button
                        className="sp-preview"
                        key={node.id}
                        onClick={() => go(node)}
                      >
                        <span className="tw-flex tw-items-center tw-gap-2">
                          <Icon name={nodeKind(node)} size={16} />
                          <strong className="tw-truncate tw-font-medium">
                            {node.name}
                          </strong>
                          <Icon name="pin" size={13} />
                        </span>
                        <span className="tw-text-xs tw-text-muted">
                          {v.spaces.find((s) => s.id === node.spaceId)?.name ??
                            'Space'}
                        </span>
                        <span className="tw-mt-auto tw-text-xs tw-text-muted">
                          Open {kindName(nodeKind(node))}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
            {items.length > 0 && (
              <div
                className={'sp-file-table' + (grid ? ' sp-file-grid' : '')}
                role="table"
                aria-label="Content"
              >
                <div className="sp-file-columns" role="row">
                  <span className="tw-flex tw-items-center tw-gap-3" role="columnheader" aria-sort={sort === 'name' ? descending ? 'descending' : 'ascending' : 'none'}>
                    <input
                      type="checkbox"
                      aria-label="Select all loaded rows"
                      checked={items.every((n) => selected.includes(n.id))}
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            items.some((n) => selected.includes(n.id)) &&
                            !items.every((n) => selected.includes(n.id));
                      }}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked ? items.map((n) => n.id) : [],
                        )
                      }
                    />
                    <button className={button + ' sp-sort'} onClick={() => sortBy('name')}>Name{sort === 'name' && <Icon name={descending ? 'down' : 'up'} size={12} />}</button>
                  </span>
                  {showSource && (
                    <span className="sp-source" role="columnheader">Source</span>
                  )}
                  <span className="sp-activity" role="columnheader" aria-sort={sort === 'activity' ? descending ? 'descending' : 'ascending' : 'none'}><button className={button + ' sp-sort'} onClick={() => sortBy('activity')}>Last activity{sort === 'activity' && <Icon name={descending ? 'down' : 'up'} size={12} />}</button></span>
                  <span />
                </div>
                {items.map((node) => (
                  <div
                    key={node.id}
                    role="row"
                    className={
                      'sp-file-row' +
                      (selected.includes(node.id) ? ' sp-selected' : '')
                    }
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setContext({
                        node,
                        x: Math.min(event.clientX, window.innerWidth - 240),
                        y: Math.min(event.clientY, window.innerHeight - 310),
                      });
                    }}
                  >
                    <span className="sp-file-name">
                      <input
                        type="checkbox"
                        aria-label={'Select ' + node.name}
                        checked={selected.includes(node.id)}
                        onChange={() => toggle(node.id)}
                      />
                      <button
                        className={button + ' sp-file-open'}
                        onClick={() => go(node)}
                      >
                        <span className="sp-content-glyph" data-kind={nodeKind(node)}><Icon name={nodeKind(node)} size={18} /></span>
                        <span className="tw-truncate">{node.name}</span>
                        <span className="sp-file-kind" title={kindName(nodeKind(node))}>
                          {contentKinds.find(
                            ([key]) => key === nodeKind(node),
                          )?.[1] ??
                            (nodeKind(node) === 'file'
                              ? 'File · Preview unavailable'
                              : kindName(nodeKind(node)))}
                        </span>
                      </button>
                    </span>
                    {showSource && (
                      <span className="sp-source">
                        <button className={button + ' sp-source-link'} onClick={() => face.directory(node.spaceId ?? v.space)}>{v.spaces.find((s) => s.id === node.spaceId)?.name ?? 'Shared'}</button>
                      </span>
                    )}
                    <span className="sp-activity">
                      {node.updatedAt
                        ? new Date(node.updatedAt).toLocaleDateString('en', {
                            month: 'short',
                            day: 'numeric',
                          })
                        : '—'}
                    </span>
                    <Menu
                      label={'Actions for ' + node.name}
                      trigger={<Icon name="more" size={17} />}
                    >
                      <FileActions face={face} v={v} node={node} />
                    </Menu>
                  </div>
                ))}
              </div>
            )}
            {!items.length && (
              <Empty
                title={
                  v.busy
                    ? 'Loading content…'
                    : v.discovery === 'Favorites' && v.location === 'home'
                      ? 'Favorites aren’t available yet'
                      : !v.query && v.location === 'home' && v.discovery === 'Shared with you'
                        ? 'Nothing shared with you yet'
                    : folder
                      ? 'This folder is empty'
                      : space
                        ? 'No matching pages'
                        : 'No results found'
                }
              >
                <p>{v.discovery === 'Favorites' && v.location === 'home' ? 'Pinned pages are shown in Suggested.' : v.query ? 'Try a different search.' : v.location === 'home' && v.discovery === 'Shared with you' ? 'Files shared directly with you will appear here.' : !v.busy ? 'Create something new to get started.' : ''}</p>
              </Empty>
            )}
            {(folder || space
              ? v.page?.nextCursor
              : v.location === 'recent'
                ? v.recentCursor
                : null) && (
              <button
                className={button + ' tw-mx-auto tw-mt-4'}
                disabled={v.busy}
                onClick={() =>
                  folder || space
                    ? face.directory(
                        v.space,
                        v.parent,
                        v.page?.nextCursor ?? '',
                      )
                    : face.moreRecent()
                }
              >
                Load more
              </button>
            )}
          </>
        )}
      </div>
      {context && (
        <div
          ref={contextRef}
          role="menu"
          aria-label={`Actions for ${context.node.name}`}
          className="sp-menu-body sp-context-menu"
          style={{
            position: 'fixed',
            left: Math.max(0, context.x),
            top: Math.max(0, context.y),
          }}
          onClick={() => setContext(null)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setContext(null);
          }}
        >
          <FileActions face={face} v={v} node={context.node} />
        </div>
      )}
      {selected.length > 0 && (
        <div role="toolbar" aria-label="Selection" className="sp-selection">
          <span>{selected.length} selected</span>
          <button disabled className={button}>
            Start chat
          </button>
          <button disabled className={button}>
            Move
          </button>
          <button disabled className={button}>
            Delete
          </button>
          <button
            className={iconButton}
            aria-label="Clear selection"
            onClick={() => setSelected([])}
          >
            <Icon name="close" size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
