import React, { useEffect, useRef } from 'react';
import { InvitePicker } from './sharing.js';
import { createTypes, creationName } from '../content-types.js';
import {
  LayoutGrid,
  FileText,
  FileMinus,
  Table2,
  Folder,
  Search,
  X,
  ArrowLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  PanelLeft,
  Sparkles,
  Settings2,
  Image,
  Globe,
  Trash2,
  Pin,
  Ellipsis,
  Clock3,
  List,
  SlidersHorizontal,
  Grip,
  Minus,
  Maximize2,
  MessageCircle,
  History,
  Presentation,
  Share2,
  Check,
  Copy,
  File,
  PanelsTopLeft,
  Database,
  SquareMousePointer,
  type LucideIcon,
} from 'lucide-react';
const icons: Record<string, LucideIcon> = {
  all: LayoutGrid,
  workspace: PanelsTopLeft,
  base: Database,
  board: SquareMousePointer,
  doc: FileText,
  sheet: Table2,
  folder: Folder,
  search: Search,
  close: X,
  arrow: ArrowLeft,
  chevron: ChevronRight,
  down: ChevronDown,
  up: ChevronUp,
  plus: Plus,
  panel: PanelLeft,
  spark: Sparkles,
  settings: Settings2,
  image: Image,
  site: Globe,
  page: FileMinus,
  trash: Trash2,
  pin: Pin,
  more: Ellipsis,
  clock: Clock3,
  list: List,
  grid: LayoutGrid,
  filter: SlidersHorizontal,
  grip: Grip,
  minimize: Minus,
  expand: Maximize2,
  chat: MessageCircle,
  history: History,
  slide: Presentation,
  share: Share2,
  check: Check,
  copy: Copy,
  file: File,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const Glyph = icons[name] ?? File;
  return <Glyph size={size} strokeWidth={1.6} aria-hidden="true" />;
}
export const button =
  'sp-control hover:tw-bg-hover focus-visible:tw-outline focus-visible:tw-outline-2 focus-visible:tw-outline-blue-500 disabled:tw-opacity-40 disabled:tw-cursor-default';
export const iconButton =
  button + ' tw-h-9 tw-w-9 tw-justify-center tw-p-0 tw-shrink-0';
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-p-10 tw-text-center">
      <Icon name="folder" size={28} />
      <h2 className="tw-m-0 tw-text-sm tw-font-medium">{title}</h2>
      <div className="tw-text-[13px] tw-leading-6 tw-text-muted">
        {children}
      </div>
    </div>
  );
}
/** Menus share dismissal and keyboard rules; only this plugin's own controls are touched. */
export function Menu({
  label,
  children,
  trigger,
  align = 'right',
  className = '',
}: {
  label: string;
  children: React.ReactNode;
  trigger: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node))
        ref.current?.removeAttribute('open');
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  return (
    <details
      ref={ref}
      className={'sp-menu ' + className}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          ref.current?.removeAttribute('open');
          ref.current?.querySelector('summary')?.focus();
        }
        if (e.key === 'Tab') ref.current?.removeAttribute('open');
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          if (ref.current) ref.current.open = true;
          const items = Array.from(
            ref.current?.querySelectorAll<HTMLButtonElement>(
              '[role="menu"] button:not(:disabled)',
            ) ?? [],
          );
          const n = items.indexOf(document.activeElement as HTMLButtonElement);
          const index = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 :
            n < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) :
            (n + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items[index]?.focus();
        }
      }}
    >
      <summary aria-label={label} aria-haspopup="menu" className={button}>
        {trigger}
      </summary>
      <div
        role="menu"
        aria-label={label}
        className={'sp-menu-body sp-menu-' + align}
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button:not(:disabled)'))
            ref.current?.removeAttribute('open');
        }}
      >
        {children}
      </div>
    </details>
  );
}
export function GapAction({ children }: { children: React.ReactNode }) {
  return (
    <button
      role="menuitem"
      disabled
      className={button + ' tw-w-full tw-justify-start'}
      title="This action is not available in Space yet"
    >
      {children}
    </button>
  );
}
/** Dialog focus stays inside our own surface; native DSH content is never altered. */
function useDialog(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  const onClose = useRef(close);
  onClose.current = close;
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest('details')?.querySelector('summary') ?? active;
    const root = ref.current;
    (root?.querySelector<HTMLElement>('input:not(:disabled)') ?? root?.querySelector<HTMLElement>('button:not(:disabled)'))?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose.current(); }
      if (event.key !== 'Tab' || !root) return;
      const items = [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')].filter(e => e.getClientRects().length > 0);
      const first = items[0], last = items.at(-1);
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
    };
    root?.addEventListener('keydown', keydown);
    return () => { root?.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, [open, ref]);
}

/** Workspace has no content-template catalogue yet. Keep its real empty state,
 * separate from supported blank-file creation; Harness Session templates are not files. */
function TemplatesGallery({ close, choose, allowed }: { close(): void; choose(kind: string): void; allowed: boolean }) {
  const [category, setCategory] = React.useState('all');
  const ref = useRef<HTMLDivElement>(null);
  useDialog(ref, true, close);
  const categories = [{ kind: 'all', label: 'All' }, ...createTypes.filter(t => !['folder', 'space'].includes(t.kind))];
  return <div className="sp-create-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) close(); }}>
    <div ref={ref} role="dialog" aria-modal="true" aria-label="Templates" className="sp-templates-dialog">
      <header><h2>Templates</h2><button className={iconButton} aria-label="Close templates" onClick={close}><Icon name="close" /></button></header>
      <div className="sp-tabs" role="tablist" aria-label="Template categories">
        {categories.map((item, index) => <button role="tab" aria-selected={category === item.kind}
          className={button + (category === item.kind ? ' sp-selected' : '')} key={item.kind}
          onClick={() => setCategory(item.kind)} onKeyDown={e => {
            if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault();
            const next = e.key === 'Home' ? 0 : e.key === 'End' ? categories.length - 1 : (index + (e.key === 'ArrowRight' ? 1 : -1) + categories.length) % categories.length;
            setCategory(categories[next].kind);
            e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
          }}>{item.label}</button>)}
      </div>
      <div role="tabpanel" className="sp-template-empty">
        <Icon name={category === 'all' ? 'grid' : category} size={32} />
        <h3>No {category === 'all' ? '' : categories.find(c => c.kind === category)?.label + ' '}templates available</h3>
        <p>You can still start with a blank file.</p>
        <div className="sp-blank-actions">{createTypes.filter(t => !['folder', 'space'].includes(t.kind) && (category === 'all' || t.kind === category)).map(t => <button key={t.kind} className={button} disabled={!allowed}
          title={!allowed ? 'You do not have permission to create here' : undefined}
          onClick={() => choose(t.kind)}><Icon name={t.kind} />Blank {t.createLabel.toLowerCase()}</button>)}</div>
      </div>
    </div>
  </div>;
}
/** Complete contract menu. Permission limits affect availability, never membership. */
export function CreateMenu({
  face,
  v,
  sidebar = false,
  target,
  shortcut,
}: {
  face: import('../client.js').Face;
  v: import('../model.js').State;
  sidebar?: boolean;
  /** Navigation shortcuts reuse the existing creation form and Server workflow. */
  target?: { kind: 'site'; parent: import('../model.js').Node } | { kind: 'space' };
  shortcut?: { kind: string; children: React.ReactNode; className?: string };
}) {
  const [draft, setDraft] = React.useState<{
    kind: string;
    space: string;
    parent: string;
    key: string;
  } | null>(null);
  const [name, setName] = React.useState('');
  const [gallery, setGallery] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const submittingRef = React.useRef(false);
  const [inviting, setInviting] = React.useState(false);
  const [invite, setInvite] = React.useState<
    import('../sharing.js').Invite | undefined
  >();
  const dialogRef = useRef<HTMLFormElement>(null);
  const dismiss = () => { if (!submittingRef.current) setDraft(null); };
  useDialog(dialogRef, !!draft, dismiss);
  const inDirectory = v.location === 'folder' || v.location === 'space';
  const parentNode = target?.kind === 'site' ? target.parent : undefined;
  const destination = parentNode
    ? v.spaces.find((s) => s.id === parentNode.spaceId)
    : inDirectory
    ? v.spaces.find((s) => s.id === v.space)
    : v.spaces.find((s) => s.type === 'personal');
  const allowed = parentNode
    ? parentNode.capabilities?.createChildren === true
    : inDirectory && v.parent
      ? v.page?.parentNode?.capabilities?.createChildren === true
      : destination?.capabilities?.createAtRoot === true;
  if (v.status.state !== 'connected') return null;
  const prepare = (kind: string) => {
    if (kind === 'templates') { setGallery(true); return; }
    setName('');
    setInviting(false);
    setInvite(undefined);
    setDraft({
      kind,
      space: parentNode?.spaceId ?? destination?.id ?? '',
      parent: parentNode?.id ?? (inDirectory ? v.parent : ''),
      key: crypto.randomUUID(),
    });
  };
  return (
    <>
      {shortcut ? (
        <button className={shortcut.className ?? button} disabled={shortcut.kind !== 'templates' && !allowed}
          title={shortcut.kind !== 'templates' && !allowed ? 'You do not have permission to create here' : undefined}
          onClick={() => prepare(shortcut.kind)}>{shortcut.children}</button>
      ) : target ? (
        <button
          className={iconButton}
          aria-label={parentNode ? `Add subpage to ${parentNode.name}` : 'New space'}
          title={parentNode && !allowed ? 'You do not have permission to create here' : parentNode ? 'Add subpage' : 'New space'}
          disabled={!!parentNode && !allowed}
          onClick={() => prepare(target.kind)}
        ><Icon name="plus" size={14} /></button>
      ) : <Menu
        className="sp-create-menu"
        label={!sidebar && inDirectory ? 'New' : 'Create'}
        align={sidebar ? 'left' : 'right'}
        trigger={
          <>
            {sidebar && <Icon name="plus" size={18} />}
            <span>{!sidebar && inDirectory ? 'New' : 'Create'}</span>
            <Icon name="down" size={12} />
          </>
        }
      >
        {createTypes.map(({ kind, label }) => (
          <React.Fragment key={kind}>
          {kind === 'folder' && <div role="separator" className="sp-menu-separator" />}
          <button
            key={kind}
            role="menuitem"
            className={button + ' tw-w-full'}
            disabled={kind !== 'space' && !allowed}
            title={
              kind !== 'space' && !allowed
                ? 'You do not have permission to create here'
                : undefined
            }
            onClick={() => prepare(kind)}
          >
            <Icon name={kind === 'space' ? 'all' : kind} />
            {label}
          </button>
          </React.Fragment>
        ))}
        <div role="separator" className="sp-menu-separator" />
        <button role="menuitem" className={button + ' tw-w-full'} onClick={() => prepare('templates')}><Icon name="grid" />Start from template</button>
      </Menu>}
      {gallery && <TemplatesGallery allowed={allowed} close={() => setGallery(false)} choose={kind => { setGallery(false); prepare(kind); }} />}
      {draft && (
        <div className="sp-create-backdrop" onPointerDown={e => { if (e.target === e.currentTarget) dismiss(); }}>
          <form
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={`Create ${draft.kind}`}
            className={'sp-create-dialog' + (draft.kind === 'space' ? ' sp-create-space' : '')}
            onSubmit={async (e) => {
              e.preventDefault();
              if (submittingRef.current || !name.trim()) return;
              submittingRef.current = true;
              setSubmitting(true);
              try {
                const created = await face.create({
                  ...draft,
                  name,
                  invite: draft.kind === 'space' ? invite : undefined,
                });
                if (created) setDraft(null);
              } finally {
                submittingRef.current = false;
                setSubmitting(false);
              }
            }}
          >
            <header className="sp-dialog-heading"><h2>{draft.kind === 'space' ? 'Create a space' : 'Create ' + creationName(draft.kind)}</h2>
              <button type="button" className={iconButton} aria-label="Close dialog" disabled={submitting} onClick={dismiss}><Icon name="close" /></button>
            </header>
            {draft.kind !== 'space' && (
              <p>
                In {draft.parent ? parentNode?.name ?? v.page?.parentNode?.name : destination?.name}
              </p>
            )}
            <label className={draft.kind === 'space' ? 'sp-space-name' : 'sp-name-field'}>
              <span className={draft.kind === 'space' ? 'sp-visually-hidden' : ''}>{draft.kind === 'space' ? 'Space name' : 'Name'}</span>
              {draft.kind === 'space' && <span className="sp-space-icon" title="Custom icons and colors aren’t available yet" aria-label="Space icon"><Icon name="workspace" size={24} /></span>}
              <input
                autoFocus
                aria-label={draft.kind === 'space' ? 'Space name' : 'Name'}
                required
                maxLength={draft.kind === 'space' ? 100 : 255}
                value={name}
                placeholder={draft.kind === 'space' ? 'Space name' : 'Name'}
                disabled={submitting}
                onChange={(e) => {
                  setName(e.target.value);
                  setDraft({ ...draft, key: crypto.randomUUID() });
                }}
              />
            </label>
            {draft.kind === 'space' && (
              <>
                <button
                  type="button"
                  className={button + ' sp-invite-toggle'}
                  aria-expanded={inviting}
                  disabled={submitting}
                  onClick={() => setInviting(!inviting)}
                >
                  <Icon name={inviting ? 'down' : 'chevron'} size={14} />Invite people<span className="sp-optional">Optional</span>
                </button>
                {inviting && (
                  <>
                    <InvitePicker
                      face={face}
                      value={invite}
                      onChange={setInvite}
                      roles={['viewer', 'editor', 'admin']}
                      disabled={submitting}
                    />
                    <p>
                      Members can access all content in this Space. Existing
                      Workspace accounts receive access immediately.
                    </p>
                  </>
                )}
              </>
            )}
            {v.error && <p role="alert">{v.error}</p>}
            <footer className="sp-dialog-actions">
              <button
                type="button"
                className={button}
                disabled={submitting}
                onClick={() => setDraft(null)}
              >
                Cancel
              </button>
              <button className={button + ' sp-submit'} disabled={submitting || !name.trim()}>
                {submitting ? 'Creating…' : 'Create'}
              </button>
            </footer>
          </form>
        </div>
      )}
    </>
  );
}
