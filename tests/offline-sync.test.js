import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import BoardElementContract from '../backend/shared/board-element-contract.js';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const restoreGateStart=html.indexOf('function historyRestoreBlocksInput('),restoreGateEnd=html.indexOf("\ndocument.addEventListener('pointerdown',historyRestoreBlocksInput,true);",restoreGateStart);
assert.ok(restoreGateStart>=0&&restoreGateEnd>restoreGateStart,'missing restore input/close guards');
const restoreGateSource=html.slice(restoreGateStart,restoreGateEnd);
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
  extract('cloudGenerationKey','runCloudRoomLocked'),
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
  extract('localBoardRoomId','restoreCloudSnapshot'),
  html.slice(html.indexOf('function restoreCloudSnapshot('),html.indexOf('\nasync function cloudRequest(',html.indexOf('function restoreCloudSnapshot('))),
  extract('cloudDiff','cloudApplyChanges'),
  extract('cloudApplyChanges','cloudRebase'),
  extract('cloudRebase','cloudMerge'),
  extract('cloudProtocolCompatible','blockCloudProtocol'),
  serLine,
  'globalThis.api={validCloudChange,cloudGenerationKey,readCloudGeneration,writeCloudGeneration,cloudGenerationValue,cloudRoomGenerationCurrent,invalidateStaleCloudRoom,handleCloudGenerationStorageEvent,cloudCheckpointUnsafeKey,validCloudRestoreId,validCloudRestoreIntent,cloudCheckpointUnsafeMarker,cloudCheckpointIsUnsafe,cloudCheckpointMarkerMatches,markCloudCheckpointUnsafe,clearCloudCheckpointUnsafe,cloudCheckpointCanResume,cloudJoinCanContinue,BOARD_COORD_LIMIT,localBoardRecord,parseLocalBoardRecord,localBoardRestoreGeneration,cloudRejoinGenerationBoard,localBoardBackupLimits,localBoardBackupUsage,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,deleteLocalBoardBackup,preserveLocalBoardBeforeCloudJoin,cloudStaleExportMatchesCurrent,cloudJoinBoardProtected,localBoardFingerprint,ensureStaleLocalBoardProtected,exportQuarantinedLocalBoard,restoreLocalBoardRecord,restoreCloudSnapshot,load,dash,clampBoardCamera,recoverBoardCamera,cloudSelectRejoinBoard,cloudProtocolCompatible,cloudDiff,cloudBoardHasUncheckpointedChanges,cloudApplyChanges,cloudRebase,ser};'
].join('\n');
const storage=new Map();
const mockLocalStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size}};
const context={structuredClone,GHDrawBoardElementContract:BoardElementContract,localStorage:mockLocalStorage,els:[],cam:{x:0,y:0,z:1},defaults:{},grid:false,dark:false,pi:0,pages:[{id:'p1',name:'Board',els:[],cam:{x:0,y:0,z:1}}],cloudRoom:null,cloudStaleLocalRoomId:null,cloudStaleLoadBackupFailed:false,cloudStaleLoadExported:false,cloudStaleLoadExportFingerprint:null,collabOn:false,editing:null,measure:()=>{},uid:()=>'recovery-page',sel:new Set(),hist:[],hidx:0,L2:(tr,en)=>en,document:{body:{classList:{toggle(){}}}},renderCalls:0,saveCalls:0};
context.snap=()=>JSON.stringify(context.els);context.syncUI=()=>{};context.render=()=>{context.renderCalls++};context.save=()=>{context.saveCalls++};
context.syncPage=()=>{const page=context.pages[context.pi];if(page){page.els=context.els;page.cam=context.cam}};
context.finishEdit=()=>{context.editing=null};context.cloudEnd=()=>{context.cloudRoom=null;context.collabOn=false};
vm.runInNewContext(source,context);
const {validCloudChange,cloudCheckpointCanResume,cloudJoinCanContinue,localBoardRecord,parseLocalBoardRecord,localBoardBackupLimits,localBoardBackupUsage,localBoardBackupKeys,writeLocalBoardBackup,localBoardBackupEntries,hasLocalBoardBackups,deleteLocalBoardBackup,preserveLocalBoardBeforeCloudJoin,cloudStaleExportMatchesCurrent,cloudJoinBoardProtected,localBoardFingerprint,ensureStaleLocalBoardProtected,exportQuarantinedLocalBoard,restoreLocalBoardRecord,restoreCloudSnapshot,load,dash,clampBoardCamera,recoverBoardCamera,cloudSelectRejoinBoard,cloudRejoinGenerationBoard,cloudProtocolCompatible,cloudDiff,cloudBoardHasUncheckpointedChanges,cloudApplyChanges,cloudRebase}=context.api;

function makeBoardHarness(){
  const storage=new Map(),localStorage={getItem:key=>storage.has(key)?storage.get(key):null,setItem:(key,value)=>storage.set(key,String(value)),removeItem:key=>storage.delete(key),key:index=>[...storage.keys()][index]??null,get length(){return storage.size}};
  const context={structuredClone,GHDrawBoardElementContract:BoardElementContract,localStorage,els:[],cam:{x:0,y:0,z:1},defaults:{},grid:false,dark:false,pi:0,pages:[{id:'p1',name:'Board',els:[],cam:{x:0,y:0,z:1}}],cloudRoom:null,cloudStaleLocalRoomId:null,cloudStaleLoadBackupFailed:false,cloudStaleLoadExported:false,cloudStaleLoadExportFingerprint:null,collabOn:false,editing:null,drag:false,measure:()=>{},uid:()=>'recovery-page',sel:new Set(),hist:[],hidx:0,L2:(tr,en)=>en,document:{body:{classList:{toggle(){}}}},renderCalls:0,saveCalls:0};
  context.snap=()=>JSON.stringify(context.els);context.syncUI=()=>{};context.render=()=>{context.renderCalls++};context.save=()=>{context.saveCalls++};context.syncPage=()=>{const page=context.pages[context.pi];if(page){page.els=context.els;page.cam=context.cam}};context.finishEdit=()=>{context.editing=null};context.cloudEnd=()=>{context.cloudRoom=null;context.collabOn=false};vm.runInNewContext(source,context);return{context,storage};
}

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
  const quarantineGate=join.indexOf('if(!ensureStaleLocalBoardProtected())'),backupGate=join.indexOf('if(!cloudJoinBoardProtected())');
  assert.ok(quarantineGate>=0&&backupGate>quarantineGate&&join.indexOf('return}',quarantineGate)<join.indexOf('cloudCheckpoint(id)'), 'failed stale-record backup/export aborts before storage reads');
  assert.ok(join.indexOf('cloudJoinBoardProtected()')<join.indexOf('cloudCheckpoint(id)'), 'current board is protected before storage reads');
  const localOverwrite=join.indexOf('if(safeLocal&&safeLocal!==current)'),localProtection=join.indexOf('if(!cloudJoinBoardProtected())',localOverwrite),localRestore=join.indexOf('restoreCloudSnapshot({board:safeLocal}',localOverwrite);assert.ok(localOverwrite>=0&&localProtection>localOverwrite&&localRestore>localProtection,'current-board protection is rechecked before restoring a local snapshot');const remoteOverwrite=join.indexOf('if(!safeLocal&&!createdHere)'),remoteProtection=join.indexOf('if(!cloudJoinBoardProtected())',remoteOverwrite),remoteRestore=join.indexOf('restoreCloudSnapshot({board:d.board}',remoteOverwrite);assert.ok(remoteOverwrite>=0&&remoteProtection>remoteOverwrite&&remoteRestore>remoteProtection,'current-board protection is rechecked before restoring the server snapshot');

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
  assert.equal(parse(recordElement('unreachable-coordinate','rect',{x:1e12})),null,'coordinates beyond the camera-reachable world are rejected');
  assert.equal(parse(recordElement('unreachable-edge','rect',{x:1e9-1,w:2})),null,'shape extents cannot exceed the camera-reachable world');
  assert.equal(parse(recordElement('infinite-coordinate','line',{pts:[[Infinity,0],[1,1]]})),null,'non-finite geometry is rejected');
  const largeElement=recordElement('legacy-large-world','rect',{x:2e6,y:-2e6}),largeCam={x:-2e6,y:2e6,z:1};
  const largeRecord=JSON.stringify({els:[largeElement],cam:largeCam,defaults:{},grid:false,dark:false,pi:0,pages:[{id:'large-page',name:'Large world',els:[largeElement],cam:largeCam}]});
  assert.ok(parseLocalBoardRecord(largeRecord),'valid coordinates beyond the old 1e6 limit remain reloadable');
  storage.set('ghdraw:v2',largeRecord);context.pages=[{id:'before',name:'Before',els:[],cam:{x:0,y:0,z:1}}];context.els=[];context.pi=0;load();
  assert.equal(context.els[0].x,2e6);assert.equal(context.cam.x,-2e6);assert.equal(context.cam.y,2e6);
  const edgeElement=recordElement('reachable-edge','rect',{x:1e9-10,y:-1e9,w:10,h:0}),edgeCamera={x:-8e9,y:8e9,z:8};
  const edgeRecord=JSON.stringify({els:[edgeElement],cam:edgeCamera,defaults:{},grid:false,dark:false,pi:0,pages:[{id:'edge-page',name:'World edge',els:[edgeElement],cam:edgeCamera}]});
  const edgeParsed=parseLocalBoardRecord(edgeRecord);assert.ok(edgeParsed,'the defined world edge is accepted');assert.deepEqual(json(edgeParsed.cam),edgeCamera,'the far-edge shape remains in view at maximum zoom');
  const edgeHarness=makeBoardHarness();edgeHarness.context.els=[edgeElement];edgeHarness.context.cam=edgeCamera;edgeHarness.context.pages=[{id:'edge-page',name:'World edge',els:[edgeElement],cam:edgeCamera}];
  const edgeSaved=edgeHarness.context.api.localBoardRecord(),edgeReloaded=edgeHarness.context.api.parseLocalBoardRecord(edgeSaved);assert.deepEqual(json(edgeReloaded.cam),edgeCamera,'save/load does not clamp away the camera needed to reach maximum accepted coordinates');
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

test('stale ghdraw:v2 backup failure blocks cloud join until backup retry or explicit .ghdraw export',async()=>{
  const h=makeBoardHarness(),c=h.context,store=h.storage,parse=c.api.parseLocalBoardRecord,limits=c.api.localBoardBackupLimits;const large=recordElement('quarantined-shape','text',{text:'x'.repeat(540000)}),cam={x:0,y:0,z:1},raw=JSON.stringify({els:[large],cam,defaults:{},grid:false,dark:false,pi:0,savedAt:1,cloudRoomId:'stale-room',restoreGeneration:0,pages:[{id:'p1',name:'Old room',els:[large],cam}]});assert.ok(parse(raw));assert.ok(raw.length>limits().entry);store.set('ghdraw:restore-generation:stale-room','1');store.set('ghdraw:v2',raw);c.pages=[{id:'p1',name:'Board',els:[],cam}];c.els=[];c.pi=0;c.cam=cam;c.api.load();assert.equal(c.cloudStaleLocalRoomId,'stale-room');assert.equal(c.cloudStaleLoadBackupFailed,true);assert.equal(store.get('ghdraw:v2'),raw,'the unbacked stale record remains byte-for-byte untouched');
  const joinStart=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),joinEnd=html.indexOf("\naddEventListener('offline'",joinStart);assert.ok(joinStart>=0&&joinEnd>joinStart);Object.assign(c,{navigator:{onLine:true,locks:{request:(_n,_o,task)=>Promise.resolve().then(task)}},runCloudRoomLocked:(_id,task)=>task(),cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,buildMenu:()=>{},preserveLocalBoardBeforeCloudJoin:()=>false,setSyncBadge:()=>{},toast:()=>{},L2:tr=>tr});const calls={checkpoint:0,room:0};c.cloudCheckpoint=async()=>{calls.checkpoint++;return null};c.cloudRequest=async()=>{calls.room++;return{}};vm.runInNewContext(html.slice(joinStart,joinEnd)+';globalThis.runCloudJoin=cloudJoin;',c);await c.runCloudJoin('stale-room');assert.deepEqual(calls,{checkpoint:0,room:0},'failed required backup blocks before checkpoint access or any network request');assert.equal(store.get('ghdraw:v2'),raw);
  const live=recordElement('current-live-work','text',{text:'latest in-memory work'});c.pages=[{id:'live-page',name:'Latest',els:[live],cam}];c.els=[live];c.pi=0;c.cam=cam;const downloads=[];c.document.createElement=()=>({click(){downloads.push({...this,blob:c.lastExportBlob})}});c.Blob=class{constructor(parts,options){this.parts=parts;this.type=options.type;c.lastExportBlob=this}};c.URL={createObjectURL:()=> 'blob:recovery',revokeObjectURL:()=>{}};c.setTimeout=()=>{};c.buildMenu=()=>{};c.toast=()=>{};c.L2=(_tr,en)=>en;assert.equal(c.api.exportQuarantinedLocalBoard(),true,'the menu export provides an explicit recovery path');assert.equal(c.cloudStaleLoadExported,true);assert.equal(downloads.length,1);assert.match(downloads[0].download,/\.ghdraw$/);const exported=JSON.parse(downloads[0].blob.parts[0]);assert.equal(exported.type,'ghdraw');assert.equal(exported.recovery.quarantined.cloudRoomId,'stale-room');assert.equal(exported.pages[0].els[0].id,'current-live-work','normal .ghdraw import restores the most recent in-memory board');assert.equal(exported.recovery.quarantined.els[0].id,'quarantined-shape','the exact quarantined board remains embedded in recovery metadata');assert.equal(exported.recovery.live.els[0].id,'current-live-work');assert.equal(parse(JSON.stringify(exported)).els[0].id,'current-live-work','the recovery download is a valid importable .ghdraw board');assert.match(html,/cloudStaleLocalRoomId&&!cloudStaleExportMatchesCurrent\(\)\?\[\[L2\('Karantinadaki panoyu dışa aktar/);
  assert.equal(c.api.ensureStaleLocalBoardProtected(),true,'an acknowledged export satisfies the fail-closed gate');c.navigator.onLine=false;c.cloudCheckpoint=async()=>{calls.checkpoint++;return null};await c.runCloudJoin('stale-room');assert.equal(calls.checkpoint,1,'after export, backup failure no longer blocks entry into subsequent safety checks');assert.equal(calls.room,0);assert.equal(store.get('ghdraw:v2'),raw,'export does not itself mutate the stored raw record');
});

test('mandatory stale-board backups require byte-for-byte raw-record retention',()=>{
  const h=makeBoardHarness(),c=h.context,store=h.storage,cam={x:0,y:0,z:1},shape=recordElement('fingerprint-collision');const raw=JSON.stringify({els:[shape],cam,defaults:{},grid:false,dark:false,pi:0,savedAt:101,cloudRoomId:'exact-room',restoreGeneration:0,pages:[{id:'p1',name:'Room',els:[shape],cam}]}),equivalent=JSON.stringify({...JSON.parse(raw),savedAt:100});assert.equal(c.api.writeLocalBoardBackup(equivalent),true);store.set('ghdraw:v2',raw);store.set('ghdraw:restore-generation:exact-room','1');const originalSet=c.localStorage.setItem;c.localStorage.setItem=(key,value)=>{if(key.startsWith('ghdraw:backup-before-collab:'))throw new Error('quota');return originalSet(key,value)};c.api.load();assert.equal(c.cloudStaleLoadBackupFailed,true,'an equivalent fingerprint is not an exact archival success');assert.equal(c.api.ensureStaleLocalBoardProtected(),false,'join remains blocked until the raw record itself is stored');assert.equal(store.get('ghdraw:v2'),raw);assert.equal(c.api.localBoardBackupEntries().some(entry=>entry.record===raw),false);c.localStorage.setItem=originalSet;assert.equal(c.api.ensureStaleLocalBoardProtected(),true);assert.equal(c.api.localBoardBackupEntries().some(entry=>entry.record===raw),true,'the retry stores the exact serialized record');assert.equal(c.cloudStaleLoadBackupFailed,false);
});

test('cloudCreate rejects an unsafe board before any network request and localizes the error',async()=>{
  const start=html.indexOf('async function cloudCreate('),end=html.indexOf('\nfunction cloudBoard(',start);assert.ok(start>=0&&end>start);for(const [translate,expected] of [[true,'Paylaşmadan önce karantinadaki pano yedeklenmeli veya dışa aktarılmalı.'],[false,'The quarantined local board must be backed up or exported before cloud sharing']]){let requests=0;const ctx={ensureStaleLocalBoardProtected:()=>false,L2:(tr,en)=>translate?tr:en,cloudRequest:async()=>{requests++;return{id:'unexpected'}}};vm.runInNewContext(html.slice(start,end)+';globalThis.runCreate=cloudCreate;',ctx);await assert.rejects(ctx.runCreate('view',{p:[]}),err=>err.message===expected);assert.equal(requests,0,'sharing is blocked before POST');}
});

test('a recovery export does not authorize later edits that cannot be backed up',async()=>{
  const h=makeBoardHarness(),c=h.context,store=h.storage,cam={x:0,y:0,z:1},stale=recordElement('stale-room-board'),raw=JSON.stringify({els:[stale],cam,defaults:{},grid:false,dark:false,pi:0,cloudRoomId:'changed-room',restoreGeneration:0,pages:[{id:'p1',name:'Room',els:[stale],cam}]});store.set('ghdraw:v2',raw);store.set('ghdraw:restore-generation:changed-room','1');c.api.load();assert.equal(c.cloudStaleLoadBackupFailed,false,'the raw stale board has a durable exact backup');assert.equal(c.cloudStaleLocalRoomId,'changed-room');const downloads=[];c.document.createElement=()=>({click(){downloads.push(c.lastExportBlob)}});c.Blob=class{constructor(parts,options){this.parts=parts;this.type=options.type;c.lastExportBlob=this}};c.URL={createObjectURL:()=> 'blob:recovery',revokeObjectURL:()=>{}};c.setTimeout=()=>{};c.buildMenu=()=>{};c.toast=()=>{};c.L2=(_tr,en)=>en;c.pages=[{id:'live',name:'Live',els:[recordElement('exported-state')],cam}];c.els=c.pages[0].els;assert.equal(c.api.exportQuarantinedLocalBoard(),true);assert.equal(c.api.cloudStaleExportMatchesCurrent(),true);
  const joinStart=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),joinEnd=html.indexOf("\naddEventListener('offline'",joinStart);assert.ok(joinStart>=0&&joinEnd>joinStart);const calls={checkpoint:0,room:0};Object.assign(c,{navigator:{onLine:true,locks:{request:(_n,_o,task)=>Promise.resolve().then(task)}},runCloudRoomLocked:(_id,task)=>task(),cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,preserveLocalBoardBeforeCloudJoin:()=>false,buildMenu:()=>{},setSyncBadge:()=>{},toast:()=>{},cloudCheckpoint:async()=>{calls.checkpoint++;return null},cloudRequest:async()=>{calls.room++;return{}},L2:(_tr,en)=>en});vm.runInNewContext(html.slice(joinStart,joinEnd)+';globalThis.runCloudJoin=cloudJoin;',c);
  const changed=recordElement('edited-after-export');c.pages=[{id:'live',name:'Live',els:[changed],cam}];c.els=c.pages[0].els;assert.equal(c.api.cloudStaleExportMatchesCurrent(),false);await c.runCloudJoin('changed-room');assert.deepEqual(calls,{checkpoint:0,room:0},'edited work is protected before checkpoint/network access when the old export is stale');assert.equal(store.get('ghdraw:v2'),raw);
  assert.equal(c.api.exportQuarantinedLocalBoard(),true,'a new export authorizes the updated board');assert.equal(c.api.cloudStaleExportMatchesCurrent(),true);const newest=JSON.parse(downloads.at(-1).parts[0]);assert.equal(newest.pages[0].els[0].id,'edited-after-export');await c.runCloudJoin('changed-room');assert.equal(calls.checkpoint,1,'the exact newly exported board may proceed to later checkpoint validation');assert.equal(calls.room,0,'generation fencing still stops an unsafe room overwrite');
});

test('cloudJoin rechecks board protection after async reads immediately before overwrite',async()=>{
  const remoteBoard={p:[{id:'remote',n:'Remote',e:[]}],d:0};for(const changedAt of ['local-snapshot','room-response']){const h=makeBoardHarness(),c=h.context;let protectionCalls=0,restoreCalls=0,roomCalls=0;c.cloudStaleLocalRoomId='race-room';const mutate=()=>{const e=recordElement('edit-during-'+changedAt);c.pages=[{id:'p1',name:'Edited',els:[e],cam:{x:0,y:0,z:1}}];c.els=[e]};Object.assign(c,{navigator:{onLine:true,locks:{request:(_n,_o,task)=>Promise.resolve().then(task)}},runCloudRoomLocked:(_id,task)=>task(),ensureStaleLocalBoardProtected:()=>true,cloudJoinBoardProtected:()=>++protectionCalls===1,cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,buildMenu:()=>{},setSyncBadge:()=>{},toast:()=>{},L2:(_tr,en)=>en,cloudJoinCanContinue:()=>true,localBoardSavedAt:()=>0,cloudCheckpoint:async()=>null,cloudCheckpointUnsafeMarker:()=>null,cloudLocalSnapshot:async()=>{if(changedAt==='local-snapshot'){mutate();return{id:'race-room',generation:0,updatedAt:Date.now()+1000,board:remoteBoard}}return null},cloudRejoinGenerationBoard:()=>changedAt==='local-snapshot'?remoteBoard:null,cloudBoard:()=>({p:[{id:'local',n:'Local',e:[]}],d:0}),cloudBoardHasUncheckpointedChanges:()=>false,cloudProtocolCompatible:()=>true,cloudRequest:async()=>{roomCalls++;if(changedAt==='room-response')mutate();return{kind:'room',syncProtocol:'room-ops-v1',board:remoteBoard,rev:0,expires:Date.now()+60000}},restoreCloudSnapshot:()=>{restoreCalls++;return true}});const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),end=html.indexOf("\naddEventListener('offline'",start);vm.runInNewContext(html.slice(start,end)+';globalThis.runCloudJoin=cloudJoin;',c);await c.runCloudJoin('race-room');assert.equal(protectionCalls,2,changedAt+': the current board is rechecked after the async read');assert.equal(restoreCalls,0,changedAt+': changed state is not replaced');assert.equal(roomCalls,changedAt==='local-snapshot'?0:1)}
});
test('a real checkpointless cloud join preserves edits made while the room request is pending',async()=>{
  const h=makeBoardHarness(),c=h.context,cam={x:0,y:0,z:1},initial=recordElement('before-join'),late=recordElement('added-during-join','ellipse');
  c.pages=[{id:'p1',name:'Local',els:[initial],cam}];c.els=c.pages[0].els;c.cam=cam;c.pi=0;c.cloudRoom=null;
  const remote={kind:'room',syncProtocol:'room-ops-v1',board:{v:2,d:0,p:[{id:'p1',n:'Remote',e:[recordElement('server-shape')]}]},rev:0,expires:Date.now()+60000};
  let releaseResponse,signalRequest,checkpointWrites=0,merges=0,restores=0;
  const requestStarted=new Promise(resolve=>signalRequest=resolve),response=new Promise(resolve=>releaseResponse=resolve),events=[];
  Object.assign(c,{navigator:{onLine:true,locks:{request:(_name,_options,task)=>Promise.resolve().then(task)}},runCloudRoomLocked:(_id,task)=>task(),ensureStaleLocalBoardProtected:()=>true,cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,buildMenu:()=>{},setSyncBadge:state=>events.push('badge:'+state),toast:message=>events.push('toast:'+message),L2:(_tr,en)=>en,cloudJoinCanContinue:()=>true,localBoardSavedAt:()=>0,localBoardRoomId:()=>'',localBoardRestoreGeneration:()=>0,cloudCheckpoint:async()=>null,cloudLocalSnapshot:async()=>null,cloudCheckpointUnsafeMarker:()=>null,cloudRejoinGenerationBoard:()=>null,cloudBoard:()=>({v:2,d:0,p:c.pages.map(p=>({id:p.id,n:p.name||'',e:p.els.map(e=>({...e}))}))}),cloudProtocolCompatible:()=>true,cloudRequest:async path=>{assert.equal(path,'/room/checkpointless-room');signalRequest();return response},saveCloudCheckpoint:async()=>{checkpointWrites++},cloudMerge:()=>{merges++},restoreCloudSnapshot:()=>{restores++;return true}});
  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),end=html.indexOf("\naddEventListener('offline'",start);assert.ok(start>=0&&end>start);
  vm.runInNewContext(html.slice(start,end)+';globalThis.runJoinLocked=cloudJoinLocked;',c);
  const joining=c.runJoinLocked('checkpointless-room');await requestStarted;
  c.pages[0].els.push(late);c.els=c.pages[0].els;
  releaseResponse(remote);await joining;
  assert.equal(c.els.some(e=>e.id==='added-during-join'),true,'the in-flight local edit remains on the active board');
  assert.equal(restores,0,'the remote snapshot is not installed over a changed board');assert.equal(merges,0,'the changed board is not sent or rebased into a room implicitly');
  assert.equal(checkpointWrites,0,'the join aborts before writing a room checkpoint');assert.equal(c.cloudRoom,null,'the room is not joined on the stale baseline');
  assert.ok(c.api.localBoardBackupEntries().some(entry=>entry.data.els.some(e=>e.id==='added-during-join')),'the actual changed local board is archived before aborting');
  assert.ok(events.some(event=>event==='badge:pending'),'the user is told local edits remain pending');
});
test('clearing storage pressure retries and durably backs up the exact stale ghdraw:v2 record',()=>{
  const h=makeBoardHarness(),c=h.context,store=h.storage;const e=recordElement('stale-small'),cam={x:0,y:0,z:1},raw=JSON.stringify({els:[e],cam,defaults:{},grid:false,dark:false,pi:0,cloudRoomId:'retry-room',restoreGeneration:0,pages:[{id:'p1',name:'Old',els:[e],cam}]});store.set('ghdraw:v2',raw);store.set('ghdraw:restore-generation:retry-room','1');store.set('unrelated-app-data','x'.repeat(2*1024*1024));c.api.load();assert.equal(c.cloudStaleLoadBackupFailed,true);assert.equal(store.get('ghdraw:v2'),raw);store.delete('unrelated-app-data');assert.equal(c.api.ensureStaleLocalBoardProtected(),true,'a retry after freeing unrelated storage writes the original record first');assert.equal(c.cloudStaleLoadBackupFailed,false);assert.ok(c.api.localBoardBackupEntries().some(entry=>entry.record===raw),'the archived recovery copy is the exact rejected ghdraw:v2 payload');assert.equal(store.get('ghdraw:v2'),raw);
});

test('confirmed private backup restore clears the stale-room guard and save/reload works; room backups keep it',()=>{
  const h=makeBoardHarness(),c=h.context,store=h.storage,cam={x:0,y:0,z:1};c.cloudStaleLocalRoomId='stale-room';c.cloudStaleLoadBackupFailed=true;c.pages=[{id:'p1',name:'Old room',els:[recordElement('old-room')],cam}];c.els=c.pages[0].els;c.pi=0;c.cam=cam;const oldRaw=c.api.localBoardRecord('stale-room',0);store.set('ghdraw:v2',oldRaw);const privateElement=recordElement('private-restored'),privateRecord=JSON.stringify({els:[privateElement],cam,defaults:{},grid:false,dark:false,pi:0,cloudRoomId:'',restoreGeneration:0,pages:[{id:'private-page',name:'Private',els:[privateElement],cam}]});assert.equal(c.api.restoreLocalBoardRecord(privateRecord,true),true,'confirmed private restore is allowed after the old raw record was archived');assert.equal(c.cloudStaleLocalRoomId,null);assert.equal(c.cloudStaleLoadBackupFailed,false);assert.equal(c.cloudStaleLoadExported,false);assert.equal(store.get('ghdraw:v2'),privateRecord);
  Object.assign(c,{histSched:()=>{},viewOnly:false,collabOn:false,isHost:false,window:{__storageWarn:false},toast:()=>{}});const saveStart=html.indexOf("function save(roomIdHint='',generationHint=null){"),saveEnd=html.indexOf('\nfunction load()',saveStart);vm.runInNewContext(html.slice(saveStart,saveEnd)+';globalThis.runSave=save;',c);c.pages[0].els.push(recordElement('edit-after-private-restore'));c.els=c.pages[0].els;c.runSave();const saved=c.api.parseLocalBoardRecord(store.get('ghdraw:v2'));assert.ok(saved.els.some(x=>x.id==='edit-after-private-restore'),'normal save resumes after the private restore');c.pages=[];c.els=[];c.api.load();assert.ok(c.els.some(x=>x.id==='edit-after-private-restore'),'a reload restores the saved private edit');
  const roomElement=recordElement('stale-room-backup'),roomRecord=JSON.stringify({els:[roomElement],cam,defaults:{},grid:false,dark:false,pi:0,cloudRoomId:'stale-room',restoreGeneration:0,pages:[{id:'room-page',name:'Room',els:[roomElement],cam}]});c.cloudStaleLocalRoomId='stale-room';assert.equal(c.api.restoreLocalBoardRecord(roomRecord,true),true,'room backup remains explicitly restorable');assert.equal(c.cloudStaleLocalRoomId,'stale-room','restoring a room-scoped backup must not clear its stale generation guard');const before=store.get('ghdraw:v2');c.runSave();assert.equal(store.get('ghdraw:v2'),before,'a stale room backup cannot be saved over before a safe rejoin');
});

test('offline join without a room checkpoint exits before loading an IndexedDB snapshot',()=>{
  const cached={id:'room-1',rev:0,base,inflight:null};
  assert.equal(cloudJoinCanContinue(false,null),false);
  assert.equal(cloudJoinCanContinue(false,{base:null}),false);
  assert.equal(cloudJoinCanContinue(false,cached),true);
  assert.equal(cloudCheckpointCanResume({...cached,inflight:{opId:'a'.repeat(32),baseRev:0,changes:[{t:'mystery'}]}}),false,'unknown persisted changes cannot be replayed or sent');
  assert.equal(cloudCheckpointCanResume({...cached,inflight:0}),false,'a malformed scalar outbox is not treated as an empty queue');
  assert.equal(cloudCheckpointCanResume({...cached,inflight:false}),false,'a false-valued corrupt outbox is rejected');
  const intent={restoreId:'ab'.repeat(16),ts:123,baseRev:0};assert.equal(cloudCheckpointCanResume({...cached,restoreIntent:intent}),true);assert.equal(cloudCheckpointCanResume({...cached,restoreIntent:{...intent,baseRev:1}}),false,'a restore intent cannot refer to a different checkpoint revision');
  assert.equal(cloudJoinCanContinue(true,null),true);

  const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){');
  const join=html.slice(start,html.indexOf("\naddEventListener('offline'",start));
  const guard=join.indexOf('if(!cloudJoinCanContinue(navigator.onLine,cachedReady?cached:null))');
  assert.ok(guard>=0&&guard<join.indexOf('cloudLocalSnapshot(id)'), 'checkpointless offline exit precedes snapshot loading');
  assert.ok(guard<join.indexOf('restoreCloudSnapshot({board:safeLocal},id,roomGeneration)'), 'checkpointless offline exit precedes board mutation');
});

test('online cloudJoin preserves and refuses to overwrite any unvalidated persisted outbox',async()=>{
  storage.clear();
  const sourceStart=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),sourceEnd=html.indexOf("\naddEventListener('offline'",sourceStart),joinSource=html.slice(sourceStart,sourceEnd);
  assert.ok(sourceStart>=0&&sourceEnd>sourceStart,'missing cloudJoin source');
  const cases=[
    {id:'room-1',rev:0,base,inflight:{opId:'ab'.repeat(16),baseRev:0,changes:[{t:'mystery'}]}},
    {id:'other-room',rev:0,base,inflight:{opId:'cd'.repeat(16),baseRev:0,changes:[{t:'put',pid:'p1',e:recordElement('kept-outbox')}]}}
  ];
  for(const cached of cases){
    const events=[],calls={room:0,checkpointRead:0,checkpointWrite:0};
    const ctx={cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,cloudStaleLocalRoomId:null,cloudStaleLoadBackupFailed:false,cloudStaleLoadExported:false,cloudJoinBoardProtected:()=>true,ensureStaleLocalBoardProtected:()=>true,preserveLocalBoardBeforeCloudJoin:()=>true,buildMenu:()=>{},cloudCheckpoint:async()=>{calls.checkpointRead++;return cached},cloudCheckpointUnsafeMarker:context.api.cloudCheckpointUnsafeMarker,cloudCheckpointMarkerMatches:context.api.cloudCheckpointMarkerMatches,clearCloudCheckpointUnsafe:context.api.clearCloudCheckpointUnsafe,cloudCheckpointCanResume,setSyncBadge:state=>events.push('badge:'+state),toast:message=>events.push('toast:'+message),L2:tr=>tr,cloudRequest:async()=>{calls.room++;return{}},saveCloudCheckpoint:async()=>{calls.checkpointWrite++;return true},navigator:{onLine:true,locks:{request:(_name,_options,task)=>Promise.resolve().then(task)}}};ctx.runCloudRoomLocked=(id,task)=>ctx.navigator.locks.request('ghdraw-room-sync:'+id,{mode:'exclusive'},task);
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
  assert.match(html,/function cloudBoard\(includeTextMetrics=false\)/,'network board serialization defaults to the compact representation');assert.match(html,/function scheduleCloudSnapshot\(id,generation=.*cloudBoard\(true\)/,'durable local snapshots include text geometry and capture a room generation');assert.match(html,/saveCloudCheckpoint\(id,oldBase,oldRev,cloudRoom\.expires,candidate,durableCurrent\)/,'staged outbox snapshots preserve geometry before send');
});

test('corrupt restore-generation metadata fails closed',()=>{
 storage.clear();for(const raw of ['', ' 1','01','-1','1.5','9007199254740992']){storage.set('ghdraw:restore-generation:bad-generation',raw);assert.equal(context.api.readCloudGeneration('bad-generation').ok,false,`rejected malformed generation ${JSON.stringify(raw)}`)}storage.delete('ghdraw:restore-generation:bad-generation');assert.equal(context.api.readCloudGeneration('bad-generation').value,null);assert.equal(context.api.cloudRoomGenerationCurrent({id:'bad-generation',generation:-1}),false);
 const record=JSON.parse(localBoardRecord('generation-room',0));for(const generation of [-1,1.5,Number.MAX_SAFE_INTEGER+1,'1'])assert.equal(parseLocalBoardRecord(JSON.stringify({...record,restoreGeneration:generation})),null,`rejected malformed board generation ${JSON.stringify(generation)}`);
});

test('a cross-tab generation storage event immediately invalidates the older room tab',()=>{
  storage.clear();storage.set('ghdraw:restore-generation:event-room','4');context.cloudRoom={id:'event-room',generation:3};const events=[],previous=context.invalidateStaleCloudRoom;context.invalidateStaleCloudRoom=(id,actual)=>events.push({id,actual});context.api.handleCloudGenerationStorageEvent({key:'ghdraw:restore-generation:event-room'});assert.deepEqual(events,[{id:'event-room',actual:4}]);events.length=0;context.api.handleCloudGenerationStorageEvent({key:'ghdraw:restore-generation:another-room'});context.api.handleCloudGenerationStorageEvent({key:'ghdraw:v2'});assert.deepEqual(events,[],'unrelated storage events do not invalidate this room');context.invalidateStaleCloudRoom=previous;context.cloudRoom=null;
});

test('stale-tab invalidation warns when its recovery backup cannot be persisted',()=>{
 storage.clear();context.cloudRoom={id:'backup-failed-room',generation:0};context.cloudRoom.generationStale=false;context.els=[recordElement('still-in-memory')];context.pages=[{id:'p1',name:'Board',els:context.els,cam:{x:0,y:0,z:1}}];context.pi=0;context.cam={x:0,y:0,z:1};context.editing=null;context.cloudPending=false;context.cloudTimer=1;const events=[],previous={write:context.writeLocalBoardBackup,clear:context.clearInterval,live:context.liveStop,badge:context.setSyncBadge,toast:context.toast};context.writeLocalBoardBackup=()=>false;context.clearInterval=()=>{};context.liveStop=()=>{};context.setSyncBadge=state=>events.push('badge:'+state);context.toast=message=>events.push('toast:'+message);try{assert.equal(context.api.invalidateStaleCloudRoom('backup-failed-room',1),true);assert.equal(context.cloudRoom.generationStale,true);assert.equal(context.cloudPending,true);assert.deepEqual(context.els.map(e=>e.id),['still-in-memory']);assert.ok(events.includes('badge:stale'));const warning=events.find(e=>e.startsWith('toast:'));assert.match(warning,/\.ghdraw/);assert.doesNotMatch(warning,/preserved in backups/)}finally{Object.assign(context,{writeLocalBoardBackup:previous.write,clearInterval:previous.clear,liveStop:previous.live,setSyncBadge:previous.badge,toast:previous.toast});context.cloudRoom=null}
});

test('older room tabs cannot overwrite a restored board and can save new edits after rejoining',()=>{
  storage.clear();context.cloudStaleLocalRoomId=null;context.cloudStaleLoadBackupFailed=false;context.cloudRoom=null;context.pages=[{id:'p1',name:'Board',els:[recordElement('removed-by-restore')],cam:{x:0,y:0,z:1}}];context.els=context.pages[0].els;context.pi=0;context.cam={x:0,y:0,z:1};context.defaults={};context.grid=false;context.dark=false;
  const oldRaw=localBoardRecord('generation-room',0),oldBoard=JSON.parse(oldRaw);storage.set('ghdraw:restore-generation:generation-room','1');storage.set('ghdraw:v2',oldRaw);context.pages=[];context.els=[];context.load();assert.equal(context.cloudStaleLocalRoomId,'generation-room','reload rejects a board from the old restore generation');assert.equal(storage.get('ghdraw:v2'),oldRaw,'the rejected local record remains untouched');assert.ok(localBoardBackupEntries().some(entry=>entry.data.els.some(e=>e.id==='removed-by-restore')),'reload creates a recovery backup before rejecting stale data');
  context.pages=[{id:'p1',name:'Board',els:[recordElement('removed-by-restore')],cam:{x:0,y:0,z:1}}];context.els=context.pages[0].els;context.pi=0;context.cam={x:0,y:0,z:1};const authoritative=JSON.stringify({...oldBoard,restoreGeneration:1,els:[],pages:[{id:'p1',name:'Board',els:[],cam:{x:0,y:0,z:1}}]});storage.set('ghdraw:v2',authoritative);
  context.cloudRoom={id:'generation-room',generation:0,expires:0};context.collabOn=true;context.isHost=true;context.viewOnly=false;context.histSched=()=>{};context.setSyncBadge=state=>context.generationEvents.push('badge:'+state);context.toast=message=>context.generationEvents.push('toast:'+message);context.L2=(_tr,en)=>en;context.clearInterval=()=>{};context.liveStop=()=>{};context.cloudTimer=0;context.generationEvents=[];const scheduled=[];context.scheduleCloudSnapshot=(id,generation)=>scheduled.push({id,generation});
  const saveStart=html.indexOf("function save(roomIdHint='',generationHint=null){"),saveEnd=html.indexOf('\nfunction load()',saveStart);assert.ok(saveStart>=0&&saveEnd>saveStart);vm.runInNewContext(html.slice(saveStart,saveEnd)+';globalThis.runSave=save;',context);
  context.runSave();assert.equal(storage.get('ghdraw:v2'),authoritative,'a stale tab cannot replace the restored canonical local record');assert.equal(scheduled.length,0,'the stale tab does not stage a new local snapshot');assert.equal(context.cloudRoom.generationStale,true);assert.ok(context.generationEvents.includes('badge:stale'));assert.ok(localBoardBackupEntries().some(entry=>entry.data.els.some(e=>e.id==='removed-by-restore')),'the old tab’s board is preserved in local recovery backups');
  const latestBoard=structuredClone(base);latestBoard.p[0].e=latestBoard.p[0].e.filter(e=>e.id!=='shape-b');const selected=cloudRejoinGenerationBoard('generation-room','generation-room',0,cloudBoardForTest(oldBoard),latestBoard,1,latestBoard,null,1);assert.deepEqual(json(selected),json(latestBoard),'rejoin chooses the new-generation room snapshot, not the still-open old-generation board');
  context.cloudRoom={id:'generation-room',generation:1,expires:0};context.cloudRoom.generationStale=false;assert.equal(context.api.restoreCloudSnapshot({board:latestBoard},'generation-room',1),true);context.els.push(recordElement('new-edit-after-rejoin','ellipse'));context.runSave();const saved=parseLocalBoardRecord(storage.get('ghdraw:v2'));assert.equal(saved.restoreGeneration,1);assert.ok(saved.els.some(e=>e.id==='new-edit-after-rejoin'));assert.deepEqual(scheduled.at(-1),{id:'generation-room',generation:1},'new user edits after rejoin save under the current generation');
  context.cloudRoom=null;context.collabOn=false;context.generationEvents=[];
});

function cloudBoardForTest(record){return{v:2,d:!!record.dark?1:0,p:(record.pages||[]).map(page=>({id:page.id,n:page.name||'',e:page.els}))}}

function generationFakeDB(room,snapshot){
  const persistent={rooms:new Map([[room.id,structuredClone(room)]]),snapshots:new Map([[snapshot.id,structuredClone(snapshot)]])};
  return{persistent,transaction(names){
    const scope=Array.isArray(names)?names:[names],staged=new Map(scope.map(name=>[name,new Map([...persistent[name]].map(([key,value])=>[key,structuredClone(value)]))]));let aborted=false,finished=false;
    const tx={
      objectStore(name){return{
        get(key){const request={};setTimeout(()=>{if(!finished){request.result=staged.get(name).has(key)?structuredClone(staged.get(name).get(key)):undefined;request.onsuccess?.()}},0);return request},
        put(value){staged.get(name).set(value.id,structuredClone(value))}
      }},
      abort(){if(aborted||finished)return;aborted=true;setTimeout(()=>{if(!finished){finished=true;tx.onabort?.()}},0)}
    };
    setTimeout(()=>{if(finished)return;if(aborted){finished=true;return}for(const name of scope)persistent[name]=staged.get(name);finished=true;tx.oncomplete?.()},20);return tx
  }}
}

test('room restore atomically advances the IDB generation and rejects delayed stale-tab writes',async()=>{
  const id='idb-generation-room',restoreId='ab'.repeat(16),oldBoard=structuredClone(base),restoredBoard=structuredClone(base);restoredBoard.p[0].e=restoredBoard.p[0].e.filter(e=>e.id!=='shape-b');const intent={restoreId,ts:123,baseRev:7,generation:1},room={id,base:oldBoard,rev:7,expires:Date.now()+60000,generation:0,inflight:null,restoreId:null,restoreIntent:intent,updatedAt:2},snapshot={id,board:oldBoard,updatedAt:2,generation:0},db=generationFakeDB(room,snapshot),source=[extract('cloudGenerationKey','runCloudRoomLocked'),extract('cloudCheckpoint','cloudCheckpointMatches'),extract('cloudCheckpointMatches','saveCloudRestoreIntent'),extract('saveCloudRestoreCheckpoint','scheduleCloudSnapshot'),'globalThis.api={saveCloudRestoreCheckpoint,saveCloudLocalSnapshot,saveCloudCheckpoint};'].join('\n'),vmctx={structuredClone,cloudDB:()=>Promise.resolve(db),cloudRoom:{id,generation:0},validCloudRestoreId:()=>true};vm.runInNewContext(source,vmctx);
  assert.equal(await vmctx.api.saveCloudRestoreCheckpoint(id,restoredBoard,9,room.expires,restoredBoard,restoreId,room),true);assert.equal(db.persistent.rooms.get(id).generation,1);assert.equal(db.persistent.snapshots.get(id).generation,1);assert.deepEqual(json(db.persistent.snapshots.get(id).board),json(restoredBoard),'restore board and generation commit together');
  const staleBoard=structuredClone(oldBoard);staleBoard.p[0].e.push(recordElement('must-not-return','ellipse'));await assert.rejects(vmctx.api.saveCloudLocalSnapshot(id,staleBoard,Date.now()+1000,0),/Stale cloud generation/);await assert.rejects(vmctx.api.saveCloudCheckpoint(id,oldBoard,7,room.expires,null,staleBoard,null,0),/Stale cloud generation/);assert.equal(db.persistent.rooms.get(id).generation,1);assert.deepEqual(json(db.persistent.snapshots.get(id).board),json(restoredBoard),'neither delayed stale write reintroduces removed content');
  vmctx.cloudRoom.generation=1;const explicitEdit=structuredClone(restoredBoard);explicitEdit.p[0].e.push(recordElement('new-explicit-edit','ellipse'));assert.equal(await vmctx.api.saveCloudLocalSnapshot(id,explicitEdit,Date.now()+2000,1),true);assert.equal(db.persistent.snapshots.get(id).generation,1);assert.ok(db.persistent.snapshots.get(id).board.p[0].e.some(e=>e.id==='new-explicit-edit'),'after reloading the latest generation, a new edit can be persisted');
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
  assert.match(html,/cloudRoomId:id,restoreGeneration:generation/);
  assert.match(html,/cloudRejoinGenerationBoard\(id,savedRoomId,currentGeneration,current,snapshotBoard/);
  assert.match(html,/addEventListener\('online'/);
  assert.match(html,/if\(cachedReady&&cached\.inflight\).*await cloudSyncLocked\(id\)/);
});

test('a failed IndexedDB open clears the rejected cached promise and permits retry',async()=>{
 const requests=[],db={},context={cloudDBPromise:null,window:{indexedDB:{}},indexedDB:{open(){const q={};requests.push(q);queueMicrotask(()=>{if(requests.length===1){q.error=new Error('temporary open failure');q.onerror()}else{q.result=db;q.onsuccess()}});return q}}};
 const start=html.indexOf('function cloudDB(){'),end=html.indexOf('\nfunction runCloudRoomLocked(',start);assert.ok(start>=0&&end>start);vm.runInNewContext(html.slice(start,end)+';globalThis.openCloudDB=cloudDB;',context);
 await assert.rejects(context.openCloudDB(),e=>e.message.includes('temporary open failure'));assert.equal(context.cloudDBPromise,null,'rejected open promise is not permanently cached');assert.equal(await context.openCloudDB(),db);assert.equal(requests.length,2,'the later open creates a fresh IndexedDB request');
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
  const context={crypto:{getRandomValues(bytes){for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes}},ensureStaleLocalBoardProtected:()=>true,cloudRequest:async(path,body)=>{calls.push({path,body:JSON.stringify(body)});if(attempts++===0)throw new TypeError('offline');return{id:'share-id'}}};
  const start=html.indexOf('async function cloudCreate('),end=html.indexOf('\nfunction cloudBoard(',start);assert.ok(start>=0&&end>start,'missing cloudCreate');
  vm.runInNewContext(html.slice(start,end)+';globalThis.runCreate=cloudCreate;',context);
  const result=await context.runCreate('view',{p:[{id:'page',e:[]}]});
  assert.equal(result.id,'share-id');assert.equal(calls.length,2);assert.equal(calls[0].path,'/create');assert.equal(calls[0].body,calls[1].body);
  assert.equal(JSON.parse(calls[0].body).requestId,'000102030405060708090a0b0c0d0e0f');
});

function cloudSyncHarness(overrides={}){
 const calls=[],events=[],current=structuredClone(local),changes=[{t:'put',pid:'p1',e:{id:'shape-a',type:'rect',x:11}}],room={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:0,expires:Date.now()+60000};
 const context={structuredClone,cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,cloudRoom:{id:'sync-room',expires:0,generation:0},cloudBase:structuredClone(base),cloudRev:0,cloudInflight:null,cloudBusy:false,cloudPending:false,document:{hidden:false},navigator:{onLine:true,locks:{request:(_name,_options,task)=>Promise.resolve().then(task)}},drag:false,editing:null,cloudRoomGenerationCurrent:()=>true,invalidateStaleCloudRoom:(id,actual)=>events.push('stale:'+id+':'+actual),readCloudGeneration:()=>({ok:true,value:0}),cloudGenerationValue:record=>record?.generation===undefined?0:Number.isSafeInteger(record?.generation)?record.generation:null,cloudCheckpointIsUnsafe:()=>false,cloudCheckpointCanResume,
  cloudBoard:()=>structuredClone(current),cloudDiff:()=>structuredClone(changes),cloudApplyChanges:board=>structuredClone(board),newCloudOpId:()=>'durable-operation-1',cloudCheckpoint:async()=>null,cloudLocalSnapshot:async()=>null,saveCloudCheckpoint:async()=>true,
  cloudRequest:async(path,body)=>{events.push(body?'post':'probe');calls.push({path,body});return body?{...room,rev:1,ack:body.opId}:{...room}},cloudProtocolCompatible:(d,op=null)=>!!d&&d.kind==='room'&&d.syncProtocol==='room-ops-v1'&&Number.isSafeInteger(d.rev)&&(!op||d.ack===op.opId),
  blockCloudProtocol:()=>{throw new Error('unexpected protocol block')},cloudMerge:()=>{},setSyncBadge:state=>events.push('badge:'+state),L2:(_tr,en)=>en,toast:message=>events.push('toast:'+message),$:()=>({title:''}),clearInterval:()=>{},clearCloudCheckpointUnsafe:()=>events.push('checkpoint-marker-cleared'),liveStop:()=>{},cloudTimer:0};
 context.runCloudRoomLocked=(id,task)=>context.navigator.locks?.request('ghdraw-room-sync:'+id,{mode:'exclusive'},task)||null;
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

test('cloudSync refuses to replay or post from a tab whose room generation is stale',async()=>{
 const h=cloudSyncHarness({cloudRoomGenerationCurrent:()=>false,readCloudGeneration:()=>({ok:true,value:1})});await h.run();assert.equal(h.calls.length,0,'stale generation is checked before checkpoint reads, probes, or writes');assert.ok(h.events.includes('stale:sync-room:1'),'the tab is invalidated with the current generation');
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

test('cloudSync pauses before any send while a restore safety marker remains unresolved',async()=>{
  const h=cloudSyncHarness({cloudCheckpointIsUnsafe:()=>true});await h.run();assert.equal(h.calls.length,0,'an unresolved restore marker blocks the probe and every operation POST');assert.equal(h.context.cloudPending,true);assert.ok(h.events.includes('badge:storage'));
});

test('cloud sync and join fail closed when cross-tab Web Locks are unavailable',async()=>{
 const sync=cloudSyncHarness({navigator:{onLine:true}});await sync.run();assert.equal(sync.calls.length,0);assert.equal(sync.context.cloudPending,true);assert.ok(sync.events.includes('badge:storage'));
 const rejected=cloudSyncHarness({navigator:{onLine:true,locks:{request:()=>Promise.reject(new Error('lock denied'))}}});await rejected.run();assert.equal(rejected.calls.length,0);assert.equal(rejected.context.cloudPending,true);assert.ok(rejected.events.includes('badge:storage'));
 const start=html.indexOf('async function cloudJoin(id,host=false,createdHere=false){'),end=html.indexOf('\naddEventListener(\'offline\'',start),events=[];let backedUp=false;const ctx={navigator:{onLine:true},setSyncBadge:state=>events.push('badge:'+state),toast:message=>events.push(message),L2:(_tr,en)=>en,preserveLocalBoardBeforeCloudJoin:()=>{backedUp=true;return true},cloudJoinBoardProtected:()=>{backedUp=true;return true}};vm.runInNewContext(html.slice(start,end)+';globalThis.join=cloudJoin;',ctx);await ctx.join('room');assert.equal(backedUp,false);assert.ok(events.some(event=>String(event).includes('lacks the cross-tab safety lock')));
 const rejectedEvents=[],rejectedJoin={navigator:{onLine:true,locks:{request:()=>Promise.reject(new Error('lock denied'))}},setSyncBadge:state=>rejectedEvents.push('badge:'+state),toast:message=>rejectedEvents.push(message),L2:(_tr,en)=>en,preserveLocalBoardBeforeCloudJoin:()=>{backedUp=true;return true},cloudJoinBoardProtected:()=>{backedUp=true;return true},runCloudRoomLocked:(id,task)=>rejectedJoin.navigator.locks.request('room:'+id,{mode:'exclusive'},task)};backedUp=false;vm.runInNewContext(html.slice(start,end)+';globalThis.join=cloudJoin;',rejectedJoin);await rejectedJoin.join('room');assert.equal(backedUp,false);assert.ok(rejectedEvents.some(event=>String(event).includes('lock denied')));
});

function memoryWebLocks(){
 const tails=new Map();return{request(name,_options,task){const prior=tails.get(name)||Promise.resolve();let release;const gate=new Promise(resolve=>release=resolve),tail=prior.catch(()=>{}).then(()=>gate);tails.set(name,tail);return prior.catch(()=>{}).then(task).finally(()=>{release();if(tails.get(name)===tail)tails.delete(name)})}}
}

function cloudHistoryRestoreHarness({inflight=null,syncMode='ready',requestError=null,deferredResponse=null,locks=null,checkpointStore=null}={}){
 const saved=[],events=[],restoreRequests=[],backups=[],store=checkpointStore||{value:{id:'history-room',base:structuredClone(base),rev:7,generation:0,expires:Date.now()+60000,inflight:inflight?structuredClone(inflight):null,restoreId:null,restoreIntent:null,updatedAt:1}};
 let current=structuredClone(base);if(inflight)current=cloudApplyChanges(base,inflight.changes);
 const restored=structuredClone(base);restored.p[0].e[0].x=1;const response={kind:'room',syncProtocol:'room-ops-v1',board:restored,rev:9,expires:Date.now()+60000};
 const lockApi=locks||{request:(_name,_options,task)=>Promise.resolve().then(task)};
 const hctx={structuredClone,localStorage:mockLocalStorage,historyRestoreInProgress:false,setHistoryRestoreBusy:busy=>{hctx.historyRestoreInProgress=!!busy;events.push('restore-busy:'+!!busy)},cloudRoom:{id:'history-room',generation:store.value.generation||0,expires:Date.now()+60000},cloudBusy:false,cloudInflight:inflight?structuredClone(inflight):null,cloudBase:structuredClone(store.value.base),cloudRev:store.value.rev,cloudPending:!!(inflight||store.value.inflight),cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,navigator:{onLine:true,locks:lockApi},confirm:()=>true,L2:(_tr,en)=>en,newCloudOpId:()=>'ef'.repeat(16),validCloudRestoreIntent:context.api.validCloudRestoreIntent,cloudCheckpointCanResume,cloudGenerationValue:context.api.cloudGenerationValue,cloudRoomGenerationCurrent:()=>true,readCloudGeneration:context.api.readCloudGeneration,writeCloudGeneration:context.api.writeCloudGeneration,invalidateStaleCloudRoom:(id,g)=>events.push('stale:'+id+':'+g),cloudProtocolCompatible:context.api.cloudProtocolCompatible,cloudCheckpoint:async()=>store.value?structuredClone(store.value):null,cloudCheckpointIsUnsafe:context.api.cloudCheckpointIsUnsafe,cloudCheckpointUnsafeMarker:context.api.cloudCheckpointUnsafeMarker,cloudCheckpointMarkerMatches:context.api.cloudCheckpointMarkerMatches,markCloudCheckpointUnsafe:context.api.markCloudCheckpointUnsafe,clearCloudCheckpointUnsafe:context.api.clearCloudCheckpointUnsafe,cloudBoard:()=>structuredClone(current),cloudDiff:(b,l)=>cloudDiff(b,l),cloudMerge:(d,sent)=>{events.push({kind:'merge',sent:structuredClone(sent)});hctx.cloudBase=structuredClone(d.board);hctx.cloudRev=d.rev;current=structuredClone(d.board);hctx.cloudPending=false},preserveLocalBoardBeforeCloudJoin:()=>{backups.push(structuredClone(current));return true},saveCloudRestoreIntent:async(id,intent,expected)=>{if(!store.value||store.value.id!==id||store.value.updatedAt!==expected.updatedAt||store.value.inflight)return false;store.value={...store.value,restoreIntent:structuredClone(intent),updatedAt:store.value.updatedAt+1};events.push('intent-write');return true},saveCloudRestoreCheckpoint:async(id,board,rev,expires,local,restoreId,expected)=>{if(!store.value||store.value.id!==id||store.value.updatedAt!==expected.updatedAt||store.value.restoreIntent?.restoreId!==restoreId||store.value.inflight)return false;const next={id,base:structuredClone(board),rev,expires,generation:store.value.restoreIntent?.generation??(store.value.generation||0)+1,inflight:null,restoreId,restoreIntent:null,updatedAt:store.value.updatedAt+1};store.value=next;saved.push({...structuredClone(next),local:structuredClone(local)});return true},clearCloudRestoreIntent:async(id,expected)=>{if(!store.value||store.value.id!==id||store.value.updatedAt!==expected.updatedAt||store.value.restoreIntent?.restoreId!==expected.restoreIntent?.restoreId)return false;store.value={...store.value,restoreIntent:null,updatedAt:store.value.updatedAt+1};return true},cloudRequest:async(path,body)=>{if(path==='/hist/history-room'){restoreRequests.push({path,body:structuredClone(body)});events.push('restore-request');if(requestError)throw requestError;if(deferredResponse)return await deferredResponse.promise;return{...response,ack:body.restoreId}}throw new Error('Unexpected cloud request '+path)},cloudSyncLocked:async()=>{events.push('sync-start');if(syncMode==='ack'){if(store.value?.inflight){events.push('outbox-ack');current=cloudApplyChanges(store.value.base,store.value.inflight.changes);store.value={...store.value,base:structuredClone(current),rev:store.value.rev+1,inflight:null,updatedAt:store.value.updatedAt+1};hctx.cloudBase=structuredClone(current);hctx.cloudRev=store.value.rev;hctx.cloudInflight=null}hctx.cloudPending=false;hctx.cloudProtocolVerified=true}else if(syncMode==='ready'){hctx.cloudPending=false;hctx.cloudProtocolVerified=true}else{events.push('sync-unresolved');hctx.cloudPending=!!store.value?.inflight||hctx.cloudPending}},runCloudRoomLocked:(id,task)=>lockApi.request('ghdraw-room-sync:'+id,{mode:'exclusive'},task),clearInterval:()=>events.push('timer-cleared'),cloudTimer:1,liveStop:()=>events.push('live-stopped'),hist:[],hidx:0,snap:()=>JSON.stringify(current),syncUI:()=>events.push({kind:'sync-ui'}),closeModal:(force=false)=>{if(hctx.historyRestoreInProgress&&!force){events.push({kind:'close-blocked'});return false}events.push({kind:'closed'});return true},toast:message=>events.push({kind:'toast',message}),setSyncBadge:state=>events.push({kind:'badge',state})};
 const start=html.indexOf('async function histRestoreCloud(ts){'),end=html.indexOf("\ndocument.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')histSnap(false,true)})",start);assert.ok(start>=0&&end>start,'missing cloud history restore');vm.runInNewContext(html.slice(start,end)+';globalThis.runHistoryRestore=histRestoreCloud;',hctx);return{hctx,store,saved,events,restored,response,restoreRequests,backups,run:hctx.runHistoryRestore,current:()=>structuredClone(current)};
}

function cloudJoinRecoveryHarness(cached,locks=null){
 if(cached.generation===undefined)cached={...cached,generation:0};
 const calls={room:0,checkpointWrite:0,sync:0,history:0,restore:0,restoreBodies:[]},events=[];let state=structuredClone(cached),current=structuredClone(cached.base);const response={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(cached.base),rev:cached.rev,expires:cached.expires||Date.now()+60000},lockApi=locks||{request:(_name,_options,task)=>Promise.resolve().then(task)};
 const hctx={structuredClone,cloudProtocolBlocked:false,cloudReceiptQuotaBlocked:false,cloudProtocolVerified:false,preserveLocalBoardBeforeCloudJoin:()=>true,buildMenu:()=>{},cloudCheckpoint:async()=>state?structuredClone(state):null,cloudCheckpointUnsafeMarker:context.api.cloudCheckpointUnsafeMarker,cloudCheckpointMarkerMatches:context.api.cloudCheckpointMarkerMatches,clearCloudCheckpointUnsafe:context.api.clearCloudCheckpointUnsafe,cloudCheckpointCanResume,cloudJoinCanContinue,cloudGenerationValue:context.api.cloudGenerationValue,readCloudGeneration:context.api.readCloudGeneration,writeCloudGeneration:context.api.writeCloudGeneration,cloudRejoinGenerationBoard:context.api.cloudRejoinGenerationBoard,localBoardRestoreGeneration:()=>0,localBoardRoomId:()=>cached.id,validCloudRestoreIntent:context.api.validCloudRestoreIntent,cloudLocalSnapshot:async()=>null,localBoardSavedAt:()=>0,localBoardRoomId:()=>cached.id,cloudBoard:()=>structuredClone(current),cloudSelectRejoinBoard:()=>null,restoreCloudSnapshot:({board})=>{current=structuredClone(board);events.push('restore-remote');return true},navigator:{onLine:true,locks:lockApi},cloudRequest:async(path,body)=>{if(path.startsWith('/hist/')){calls.restore++;calls.restoreBodies.push(structuredClone(body));const recovered=structuredClone(base);recovered.p[0].e[0].x=3;return{kind:'room',syncProtocol:'room-ops-v1',board:recovered,rev:state.rev+1,expires:state.expires,ack:body.restoreId}}calls.room++;return{...response,board:structuredClone(state.base),rev:state.rev}},cloudProtocolCompatible:()=>true,cloudRoomGenerationCurrent:()=>true,invalidateStaleCloudRoom:(id,g)=>events.push('stale:'+id+':'+g),cloudRoom:null,cloudBase:null,cloudRev:0,cloudInflight:null,cloudPending:true,cloudBusy:false,saveCloudRestoreCheckpoint:async(id,board,rev,expires,_local,restoreId)=>{state={id,base:structuredClone(board),rev,expires,generation:state.restoreIntent?.generation??(state.generation||0)+1,inflight:null,restoreId,restoreIntent:null,updatedAt:(state.updatedAt||1)+1};current=structuredClone(board);calls.checkpointWrite++;return true},saveCloudCheckpoint:async(id,board,rev,expires,inflight)=>{state={id,base:structuredClone(board),rev,expires,generation:hctx.cloudRoom?.generation||0,inflight:inflight||null,restoreId:state.restoreId||null,restoreIntent:null,updatedAt:(state.updatedAt||1)+1};calls.checkpointWrite++;return true},cloudSyncLocked:async()=>{calls.sync++},cloudMerge:(d)=>{hctx.cloudBase=structuredClone(d.board);hctx.cloudRev=d.rev;current=structuredClone(d.board);hctx.cloudPending=false},setSyncBadge:state=>events.push('badge:'+state),toast:message=>events.push('toast:'+message),L2:tr=>tr,collabOn:false,isHost:false,roomId:null,conns:[],peersN:0,hostConn:null,cloudTimer:0,history:{replaceState:()=>calls.history++},location:{href:'https://ghdraw.test/#collab='+cached.id},setStatus:()=>{},clearInterval:()=>{},setInterval:()=>1,liveStart:()=>{},hist:[],hidx:0,snap:()=>JSON.stringify(current),buildPages:()=>{},render:()=>{}};
 hctx.runCloudRoomLocked=(id,task)=>lockApi.request('ghdraw-room-sync:'+id,{mode:'exclusive'},task);
 const start=html.indexOf('function activateOfflineCloud(id,host,cached,protocolBlocked=false){'),end=html.indexOf("\naddEventListener('offline'",start);assert.ok(start>=0&&end>start,'missing cloudJoin recovery');vm.runInNewContext(html.slice(start,end)+';globalThis.runCloudJoin=cloudJoin;globalThis.runRestoreRecovery=reconcileCloudRestoreIntent;',hctx);return{hctx,calls,events,run:hctx.runCloudJoin,recover:hctx.runRestoreRecovery,state:()=>structuredClone(state)};
}

test('cloud history restore checkpoints its acknowledged revision before any later rebase',async()=>{
  storage.clear();const h=cloudHistoryRestoreHarness();await h.run(123);const cp=h.store.value;
  assert.equal(h.saved.length,1);assert.equal(h.saved[0].id,'history-room');assert.equal(h.saved[0].rev,9);assert.deepEqual(json(h.saved[0].base),json(h.restored));assert.deepEqual(json(h.saved[0].local),json(h.restored));assert.equal(h.saved[0].inflight,null);assert.equal(context.api.validCloudRestoreId(h.saved[0].restoreId),true);assert.equal(cp.restoreIntent,null);assert.equal(context.api.cloudCheckpointIsUnsafe('history-room'),false,'a durably saved restore clears the fail-closed marker');assert.ok(h.events.indexOf('sync-start')<h.events.indexOf('restore-request'));
  const peer=structuredClone(h.restored);peer.p[0].e[0].x=2;const stale=cloudRebase(peer,base,h.restored),safe=cloudRebase(peer,h.saved[0].base,h.restored);assert.equal(stale.board.p[0].e[0].x,1);assert.equal(safe.board.p[0].e[0].x,2);
});

test('delayed history restore blocks pointer edits and modal dismissal until the checkpoint is durable',async()=>{
 storage.clear();let resolveRestore;const deferredResponse={promise:new Promise(resolve=>resolveRestore=resolve)},h=cloudHistoryRestoreHarness({deferredResponse}),restore=h.run(123);
 for(let i=0;i<20&&!h.events.includes('restore-request');i++)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(h.events.includes('restore-request'),'the test reached the delayed server response');assert.equal(h.hctx.historyRestoreInProgress,true,'the busy lock is set before awaiting the restore response');
 vm.runInNewContext(restoreGateSource+';globalThis.restoreGate={historyRestoreBlocksInput,historyRestoreCloseBlocked};',h.hctx);
 let editCount=0,prevented=false,stopped=false;const pointer={preventDefault(){prevented=true},stopImmediatePropagation(){stopped=true}};
 if(!h.hctx.restoreGate.historyRestoreBlocksInput(pointer))editCount++;
 assert.equal(editCount,0,'a pointer edit cannot run while the restore request is pending');assert.equal(prevented,true);assert.equal(stopped,true);assert.equal(h.hctx.restoreGate.historyRestoreCloseBlocked(false),true,'Escape/X/backdrop dismissal is blocked');assert.equal(h.hctx.restoreGate.historyRestoreCloseBlocked(true),false,'the restore flow may close its own modal after completion');
 h.hctx.closeModal();assert.ok(h.events.some(event=>event.kind==='close-blocked'),'a user close attempt leaves the modal open');assert.equal(h.store.value.inflight,null,'no outbox operation was discarded');
 resolveRestore({...h.response,ack:h.restoreRequests[0].body.restoreId});await restore;
 assert.equal(h.hctx.historyRestoreInProgress,false,'editing is unblocked after atomic checkpoint persistence');assert.equal(h.saved.length,1);assert.deepEqual(json(h.saved[0].base),json(h.restored));assert.ok(h.events.some(event=>event.kind==='closed'));
});

test('history restore refuses to proceed while a durable outbox lacks authoritative ACK',async()=>{
 storage.clear();const op={opId:'ab'.repeat(16),baseRev:7,changes:[{t:'put',pid:'p1',e:recordElement('pending-shape','ellipse')}]},h=cloudHistoryRestoreHarness({inflight:op,syncMode:'failure'});await h.run(123);
 assert.equal(h.restoreRequests.length,0,'restore is not submitted while any outbox entry remains');assert.equal(h.store.value.inflight.opId,op.opId);assert.deepEqual(json(h.store.value.inflight.changes),json(op.changes));assert.equal(h.backups.length,0);assert.ok(h.events.some(event=>event.kind==='toast'&&event.message.includes('outbox was not changed')));
});

test('history restore waits for lost-ACK retry to be authoritatively acknowledged first',async()=>{
 storage.clear();const op={opId:'ab'.repeat(16),baseRev:7,changes:[{t:'put',pid:'p1',e:recordElement('acknowledged-before-restore','ellipse')}]},h=cloudHistoryRestoreHarness({inflight:op,syncMode:'ack'});await h.run(123);
 assert.equal(h.events.indexOf('outbox-ack')<h.events.indexOf('restore-request'),true);assert.equal(h.store.value.inflight,null);assert.equal(h.restoreRequests.length,1);assert.equal(h.restoreRequests[0].body.op,'restore');assert.equal(h.restoreRequests[0].body.restoreId,h.store.value.restoreId);assert.ok(h.backups[0].p[0].e.some(e=>e.id==='acknowledged-before-restore'),'the acknowledged board remains available in local backup');
});

test('uncertain restore response retains one durable restoreId for retry',async()=>{
 storage.clear();const h=cloudHistoryRestoreHarness({requestError:new TypeError('connection lost')});await h.run(123);const cp=h.store.value,token=cp.restoreIntent?.restoreId;assert.equal(context.api.validCloudRestoreIntent(cp.restoreIntent),true,JSON.stringify(cp.restoreIntent));assert.equal(cloudCheckpointCanResume(cp),true,'a valid pending intent remains resumable');
 assert.equal(h.restoreRequests.length,1);assert.equal(context.api.validCloudRestoreId(token),true);assert.equal(cp.inflight,null);assert.equal(context.api.cloudCheckpointIsUnsafe('history-room'),true);assert.equal(context.api.cloudCheckpointUnsafeMarker('history-room'),token);assert.ok(h.events.some(event=>event.kind==='toast'&&event.message.includes('same restoreId')));
 const recovered=cloudJoinRecoveryHarness(cp);assert.match(html,/reconcileCloudRestoreIntent\(id,cached\)/);const recoveredCheckpoint=await recovered.recover('history-room',cp);assert.equal(recovered.calls.restore,1,JSON.stringify({calls:recovered.calls,events:recovered.events,state:recovered.state()}));assert.equal(recovered.calls.restoreBodies[0].restoreId,token);assert.equal(recoveredCheckpoint.restoreIntent,null);assert.equal(recoveredCheckpoint.restoreId,token);assert.equal(context.api.cloudCheckpointIsUnsafe('history-room'),false,'rejoin reconciliation clears only after checkpoint validation');
});

test('restore checkpoint marker clear failure stops sync but leaves a self-validating checkpoint',async()=>{
 storage.clear();const remove=mockLocalStorage.removeItem,h=cloudHistoryRestoreHarness();mockLocalStorage.removeItem=()=>{throw new Error('storage denied')};try{await h.run(123)}finally{mockLocalStorage.removeItem=remove}const cp=h.store.value;
 assert.equal(h.saved.length,1);assert.equal(cloudCheckpointCanResume(cp),true);assert.equal(cp.inflight,null);assert.equal(cp.restoreIntent,null);assert.equal(context.api.cloudCheckpointMarkerMatches(context.api.cloudCheckpointUnsafeMarker('history-room'),'history-room',cp),true);assert.ok(h.events.includes('timer-cleared'));assert.ok(h.events.includes('live-stopped'));assert.ok(h.events.some(event=>event.kind==='badge'&&event.state==='storage'));assert.ok(h.events.some(event=>event.kind==='toast'&&event.message.includes('same restoreId')));
});

test('two tabs serialize sync and restore; restore then refuses the still-unacknowledged outbox',async()=>{
 storage.clear();const locks=memoryWebLocks(),startedResolve={};let postReject;const started=new Promise(resolve=>startedResolve.resolve=resolve);let durable=null;const room={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:7,expires:Date.now()+60000};const store={};Object.defineProperty(store,'value',{get:()=>durable,set:value=>{durable=value}});
 const sync=cloudSyncHarness({cloudRoom:{id:'history-room',expires:room.expires},cloudRev:7,cloudPending:true,navigator:{onLine:true,locks},newCloudOpId:()=>'aa'.repeat(16),cloudDiff:()=>[{t:'put',pid:'p1',e:recordElement('sync-race-shape','ellipse')}],cloudCheckpoint:async()=>durable?structuredClone(durable):null,saveCloudCheckpoint:async(id,board,rev,expires,inflight)=>{durable={id,base:structuredClone(board),rev,expires,inflight:structuredClone(inflight),restoreId:null,restoreIntent:null,updatedAt:Date.now()}},cloudRequest:async(_path,body)=>{if(body){startedResolve.resolve();return new Promise((_resolve,reject)=>{postReject=reject})}return room}});
 const syncPromise=sync.run();await started;const restore=cloudHistoryRestoreHarness({locks,checkpointStore:store,syncMode:'failure'});const restorePromise=restore.run(123);await new Promise(resolve=>setImmediate(resolve));assert.equal(restore.restoreRequests.length,0);assert.equal(restore.events.includes('sync-start'),false,'the second tab cannot enter the room lock during the in-flight POST');
 postReject(new TypeError('lost network'));await syncPromise;await restorePromise;assert.equal(restore.restoreRequests.length,0);assert.equal(durable.inflight.opId,'aa'.repeat(16));assert.ok(restore.events.includes('sync-start'),JSON.stringify(restore.events));assert.ok(restore.events.some(event=>event.kind==='toast'&&event.message.includes('outbox was not changed')));
});

test('detached history-restore outbox retries its original opId without deriving a stale sent board',async()=>{
  const op={opId:'cd'.repeat(16),baseRev:0,changes:[{t:'put',pid:'p1',e:recordElement('detached-shape','ellipse')}],restoreDetached:true},peer={kind:'room',syncProtocol:'room-ops-v1',board:structuredClone(base),rev:9,expires:Date.now()+60000};let sentSeen=null,posted=null;
  const h=cloudSyncHarness({cloudBase:structuredClone(base),cloudRev:8,cloudInflight:op,cloudProtocolVerified:false,cloudCheckpoint:async()=>({id:'sync-room',base:structuredClone(base),rev:8,expires:Date.now()+60000,inflight:op,restoreId:null,restoreIntent:null,updatedAt:1}),cloudRequest:async(_path,body)=>{if(body){posted=body;return{...peer,ack:body.opId,rev:10}}return peer},cloudMerge:(_d,sent)=>{sentSeen=structuredClone(sent)}});await h.run();
  assert.equal(posted.opId,op.opId);assert.equal(posted.baseRev,op.baseRev);assert.deepEqual(json(posted.changes),json(op.changes));assert.deepEqual(json(sentSeen),json(local),'a restored outbox uses the current durable board as its sync comparison point');assert.equal(h.context.cloudInflight,null);
});
