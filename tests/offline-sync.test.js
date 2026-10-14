import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
function extract(name,next){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing ${name}`);
  const end=html.indexOf(`\nfunction ${next}(`,start);
  assert.notEqual(end,-1,`missing function following ${name}`);
  return html.slice(start,end);
}
const source=[
  extract('cloudSelectRejoinBoard','cloudDiff'),
  extract('cloudDiff','cloudApplyChanges'),
  extract('cloudApplyChanges','cloudRebase'),
  extract('cloudRebase','cloudMerge'),
  extract('cloudProtocolCompatible','blockCloudProtocol'),
  'globalThis.api={cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudApplyChanges,cloudRebase};'
].join('\n');
const context={structuredClone};
vm.runInNewContext(source,context);
const {cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudApplyChanges,cloudRebase}=context.api;

const base={v:2,d:0,p:[
  {id:'p1',n:'Board',e:[
    {id:'shape-a',type:'rect',x:0,text:'base',th:[{id:'m1',t:'first'}]},
    {id:'shape-b',type:'rect',x:4}
  ]},
  {id:'p2',n:'Second',e:[]}
]};
const local=structuredClone(base);
local.p[0].e[0].x=10;
local.p[0].e[0].text='local edit';
local.p[0].e[0].th.push({id:'m2',t:'local note'});
local.p[0].e.splice(1,1);
local.p[0].e.push({id:'shape-new',type:'ellipse',x:8});

function json(value){return JSON.parse(JSON.stringify(value))}

test('cloud rebase retains offline edits while preserving unrelated remote edits',()=>{
  const remote=structuredClone(base);
  remote.p[0].e[0].x=20;
  remote.p[0].e[0].text='remote edit';
  remote.p[0].e[0].th.push({id:'m3',t:'remote note'});
  remote.p[0].e.push({id:'remote-shape',type:'line',x:30});
  remote.p.push({id:'remote-page',n:'Peer page',e:[]});

  const result=cloudRebase(remote,base,local);
  const p=result.board.p.find(x=>x.id==='p1');
  const a=p.e.find(x=>x.id==='shape-a');
  assert.equal(a.x,10,'local wins for a concurrently edited shape');
  assert.equal(a.text,'local edit');
  assert.deepEqual(a.th.map(x=>x.id),['m1','m3','m2'],'thread messages from both clients survive');
  assert.ok(!p.e.some(x=>x.id==='shape-b'),'offline delete is retained');
  assert.ok(p.e.some(x=>x.id==='shape-new'),'offline addition is retained');
  assert.ok(p.e.some(x=>x.id==='remote-shape'),'unrelated peer addition is retained');
  assert.ok(result.board.p.some(x=>x.id==='remote-page'),'remote page is retained');
  assert.ok(result.pending.length>0);
});

test('rejoining a room never imports additions or deletions from another local board',()=>{
  const privateBoard=structuredClone(base);
  privateBoard.p[0].e.splice(1,1);
  privateBoard.p[0].e.push({id:'private-shape',type:'rect',x:77});
  const unsafeDelta=cloudDiff(base,privateBoard);
  assert.ok(unsafeDelta.some(c=>c.t==='del'&&c.eid==='shape-b'));
  assert.ok(unsafeDelta.some(c=>c.t==='put'&&c.e.id==='private-shape'));

  const safe=cloudSelectRejoinBoard('room-1','other-room',privateBoard,null,base,null);
  assert.deepEqual(json(safe),json(base),'mismatched localStorage uses this room checkpoint instead');
  assert.deepEqual(json(cloudDiff(base,safe)),[],'private additions and deletions do not enter the room delta');

  const roomSnapshot=structuredClone(base);roomSnapshot.p[0].e.push({id:'offline-room-shape',type:'ellipse',x:12});
  const resumed=cloudSelectRejoinBoard('room-1','other-room',privateBoard,roomSnapshot,base,null);
  assert.deepEqual(json(resumed),json(roomSnapshot),'room snapshot outranks unrelated global localStorage');
  assert.equal(cloudSelectRejoinBoard('room-1','room-1',roomSnapshot,null,base,null),roomSnapshot,'matching room marker preserves same-room local edits');
});

test('safe sync requires a room revision and exact operation acknowledgement',()=>{
  const op={opId:'stable-op-id'};
  const room={kind:'room',syncProtocol:'room-ops-v1',board:base,rev:4};
  assert.equal(cloudProtocolCompatible(room),true,'revisioned GET is compatible');
  assert.equal(cloudProtocolCompatible({...room,rev:undefined}),false,'legacy GET without revision is incompatible');
  assert.equal(cloudProtocolCompatible({...room,syncProtocol:undefined}),false,'a stored revision alone does not prove backend support');
  assert.equal(cloudProtocolCompatible({...room,kind:undefined}),false,'malformed compatibility responses are blocked');
  assert.equal(cloudProtocolCompatible(room,op),false,'POST without ACK is never accepted');
  assert.equal(cloudProtocolCompatible({...room,ack:'another-op'},op),false,'wrong ACK is rejected');
  assert.equal(cloudProtocolCompatible({...room,ack:op.opId},op),true,'matching ACK and revision are required');

  const start=html.indexOf('async function cloudSync(){');
  const sync=html.slice(start,html.indexOf('\nfunction activateOfflineCloud(',start));
  assert.ok(sync.indexOf('probe=await cloudRequest(\'/room/\'+id)')<sync.indexOf('const d=op?await cloudRequest(\'/room/\'+id,{changes:'), 'reconnect compatibility GET runs before any queued POST');
  assert.match(sync,/if\(!cloudProtocolCompatible\(probe\)\|\|probe\.rev<oldRev\)/,'incompatible probe blocks the queued POST');
  assert.ok(sync.indexOf('if(!cloudProtocolCompatible(d,op)||d.rev<oldRev)')<sync.indexOf('cloudMerge(d,sent)'), 'incompatible response exits before completing/clearing the outbox');
  assert.match(sync,/if\(cloudProtocolBlocked\|\|!cloudRoom/,'blocked protocol prevents scheduled sends');
  assert.match(html,/if\(!protocolBlocked\)cloudTimer=setInterval\(cloudSync,4000\)/,'incompatible server does not get an automatic retry timer');
});

test('an outbox delta can reconstruct its sent snapshot and safely replay',()=>{
  const changes=cloudDiff(base,local);
  const sent=cloudApplyChanges(base,changes);
  assert.deepEqual(json(sent),json(local));

  const remote=structuredClone(base);
  remote.p[0].e[0].th.push({id:'peer-message',t:'peer'});
  const once=cloudApplyChanges(remote,changes);
  const twice=cloudApplyChanges(once,changes);
  assert.deepEqual(json(twice),json(once),'retry does not duplicate elements or thread messages');
  assert.deepEqual(once.p[0].e.find(x=>x.id==='shape-a').th.map(x=>x.id),['m1','peer-message','m2']);
});

test('offline checkpoint, operation id, acknowledgement, and revision retry paths are present',()=>{
  assert.match(html,/indexedDB\.open\('ghdraw-cloud-sync-v1',2\)/);
  assert.match(html,/saveCloudCheckpoint\(id,oldBase,oldRev,cloudRoom\.expires,op,current\)/);
  assert.match(html,/opId:op\.opId,baseRev:op\.baseRev/);
  assert.match(html,/d\.ack===op\.opId/);
  assert.match(html,/cloudLocalSnapshot\(id\)/);
  assert.match(html,/d\.syncProtocol==='room-ops-v1'/);
  const backend=readFileSync(new URL('../backend/src/main.js',import.meta.url),'utf8');
  assert.match(backend,/syncProtocol:'room-ops-v1'/);
  assert.match(html,/cloudRoomId:roomIdHint\|\|cloudRoom\?\.id/);
  assert.match(html,/cloudSelectRejoinBoard\(id,savedRoomId,current,snapshotBoard,cached\?\.base,null\)/);
  assert.match(html,/addEventListener\('online'/);
  assert.match(html,/if\(cached&&cached\.base&&cached\.inflight\).*await cloudSync\(\)/);
});

test('mobile and tablet styles account for safe areas, touch size, and compact landscape',()=>{
  assert.match(html,/viewport-fit=cover/);
  assert.match(html,/@media\(pointer:coarse\)\{\.ib \.k\{display:none\}\.ib\{width:44px;height:44px\}/);
  assert.match(html,/env\(safe-area-inset-bottom\)/);
  assert.match(html,/@media\(max-width:900px\) and \(max-height:500px\)/);
  assert.match(html,/<div id="syncBadge" role="status" aria-live="polite">/);
});
