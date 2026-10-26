import React from 'react';
import type { Face } from '../client.js';
import type { State } from '../model.js';
import { Icon, button, iconButton } from './primitives.js';
export function Navigation({ face, v }: { face: Face; v: State }) {
  const row = button + ' tw-w-full tw-justify-start tw-px-2 tw-py-1.5 tw-text-[13px] tw-text-left';
  return <aside aria-label="Space navigation" className={`${v.nav ? 'tw-w-[224px]' : 'tw-w-12'} tw-box-border tw-shrink-0 tw-flex tw-flex-col tw-gap-1 tw-bg-sidebar tw-p-2 tw-overflow-hidden tw-border-0 tw-border-r tw-border-solid tw-border-line`}>
    <div className="tw-flex tw-items-center tw-justify-between tw-px-2 tw-py-2">{v.nav && <strong className="tw-text-sm tw-font-semibold">Space</strong>}<button className={iconButton} aria-label={v.nav ? '收起内容导航' : '展开内容导航'} onClick={() => face.update({ nav: !v.nav })}><Icon name="panel" size={16}/></button></div>
    {v.nav && <>
      <button className={row} onClick={() => face.update({ notice: '新建 Page 将在后续 Worktree 编辑阶段提供。当前版本为只读。' })}><Icon name="plus"/>New page</button>
      {([['all','All','all'],['doc','Pages','doc'],['site','Sites','site'],['image','Images','image'],['sheet','Sheets','sheet']] as const).map(([filter,label,icon]) => <button key={filter} className={row + (v.location === 'home' && v.filter === filter && !v.content ? ' tw-bg-hover' : '')} onClick={() => { face.home(); face.update({ filter }); }}><Icon name={icon}/>{label}</button>)}
      <div className="tw-mt-5 tw-px-2 tw-py-1 tw-text-[11px] tw-text-muted">Pinned</div>
      <div className="tw-px-2 tw-py-1 tw-text-[12px] tw-text-muted">收藏功能尚未接入</div>
      <button className={row + ' tw-mt-3 tw-text-muted'} onClick={() => face.home('recent')}>Recents <Icon name="chevron" size={12}/></button>
      {v.recent.slice(0,4).map(item => <button key={item.node.id} title={item.node.name} className={row + (v.content?.nodeId === item.node.id ? ' tw-bg-hover' : '')} onClick={() => face.open(item.node.id)}><Icon name={item.resource.unitType ?? 'doc'} size={15}/><span className="tw-truncate">{item.node.name}</span></button>)}
      <div className="tw-mt-4 tw-px-2 tw-py-1 tw-text-[11px] tw-text-muted">Spaces</div>
      <div className="tw-min-h-0 tw-flex-1 tw-overflow-y-auto">{v.spaces.map(space => <React.Fragment key={space.id}><button className={row + (v.space === space.id && v.location === 'folder' ? ' tw-bg-hover' : '')} onClick={() => face.directory(space.id)}><Icon name="folder" size={15}/><span className="tw-truncate">{space.name}</span></button>{v.space === space.id && v.location === 'folder' && <>{v.page?.parentNode && <button className={row + ' tw-pl-4'} onClick={() => face.directory(space.id,v.page!.parentNode!.id)}><Icon name="folder" size={14}/><span className="tw-truncate">{v.page.parentNode.name}</span></button>}{v.page?.nodes.map(node => <button key={node.id} title={node.name} className={row + (v.page?.parentNode ? ' tw-pl-8' : ' tw-pl-4') + (v.content?.nodeId === node.id ? ' tw-bg-hover' : '')} onClick={() => node.resource ? face.open(node.id) : face.directory(space.id,node.id)}><Icon name={node.resource?.unitType ?? 'folder'} size={14}/><span className="tw-truncate">{node.name}</span></button>)}</>}</React.Fragment>)}</div>
      <button className={row + ' tw-mt-auto tw-text-muted'} onClick={() => face.update({ notice:'Trash 浏览尚未接入。此只读版本不会删除内容。' })}><Icon name="trash" size={15}/>Trash</button>
      <button className={row + ' tw-text-muted'} onClick={() => face.update({ settings:true })}><Icon name="settings" size={15}/><span className="tw-truncate">{v.status.user?.displayName ?? 'Workspace 设置'}</span><span aria-label={v.status.state} className={'tw-ml-auto tw-h-1.5 tw-w-1.5 tw-shrink-0 tw-rounded-full ' + (v.status.state === 'connected' ? 'tw-bg-emerald-600' : 'tw-bg-neutral-400')}/></button>
    </>}
  </aside>;
}
