import React, { useEffect, useState, useSyncExternalStore } from 'react';
import type { Face } from './client.js';
import { nodeKind, kindName, type Node, type State } from './model.js';
import { Viewer } from './viewer.js';

type IconName = 'home' | 'clock' | 'folder' | 'doc' | 'sheet' | 'settings' | 'arrow' | 'close' | 'spark' | 'chevron' | 'menu' | 'file';
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<IconName,string> = {
    home: 'M3 11 12 3l9 8M5 10v11h14V10M9 21v-7h6v7',
    clock: 'M12 8v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
    folder: 'M3 7V5h6l2 2h10v13H3V7Z', doc: 'M14 3H5v18h14V8l-5-5v5h5M8 12h8M8 16h6',
    sheet: 'M4 4h16v16H4V4Zm0 5h16M4 14h16M10 4v16',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm0-5v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4',
    arrow: 'M19 12H5m6-6-6 6 6 6', close: 'm6 6 12 12M6 18 18 6',
    spark: 'm12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z',
    chevron: 'm9 5 7 7-7 7', menu: 'M4 6h16M4 12h16M4 18h16', file: 'M14 3H5v18h14V8l-5-5v5h5',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={paths[name as IconName] ?? paths.file}/></svg>;
}
const useView = (props: Face) => useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
const pathTitle = (v: State) => v.page?.parentNode?.name ?? v.page?.space?.name ?? v.spaces.find(s => s.id === v.space)?.name ?? '内容';
function date(value?: string) { return value ? new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) : '—'; }
function Notice({ icon = 'folder', title, children }: { icon?: string; title: string; children?: React.ReactNode }) { return <div className="sp-empty"><span className="sp-empty-icon"><Icon name={icon} size={28}/></span><h2>{title}</h2><div>{children}</div></div>; }

export function SpaceView(props: Face) {
  const v = useView(props);
  const connected = v.status.state === 'connected';
  const source = v.location === 'folder' ? v.page?.nodes ?? [] : v.recent.map(item => ({ ...item.node, resource: item.resource }));
  const items = source.filter(node => node.name.toLocaleLowerCase().includes(v.query.toLocaleLowerCase()) && (v.filter === 'all' || nodeKind(node) === v.filter));
  const title = v.location === 'home' ? '你的工作，从这里继续' : v.location === 'recent' ? '最近访问' : pathTitle(v);
  return <div className={`sp-app ${v.content ? 'sp-reading' : ''}`}>
    <aside className="sp-nav">
      <button className="sp-brand" onClick={() => props.home()}><span className="sp-brand-mark"><Icon name="sheet"/></span>Space</button>
      <div className="sp-nav-group">
        <button className={v.location === 'home' && !v.content ? 'selected' : ''} onClick={() => props.home()}><Icon name="home"/><span>概览</span></button>
        <button className={v.location === 'recent' && !v.content ? 'selected' : ''} onClick={() => props.home('recent')}><Icon name="clock"/><span>最近访问</span></button>
      </div>
      <div className="sp-nav-caption">SPACES <span>{v.spaces.length || ''}</span></div>
      <div className="sp-spaces">{v.spaces.map(space => <button key={space.id} title={space.name} className={v.location === 'folder' && v.space === space.id ? 'selected' : ''} onClick={() => props.directory(space.id)}><span className="sp-space-dot">{space.name.slice(0,1)}</span><span>{space.name}</span></button>)}{connected && !v.spaces.length && !v.busy && <p className="sp-muted sp-small">没有可访问的 Space</p>}</div>
      <div className="sp-nav-bottom">
        <button onClick={() => props.update({ settings: true })}><Icon name="settings"/><span>Settings</span><span className={`sp-status-dot ${connected ? 'connected' : ''}`}/></button>
        <div className="sp-identity">{connected ? (v.status.user?.displayName ?? v.status.user?.username ?? '已连接 Workspace') : '连接你的 Workspace'}</div>
      </div>
    </aside>
    <main className="sp-main">
      <div className="sp-topbar"><span>{v.content ? 'Space / ' + kindName(v.content.type) : 'Space / ' + (v.location === 'home' ? '概览' : v.location === 'recent' ? '最近访问' : pathTitle(v))}</span><div className="sp-topbar-actions">{v.busy && <span className="sp-inline-loading" role="status"><span className="sp-spinner"/>加载中</span>}<button className="sp-button sp-quiet" onClick={() => props.refresh()} disabled={v.busy}>刷新</button><button className="sp-icon-button" aria-label="Workspace 设置" onClick={() => props.update({ settings: true })}><Icon name="settings"/></button></div></div>
      {v.error && <div className="sp-error" role="alert"><span>{v.error}</span><button onClick={() => props.update({ error: '' })} aria-label="关闭错误"><Icon name="close" size={16}/></button></div>}
      {!connected ? <Notice icon="home" title="让内容和对话一起工作"><p>连接 Workspace，浏览你的文档与表格。<br/>选择需要的内容，带入已有的 DSH 对话。</p><button className="sp-button sp-primary" onClick={() => props.update({ settings: true })}>连接 Workspace</button>{v.status.state === 'network-error' && <p role="alert">Workspace 暂时无法连接，请在 Settings 中重试。</p>}</Notice> : v.content ? <div className="sp-workspace">
        {v.rail && <aside className="sp-file-rail"><div className="sp-rail-heading"><span>{v.location === 'folder' ? pathTitle(v) : '最近文件'}</span><button aria-label="收起文件列表" onClick={() => props.update({ rail: false })}><Icon name="close" size={14}/></button></div>{source.map(node => <button key={node.id} className={v.content?.nodeId === node.id ? 'selected' : ''} onClick={() => node.resource && ['doc','sheet'].includes(nodeKind(node)) ? props.open(node.id) : props.directory(v.space || node.spaceId || '', node.id)}><Icon name={nodeKind(node)}/><span>{node.name}</span></button>)}</aside>}
        <section className="sp-document"><header className="sp-document-header"><div className="sp-document-title"><button className="sp-icon-button" onClick={() => props.close()} aria-label="关闭文件，返回列表"><Icon name="arrow"/></button>{!v.rail && <button className="sp-icon-button" onClick={() => props.update({ rail: true })} aria-label="展开文件列表"><Icon name="menu"/></button>}<div><h1>{v.content.name}</h1><div className="sp-muted sp-small">{kindName(v.content.type)} <span>·</span> 只读快照 <span>·</span> 版本 {v.content.revision}</div></div></div><button className={`sp-button ${v.ai ? 'sp-active' : ''}`} onClick={() => props.update({ ai: !v.ai })}><Icon name="spark"/>使用 AI</button></header><Breadcrumbs v={v} props={props}/><div className="sp-canvas"><Viewer key={v.content.nodeId + v.content.sha256} file={v.content}/></div></section>
        {v.ai && <ContextPanel props={props} v={v}/>}
      </div> : <div className="sp-content" key={v.location + v.parent + v.space}>
        <header className="sp-page-heading"><div className="sp-eyebrow">{v.location === 'home' ? 'WORKSPACE' : v.location === 'recent' ? 'RECENT' : 'BROWSE'}</div><h1>{title}</h1><p className="sp-muted">{v.location === 'home' ? '有序整理，随时开始。你的文档与表格都在这里。' : v.location === 'recent' ? 'Workspace 中最近打开过的文件。' : '浏览当前位置的内容，或打开文件开始阅读。'}</p></header>
        {v.location === 'folder' && <Breadcrumbs v={v} props={props}/>}
        {v.location === 'home' && <><div className="sp-section-heading"><h2>Spaces</h2><span className="sp-muted sp-small">你的内容位置</span></div><div className="sp-space-cards">{v.spaces.map(space => <button className="sp-space-card" key={space.id} onClick={() => props.directory(space.id)}><span className="sp-space-dot">{space.name.slice(0,1)}</span><div><strong>{space.name}</strong><span>{space.type === 'personal' ? '个人 Space' : '团队 Space'}</span></div><Icon name="chevron" size={16}/></button>)}</div>{v.recent.length > 0 && <><div className="sp-section-heading"><h2>继续上次的工作</h2><button className="sp-text-button" onClick={() => props.home('recent')}>查看最近访问 <Icon name="chevron" size={14}/></button></div><div className="sp-recent-cards">{v.recent.slice(0,3).map(item => <button key={item.node.id} className="sp-recent-card" onClick={() => props.open(item.node.id)} disabled={!['doc','sheet'].includes(item.resource.unitType ?? '')}><span className={`sp-file-icon ${item.resource.unitType}`}><Icon name={item.resource.unitType ?? 'file'} size={24}/></span><strong>{item.node.name}</strong><span>{kindName(item.resource.unitType ?? 'file')} · {item.location.space.name}</span><small>访问于 {date(item.lastOpenedAt)}</small></button>)}</div></>}</>}
        <div className="sp-section-heading"><h2>{v.location === 'home' ? '最近打开的文件' : '内容'}</h2><span className="sp-muted sp-small">{source.length} 项已加载</span></div>
        <div className="sp-list-toolbar"><div className="sp-filters">{[['all','全部'],['doc','Documents'],['sheet','Sheets'],...(v.location === 'folder' ? [['folder','Folders']] : [])].map(([key,label]) => <button key={key} aria-pressed={v.filter === key} className={v.filter === key ? 'selected' : ''} onClick={() => props.update({ filter: key })}>{label}</button>)}</div><input aria-label="筛选已加载内容名称" placeholder="筛选已加载的名称…" value={v.query} onChange={e => props.update({ query: e.target.value })}/></div>
        <div className="sp-list-scope">{v.location === 'folder' ? '当前层级' : '最近访问'} · 名称筛选仅作用于已加载项目</div>
        <div className="sp-file-list"><div className="sp-list-head"><span>名称</span><span>类型</span><span>操作</span></div>{items.map(node => <FileRow key={node.id} node={node} props={props} space={v.space}/>)}</div>
        {!items.length && <Notice title={v.query || v.filter !== 'all' ? '没有匹配的内容' : '这里还没有内容'}><p>{v.query ? '试试其他名称，或清除筛选。' : '打开一个 Space，浏览文件；访问记录将由 Workspace 保存。'}</p></Notice>}
        {(v.location === 'folder' ? v.page?.nextCursor : v.recentCursor) && <button className="sp-button sp-more" disabled={v.busy} onClick={() => v.location === 'folder' ? props.directory(v.space, v.parent, v.page!.nextCursor!) : props.moreRecent()}>加载更多</button>}
      </div>}
    </main>
    {v.settings && <Settings props={props} v={v}/>}
  </div>;
}

function FileRow({ node, props, space }: { node: Node; props: Face; space: string }) {
  const kind = nodeKind(node); const canOpen = ['doc','sheet'].includes(kind) && node.resource?.capabilities.openContent;
  const open = () => canOpen ? props.open(node.id) : props.directory(space || node.spaceId || '', node.id);
  return <div className="sp-file-row"><button className="sp-file-name" onClick={open} disabled={!!node.resource && !canOpen} title={node.resource && !canOpen ? '此类型尚未提供阅读视图' : node.name}><span className={`sp-file-icon ${kind}`}><Icon name={kind}/></span><strong>{node.name}</strong></button><span className="sp-muted sp-small">{kindName(kind)}</span><div>{node.capabilities?.browseChildren !== false && <button className="sp-text-button" onClick={() => props.directory(space || node.spaceId || '', node.id)}>{kind === 'folder' ? '浏览' : '子项'}<Icon name="chevron" size={14}/></button>}</div></div>;
}
function Breadcrumbs({ v, props }: { v: State; props: Face }) {
  if (v.location !== 'folder') return <div className="sp-breadcrumb"><button onClick={() => props.home('recent')}>最近访问</button><Icon name="chevron" size={12}/><span>{v.content?.name}</span></div>;
  return <nav aria-label="内容位置" className="sp-breadcrumb"><button onClick={() => props.directory(v.space)}>{v.spaces.find(s => s.id === v.space)?.name ?? 'Space'}</button>{v.page?.breadcrumbs?.map(part => <React.Fragment key={part.id}><Icon name="chevron" size={12}/><button onClick={() => props.directory(v.space, part.id)}>{part.name}</button></React.Fragment>)}</nav>;
}
function ContextPanel({ props, v }: { props: Face; v: State }) {
  const context = v.context;
  const [choose, setChoose] = useState(false);
  return <aside className="sp-context"><div className="sp-context-heading"><Icon name="spark"/><strong>围绕文档工作</strong><button className="sp-icon-button" aria-label="收起 AI 工作区" onClick={() => props.update({ ai: false })}><Icon name="close" size={16}/></button></div><p className="sp-muted sp-small">使用 DSH 已有对话，内容由你明确选择。</p>
    <div className="sp-context-session"><span className="sp-eyebrow">关联对话</span><strong>{v.sessionId ? v.sessionTitle : '尚未选择对话'}</strong><button className="sp-text-button" onClick={() => setChoose(!choose)}>{v.sessionId ? '更换对话' : '选择已有对话'}</button></div>
    {choose && <div className="sp-session-choices"><p className="sp-small sp-muted">选择将清除本地 Context 选择；原对话草稿和历史保留。</p>{v.sessions.map(s => <button key={s.id} onClick={() => { props.link(s.id); setChoose(false); }}>{s.title}</button>)}</div>}
    <div className="sp-context-section"><span className="sp-eyebrow">当前打开</span><strong>{v.content?.name ?? '未打开文件'}</strong>{v.content && <button className="sp-button" onClick={() => props.select()} disabled={v.busy || (context?.file.sha256 === v.content.sha256 && context.state !== 'submitted')}><Icon name="doc" size={16}/>选择此文件</button>}</div>
    <div className="sp-context-section"><span className="sp-eyebrow">下一次请求的内容</span>{context ? <div className="sp-context-card"><div><Icon name={context.file.type}/><strong>{context.file.name}</strong></div><span className={`sp-context-state ${context.state}`}>{({ selected: '已选择 · 尚未提交', draft: '已加入草稿 · 等待原生发送', submitted: '已提交至原对话' })[context.state]}</span><p>版本 {context.file.revision} · 冻结的{context.file.type === 'doc' ? '正文文本' : '工作表名称及单元格'}快照</p><p className="sp-small sp-muted">AI Context 使用内容投影；复杂排版与嵌入对象不在此范围。</p><button className="sp-text-button" onClick={() => props.removeContext()}>移除本地选择</button>{context.state !== 'selected' && <p className="sp-small sp-muted">原生草稿或已提交消息需在原对话中管理。</p>}</div> : <p className="sp-muted sp-small">打开文件不会自动交给 Agent。选择后，你可以检查并加入原对话草稿。</p>}</div>
    <div className="sp-context-bottom">{v.experience === 'reduced' && <p role="status">Reduced Experience · 文档与对话分开显示；Space 阅读现场保留。</p>}<button className="sp-button sp-primary" disabled={!v.sessionId || context?.state !== 'selected' || v.busy} onClick={() => props.draft()}>加入原对话草稿 <Icon name="chevron" size={15}/></button><button className="sp-button" disabled={!v.sessionId || v.busy} onClick={() => props.chat()}>继续对话 · 旁显文档</button><p className="sp-small sp-muted">通过宿主原生输入框发送。提交状态来自原生消息；不代表 Agent 已读取。</p></div>
  </aside>;
}
function Settings({ props, v }: { props: Face; v: State }) {
  const [endpoint,setEndpoint] = useState(v.status.endpoint);
  const [username,setUsername] = useState(''); const [password,setPassword] = useState('');
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (event.key === 'Escape') props.update({ settings: false }); }; document.addEventListener('keydown', listener); return () => document.removeEventListener('keydown', listener); }, []);
  const labels: Record<string,string> = { unconfigured: '尚未连接', connected: '已连接', unauthenticated: '需要登录', 'network-error': '无法连接' };
  return <div className="sp-modal-backdrop" onClick={() => props.update({ settings: false })}><section className="sp-settings" role="dialog" aria-modal="true" aria-label="Workspace Settings" onClick={e => e.stopPropagation()}><header><div><span className="sp-eyebrow">SPACE SETTINGS</span><h1>Workspace 连接</h1></div><button autoFocus className="sp-icon-button" onClick={() => props.update({ settings: false })} aria-label="关闭设置"><Icon name="close"/></button></header><p className="sp-muted">连接你自己的 Workspace Server。身份验证由服务端提供。</p><form onSubmit={e => { e.preventDefault(); props.configure(endpoint); }}><label>Workspace Endpoint<input required type="url" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="https://workspace.example.com"/></label><p className="sp-small sp-muted">更换地址将清除本地文件与 Context；原生对话内容保留。</p><button className="sp-button" disabled={v.busy}>连接服务</button></form><div className="sp-connection-status" role="status"><span className={`sp-status-dot ${v.status.state === 'connected' ? 'connected' : ''}`}/>{labels[v.status.state] ?? v.status.state}<span>{v.status.user?.displayName ?? v.status.user?.username}</span></div>{v.status.endpoint && v.status.state !== 'connected' && <form onSubmit={e => { e.preventDefault(); props.login(username,password); setPassword(''); }}><label>用户名<input autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)}/></label><label>密码<input autoComplete="current-password" type="password" required value={password} onChange={e => setPassword(e.target.value)}/></label><button className="sp-button sp-primary" disabled={v.busy}>登录 Workspace</button><p className="sp-small sp-muted">此版本支持密码登录；仅 OAuth 的服务尚未接入。重启后需要重新登录。</p></form>}{v.error && <p className="sp-settings-error" role="alert">{v.error}</p>}{v.status.endpoint && <button className="sp-text-button" disabled={v.busy} onClick={() => props.disconnect()}>断开 Workspace</button>}</section></div>;
}
export function DockView(props: Face & { sessionId?: string }) {
  const v = useView(props);
  const mismatch = v.content && v.sessionId && props.sessionId && props.sessionId !== v.sessionId;
  return <div className="sp-app sp-dock"><div className="sp-dock-header"><button className="sp-text-button" onClick={() => props.back()}><Icon name="arrow" size={16}/>回到 Space</button><span className="sp-small sp-muted">只读</span></div>{mismatch ? <Notice title="此文档关联另一个对话"><p>{v.sessionTitle}</p><button className="sp-button" onClick={() => props.chat()}>返回关联对话</button></Notice> : v.content ? <><header className="sp-dock-title"><Icon name={v.content.type}/><div><strong>{v.content.name}</strong><span>版本 {v.content.revision} · Workspace</span></div><button className="sp-button" onClick={() => props.select()}>选择</button></header><div className="sp-dock-status" role="status">{v.context ? `${v.context.file.name} · ${{ selected:'尚未提交',draft:'已加入草稿，等待发送',submitted:'已提交至原对话' }[v.context.state]}` : '尚未选择 AI 使用的内容'}</div>{v.context?.state === 'selected' && <div className="sp-dock-draft"><button className="sp-button sp-primary" disabled={v.busy} onClick={() => props.draft()}>加入当前原生草稿</button></div>}<div className="sp-canvas"><Viewer key={v.content.nodeId + v.content.sha256} file={v.content}/></div></> : <Notice title="在 Space 中选择文件"><p>文档将在这里与原生对话并排显示。</p><button className="sp-button" onClick={() => props.back()}>浏览 Space</button></Notice>}</div>;
}
