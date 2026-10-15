import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fontsStart=html.indexOf('const FONTS='),fontsEnd=html.indexOf('\n',fontsStart);
assert.ok(fontsStart>=0&&fontsEnd>fontsStart,'missing font allowlist');
const fontsSource=html.slice(fontsStart,fontsEnd);
function extract(name,next){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`missing ${name}`);
  const end=html.indexOf(`\nfunction ${next}(`,start);
  assert.notEqual(end,-1,`missing function following ${name}`);
  return html.slice(start,end);
}
const loadStart=html.indexOf('function load(){');
const loadEnd=html.indexOf('\nconst TOOLS=',loadStart);
assert.ok(loadStart>=0&&loadEnd>loadStart,'missing load function');
const loadSource=html.slice(loadStart,loadEnd);
const source=[
  fontsSource,
  extract('cloudJoinCanContinue','cloudSelectRejoinBoard'),
  extract('cloudSelectRejoinBoard','cloudDiff'),
  extract('localBoardRecord','save'),
  extract('isBoardObject','validBoardCamera'),
  extract('validBoardCamera','validBoardElement'),
  extract('validBoardElement','validBoardDefaults'),
  extract('validBoardDefaults','normalizeBoardElement'),
  extract('normalizeBoardElement','normalizeBoardDefaults'),
  extract('normalizeBoardDefaults','parseLocalBoardRecord'),
  extract('parseLocalBoardRecord','localBoardBackupKeys'),
  extract('dash','roughPass'),
  loadSource,
  extract('localBoardBackupKeys','writeLocalBoardBackup'),
  extract('writeLocalBoardBackup','localBoardBackupEntries'),
  extract('localBoardBackupEntries','hasLocalBoardBackups'),
  extract('hasLocalBoardBackups','preserveLocalBoardBeforeCloudJoin'),
  extract('preserveLocalBoardBeforeCloudJoin','restoreLocalBoardRecord'),
  extract('restoreLocalBoardRecord','localBoardRoomId'),
  extract('cloudDiff','cloudApplyChanges'),
  extract('cloudApplyChanges','cloudRebase'),
  extract('cloudRebase','cloudMerge'),
  extract('cloudProtocolCompatible','blockCloudProtocol'),
  'globalThis.api={cloudJoinCanContinue,localBoardRecord,parseLocalBoardRecord,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,preserveLocalBoardBeforeCloudJoin,restoreLocalBoardRecord,load,dash,cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudApplyChanges,cloudRebase};'
].join('\n');
const storage=new Map();
const mockLocalStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),key:index=>[...storage.keys()][index]??null,get length(){return storage.size}};
const context={structuredClone,localStorage:mockLocalStorage,els:[],cam:{x:0,y:0,z:1},defaults:{},grid:false,dark:false,pi:0,pages:[{id:'p1',name:'Board',els:[],cam:{x:0,y:0,z:1}}],cloudRoom:null,collabOn:false,editing:null,measure:()=>{},uid:()=>'recovery-page'};
context.syncPage=()=>{const page=context.pages[context.pi];if(page){page.els=context.els;page.cam=context.cam}};
context.finishEdit=()=>{context.editing=null};context.cloudEnd=()=>{context.cloudRoom=null;context.collabOn=false};
vm.runInNewContext(source,context);
const {cloudJoinCanContinue,localBoardRecord,parseLocalBoardRecord,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,preserveLocalBoardBeforeCloudJoin,restoreLocalBoardRecord,load,dash,cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudApplyChanges,cloudRebase}=context.api;

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
function recordElement(id,type='rect',extra={}){const base={id,type,x:0,y:0,w:10,h:10,seed:1,stroke:'#1e1e1e',bg:'transparent',fill:'hachure',sw:2,style:'solid',rough:1,round:true,opacity:100,align:'left'};if(type==='text')Object.assign(base,{text:'',font:'Caveat',size:28});return{...base,...extra}}

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

test('cloudJoin backs up the newer in-memory board when ghdraw:v2 is stale',()=>{
  storage.clear();
  const stale=JSON.stringify({savedAt:1,cloudRoomId:'private',els:[{id:'stale'}],pages:[{id:'private-page',name:'Private',els:[{id:'stale'}],cam:{x:0,y:0,z:1}}]});
  storage.set('ghdraw:v2',stale);
  context.els=[recordElement('memory-latest','rect',{x:77})];
  context.cam={x:5,y:6,z:1};context.defaults={stroke:'#123456'};context.grid=true;context.dark=true;context.pi=0;
  context.pages=[{id:'live-page',name:'Live',els:[],cam:{x:0,y:0,z:1}}];context.cloudRoom=null;
  assert.equal(preserveLocalBoardBeforeCloudJoin(),true);
  const backup=storage.get('ghdraw:backup-before-collab'),decoded=JSON.parse(backup);
  assert.notEqual(backup,stale);
  assert.deepEqual(json(decoded.els),json(context.els),'backup stores live elements, not stale autosave');
  assert.deepEqual(json(decoded.pages[0].els),json(context.els),'active page is synchronized before serialization');
  assert.equal(decoded.savedAt>1,true);
  assert.equal(storage.get('ghdraw:v2'),stale,'the stale record is not mistaken for the backup');

  const firstBackup=backup;
  assert.equal(preserveLocalBoardBeforeCloudJoin(),true,'unchanged content reuses its existing backup');
  assert.equal(localBoardBackupEntries().length,1,'a new timestamp alone does not create duplicate archives');
  context.els=[recordElement('later-live-board','ellipse')];context.pages=[{id:'later-page',name:'Later',els:[],cam:{x:0,y:0,z:1}}];
  assert.equal(preserveLocalBoardBeforeCloudJoin(),true,'a later join gets a unique archive');
  assert.equal(storage.get('ghdraw:backup-before-collab'),firstBackup,'the original recovery copy is never overwritten');
  const entries=localBoardBackupEntries();
  assert.equal(entries.length,2,'both backups remain restorable');
  assert.ok(entries.some(entry=>entry.record!==firstBackup&&entry.data.els[0]?.id==='later-live-board'));
  assert.equal(hasLocalBoardBackups(),true);

  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){');
  const join=html.slice(start,html.indexOf("\naddEventListener('offline'",start));
  const backupGate=join.indexOf('if(!preserveLocalBoardBeforeCloudJoin())');
  assert.ok(backupGate>=0&&join.indexOf('return}',backupGate)<join.indexOf('cloudCheckpoint(id)'), 'failed backup aborts before storage reads');
  assert.ok(join.indexOf('preserveLocalBoardBeforeCloudJoin()')<join.indexOf('cloudCheckpoint(id)'), 'backup precedes storage reads');
  assert.ok(join.indexOf('preserveLocalBoardBeforeCloudJoin()')<join.indexOf('restoreCloudSnapshot'), 'backup precedes any board restore');

  const cyclic={};cyclic.self=cyclic;context.els=[cyclic];context.pages=[{id:'cycle',name:'',els:[],cam:{x:0,y:0,z:1}}];
  assert.equal(preserveLocalBoardBeforeCloudJoin(),false,'unserializable live state is fail-closed');
  context.els=[recordElement('memory-latest','rect',{x:77})];context.pages=[{id:'live-page',name:'Live',els:[],cam:{x:0,y:0,z:1}}];
  context.localStorage={getItem:()=>stale,setItem:()=>{throw new Error('quota')}};
  assert.equal(preserveLocalBoardBeforeCloudJoin(),false,'failed backup write is fail-closed');
  context.localStorage=mockLocalStorage;
});





test('validator rejects unsafe geometry and style while allowing UI-supported resize values',()=>{
  const parse=(element,cam={x:0,y:0,z:1},defaults={})=>parseLocalBoardRecord(JSON.stringify({els:[element],cam,defaults,pi:0,pages:[{id:'safe-page',name:'Safe',els:[element],cam}]}));
  assert.equal(parse(recordElement('negative','rect',{w:-1,h:-1})),null,'negative shape dimensions are invalid');
  assert.equal(parse(recordElement('huge-coordinate','rect',{x:Number.MAX_VALUE})),null,'unbounded finite coordinates are invalid');
  assert.equal(parse(recordElement('huge-text','text',{size:Number.MAX_VALUE})),null,'text size cannot overflow measurement');
  assert.equal(parse(recordElement('tiny-text','text',{size:Number.MIN_VALUE})),null,'text size cannot underflow measurement');
  assert.equal(parse(recordElement('huge-point','line',{pts:[[Number.MAX_VALUE,0],[1,1]]})),null,'line points are bounded');
  assert.equal(parse(recordElement('bad-stroke','rect',{sw:Number.MAX_VALUE,style:'dotted'})),null,'stroke width cannot overflow dash calculation');
  assert.equal(parse(recordElement('bad-roughness','rect',{rough:Number.MAX_VALUE})),null,'roughness is bounded');
  assert.equal(parse(recordElement('bad-opacity','rect',{opacity:Number.MAX_VALUE})),null,'opacity is bounded');
  assert.equal(parse(recordElement('bad-defaults'),{x:0,y:0,z:1},{sw:Number.MAX_VALUE,style:'dotted'}),null,'unsafe saved defaults cannot affect new drawings');
  assert.equal(parse(recordElement('bad-default-roughness'),{x:0,y:0,z:1},{rough:Number.MAX_VALUE}),null,'saved default roughness is bounded');
  assert.equal(parse(recordElement('bad-default-opacity'),{x:0,y:0,z:1},{opacity:Number.MAX_VALUE}),null,'saved default opacity is bounded');
  const poisonedStroke=JSON.parse('{\"toString\":null,\"valueOf\":null}');
  const validDefaults={stroke:'#1e1e1e',bg:'transparent',fill:'cross',sw:4,style:'dotted',rough:2,round:false,opacity:50,font:'Caveat',size:300,align:'right'};
  assert.ok(parse(recordElement('valid-defaults'),{x:0,y:0,z:1},validDefaults),'all supported persisted default fields remain valid');
  for(const[key,value]of[['stroke',poisonedStroke],['bg',poisonedStroke],['fill',poisonedStroke],['sw',poisonedStroke],['style',poisonedStroke],['rough',poisonedStroke],['round',poisonedStroke],['opacity',poisonedStroke],['font',poisonedStroke],['size',poisonedStroke],['align',poisonedStroke]])assert.equal(parse(recordElement('bad-default-'+key),{x:0,y:0,z:1},{[key]:value}),null,'default '+key+' is allowlisted');
  for(const[key,value]of[['stroke','transparent'],['bg','rgb(1,2,3)'],['fill','unknown'],['sw',3],['style','wavy'],['rough',3],['round',1],['opacity',55],['font','Arial'],['size',301],['align','justify']])assert.equal(parse(recordElement('bad-default-value-'+key),{x:0,y:0,z:1},{[key]:value}),null,'default '+key+' rejects non-allowlisted values');
  assert.equal(parse(recordElement('bad-default-extra'),{x:0,y:0,z:1},{unexpected:poisonedStroke}),null,'unknown saved defaults are rejected');
  assert.equal(parse(recordElement('bad-default-color'),{x:0,y:0,z:1},{stroke:'rgb(1,2,3)'}),null,'only safe color strings are accepted');
  const badElementFields=['id','type','x','y','w','h','pts','seed','stroke','bg','fill','sw','style','rough','round','opacity','font','size','align','text','lw','src','giphyId','name','frame','cm','th','ts','au','note','txt','done','pr','b0','b1','g','__bak','__new','__c','unexpected'];
  for(const key of badElementFields)assert.equal(parse(recordElement('bad-element-'+key,'rect',{[key]:poisonedStroke})),null,'drawing field '+key+' rejects hostile object values');
  for(const[key,value]of[['stroke','transparent'],['bg','rgb(1,2,3)'],['fill','unknown'],['sw',0],['style','wavy'],['rough',3],['round',1],['opacity',101],['font','Arial'],['size',401],['align','justify'],['seed',1.5]])assert.equal(parse(recordElement('bad-element-value-'+key,'rect',{[key]:value})),null,'drawing field '+key+' rejects non-allowlisted values');
  assert.equal(parse(recordElement('too-large-text','text',{text:'No',size:401})),null,'text above the resize limit is rejected');
  const camera={x:0,y:0,z:Number.MAX_VALUE};
  assert.equal(parse(recordElement('camera-test'),camera),null,'camera zoom above the app range is invalid');
  assert.equal(parse(recordElement('tiny-camera'),{x:0,y:0,z:Number.MIN_VALUE}),null,'camera zoom below the app range is invalid');
  const maxStroke=parse(recordElement('valid-dotted','rect',{sw:64,style:'dotted'}));
  const dashResult=[];dash({setLineDash(values){assert.ok(values.every(value=>Number.isFinite(value)&&value>=0));dashResult.push(values)}},maxStroke.els[0]);
  assert.equal(dashResult[0][1],155.6,'bounded maximum stroke produces a finite dotted dash');
  const maxText=recordElement('valid-text','text',{text:'Readable',size:400});
  assert.ok(parse(maxText),'text resize max from the UI remains valid');
  assert.ok(html.includes('Math.max(6,Math.min(400,Math.round(o.size*k)))'),'test follows the real resize range');
  storage.set('ghdraw:v2',JSON.stringify({els:[maxText],cam:{x:0,y:0,z:1},defaults:{},grid:false,dark:false,pi:0,pages:[{id:'resized-page',name:'Resized',els:[maxText],cam:{x:0,y:0,z:1}}]}));
  context.pages=[{id:'before',name:'Before',els:[],cam:{x:0,y:0,z:1}}];context.els=[];context.pi=0;
  load();
  assert.equal(context.els[0].size,400,'a UI-resized 400px label loads successfully');
  const kept=recordElement('kept-board');context.els=[kept];context.cam={x:7,y:8,z:1};context.defaults={sw:2,rough:1,opacity:100,size:28};context.pages=[{id:'kept-page',name:'Kept',els:context.els,cam:context.cam}];
  storage.set('ghdraw:v2',JSON.stringify({els:[recordElement('bad-defaults')],cam:{x:0,y:0,z:1},defaults:{sw:Number.MAX_VALUE},grid:false,dark:false,pi:0,pages:[{id:'bad-page',name:'Bad',els:[recordElement('bad-defaults')],cam:{x:0,y:0,z:1}}]}));
  load();
  assert.equal(context.els[0].id,'kept-board','unsafe defaults cannot partially replace current board');
  assert.equal(context.defaults.sw,2,'unsafe defaults do not poison the drawing tools');
  const safeDefaults={stroke:'#1e1e1e',bg:'transparent',fill:'hachure',sw:2,style:'solid',rough:1,round:true,opacity:100,font:'Caveat',size:28,align:'left'};context.defaults=safeDefaults;
  const malicious=JSON.stringify({els:[recordElement('poison')],cam:{x:0,y:0,z:1},defaults:{stroke:poisonedStroke},pi:0,pages:[{id:'poison-page',name:'Poison',els:[recordElement('poison')],cam:{x:0,y:0,z:1}}]});storage.set('ghdraw:v2',malicious);
  load();
  assert.equal(context.els[0].id,'kept-board','the reported stroke payload cannot replace the active board');
  assert.equal(context.defaults.stroke,'#1e1e1e','the reported stroke payload cannot poison canvas defaults');
  const legacy=parseLocalBoardRecord(JSON.stringify({els:[{id:'missing-style',type:'rect',x:0,y:0,w:10,h:10,style:'dotted'}],cam:{x:0,y:0,z:1},defaults:{sw:null,rough:null,opacity:null,size:null}}));
  assert.equal(legacy.els[0].sw,2,'older records without stroke width receive the safe default');
  const legacyDash=[];dash({setLineDash(values){assert.ok(values.every(value=>Number.isFinite(value)&&value>=0));legacyDash.push(values)}},legacy.els[0]);
  assert.deepEqual(json(legacyDash[0]),[0.1,6.8],'legacy dotted elements render with the normalized stroke width');
  assert.equal(legacy.defaults.sw,2,'null style defaults from earlier overflow serialize safely');
  assert.ok(parse(recordElement('valid-note','rect',{note:1,txt:'Sticky',au:'A',ts:123,bg:'#ffec99',stroke:'#c9a400'})),'sticky-note fields remain supported');
  assert.ok(parse(recordElement('valid-pin','ellipse',{cm:1,th:[{id:'m1',n:'A',c:'#1e1e1e',t:'Comment',ts:123}],done:false,ts:123,au:'A'})),'comment-pin/thread fields remain supported');
  assert.ok(parse(recordElement('valid-image','image',{src:'data:image/png;base64,AA',name:'Image'})),'image elements remain supported');
  assert.ok(parse(recordElement('valid-gif','image',{giphyId:'gif-123'})),'legacy GIF id-only image elements remain supported');
  assert.ok(parse(recordElement('valid-video','video',{src:'https://example.invalid/video.mp4',name:'Video'})),'video elements remain supported');
});

test('malformed backups stay untouched and cannot partially replace the live board',()=>{
  storage.clear();
  const malformed=JSON.stringify({els:[],pages:[{id:'p',name:'bad',els:[null],cam:{x:0,y:0,z:1}}],pi:0});
  storage.set('ghdraw:backup-before-collab',malformed);
  assert.equal(parseLocalBoardRecord(malformed),null,'null elements are rejected');
  assert.equal(localBoardBackupEntries().length,0,'malformed backups are excluded from restore choices');
  assert.equal(hasLocalBoardBackups(),true,'the original backup key remains visible for recovery diagnostics');
  context.els=[recordElement('live-board')];context.cam={x:4,y:5,z:1};context.defaults={stroke:'#123456'};context.grid=true;context.dark=false;context.pi=0;context.pages=[{id:'live-page',name:'Live',els:context.els,cam:context.cam}];
  storage.set('ghdraw:v2',malformed);
  const before=json({els:context.els,cam:context.cam,defaults:context.defaults,grid:context.grid,dark:context.dark,pages:context.pages,pi:context.pi});
  assert.equal(restoreLocalBoardRecord(malformed,true),false,'malformed data cannot be explicitly applied');
  load();
  assert.deepEqual(json({els:context.els,cam:context.cam,defaults:context.defaults,grid:context.grid,dark:context.dark,pages:context.pages,pi:context.pi}),before,'load validates the full record before changing app state');
  assert.equal(storage.get('ghdraw:backup-before-collab'),malformed,'unreadable backup remains intact');
  assert.equal(storage.get('ghdraw:v2'),malformed,'failed load does not rewrite the stored record');
  const legacy=parseLocalBoardRecord(JSON.stringify({els:[recordElement('legacy')],cam:{x:0,y:0,z:1}}));
  assert.equal(legacy.pages.length,1,'valid legacy single-page records remain recoverable');
});

test('pre-collaboration backup finalizes an active edit before serialization',()=>{
  storage.clear();context.els=[recordElement('pre-edit')];context.pages=[{id:'edit-page',name:'Edit',els:[],cam:{x:0,y:0,z:1}}];context.editing={active:true};
  const finish=context.finishEdit;
  context.finishEdit=()=>{context.els=[recordElement('finished-edit','text',{text:'latest text'})];context.editing=null};
  assert.equal(preserveLocalBoardBeforeCloudJoin(),true);
  const saved=JSON.parse(storage.get('ghdraw:backup-before-collab'));
  assert.equal(saved.els[0].text,'latest text');
  context.finishEdit=finish;context.editing=null;
});

test('restoring a backup requires confirmation and keeps both the selected copy and current board',()=>{
  storage.clear();
  context.els=[recordElement('saved-private')];context.pages=[{id:'private-page',name:'Private',els:[],cam:{x:0,y:0,z:1}}];context.pi=0;context.cloudRoom=null;context.collabOn=false;
  const selected=localBoardRecord();storage.set('ghdraw:backup-before-collab',selected);
  context.els=[recordElement('current-room-board')];context.pages=[{id:'room-page',name:'Room',els:[],cam:{x:0,y:0,z:1}}];context.cloudRoom={id:'live-room'};context.collabOn=true;
  const current=localBoardRecord();storage.set('ghdraw:v2',current);
  const finish=context.finishEdit;context.editing={active:true};context.finishEdit=()=>{context.els=[recordElement('current-room-board','text',{text:'latest room edit'})];context.editing=null};
  assert.equal(restoreLocalBoardRecord(selected,false),false,'cancel does not restore');
  assert.equal(storage.get('ghdraw:v2'),current,'cancel leaves current board storage unchanged');
  assert.equal(restoreLocalBoardRecord(selected,true),true,'confirmed restore succeeds');
  assert.equal(storage.get('ghdraw:v2'),selected,'confirmed restore installs the selected board');
  assert.equal(storage.get('ghdraw:backup-before-collab'),selected,'selected backup is retained');
  assert.ok(localBoardBackupEntries().some(entry=>entry.data.els[0]?.text==='latest room edit'),'the latest current edit is retained as another backup');
  assert.equal(context.cloudRoom,null,'restoring from a cloud room closes it locally');
  assert.equal(context.collabOn,false);context.finishEdit=finish;

  const start=html.indexOf('function openLocalBoardBackupRestore(){');
  const restore=html.slice(start,html.indexOf('\nfunction buildMenu()',start));
  assert.ok(restore.indexOf('confirm(preview)')<restore.indexOf('restoreLocalBoardRecord(selected.record,true)'), 'explicit preview confirmation precedes restore');
  assert.ok(restore.includes('localBoardBackupSummary(selected.data,selected.key)'), 'confirmation displays the selected backup summary');
  assert.ok(html.includes('openLocalBoardBackupRestore'), 'restore flow is wired into the menu');
});

test('offline join without a room checkpoint exits before loading an IndexedDB snapshot',()=>{
  assert.equal(cloudJoinCanContinue(false,null),false);
  assert.equal(cloudJoinCanContinue(false,{base:null}),false);
  assert.equal(cloudJoinCanContinue(false,{base}),true);
  assert.equal(cloudJoinCanContinue(true,null),true);

  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){');
  const join=html.slice(start,html.indexOf("\naddEventListener('offline'",start));
  const guard=join.indexOf('if(!cloudJoinCanContinue(navigator.onLine,cached))');
  assert.ok(guard>=0&&guard<join.indexOf('cloudLocalSnapshot(id)'), 'checkpointless offline exit precedes snapshot loading');
  assert.ok(guard<join.indexOf('restoreCloudSnapshot({board:safeLocal},id)'), 'checkpointless offline exit precedes board mutation');
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

test('share creation retries reuse the same cryptographic request ID',async()=>{
  const calls=[];let attempts=0;
  const context={crypto:{getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes}},cloudRequest:async(path,body)=>{calls.push({path,body:JSON.stringify(body)});if(attempts++===0)throw new TypeError('offline');return{id:'share-id'}}};
  const start=html.indexOf('async function cloudCreate('),end=html.indexOf('\nfunction cloudBoard(',start);assert.ok(start>=0&&end>start,'missing cloudCreate');
  vm.runInNewContext(html.slice(start,end)+';globalThis.runCreate=cloudCreate;',context);
  const result=await context.runCreate('view',{p:[{id:'page',e:[]}]});
  assert.equal(result.id,'share-id');assert.equal(calls.length,2);assert.equal(calls[0].path,'/create');assert.equal(calls[0].body,calls[1].body);
  assert.equal(JSON.parse(calls[0].body).requestId,'000102030405060708090a0b0c0d0e0f');
});
