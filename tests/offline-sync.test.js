import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const fontsStart=html.indexOf('const FONTS='),fontsEnd=html.indexOf('\n',fontsStart);
assert.ok(fontsStart>=0&&fontsEnd>fontsStart,'missing font allowlist');
const fontsSource=html.slice(fontsStart,fontsEnd);
const serLine=html.split('\n').find(line=>line.startsWith('const ser='));
assert.ok(serLine,'missing element serializer');
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
  extract('validCloudElement','cloudSelectRejoinBoard'),
  extract('cloudSelectRejoinBoard','cloudDiff'),
  extract('localBoardRecord','save'),
  extract('isBoardObject','validBoardCamera'),
  extract('validBoardCamera','validBoardElement'),
  extract('validBoardElement','validBoardDefaults'),
  extract('validBoardDefaults','normalizeBoardElement'),
  extract('normalizeBoardElement','normalizeBoardDefaults'),
  extract('normalizeBoardDefaults','parseLocalBoardRecord'),
  extract('parseLocalBoardRecord','normalizeCloudRoomBoard'),
  extract('normalizeCloudRoomBoard','localBoardBackupLimits'),
  extract('localBoardBackupLimits','localBoardBackupKeys'),
  extract('dash','roughPass'),
  loadSource,
  extract('localBoardBackupKeys','localBoardBackupUsage'),
  extract('localBoardBackupUsage','writeLocalBoardBackup'),
  extract('writeLocalBoardBackup','localBoardBackupEntries'),
  extract('localBoardBackupEntries','hasLocalBoardBackups'),
  extract('hasLocalBoardBackups','deleteLocalBoardBackup'),
  extract('deleteLocalBoardBackup','preserveLocalBoardBeforeCloudJoin'),
  extract('preserveLocalBoardBeforeCloudJoin','restoreLocalBoardRecord'),
  extract('restoreLocalBoardRecord','localBoardRoomId'),
  html.slice(html.indexOf('function restoreCloudSnapshot('),html.indexOf('\nasync function cloudRequest(',html.indexOf('function restoreCloudSnapshot('))),
  extract('cloudDiff','cloudApplyChanges'),
  extract('cloudApplyChanges','cloudRebase'),
  extract('cloudRebase','cloudMerge'),
  extract('cloudProtocolCompatible','blockCloudProtocol'),
  serLine,
  'globalThis.api={validCloudChange,cloudCheckpointUnsafeKey,cloudCheckpointIsUnsafe,markCloudCheckpointUnsafe,clearCloudCheckpointUnsafe,cloudCheckpointCanResume,cloudJoinCanContinue,localBoardRecord,parseLocalBoardRecord,localBoardBackupLimits,localBoardBackupUsage,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,deleteLocalBoardBackup,preserveLocalBoardBeforeCloudJoin,restoreLocalBoardRecord,restoreCloudSnapshot,load,dash,clampBoardCamera,recoverBoardCamera,cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudBoardHasUncheckpointedChanges,cloudApplyChanges,cloudRebase,ser};'
].join('\n');
const storage=new Map();
const mockLocalStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size}};
const context={structuredClone,localStorage:mockLocalStorage,els:[],cam:{x:0,y:0,z:1},defaults:{},grid:false,dark:false,pi:0,pages:[{id:'p1',name:'Board',els:[],cam:{x:0,y:0,z:1}}],cloudRoom:null,collabOn:false,editing:null,measure:()=>{},uid:()=>'recovery-page',sel:new Set(),hist:[],hidx:0,document:{body:{classList:{toggle(){}}}},renderCalls:0,saveCalls:0};
context.snap=()=>JSON.stringify(context.els);context.syncUI=()=>{};context.render=()=>{context.renderCalls++};context.save=()=>{context.saveCalls++};
context.syncPage=()=>{const page=context.pages[context.pi];if(page){page.els=context.els;page.cam=context.cam}};
context.finishEdit=()=>{context.editing=null};context.cloudEnd=()=>{context.cloudRoom=null;context.collabOn=false};
vm.runInNewContext(source,context);
const {validCloudChange,cloudCheckpointCanResume,cloudJoinCanContinue,localBoardRecord,parseLocalBoardRecord,localBoardBackupLimits,localBoardBackupUsage,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,deleteLocalBoardBackup,preserveLocalBoardBeforeCloudJoin,restoreLocalBoardRecord,restoreCloudSnapshot,load,dash,clampBoardCamera,recoverBoardCamera,cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudBoardHasUncheckpointedChanges,cloudApplyChanges,cloudRebase}=context.api;

const base={v:2,d:0,p:[
  {id:'p1',n:'Board',e:[
    {id:'shape-a',type:'rect',x:0,y:0,w:10,h:10,seed:1,stroke:'#1e1e1e',bg:'transparent',fill:'hachure',sw:2,style:'solid',rough:1,round:true,opacity:100,text:'base',th:[{id:'m1',t:'first'}]},
    {id:'shape-b',type:'rect',x:4,y:0,w:10,h:10,seed:2,stroke:'#1e1e1e',bg:'transparent',fill:'hachure',sw:2,style:'solid',rough:1,round:true,opacity:100}
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
  const largeElement=recordElement('legacy-large-world','rect',{x:2e6,y:-2e6}),largeCam={x:-2e6,y:2e6,z:1};
  const largeRecord=JSON.stringify({els:[largeElement],cam:largeCam,defaults:{},grid:false,dark:false,pi:0,pages:[{id:'large-page',name:'Large world',els:[largeElement],cam:largeCam}]});
  assert.ok(parseLocalBoardRecord(largeRecord),'valid coordinates beyond the old 1e6 limit remain reloadable');
  storage.set('ghdraw:v2',largeRecord);context.pages=[{id:'before',name:'Before',els:[],cam:{x:0,y:0,z:1}}];context.els=[];context.pi=0;load();
  assert.equal(context.els[0].x,2e6);assert.equal(context.cam.x,-2e6);assert.equal(context.cam.y,2e6);
  assert.deepEqual(json(clampBoardCamera({x:1e12,y:-1e12,z:100})),{x:9e9,y:-9e9,z:8},'camera is clamped before rendering/saving so future boards remain within the accepted range');
  const farCamera={x:9e9,y:-9e9,z:1},visible=recordElement('camera-recovery','rect'),farRecord=JSON.stringify({els:[visible],cam:farCamera,pi:0,pages:[{id:'far-camera-page',name:'',els:[visible],cam:farCamera}]}),recovered=parseLocalBoardRecord(farRecord);
  assert.ok(recovered);assert.notEqual(recovered.cam.x,9e9);assert.notEqual(recovered.cam.y,-9e9);assert.deepEqual(json(recovered.cam),json(recovered.pages[0].cam),'saved camera outside every page item is recentered so the board is reachable after reload');
  const empty=parseLocalBoardRecord(JSON.stringify({els:[],cam:farCamera,pi:0,pages:[{id:'empty-camera-page',name:'',els:[],cam:farCamera}]}));assert.deepEqual(json(empty.cam),{x:0,y:0,z:1},'empty pages do not reopen at an unreachable pan offset');
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

test('local backup retention is bounded and never silently deletes an existing recovery copy',()=>{
  storage.clear();const limit=localBoardBackupLimits(),recordFor=id=>{const e=recordElement(id),cam={x:0,y:0,z:1};return JSON.stringify({els:[e],cam,defaults:{},grid:false,dark:false,pi:0,savedAt:Date.now(),pages:[{id:'page-'+id,name:'Local',els:[e],cam}]})};
  for(let i=0;i<limit.count;i++){const key=i===0?'ghdraw:backup-before-collab':'ghdraw:backup-before-collab:archive-'+i;storage.set(key,recordFor('archive-'+i))}
  const before=[...storage.entries()];assert.equal(writeLocalBoardBackup(recordFor('fifth-backup')),false,'full archive refuses another snapshot instead of evicting an older one');assert.deepEqual([...storage.entries()],before,'a failed backup never silently removes or overwrites stored recovery data');
  storage.clear();const tooLargeText=recordElement('large-backup','text',{text:'x'.repeat(270000)}),largeCam={x:0,y:0,z:1},largeRecord=JSON.stringify({els:[tooLargeText],cam:largeCam,defaults:{},grid:false,dark:false,pi:0,pages:[{id:'large-page',name:'Large',els:[tooLargeText],cam:largeCam}]});assert.ok(parseLocalBoardRecord(largeRecord),'oversize fixture is otherwise valid');assert.ok(largeRecord.length>limit.entry);assert.equal(writeLocalBoardBackup(largeRecord),false,'an individual backup above the size cap is refused');
  storage.clear();storage.set('unrelated-app-data','x'.repeat(limit.origin));assert.equal(writeLocalBoardBackup(recordFor('storage-headroom')),false,'a backup is refused before localStorage headroom is exhausted');
  storage.clear();const key='ghdraw:backup-before-collab';storage.set(key,recordFor('delete-confirmation'));assert.equal(deleteLocalBoardBackup(key,false),false,'deletion requires explicit confirmation');assert.notEqual(storage.get(key),undefined);assert.equal(deleteLocalBoardBackup(key,true),true,'confirmed management can free storage');assert.equal(storage.has(key),false);
  assert.match(html,/Manage local board backups/,'the menu exposes the explicit backup-management flow');assert.match(html,/permanently deleted/,'the UI warns before irreversible local backup deletion');
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
  const cached={id:'room-1',rev:0,base,inflight:null};
  assert.equal(cloudJoinCanContinue(false,null),false);
  assert.equal(cloudJoinCanContinue(false,{base:null}),false);
  assert.equal(cloudJoinCanContinue(false,cached),true);
  assert.equal(cloudCheckpointCanResume({...cached,inflight:{opId:'a'.repeat(32),baseRev:0,changes:[{t:'mystery'}]}}),false,'unknown persisted changes cannot be replayed or sent');
  assert.equal(cloudCheckpointCanResume({...cached,inflight:0}),false,'a malformed scalar outbox is not treated as an empty queue');
  assert.equal(cloudCheckpointCanResume({...cached,inflight:false}),false,'a false-valued corrupt outbox is rejected');
  assert.equal(cloudJoinCanContinue(true,null),true);

  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){');
  const join=html.slice(start,html.indexOf("\naddEventListener('offline'",start));
  const guard=join.indexOf('if(!cloudJoinCanContinue(navigator.onLine,cachedReady?cached:null))');
  assert.ok(guard>=0&&guard<join.indexOf('cloudLocalSnapshot(id)'), 'checkpointless offline exit precedes snapshot loading');
  assert.ok(guard<join.indexOf('restoreCloudSnapshot({board:safeLocal},id)'), 'checkpointless offline exit precedes board mutation');
});

test('online cloudJoin preserves and refuses to overwrite any unvalidated persisted outbox',async()=>{
  const sourceStart=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),sourceEnd=html.indexOf("\naddEventListener('offline'",sourceStart),joinSource=html.slice(sourceStart,sourceEnd);
  assert.ok(sourceStart>=0&&sourceEnd>sourceStart,'missing cloudJoin source');
  const cases=[
    {id:'room-1',rev:0,base,inflight:{opId:'ab'.repeat(16),baseRev:0,changes:[{t:'mystery'}]}},
    {id:'other-room',rev:0,base,inflight:{opId:'cd'.repeat(16),baseRev:0,changes:[{t:'put',pid:'p1',e:recordElement('kept-outbox')}]}}
  ];
  for(const cached of cases){
    const events=[],calls={room:0,checkpointRead:0,checkpointWrite:0};
    const ctx={cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,preserveLocalBoardBeforeCloudJoin:()=>true,buildMenu:()=>{},cloudCheckpoint:async()=>{calls.checkpointRead++;return cached},cloudCheckpointIsUnsafe:()=>false,cloudCheckpointCanResume,setSyncBadge:state=>events.push('badge:'+state),toast:message=>events.push('toast:'+message),L2:tr=>tr,cloudRequest:async()=>{calls.room++;return{}},saveCloudCheckpoint:async()=>{calls.checkpointWrite++;return true}};
    vm.runInNewContext(joinSource+';globalThis.runCloudJoin=cloudJoin;',ctx);
    const before=json(cached.inflight);await ctx.runCloudJoin('room-1');
    assert.equal(calls.checkpointRead,1);assert.equal(calls.room,0,'a bad durable outbox never reaches the network');assert.equal(calls.checkpointWrite,0,'cloudJoin cannot replace the rejected outbox with an empty checkpoint');assert.deepEqual(json(cached.inflight),before,'the original outbox remains untouched');assert.ok(events.includes('badge:storage'));assert.ok(events.some(event=>event.startsWith('toast:')&&event.includes('outbox korunuyor')));
  }
});

test('offline room snapshots reject null elements before render and remeasure legacy text metrics',()=>{
  const malformed={v:2,d:0,p:[{id:'bad-page',n:'Bad',e:[null]}]},room={kind:'room',syncProtocol:'room-ops-v1',board:{p:base.p},rev:0};
  const cached={id:'room-1',rev:0,base:malformed,inflight:null};
  assert.equal(cloudJoinCanContinue(false,cached),false,'a malformed cached room board cannot authorize offline resume');
  assert.equal(cloudCheckpointCanResume({...cached,base,inflight:{opId:'a'.repeat(32),baseRev:0,changes:[{t:'put',pid:'p1',e:null}]}}),false,'malformed durable outbox deltas cannot activate or rebase');
  assert.equal(cloudProtocolCompatible({...room,board:malformed}),false,'malformed online room responses fail protocol validation');
  assert.equal(cloudSelectRejoinBoard('room-1','room-1',malformed,malformed,malformed,null),null,'null items are rejected from every cached-board candidate');
  context.pages=[{id:'kept-page',name:'Kept',els:[recordElement('keep')],cam:{x:0,y:0,z:1}}];context.els=context.pages[0].els;context.pi=0;context.cam={x:7,y:8,z:1};context.renderCalls=0;context.saveCalls=0;const previous=json({pages:context.pages,els:context.els,cam:context.cam});
  assert.equal(restoreCloudSnapshot({board:malformed},'room-1'),false);assert.deepEqual(json({pages:context.pages,els:context.els,cam:context.cam}),previous,'invalid cached content cannot partially mutate the live board');assert.equal(context.renderCalls,0);assert.equal(context.saveCalls,0);
  const oldText=recordElement('old-room-text','text',{text:'Offline label'});delete oldText.w;delete oldText.h;delete oldText.lw;context.measure=e=>{e.w=44;e.h=35;e.lw=[44]};
  const oldBoard={v:2,d:0,p:[{id:'text-page',n:'Text',e:[oldText]}]};assert.equal(restoreCloudSnapshot({board:oldBoard},'room-1'),true,'legacy offline snapshot restores after text is remeasured');assert.equal(context.els[0].w,44);assert.equal(context.els[0].h,35);assert.deepEqual(json(context.els[0].lw),[44]);assert.equal(context.renderCalls,1);assert.equal(context.saveCalls,1);
});

test('local snapshots retain text geometry while network boards stay compact',()=>{
  const text=recordElement('text-metrics','text',{text:'Metrics',w:40,h:35,lw:[40]});const room=JSON.parse(context.api.ser(text,true)),peer=JSON.parse(context.api.ser(text));
  assert.deepEqual(json({w:room.w,h:room.h,lw:room.lw}),{w:40,h:35,lw:[40]});assert.equal('w' in peer,false);assert.equal('h' in peer,false);assert.equal('lw' in peer,false);
  assert.match(html,/function cloudBoard\(includeTextMetrics=false\)/,'network board serialization defaults to the compact representation');assert.match(html,/function scheduleCloudSnapshot\(id\).*cloudBoard\(true\)/,'durable local snapshots include text geometry');assert.match(html,/saveCloudCheckpoint\(id,oldBase,oldRev,cloudRoom\.expires,candidate,durableCurrent\)/,'staged outbox snapshots preserve geometry before send');
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

  const roomSnapshot=structuredClone(base);roomSnapshot.p[0].e.push(recordElement('offline-room-shape','ellipse',{x:12}));
  const resumed=cloudSelectRejoinBoard('room-1','other-room',privateBoard,roomSnapshot,base,null);
  assert.deepEqual(json(resumed),json(roomSnapshot),'room snapshot outranks unrelated global localStorage');
  assert.equal(cloudSelectRejoinBoard('room-1','room-1',roomSnapshot,null,base,null),roomSnapshot,'matching room marker preserves same-room local edits');
});

test('checkpointless room snapshots with local changes are preserved instead of silently overwritten',()=>{
  assert.equal(cloudBoardHasUncheckpointedChanges(base,base),false,'identical room and server boards can safely join without a checkpoint');
  const metricsOnly={v:2,d:0,p:[{id:'text-page',n:'Text',e:[recordElement('room-text','text',{text:'Label',w:52,h:35,lw:[52]})]}]},wire=structuredClone(metricsOnly);delete wire.p[0].e[0].w;delete wire.p[0].e[0].h;delete wire.p[0].e[0].lw;
  assert.equal(cloudBoardHasUncheckpointedChanges(wire,metricsOnly),false,'local text geometry alone does not look like an unsynced content edit');
  const snapshot=structuredClone(base);snapshot.p[0].e.push(recordElement('uncheckpointed-shape','ellipse'));
  assert.equal(cloudBoardHasUncheckpointedChanges(base,snapshot),true,'a different room snapshot needs a known base before a rebase');
  assert.equal(cloudBoardHasUncheckpointedChanges(base,null),true,'malformed local state fails closed');
  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),join=html.slice(start,html.indexOf("\naddEventListener('offline'",start));
  const guard=join.indexOf('cloudBoardHasUncheckpointedChanges(d.board,safeLocal)'),merge=join.indexOf('cloudMerge(d,rebaseFrom)');
  assert.ok(guard>=0&&guard<merge,'cloudJoin returns before merge when no valid checkpoint can preserve the local delta');
  assert.match(join,/safeLocal&&cloudBoardHasUncheckpointedChanges\(d\.board,safeLocal\).*return}/,'the selected local room board remains active while the join is refused');
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
  assert.match(sync,/if\(cloudProtocolBlocked\|\|cloudReceiptQuotaBlocked\|\|!cloudRoom/,'protocol incompatibility and a reached room quota prevent scheduled sends');
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
  assert.match(html,/saveCloudCheckpoint\(id,oldBase,oldRev,cloudRoom\.expires,candidate,durableCurrent\)/);
  assert.match(html,/JSON\.stringify\(durable\.inflight\)!==JSON\.stringify\(candidate\)/);
  assert.match(html,/opId:op\.opId,baseRev:op\.baseRev/);
  assert.match(html,/d\.ack===op\.opId/);
  assert.match(html,/cloudLocalSnapshot\(id\)/);
  assert.match(html,/d\.syncProtocol==='room-ops-v1'/);
  const backend=readFileSync(new URL('../backend/src/main.js',import.meta.url),'utf8');
  assert.match(backend,/syncProtocol:'room-ops-v1'/);
  assert.match(html,/cloudRoomId:roomIdHint\|\|cloudRoom\?\.id/);
  assert.match(html,/cloudSelectRejoinBoard\(id,savedRoomId,current,snapshotBoard,cachedReady\?cached\.base:null,null\)/);
  assert.match(html,/addEventListener\('online'/);
  assert.match(html,/if\(cachedReady&&cached\.inflight\).*await cloudSync\(\)/);
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

function cloudSyncHarness(overrides={}){
 const calls=[],events=[],current=structuredClone(local),changes=[{t:'put',pid:'p1',e:{id:'shape-a',type:'rect',x:11}}],room={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:0,expires:Date.now()+60000};
 const context={structuredClone,cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,cloudRoom:{id:'sync-room',expires:0},cloudBase:structuredClone(base),cloudRev:0,cloudInflight:null,cloudBusy:false,cloudPending:false,document:{hidden:false},navigator:{onLine:true},drag:false,editing:null,
  cloudBoard:()=>structuredClone(current),cloudDiff:()=>structuredClone(changes),cloudApplyChanges:board=>structuredClone(board),newCloudOpId:()=>'durable-operation-1',cloudCheckpoint:async()=>null,cloudLocalSnapshot:async()=>null,saveCloudCheckpoint:async()=>true,
  cloudRequest:async(path,body)=>{events.push(body?'post':'probe');calls.push({path,body});return body?{...room,rev:1,ack:body.opId}:{...room}},cloudProtocolCompatible:(d,op=null)=>!!d&&d.kind==='room'&&d.syncProtocol==='room-ops-v1'&&Number.isSafeInteger(d.rev)&&(!op||d.ack===op.opId),
  blockCloudProtocol:()=>{throw new Error('unexpected protocol block')},cloudMerge:()=>{},setSyncBadge:state=>events.push('badge:'+state),L2:(_tr,en)=>en,toast:message=>events.push('toast:'+message),$:()=>({title:''}),clearInterval:()=>{},clearCloudCheckpointUnsafe:()=>events.push('checkpoint-marker-cleared'),liveStop:()=>{},cloudTimer:0};
 Object.assign(context,overrides);const start=html.indexOf('async function cloudSync(){'),end=html.indexOf('\nfunction activateOfflineCloud(',start);assert.ok(start>=0&&end>start,'missing cloudSync');
 vm.runInNewContext(html.slice(start,end)+';globalThis.runCloudSync=cloudSync;',context);return{context,calls,events,run:context.runCloudSync};
}

test('failed IndexedDB outbox persistence never stages an in-memory operation or sends on the next timer',async()=>{
 const h=cloudSyncHarness({cloudCheckpoint:async()=>null,saveCloudCheckpoint:async()=>{throw new Error('IndexedDB quota exceeded')}});
 await h.run();assert.equal(h.context.cloudInflight,null,'a failed write cannot mark the operation in flight');
 await h.run();assert.equal(h.context.cloudInflight,null,'a later retry must stage and persist before marking in flight');
 assert.equal(h.calls.length,0,'no compatibility probe or room POST is made while durable storage fails');
});

test('cloudSync refuses to send when IndexedDB readback differs from the exact staged operation',async()=>{
 let stored=null,reads=0;const h=cloudSyncHarness({
  cloudCheckpoint:async()=>{reads++;return reads===1?null:{...stored,inflight:{...stored.inflight,opId:'different-operation'}}},
  saveCloudCheckpoint:async(id,baseBoard,rev,expires,inflight)=>{stored={id,base:baseBoard,rev,expires,inflight}}
 });
 await h.run();assert.equal(h.context.cloudInflight,null);assert.equal(h.calls.length,0,'a mismatched IndexedDB readback must not reach the network');
});

test('cloudSync reads the exact durable outbox before sending its operation',async()=>{
 let stored=null,context;const events=[];const h=cloudSyncHarness({
  cloudCheckpoint:async()=>{events.push(stored?.inflight?'readback-op':'read');return stored},
  saveCloudCheckpoint:async(id,baseBoard,rev,expires,inflight)=>{events.push('write');stored={id,base:baseBoard,rev,expires,inflight}},
  cloudRequest:async(path,body)=>{if(body){events.push('post');assert.equal(context.cloudInflight.opId,body.opId,'in-memory in-flight is set only after durable readback');return{kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:1,expires:Date.now()+60000,ack:body.opId}}events.push('probe');return{kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:0,expires:Date.now()+60000}}
 });context=h.context;await h.run();
 assert.ok(events.indexOf('write')<events.indexOf('readback-op'));assert.ok(events.indexOf('readback-op')<events.indexOf('post'),'the operation is read back before the POST');
});


test('room receipt limit response exposes a stable code and actionable message',async()=>{
  const payload={error:'room_receipt_limit',message:'Create a new room to continue.'},context={CLOUD:'https://example.test',fetch:async()=>({ok:false,status:409,json:async()=>payload})};
  const start=html.indexOf('async function cloudRequest('),end=html.indexOf('\nasync function cloudCreate(',start);assert.ok(start>=0&&end>start);
  vm.runInNewContext(html.slice(start,end)+';globalThis.runRequest=cloudRequest;',context);
  await assert.rejects(context.runRequest('/room/id',{changes:[]}),e=>e.status===409&&e.code==='room_receipt_limit'&&e.message===payload.message);
});

test('receipt quota rejection keeps the durable outbox and pauses automatic retries',async()=>{
  let stored=null,reads=0,posts=0;const response={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:0,expires:Date.now()+60000},events=[];
  const h=cloudSyncHarness({
    cloudCheckpoint:async()=>reads++===0?null:stored,
    saveCloudCheckpoint:async(id,baseBoard,rev,expires,inflight)=>{stored={id,base:baseBoard,rev,expires,inflight}},
    cloudRequest:async(_path,body)=>{if(body){posts++;throw Object.assign(new Error('Create a new room to continue.'),{status:409,code:'room_receipt_limit'})}return response},
    clearInterval:()=>events.push('timer-cleared'),liveStop:()=>events.push('live-stopped')
  });
  await h.run();assert.equal(posts,1);assert.equal(h.context.cloudReceiptQuotaBlocked,true);assert.equal(h.context.cloudPending,true);assert.equal(h.context.cloudInflight.opId,'durable-operation-1','the rejected operation stays available for safe recovery');assert.ok(events.includes('timer-cleared'));assert.ok(events.includes('live-stopped'));assert.ok(h.events.includes('badge:quota'));
  await h.run();assert.equal(posts,1,'a quota-blocked room does not automatically retry and burn reads');
});

function cloudHistoryRestoreHarness({inflight=null}={}){
  let current=structuredClone(base);const saved=[],events=[],restored=structuredClone(base);restored.p[0].e[0].x=1;const response={kind:'room',syncProtocol:'room-ops-v1',board:restored,rev:8,expires:Date.now()+60000};
  const hctx={structuredClone,localStorage:mockLocalStorage,cloudRoom:{id:'history-room',expires:Date.now()+60000},cloudBusy:false,cloudInflight:inflight?structuredClone(inflight):null,cloudBase:structuredClone(base),cloudRev:7,cloudPending:!!inflight,confirm:()=>true,L2:(_tr,en)=>en,markCloudCheckpointUnsafe:context.api.markCloudCheckpointUnsafe,clearCloudCheckpointUnsafe:context.api.clearCloudCheckpointUnsafe,cloudRequest:async()=>response,cloudBoard:()=>structuredClone(current),cloudMerge:(d,sent)=>{events.push({kind:'merge',sent:structuredClone(sent)});hctx.cloudBase=structuredClone(d.board);hctx.cloudRev=d.rev;current=structuredClone(d.board);hctx.cloudPending=false},saveCloudCheckpoint:async(id,board,rev,expires,op,local)=>{saved.push({id,base:structuredClone(board),rev,expires,inflight:op&&structuredClone(op),local:structuredClone(local)});return true},hist:[],hidx:0,snap:()=>JSON.stringify(current),syncUI:()=>events.push({kind:'sync-ui'}),closeModal:()=>events.push({kind:'closed'}),toast:message=>events.push({kind:'toast',message}),setSyncBadge:state=>events.push({kind:'badge',state})};
  const start=html.indexOf('async function histRestoreCloud(ts){'),end=html.indexOf("\ndocument.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')histSnap(false,true)})",start);assert.ok(start>=0&&end>start,'missing cloud history restore');
  vm.runInNewContext(html.slice(start,end)+';globalThis.runHistoryRestore=histRestoreCloud;',hctx);return{hctx,saved,events,restored,response,run:hctx.runHistoryRestore,current:()=>structuredClone(current)};
}

test('cloud history restore checkpoints its new base/revision before a reload can rebase over peer changes',async()=>{
  storage.clear();const h=cloudHistoryRestoreHarness();await h.run(123);
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].id,'history-room');assert.equal(h.saved[0].rev,8);assert.deepEqual(json(h.saved[0].base),json(h.restored));assert.deepEqual(json(h.saved[0].local),json(h.restored));assert.equal(h.saved[0].inflight,null);assert.equal(context.api.cloudCheckpointIsUnsafe('history-room'),false,'a durably saved restore clears the fail-closed marker');
  const peer=structuredClone(h.restored);peer.p[0].e[0].x=2;
  const stale=cloudRebase(peer,base,h.restored),safe=cloudRebase(peer,h.saved[0].base,h.restored);
  assert.equal(stale.board.p[0].e[0].x,1,'the old checkpoint reproduces the reported collaborator overwrite');assert.equal(safe.board.p[0].e[0].x,2,'the persisted restore checkpoint preserves the collaborator’s newer edit');
});

test('cloud history restore preserves an in-flight outbox and marks its prior revision as detached',async()=>{
  storage.clear();const op={opId:'ab'.repeat(16),baseRev:7,changes:[{t:'put',pid:'p1',e:recordElement('pending-shape','ellipse')}]},h=cloudHistoryRestoreHarness({inflight:op});await h.run(123);const cached={id:'history-room',base:h.saved[0].base,rev:h.saved[0].rev,expires:h.saved[0].expires,inflight:h.saved[0].inflight};
  assert.equal(h.saved.length,1);assert.equal(cached.inflight.opId,op.opId);assert.equal(cached.inflight.baseRev,op.baseRev);assert.deepEqual(json(cached.inflight.changes),json(op.changes));assert.equal(cached.inflight.restoreDetached,true);assert.equal(cloudCheckpointCanResume(cached),true,'the preserved outbox remains safely resumable after the restore revision advances');assert.equal(h.hctx.cloudInflight.opId,op.opId);assert.equal(h.hctx.cloudPending,true);
});

test('detached history-restore outbox retries its original opId without deriving a stale sent board',async()=>{
  const op={opId:'cd'.repeat(16),baseRev:0,changes:[{t:'put',pid:'p1',e:recordElement('detached-shape','ellipse')}],restoreDetached:true},peer={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:9,expires:Date.now()+60000};let sentSeen=null,posted=null;
  const h=cloudSyncHarness({cloudBase:structuredClone(base),cloudRev:8,cloudInflight:op,cloudProtocolVerified:false,cloudRequest:async(_path,body)=>{if(body){posted=body;return{...peer,ack:body.opId,rev:10}}return peer},cloudMerge:(_d,sent)=>{sentSeen=structuredClone(sent)}});await h.run();
  assert.equal(posted.opId,op.opId);assert.equal(posted.baseRev,op.baseRev);assert.deepEqual(json(posted.changes),json(op.changes));assert.deepEqual(json(sentSeen),json(local),'a restored outbox uses the current durable board as its sync comparison point');assert.equal(h.context.cloudInflight,null);
});
