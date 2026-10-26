import React, { useSyncExternalStore } from 'react';
import type { Face } from './client.js';
import { PageViewer } from './components/page-viewer.js';
import { Navigation } from './components/navigation.js';
import { ContentBrowser } from './components/content-browser.js';
import { Settings } from './components/settings.js';
import { Icon, button, iconButton, Empty } from './components/primitives.js';

/** Public native Conversation Factory, scoped to the existing retained Session. */
export function NativeConversation(props: any) {
  const session = props.useSession((s: any) => s);
  const conversation = props.useConversation((s: any) => s);
  const hero = session.blank && !session.running && conversation.activeTargets.size === 0;
  return props.renderFactorySlot('conversation.content', { variant:'embedded', phase: session.openState === 'loading' ? 'settling' : hero ? 'hero' : 'active', hero }, { slots: { views: FixedChat } });
}
function FixedChat(props: any) { return props.renderSlot('conversation.session', { view:'chat' }); }

export function SpaceView(props: Face & { SessionProvider: React.ComponentType<any>; renderSlot: (name: string, args: object) => React.ReactNode }) {
  const v = useSyncExternalStore(props.store.subscribe,props.store.getSnapshot);
  const Provider = props.SessionProvider;
  return <div className="sp-shell"><div className="tw-relative tw-flex tw-h-full tw-w-full tw-min-w-0 tw-overflow-hidden tw-bg-canvas tw-font-sans tw-text-[13px] tw-text-ink">
    <Navigation face={props} v={v}/>
    <main style={{containerType:"inline-size",containerName:"sp-main"}} className="tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1 tw-flex-col">
      {(v.error || v.notice) && <div role={v.error ? 'alert' : 'status'} className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-bg-hover tw-px-5 tw-py-2 tw-text-xs"><span>{v.error || v.notice}</span><button className={iconButton} aria-label="关闭提示" onClick={() => props.update({error:'',notice:''})}><Icon name="close" size={14}/></button></div>}
      {v.busy && <div role="status" aria-label="加载中" className="tw-h-0.5 tw-shrink-0 tw-bg-neutral-300"/>}
      {v.status.state !== 'connected' ? <Empty title="连接你的 Workspace"><p>浏览文档与表格，在已有对话中一起工作。</p><button className={button + ' tw-bg-hover'} onClick={() => props.update({settings:true})}>连接 Workspace</button></Empty> : v.content ? <PageViewer face={props} v={v}/> : <ContentBrowser key={`${v.location}:${v.space}:${v.parent}`} face={props} v={v}/>}
    </main>
    {v.ai && v.content && <aside aria-label="Page AI" className="sp-ai-panel"><div className="tw-flex tw-shrink-0 tw-items-center tw-justify-between tw-gap-2 tw-px-4 tw-py-3"><span className="tw-truncate tw-text-[13px]">{v.sessionTitle || 'Work with this page'}</span>{v.sessionId && <select aria-label="关联的原生对话" value={v.sessionId} onChange={e=>props.link(e.target.value)} className="tw-max-w-24 tw-border-0 tw-bg-transparent tw-text-xs tw-text-muted">{v.sessions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}</select>}<button className={iconButton} aria-label="关闭 AI 面板" onClick={() => props.update({ai:false})}><Icon name="close" size={16}/></button></div>
      {!v.sessionId ? <div className="tw-flex tw-flex-col tw-gap-2 tw-p-5"><p className="tw-text-sm">选择已有对话</p>{v.sessions.map(session => <button className={button + ' tw-justify-start tw-text-left'} key={session.id} onClick={() => props.link(session.id)}>{session.title}</button>)}{!v.sessions.length && <p className="tw-text-xs tw-text-muted">先在 DSH 中打开一个对话，再返回 Space。</p>}</div> : <>
        <div className="tw-mx-3 tw-mb-2 tw-flex tw-flex-col tw-gap-2 tw-rounded-xl tw-border tw-border-solid tw-border-line tw-p-3">
          <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs"><Icon name={v.context?.file.type ?? v.content.type} size={14}/><span className="tw-min-w-0 tw-flex-1 tw-truncate">{v.context?.file.name ?? v.content.name}</span><span className="tw-text-[10px] tw-text-muted">{v.context ? ({ selected:'已选择',draft:'引用在草稿中',submitted:'引用已提交' }[v.context.state]) : '未关联'}</span></div>
          <div className="tw-flex tw-flex-wrap tw-gap-1">{(!v.context || v.context.file.nodeId !== v.content.nodeId) && <button className={button + ' tw-py-1 tw-text-xs'} onClick={() => props.select()}>选择此文件</button>}{v.context?.state === 'selected' && <button disabled={v.busy} className={button + ' tw-bg-hover tw-py-1 tw-text-xs'} onClick={() => props.draft()}>关联到对话</button>}{v.context && <button className={button + ' tw-py-1 tw-text-xs tw-text-muted'} onClick={() => props.removeContext()}>移除选择</button>}</div>
        </div>
        <div className="sp-native-conversation"><Provider session={props.reference()}>{props.renderSlot('space.conversation',{})}</Provider></div>
      </>}
    </aside>}
    {v.settings && <Settings face={props} v={v}/>}
  </div></div>;
}
