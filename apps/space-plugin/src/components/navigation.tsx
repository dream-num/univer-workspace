import React from 'react';
import type { Face } from '../client.js';
import { nodeKind, type State } from '../model.js';
import { CreateMenu, Icon, button, iconButton } from './primitives.js';
export function Navigation({ face, v }: { face: Face; v: State }) {
  const row = button + ' sp-nav-row';
  if(!v.nav&&!v.flyout)return <button className={iconButton+' sp-nav-restore'} aria-label="Open Space navigation" onClick={()=>face.update({flyout:true})}><Icon name="panel"/></button>;
  const go=()=>{if(v.flyout)face.update({flyout:false});};
  return <><aside aria-label="Space navigation" className={'sp-navigation'+(!v.nav?' sp-navigation-flyout':'')}>
    <div className="sp-nav-heading"><strong>Space</strong><button className={iconButton} aria-label="Search Space content" onClick={()=>{face.home(); requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('.sp-search input')?.focus());}}><Icon name="search"/></button><button className={iconButton} aria-label="Toggle sidebar" onClick={() => face.update({ nav:!v.nav, flyout:false })}><Icon name="panel"/></button></div>
    <div className="sp-nav-create"><CreateMenu/></div>
    <div className="sp-nav-scroll">
      {([['all','All','all'],['doc','Pages','doc'],['slide','Slides','slide'],['site','Sites','site'],['image','Images','image']] as const).map(([filter,label,icon]) => <button key={filter} disabled={['slide','site','image'].includes(filter)} title={['slide','site','image'].includes(filter)?'Not available in this release':undefined} className={row + (v.location === 'home' && v.filter === filter && !v.content ? ' sp-selected' : '')} onClick={() => { face.home(); face.update({ filter }); go(); }}><Icon name={icon}/>{label}</button>)}
      {v.pins.length>0&&<><div className="sp-nav-section">Pinned</div>{v.pins.map(id=>v.all.find(n=>n.id===id)).filter(Boolean).map(node=><button key={node!.id} className={row+(v.content?.nodeId===node!.id?' sp-selected':'')} onClick={()=>{node!.resource?face.open(node!.id):face.directory(node!.spaceId??v.space,node!.id);go();}}><Icon name={nodeKind(node!)}/><span className="tw-truncate">{node!.name}</span></button>)}</>}
      <button className={row+' sp-nav-section sp-section-button'} onClick={()=>face.home('recent')}>Recents <Icon name="down" size={12}/></button>
      {v.recent.slice(0,7).map(item => <button key={item.node.id} title={item.node.name} className={row + (v.content?.nodeId === item.node.id ? ' sp-selected' : '')} onClick={() => {face.open(item.node.id);go();}}><Icon name={item.resource.unitType ?? 'doc'}/><span className="tw-truncate">{item.node.name}</span></button>)}
      <div className="sp-nav-section">Spaces</div>
      {v.spaces.map(space=><button key={space.id} className={row+(v.space===space.id&&v.location==='space'&&!v.content?' sp-selected':'')} onClick={()=>{face.directory(space.id);go();}}><Icon name="all"/><span className="tw-truncate">{space.name}</span></button>)}
    </div>
    <button disabled title="Trash is not available" className={row+' tw-text-muted'}><Icon name="trash"/>Trash</button>
    <button className={row+' tw-text-muted'} aria-label="Workspace settings" onClick={()=>face.update({settings:true})}><Icon name="settings"/><span className="tw-truncate">{v.status.state==='connected'?'Workspace connected':'Connect Workspace'}</span></button>
  </aside>{!v.nav&&<div className="sp-nav-scrim" onClick={()=>face.update({flyout:false})}/>}</>;
}
