import React, { useEffect, useRef, useState } from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import type { Invite, MemberList, PublicUser, ShareRole, ShareTarget } from '../sharing.js';
import { Icon, button, iconButton } from './primitives.js';

export function Avatar({ user }: { user: PublicUser }) {
  return <span className="sp-avatar" aria-hidden="true">{user.avatarUrl ? <img src={user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : (user.displayName || user.username).slice(0, 1).toUpperCase()}</span>;
}
export function InvitePicker({ face, value, onChange, roles, disabled }: {
  face: Face; value?: Invite; onChange(value: Invite | undefined): void; roles: ShareRole[]; disabled?: boolean;
}) {
  const [query, setQuery] = useState(''), [users, setUsers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState('');
  const [role, setRole] = useState<ShareRole>(value?.role ?? 'viewer');
  useEffect(() => {
    let active = true;
    setUsers([]); setError('');
    if (query.trim().length < 2 || value) { setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(() => {
      void face.sharing({ action: 'users', query }).then(result => { if (active) setUsers(result.users); }).catch(cause => { if (active) setError(cause.message); }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query, value?.user.id]);
  return <div className="sp-invite-picker">
    <div className="sp-invite-fields">
      {value ? <div className="sp-selected-person"><Avatar user={value.user} /><span>{value.user.displayName} <small>@{value.user.username}</small></span><button type="button" disabled={disabled} aria-label="Cancel selected invitation" className={iconButton} onClick={() => { onChange(undefined); setQuery(''); }}><Icon name="close" size={14} /></button></div> : <input aria-label="Add people" placeholder="Search name or username" maxLength={100} value={query} disabled={disabled} onChange={e => setQuery(e.target.value)} />}
      <select aria-label="Invitation role" value={value?.role ?? role} disabled={disabled} onChange={e => { const next = e.target.value as ShareRole; setRole(next); if (value) onChange({ ...value, role: next }); }}>{roles.map(r => <option key={r} value={r}>{r === 'viewer' ? 'Viewer' : r === 'editor' ? 'Editor' : 'Admin'}</option>)}</select>
    </div>
    {!value && query.trim().length >= 2 && <div className="sp-user-results" role="listbox" aria-label="People"><span role="status">{loading ? 'Searching…' : !users.length && !error ? 'No matching people' : ''}</span>{users.map(user => <button className={button} role="option" aria-selected="false" type="button" key={user.id} onClick={() => { onChange({ user, role }); setUsers([]); }}><Avatar user={user} /><span>{user.displayName} <small>@{user.username}</small></span></button>)}</div>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
export function SpaceShareDialog({ face, v, target }: { face: Face; v: State; target: ShareTarget }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [data, setData] = useState<MemberList>(), [invite, setInvite] = useState<Invite | undefined>(target.invite);
  const [busy, setBusy] = useState(false), [error, setError] = useState(target.error ?? ''), [notice, setNotice] = useState('');
  const alive = useRef(true);
  const close = () => { if (!busy) face.update({ sharing: null }); };
  const load = async () => { const result = await face.sharing({ action: 'members', id: target.id }); if (alive.current) setData(result); };
  useEffect(() => {
    dialog.current?.showModal();
    void load().catch(cause => { if (alive.current) setError(cause.message); });
    return () => { alive.current = false; };
  }, []);
  const change = async (operation: () => Promise<unknown>, message: string) => {
    setBusy(true); setError(''); setNotice('');
    try { await operation(); await load(); if (alive.current) { setNotice(message); setInvite(undefined); face.refresh(); } }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : 'Sharing failed.'); }
    finally { if (alive.current) setBusy(false); }
  };
  const canManage = data?.space.capabilities?.manageMembers === true;
  const roles: ShareRole[] = data?.space.accessRole === 'owner' ? ['viewer', 'editor', 'admin'] : ['viewer', 'editor'];
  return <dialog ref={dialog} className="sp-create-dialog sp-share-dialog" aria-label={`Share ${target.name}`} onCancel={e => { e.preventDefault(); close(); }}>
    <header className="sp-share-heading"><div><h2>Share {target.name}</h2><p>Members have access to all content in this Space.</p></div><button disabled={busy} className={iconButton} aria-label="Close sharing" onClick={close}><Icon name="close" /></button></header>
    {!data && !error && <p role="status">Loading sharing settings…</p>}
    {data && <>
      {canManage ? <section><InvitePicker face={face} value={invite} onChange={setInvite} roles={roles} disabled={busy} /><button className={button + ' sp-invite-submit'} disabled={busy || !invite} onClick={() => invite && change(() => face.sharing({ action: 'set-member', id: target.id, user: invite.user.id, role: invite.role }), 'Member added. Access is active immediately.')}>Add member</button><p className="sp-share-note">Existing Workspace accounts receive access immediately. No pending invitation is created.</p></section> : <p>You can view members. Your role does not allow managing access.</p>}
      <h3>Link access</h3><select aria-label="Space link access" disabled={busy || !data.space.capabilities?.renameSpace} value={data.space.publicRead ? 'public' : 'members'} onChange={e => change(() => face.sharing({ action: 'space-access', id: target.id, publicRead: e.target.value === 'public' }), 'Space access updated.')}><option value="members">Only Space members</option><option value="public">Anyone with the link · Viewer</option></select>
      <h3>Who has access</h3><ul className="sp-access-list">{[{ user: data.owner, role: 'owner' as const }, ...data.members].map(item => {
        const locked = !canManage || item.role === 'owner' || (data.space.accessRole === 'admin' && item.role === 'admin');
        return <li key={item.user.id}><Avatar user={item.user} /><div className="sp-person"><strong>{item.user.displayName}{item.user.id === v.status.user?.id ? ' (you)' : ''}</strong><small>@{item.user.username}</small></div>{locked ? <span>{item.role === 'owner' ? 'Owner' : item.role === 'admin' ? 'Admin' : item.role === 'editor' ? 'Editor' : 'Viewer'}</span> : <><select aria-label={`Role for ${item.user.username}`} value={item.role} disabled={busy} onChange={e => change(() => face.sharing({ action: 'set-member', id: target.id, user: item.user.id, role: e.target.value }), 'Role updated.')} >{roles.map(role => <option key={role} value={role}>{role === 'viewer' ? 'Viewer' : role === 'editor' ? 'Editor' : 'Admin'}</option>)}</select><button aria-label={`Remove ${item.user.username}`} disabled={busy} className={iconButton} onClick={() => change(() => face.sharing({ action: 'remove-member', id: target.id, user: item.user.id }), 'Member removed.')}><Icon name="close" size={16} /></button></> }</li>;
      })}</ul>
    </>}
    {error && <p role="alert">{error}<button className={button} disabled={busy} onClick={() => { setError(''); void load().catch(cause => setError(cause.message)); }}>Retry</button></p>}
    {notice && <p role="status">{notice}</p>}
    <footer><button className={button} disabled={busy} onClick={close}>Done</button></footer>
  </dialog>;
}
