import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {Client,Query,TablesDB} from 'node-appwrite';
import {BOARD_COORD_LIMIT,BOARD_POINT_LIMIT,CLEANUP_PAGE_BUDGET,CLEANUP_ROW_BUDGET,CLEANUP_SPECIAL_ROW_BUDGET,CLEANUP_TIME_BUDGET_MS,createAppwriteDb,createHandler,LIVE_CHAT_MESSAGE_LIMIT,LIVE_CHAT_RECEIPT_LIMIT,LIVE_REQUEST_MAX_BYTES,LIVE_RESPONSE_MAX_BYTES,LIVE_ROOM_PEER_LIMIT,LIVE_ROOM_REQUESTS_PER_SECOND,LIVE_ROW_MAX_BYTES,ROOM_OP_RECEIPT_LIMIT} from './main.js';
import BoardElementContract from '../shared/board-element-contract.js';

const Q={limit:n=>`limit:${n}`,orderAsc:key=>`orderAsc:${key}`,cursorAfter:id=>`cursorAfter:${id}`,select:fields=>`select:${fields.join(',')}`,equal:(key,values)=>`equal:${key}:${JSON.stringify(Array.isArray(values)?values:[values])}`,lessThanEqual:(key,value)=>`lessThanEqual:${key}:${value}`};
const DB='ghdraw',TABLE='boards';
const board=()=>({p:[{id:'page-1',n:'Page 1',e:[{id:'shape-1',type:'rect',x:0,y:0,w:10,h:10}]}]});
const rowData=data=>({payload:JSON.stringify(data),expiresAt:new Date(data.expires).toISOString()});
const lockRow=(id,leaseId,expires)=>[id,{$id:id,...rowData({kind:'lock',leaseId,ts:expires-60000,expires}),$permissions:[]}];
const err=code=>Object.assign(new Error('mock database error'),{code});

test('installed Node SDK sends row and cursor query calls to TablesDB endpoints',async()=>{
 const client=new Client().setEndpoint('https://fra.cloud.appwrite.io/v1').setProject('project-test').setKey('ephemeral-test-key'),calls=[];
 client.call=async(method,uri,headers,payload)=>{calls.push({method,path:uri.pathname,headers,payload});return {rows:[]}};
 const tables=new TablesDB(client);
 await tables.createRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'},permissions:[],transactionId:'tx-test'});
 await tables.getRow({databaseId:DB,tableId:TABLE,rowId:'row-test',transactionId:'tx-test'});
 await tables.updateRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'},transactionId:'tx-test'});
 await tables.deleteRow({databaseId:DB,tableId:TABLE,rowId:'row-test',transactionId:'tx-test'});
 await tables.deleteRows({databaseId:DB,tableId:TABLE,queries:[Query.equal('$id',['row-test'])],transactionId:'tx-test'});
 await tables.listRows({databaseId:DB,tableId:TABLE,queries:[Query.lessThanEqual('expiresAt','2026-10-15T13:22:00.000Z'),Query.orderAsc('expiresAt'),Query.limit(100),Query.select(['$id','expiresAt'])]});
 await tables.createTransaction({ttl:60});
 await tables.updateTransaction({transactionId:'tx-test',commit:true});
 assert.equal(calls.length,8);assert.ok(calls.every(call=>call.path.includes('/tablesdb/')));assert.ok(calls.every(call=>!call.path.includes('/databases/')));
 assert.equal(calls[0].path,'/v1/tablesdb/ghdraw/tables/boards/rows');assert.equal(calls[0].payload.data.payload,'{}');assert.deepEqual(calls[0].payload.permissions,[]);assert.equal(calls[0].payload.transactionId,'tx-test');
 assert.equal(calls[4].method,'delete');assert.equal(calls[4].path,'/v1/tablesdb/ghdraw/tables/boards/rows');assert.equal(calls[4].payload.transactionId,'tx-test');assert.ok(calls[4].payload.queries[0].includes('row-test'));assert.ok(calls[5].payload.queries.some(q=>q.includes('lessThanEqual')&&q.includes('expiresAt')));assert.ok(calls[5].payload.queries.some(q=>q.includes('orderAsc')&&q.includes('expiresAt')));
 assert.ok(calls.some(call=>call.path.endsWith('/rows/row-test')));assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions'));
 assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions/tx-test'));
 });

test('browser and backend load one versioned board element contract',()=>{
 const client=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),worker=readFileSync(new URL('../../sw.js',import.meta.url),'utf8');
 assert.equal(BoardElementContract.VERSION,1);assert.match(client,/<script src="\.\/backend\/shared\/board-element-contract\.js"><\/script>/);assert.match(client,/GHDrawBoardElementContract\.validElement\(e\)/);assert.match(worker,/backend\/shared\/board-element-contract\.js/);
 assert.equal(BoardElementContract.validElement({id:'shape',type:'rect',x:0,y:0,w:10,h:10,unknown:1}),false);
 assert.equal(BoardElementContract.validElement({id:'text',type:'text',x:0,y:0,w:10,h:10,text:'x',font:'Caveat',size:401}),false);
});

test('cloudBoard text wire payload roundtrips through backend create and room edit validation',async()=>{
 const clientHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),serializer=clientHtml.split('\n').find(line=>line.startsWith('const ser=')),start=clientHtml.indexOf('function cloudBoard('),end=clientHtml.indexOf('\nfunction validCloudElement(',start);
 assert.ok(serializer&&start>=0&&end>start,'the production cloudBoard serializer is available');
 const browser={pages:[{id:'page-1',name:'Text',els:[{id:'shared-text',type:'text',x:10,y:20,w:84,h:35,lw:[84],text:'A shared label',font:'Caveat',size:28,align:'left'}]}],dark:false,syncPage(){}};
 vm.runInNewContext(`${serializer}\n${clientHtml.slice(start,end)}\nglobalThis.wireBoard=cloudBoard();`,browser);
 const wireBoard=JSON.parse(JSON.stringify(browser.wireBoard)),wireText=wireBoard.p[0].e[0];
 assert.equal(Object.hasOwn(wireText,'w'),false);assert.equal(Object.hasOwn(wireText,'h'),false);
 assert.equal(BoardElementContract.validElement(wireText),true,'the same shared contract used by the Function accepts the browser serializer output');
 const fx=fixture(),created=await fx.call({method:'POST',path:'/create',body:{kind:'room',board:wireBoard,requestId:'d'.repeat(32)}});
 assert.equal(created.status,201,'room creation accepts the exact cloudBoard payload');
 const edited={...wireText,text:'Edited offline label'},opId='e'.repeat(32),update=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId,baseRev:0,changes:[{t:'put',pid:'page-1',e:edited}]}});
 assert.equal(update.status,200,'room add/edit accepts the exact serialized text contract');assert.equal(update.body.ack,opId);
 assert.equal(update.body.board.p[0].e[0].text,'Edited offline label');
 const before=fx.db.rows.get(created.body.id).payload,invalid=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:'f'.repeat(32),baseRev:1,changes:[{t:'put',pid:'page-1',e:{...edited,w:-1}}]}});
 assert.equal(invalid.status,400,'supplied invalid text metrics remain rejected');assert.equal(fx.db.rows.get(created.body.id).payload,before,'invalid metrics cannot mutate the shared board');
});
test('element ID boundaries roundtrip through the production client wire format, room writes and history restore',async()=>{
 const clientHtml=readFileSync(new URL('../../index.html',import.meta.url),'utf8'),serializer=clientHtml.split('\n').find(line=>line.startsWith('const ser=')),start=clientHtml.indexOf('function cloudBoard('),end=clientHtml.indexOf('\nfunction validCloudElement(',start);assert.ok(serializer&&start>=0&&end>start);
 const wireFor=id=>{const browser={pages:[{id:'page-1',name:'Boundary',els:[{id,type:'rect',x:0,y:0,w:10,h:10},{id:'secondary',type:'rect',x:20,y:0,w:10,h:10}]}],dark:false,syncPage(){}};vm.runInNewContext(`${serializer}\n${clientHtml.slice(start,end)}\nglobalThis.wireBoard=cloudBoard();`,browser);return JSON.parse(JSON.stringify(browser.wireBoard))};
 assert.equal(BoardElementContract.MAX_ELEMENT_ID_LENGTH,256);
 const fx=fixture();
 for(const [index,length] of [128,129,256].entries()){
  const id='i'.repeat(length),payload=wireFor(id);assert.equal(payload.p[0].e[0].id,id);assert.equal(BoardElementContract.validElement(payload.p[0].e[0]),true);
  const created=await fx.call({method:'POST',path:'/create',body:{kind:'room',board:payload,requestId:'d'.repeat(30)+(index+1).toString(16).padStart(2,'0')}});assert.equal(created.status,201,`create accepts ${length}-character ID`);
  let room=await fx.call({method:'GET',path:`/room/${created.body.id}`});assert.equal(room.status,200);assert.equal(room.body.board.p[0].e[0].id,id,'room load preserves the exact opaque ID');
  const firstSave=await fx.call({method:'POST',path:`/hist/${created.body.id}`,body:{op:'save'}});assert.equal(firstSave.status,200);
  const edited={...payload.p[0].e[0],x:3},update=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:'a'.repeat(30)+(index+1).toString(16).padStart(2,'0'),baseRev:0,changes:[{t:'put',pid:'page-1',e:edited}]}});assert.equal(update.status,200,`room write accepts ${length}-character ID`);assert.equal(update.body.board.p[0].e[0].id,id);
  assert.equal((await fx.call({method:'POST',path:`/hist/${created.body.id}`,body:{op:'save'}})).status,200);
  const versions=await fx.call({method:'POST',path:`/hist/${created.body.id}`,body:{}});assert.equal(versions.status,200);assert.ok(versions.body.versions.length>=2);
  const oldTs=versions.body.versions.at(-1).ts,loadedVersion=await fx.call({method:'POST',path:`/hist/${created.body.id}`,body:{op:'get',ts:oldTs}});assert.equal(loadedVersion.status,200);assert.equal(loadedVersion.body.board.p[0].e[0].id,id,'history load preserves the exact ID');
  const restoreId='b'.repeat(30)+(index+1).toString(16).padStart(2,'0'),restored=await fx.call({method:'POST',path:`/hist/${created.body.id}`,body:{op:'restore',ts:oldTs,restoreId}});assert.equal(restored.status,200);assert.equal(restored.body.ack,restoreId);assert.equal(restored.body.board.p[0].e[0].id,id,'server restore preserves the exact ID');
  room=await fx.call({method:'GET',path:`/room/${created.body.id}`});assert.equal(room.body.board.p[0].e[0].id,id,'final load after restore preserves the exact ID');
  const orderOpId='c'.repeat(30)+(index+1).toString(16).padStart(2,'0'),ordered=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:orderOpId,baseRev:room.body.rev,changes:[{t:'order',pid:'page-1',ids:['secondary',id]}]}});assert.equal(ordered.status,200,`room order accepts ${length}-character element ID`);assert.deepEqual(ordered.body.board.p[0].e.map(e=>e.id),['secondary',id],'long element IDs retain their exact identity during reorder');
  const deleteOpId='d'.repeat(30)+(index+1).toString(16).padStart(2,'0'),deleted=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:deleteOpId,baseRev:ordered.body.rev,changes:[{t:'del',pid:'page-1',eid:id}]}});assert.equal(deleted.status,200,`room delete accepts ${length}-character element ID`);assert.deepEqual(deleted.body.board.p[0].e.map(e=>e.id),['secondary'],'long element deletion is applied without truncation');
 }
 const oversize='x'.repeat(257),invalidBoard=wireFor(oversize);assert.equal(invalidBoard.p[0].e[0].id,oversize,'serializer never truncates an oversize ID');assert.equal(BoardElementContract.validElement(invalidBoard.p[0].e[0]),false);
 const invalidCreateFx=fixture(),invalidCreate=await invalidCreateFx.call({method:'POST',path:'/create',body:{kind:'room',board:invalidBoard,requestId:'c'.repeat(32)}});assert.equal(invalidCreate.status,400);assert.equal(invalidCreateFx.db.rows.size,0,'invalid create causes no room, receipt or quota mutation');
 const updateFx=fixture(),validRoom=await createShare(updateFx,'room'),before=updateFx.db.rows.get(validRoom.id).payload,quotaId=roomQuotaRowId(validRoom.id),quotaBefore=updateFx.db.rows.get(quotaId).payload,rejected=await updateFx.call({method:'POST',path:`/room/${validRoom.id}`,body:{opId:'e'.repeat(32),baseRev:0,changes:[{t:'put',pid:'page-1',e:invalidBoard.p[0].e[0]}]}});assert.equal(rejected.status,400);assert.equal(updateFx.db.rows.get(validRoom.id).payload,before,'invalid update cannot mutate board or revision');assert.equal(updateFx.db.rows.get(quotaId).payload,quotaBefore,'invalid update cannot mutate the receipt counter');
 const rejectedDelete=await updateFx.call({method:'POST',path:`/room/${validRoom.id}`,body:{opId:'6'.repeat(32),baseRev:0,changes:[{t:'del',pid:'page-1',eid:oversize}]}});assert.equal(rejectedDelete.status,400,'oversize delete IDs are rejected');
 const rejectedOrder=await updateFx.call({method:'POST',path:`/room/${validRoom.id}`,body:{opId:'7'.repeat(32),baseRev:0,changes:[{t:'order',pid:'page-1',ids:[oversize]}]}});assert.equal(rejectedOrder.status,400,'oversize order IDs are rejected');
 const rejectedPageId=await updateFx.call({method:'POST',path:`/room/${validRoom.id}`,body:{opId:'8'.repeat(32),baseRev:0,changes:[{t:'order',pid:'p'.repeat(129),ids:['valid']}]}});assert.equal(rejectedPageId.status,400,'page IDs remain limited to 128 characters');
 assert.equal(updateFx.db.rows.get(validRoom.id).payload,before,'invalid delta IDs cannot mutate the board or revision');assert.equal(updateFx.db.rows.get(quotaId).payload,quotaBefore,'invalid delta IDs cannot mutate the receipt counter');assert.equal([...updateFx.db.rows.keys()].some(rowId=>rowId.startsWith('o')||rowId.startsWith('h')),false,'invalid updates create no receipt or history');
});
test('301-comment room update survives lost ACK and duplicate retry without replaying comments',async()=>{
 const initialMessages=Array.from({length:300},(_,i)=>({id:'m'+i,t:'comment '+i})),allMessages=[...initialMessages,{id:'m300',t:'comment 300'}];
 const thread=(messages)=>({id:'comment-pin',type:'ellipse',x:0,y:0,w:20,h:20,cm:1,th:messages});
 const fx=fixture(),created=await fx.call({method:'POST',path:'/create',body:{kind:'room',board:{v:2,d:0,p:[{id:'page-1',n:'Board',e:[thread(initialMessages)]}]},requestId:'a'.repeat(32)}});
 assert.equal(created.status,201);const opId='b'.repeat(32),body={opId,baseRev:0,changes:[{t:'put',pid:'page-1',e:thread(allMessages)}]};
 const committed=await fx.call({method:'POST',path:`/room/${created.body.id}`,body});assert.equal(committed.status,200);assert.equal(committed.body.rev,1);
 // Treat the first successful response as lost, as happens when the ACK is dropped on the network.
 const retry=await fx.call({method:'POST',path:`/room/${created.body.id}`,body});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.ack,opId);assert.equal(retry.body.rev,1);
 assert.equal(retry.body.board.p[0].e[0].th.length,301,'comments remain exactly-once after retry');
 const before=fx.db.rows.get(created.body.id).payload,tooMany=Array.from({length:BoardElementContract.MAX_COMMENTS+1},(_,i)=>({id:'over-'+i,t:'x'}));
 const rejected=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:'c'.repeat(32),baseRev:1,changes:[{t:'put',pid:'page-1',e:thread(tooMany)}]}});
 assert.equal(rejected.status,409,'the shared comment cap returns an explicit conflict');assert.equal(rejected.body.error,'comment_limit');assert.equal(fx.db.rows.get(created.body.id).payload,before,'over-limit input does not truncate or mutate existing comments');
});
class MemoryTablesDB{
 constructor(seed=[]){this.rows=new Map(seed);this.transactions=new Map();this.nextTx=0;this.calls=[];this.tablePermissions=[];this.failDeleteOnceId=null;this.failDeleteRowsAt=0;this.beforeTxCommit=null}
 #map(transactionId){if(!transactionId)return this.rows;const tx=this.transactions.get(transactionId);if(!tx)throw err(404);return tx.rows}
 async createTransaction(){const $id=`tx-${++this.nextTx}`,copy=()=>new Map([...this.rows].map(([id,row])=>[id,structuredClone(row)]));this.transactions.set($id,{rows:copy(),original:copy()});return {$id}}
 async updateTransaction({transactionId,commit=false}){
  const tx=this.transactions.get(transactionId);if(!tx)return {};
  if(commit){if(this.beforeTxCommit)await this.beforeTxCommit(transactionId,tx);const same=(a,b)=>a===undefined?b===undefined:b!==undefined&&JSON.stringify(a)===JSON.stringify(b),ids=new Set([...tx.original.keys(),...tx.rows.keys()]);
   for(const id of ids){const old=tx.original.get(id),next=tx.rows.get(id);if(same(old,next))continue;if(!same(this.rows.get(id),old))throw err(409)}
   for(const id of ids){const old=tx.original.get(id),next=tx.rows.get(id);if(same(old,next))continue;if(next===undefined)this.rows.delete(id);else this.rows.set(id,structuredClone(next))}
  }
  this.transactions.delete(transactionId);return {status:commit?'committed':'rolled_back'}
 }
 async getRow({rowId,transactionId}){const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);return structuredClone(rows.get(rowId))}
 async getRowAsAnonymous(rowId){const row=this.rows.get(rowId);if(!row)throw err(404);const permissions=[...this.tablePermissions,...(row.$permissions||[])];if(permissions.some(p=>typeof p==='string'&&/^(read|write)\("any"\)$/.test(p)))return structuredClone(row);throw err(401)}
 async createRow({rowId,data,permissions=[],transactionId}){this.calls.push({op:'createRow',rowId,permissions:structuredClone(permissions)});const rows=this.#map(transactionId);if(rows.has(rowId))throw err(409);const row={$id:rowId,...structuredClone(data),$permissions:structuredClone(permissions)};rows.set(rowId,row);return structuredClone(row)}
 async updateRow({rowId,data,permissions,transactionId}){this.calls.push({op:'updateRow',rowId});const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);const old=rows.get(rowId);const row={...old,...structuredClone(data),$id:rowId};if(permissions!==undefined)row.$permissions=structuredClone(permissions);rows.set(rowId,row);return structuredClone(row)}
 async deleteRow({rowId,transactionId}){this.calls.push({op:'deleteRow',rowId});if(this.failDeleteOnceId===rowId){this.failDeleteOnceId=null;throw err(500)}const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);rows.delete(rowId);return {}}
 async deleteRows({queries=[],transactionId}){this.calls.push({op:'deleteRows',queries:structuredClone(queries)});const batch=this.calls.filter(call=>call.op==='deleteRows').length;if(this.failDeleteRowsAt===batch){this.failDeleteRowsAt=0;throw err(500)}const rows=this.#map(transactionId),ids=queries.filter(q=>q.startsWith('equal:$id:')).flatMap(q=>JSON.parse(q.slice('equal:$id:'.length))),expiryQuery=queries.find(q=>q.startsWith('lessThanEqual:expiresAt:')),cutoff=expiryQuery?.slice('lessThanEqual:expiresAt:'.length);let total=0;for(const id of ids){const row=rows.get(id);if(!row||cutoff&&(!row.expiresAt||row.expiresAt>cutoff))continue;rows.delete(id);total++}return{total,rows:[]}}
 async listRows({databaseId,tableId,queries=[]}){
  assert.equal(databaseId,DB);assert.equal(tableId,TABLE);this.calls.push({op:'listRows',queries:[...queries]});let limit=25,cursor=null,select=null,order=null;
  let expiryCutoff=null;for(const q of queries){if(q.startsWith('limit:'))limit=Number(q.slice(6));else if(q.startsWith('cursorAfter:'))cursor=q.slice(12);else if(q.startsWith('select:'))select=q.slice(7).split(',');else if(q.startsWith('orderAsc:'))order=q.slice(9);else if(q.startsWith('lessThanEqual:expiresAt:'))expiryCutoff=q.slice('lessThanEqual:expiresAt:'.length)}
  let all=[...this.rows.values()];if(expiryCutoff)all=all.filter(row=>row.expiresAt&&row.expiresAt<=expiryCutoff);if(order==='$id')all.sort((a,b)=>a.$id.localeCompare(b.$id));else if(order==='expiresAt')all.sort((a,b)=>String(a.expiresAt).localeCompare(String(b.expiresAt))||a.$id.localeCompare(b.$id));
  if(cursor){if(!this.rows.has(cursor))throw err(404);all=all.filter(row=>row.$id.localeCompare(cursor)>0)}
  const page=all.slice(0,limit).map(row=>select?Object.fromEntries(select.filter(k=>k in row).map(k=>[k,row[k]])):structuredClone(row));return {total:all.length,rows:page}
 }
}

function fixture({env={GROQ_API_KEY:'test-groq-key'},seed=[],clock=()=>Date.now()}={}){
 const db=new MemoryTablesDB(seed),logs=[];let factories=0;
 const handler=createHandler({dbFactory:()=>{factories++;return db},QueryApi:Q,env,clock,fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'Hello from test.'}}]})})});
 const call=async({method='GET',path='/',body,bodyText,headers={}}={})=>{
  const req={method,path,bodyJson:body,bodyText:bodyText===undefined?(body===undefined?'':JSON.stringify(body)):bodyText,headers};
  const res={json:(value,status=200,responseHeaders={})=>({status,headers:responseHeaders,body:value}),text:(text,status=200,responseHeaders={})=>({status,headers:responseHeaders,body:text})};
  return handler({req,res,error:message=>logs.push(String(message))});
 };
 return {db,logs,call,get factories(){return factories}};
}
const createShare=async(fx,kind='view')=>{
 const response=await fx.call({method:'POST',path:'/create',body:{kind,board:board()}});
 assert.equal(response.status,201);return response.body;
};
const roomQuotaRowId=id=>'q'+id.slice(0,31);
const roomOpReceiptRowId=(roomId,opId)=>'o'+createHash('sha256').update(`ghdraw-room-op:${roomId}:${opId}`).digest('hex').slice(0,31);
const liveChatReceiptRowIdForTest=(roomId,mid)=>'j'+createHash('sha256').update(`ghdraw-live-chat:${roomId}:${mid}`).digest('hex').slice(0,31);
const paddedReceiptIds=(existing,count,excluded=[])=>{
 const ids=[...existing],used=new Set([...existing,...excluded]);
 for(let serial=0;ids.length<count;serial++){
  const id='o'+serial.toString(16).padStart(31,'0');if(used.has(id))continue;
  used.add(id);ids.push(id);
 }
 return ids;
};
const update=(fx,id,{opId='11111111111111111111111111111111',baseRev=0,shapeId='shape-2'}={})=>fx.call({method:'POST',path:`/room/${id}`,body:{opId,baseRev,changes:[{t:'put',pid:'page-1',e:{id:shapeId,type:'ellipse',x:0,y:0,w:10,h:10}}]}});
const seededShares=n=>Array.from({length:n},(_,i)=>{const id=(0x10000+i).toString(16).padStart(32,'0'),data={kind:'view',expires:Date.now()+86400000,board:board()};return [id,{$id:id,...rowData(data),$permissions:[]}]});
const MAX_PAYLOAD=12*1024*1024;
function createBodyForStoredBytes(target){
 const requestId='c'.repeat(32),b=board(),expires=Date.now()+7*24*3600000,element=b.p[0].e[0];element.text='x'.repeat(1e6);element.src='x'.repeat(1e7-10);
 const stored=()=>({kind:'view',expires,board:b,room:null,owner:'o'.repeat(48),createReceiptId:'g'+'0'.repeat(31)});
 const room=target-Buffer.byteLength(JSON.stringify(stored()));assert.ok(room>7);element.lw=Array(Math.floor((room-7)/11)).fill(1e9);const padding=target-Buffer.byteLength(JSON.stringify(stored()));assert.ok(padding>=0&&padding<=10);element.src+='x'.repeat(padding);
 assert.equal(Buffer.byteLength(JSON.stringify(stored())),target);
 const body={kind:'view',board:b,requestId};assert.ok(Buffer.byteLength(JSON.stringify(body))<=MAX_PAYLOAD,'raw request stays below the old request-only limit');return body;
}

// Function runtime credentials are ephemeral; no long-lived secret is accepted from the source.
test('concurrent comments over the shared limit return explicit 409 and preserve capped-room duplicate ACKs',async()=>{
 const initialMessages=Array.from({length:BoardElementContract.MAX_COMMENTS-1},(_,i)=>({id:'base-'+i,t:'x'}));
 const thread=(messages)=>({id:'limit-pin',type:'ellipse',x:0,y:0,w:20,h:20,cm:1,th:messages});
 const fx=fixture(),created=await fx.call({method:'POST',path:'/create',body:{kind:'room',board:{v:2,d:0,p:[{id:'page-1',n:'Board',e:[thread(initialMessages)]}]},requestId:'1'.repeat(32)}});
 assert.equal(created.status,201);
 const committedMessages=[...initialMessages,{id:'peer-add',t:'peer'}],firstBody={opId:'2'.repeat(32),baseRev:0,changes:[{t:'put',pid:'page-1',e:thread(committedMessages)}]};
 const committed=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:firstBody});assert.equal(committed.status,200);assert.equal(committed.body.board.p[0].e[0].th.length,BoardElementContract.MAX_COMMENTS);
 const beforeConflict=fx.db.rows.get(created.body.id).payload,rowCount=fx.db.rows.size;
 const concurrentMessages=[...initialMessages,{id:'local-add',t:'local'}],conflict=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:{opId:'3'.repeat(32),baseRev:0,changes:[{t:'put',pid:'page-1',e:thread(concurrentMessages)}]}});
 assert.equal(conflict.status,409);assert.equal(conflict.body.error,'comment_limit','a stale concurrent add that would exceed the cap has a stable code');
 assert.equal(fx.db.rows.get(created.body.id).payload,beforeConflict,'the conflict does not truncate comments or mutate the room');assert.equal(fx.db.rows.size,rowCount,'the rejected operation writes no receipt or quota row');
 const retry=await fx.call({method:'POST',path:`/room/${created.body.id}`,body:firstBody});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.ack,firstBody.opId);assert.equal(retry.body.board.p[0].e[0].th.length,BoardElementContract.MAX_COMMENTS,'the already-committed ACK is still recoverable at the cap');
});
test('Appwrite client uses runtime endpoint/project and the per-execution x-appwrite-key',()=>{
 const seen={};
 class FakeClient{setEndpoint(v){seen.endpoint=v;return this}setProject(v){seen.project=v;return this}setKey(v){seen.key=v;return this}}
 class FakeTablesDB{constructor(client){this.client=client}}
 const db=createAppwriteDb({req:{headers:{'x-appwrite-key':'ephemeral-test-key'}},env:{APPWRITE_FUNCTION_API_ENDPOINT:'https://fra.cloud.appwrite.io/v1',APPWRITE_FUNCTION_PROJECT_ID:'project-test'},ClientClass:FakeClient,TablesDBClass:FakeTablesDB});
 assert.ok(db instanceof FakeTablesDB);assert.deepEqual(seen,{endpoint:'https://fra.cloud.appwrite.io/v1',project:'project-test',key:'ephemeral-test-key'});
 assert.throws(()=>createAppwriteDb({req:{headers:{}},env:{},ClientClass:FakeClient,TablesDBClass:FakeTablesDB}),e=>e.code===500&&!e.message.includes('ephemeral'));
});

test('deployment timeout is explicitly shorter than the lock lease',()=>{
 const source=readFileSync(new URL('./main.js',import.meta.url),'utf8'),readme=readFileSync(new URL('../../README.md',import.meta.url),'utf8');
 const leaseMs=Number(source.match(/LOCK_LEASE_MS=(\d+)/)?.[1]),timeoutSeconds=Number(readme.match(/set its Timeout setting to \*\*(\d+) seconds\*\*/)?.[1]);
 assert.ok(Number.isFinite(leaseMs)&&Number.isFinite(timeoutSeconds));assert.ok(timeoutSeconds*1000<leaseMs,`Function timeout ${timeoutSeconds}s must be shorter than ${leaseMs}ms lock lease`);
});

test('room receipt cap fits a Free-plan owner-delete transaction with 100-row bulk requests',()=>{
 const freeRowsPerBulk=100,freeTransactionOperations=100,fixedDeleteRows=5,bulkDeleteOperations=Math.ceil(ROOM_OP_RECEIPT_LIMIT/freeRowsPerBulk);
 assert.equal(ROOM_OP_RECEIPT_LIMIT,9400);assert.equal(LIVE_CHAT_RECEIPT_LIMIT,ROOM_OP_RECEIPT_LIMIT,'chat and board receipts share one per-room budget rather than separate caps');assert.ok(bulkDeleteOperations+fixedDeleteRows<=freeTransactionOperations,`${bulkDeleteOperations} bulk deletes plus ${fixedDeleteRows} fixed deletes must fit in ${freeTransactionOperations} staged operations`);
});
test('room receipt limit accepts operation 9,400, rejects the next without mutation, and preserves its duplicate ACK',async()=>{
 const fx=fixture(),room=await createShare(fx,'room'),firstOpId='1'.repeat(32),finalOpId='2'.repeat(32),rejectedOpId='3'.repeat(32);
 const first=await update(fx,room.id,{opId:firstOpId,baseRev:0,shapeId:'cap-first'});assert.equal(first.status,200);
 const quotaId=roomQuotaRowId(room.id),quotaRow=fx.db.rows.get(quotaId),quota=JSON.parse(quotaRow.payload);
 const finalReceiptId=roomOpReceiptRowId(room.id,finalOpId),rejectedReceiptId=roomOpReceiptRowId(room.id,rejectedOpId);
 quota.receiptIds=paddedReceiptIds(quota.receiptIds,ROOM_OP_RECEIPT_LIMIT-1,[finalReceiptId,rejectedReceiptId]);quota.count=ROOM_OP_RECEIPT_LIMIT-1;
 fx.db.rows.set(quotaId,{$id:quotaId,...rowData(quota),$permissions:quotaRow.$permissions});
 const accepted=await update(fx,room.id,{opId:finalOpId,baseRev:first.body.rev,shapeId:'cap-final'});assert.equal(accepted.status,200);
 const atLimit=JSON.parse(fx.db.rows.get(quotaId).payload);assert.equal(atLimit.count,ROOM_OP_RECEIPT_LIMIT);assert.equal(atLimit.receiptIds.length,ROOM_OP_RECEIPT_LIMIT);
 const roomBefore=fx.db.rows.get(room.id).payload,quotaBefore=fx.db.rows.get(quotaId).payload,rowCount=fx.db.rows.size;
 const rejected=await update(fx,room.id,{opId:rejectedOpId,baseRev:accepted.body.rev,shapeId:'cap-rejected'});
 assert.equal(rejected.status,409);assert.equal(rejected.body.error,'room_receipt_limit');assert.match(rejected.body.message,/shared 9,400 room receipt limit/);
 assert.equal(fx.db.rows.get(room.id).payload,roomBefore,'the 9,401st operation cannot mutate the room');assert.equal(fx.db.rows.get(quotaId).payload,quotaBefore,'the rejected operation cannot increment the receipt ledger');assert.equal(fx.db.rows.size,rowCount,'the rejected operation creates no receipt or side row');assert.equal(fx.db.rows.has(rejectedReceiptId),false);
 const retry=await update(fx,room.id,{opId:finalOpId,baseRev:first.body.rev,shapeId:'cap-final'});
 assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.ack,finalOpId,'the accepted 9,400th operation remains retryable at the cap');
 assert.equal(fx.db.rows.get(room.id).payload,roomBefore,'duplicate ACK does not replay the room mutation');assert.equal(fx.db.rows.get(quotaId).payload,quotaBefore,'duplicate ACK does not consume another receipt');assert.equal(fx.db.rows.size,rowCount);
});
test('OPTIONS and health are available without database credentials or a DB connection',async()=>{
 const fx=fixture();const preflight=await fx.call({method:'OPTIONS',path:'/create'});assert.equal(preflight.status,204);assert.equal(preflight.headers['Access-Control-Allow-Origin'],'https://ghdraw.vercel.app');
 const health=await fx.call({method:'GET',path:'/health'});assert.deepEqual(health.body,{ok:true});assert.equal(fx.factories,0);
});

test('anonymous share creation and view reads work through the Function while rows remain private',async()=>{
 const fx=fixture(),created=await createShare(fx,'view');
 const stored=fx.db.rows.get(created.id);assert.deepEqual(stored.$permissions,[]);
 const view=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(view.status,200);assert.deepEqual(view.body.board,board());assert.equal('owner' in view.body,false);
 assert.equal('userId' in view.body,false);assert.equal('createReceiptId' in view.body,false);assert.ok(fx.db.calls.some(c=>c.op==='createRow'&&c.rowId===created.id&&c.permissions.length===0));
});

test('create and room writes enforce the frontend coordinate and geometry contract before mutating rows',async()=>{
 const client=readFileSync(new URL('../../index.html',import.meta.url),'utf8');assert.equal(BOARD_COORD_LIMIT,1e9);assert.equal(BOARD_POINT_LIMIT,1e6);assert.equal(BoardElementContract.COORD_LIMIT,1e9);assert.equal(BoardElementContract.POINT_LIMIT,1e6);assert.match(client,/const BOARD_COORD_LIMIT=1e9/);
 const invalid=[
  {id:'too-far',type:'rect',x:BOARD_COORD_LIMIT+1,y:0,w:1,h:1},
  {id:'past-right-edge',type:'rect',x:BOARD_COORD_LIMIT-1,y:0,w:2,h:1},
  {id:'negative-size',type:'rect',x:0,y:0,w:-1,h:1},
  {id:'non-finite-point',type:'line',pts:[[Number.POSITIVE_INFINITY,0],[1,1]]},
  {id:'bad-pressure',type:'pen',pts:[[0,0,1.01],[1,1]]},
  {id:'empty-line',type:'line',pts:[]},
  {id:'unknown-field',type:'rect',x:0,y:0,w:10,h:10,unexpected:1},
  {id:'text-size-out-of-range',type:'text',x:0,y:0,w:10,h:10,text:'x',font:'Caveat',size:401},
  {id:'invalid-style',type:'rect',x:0,y:0,w:10,h:10,style:'wavy'},
  {id:'invalid-color',type:'rect',x:0,y:0,w:10,h:10,stroke:'red'}
 ];
 for(const element of invalid){
  const fx=fixture(),result=await fx.call({method:'POST',path:'/create',body:{kind:'view',requestId:'c'.repeat(32),board:{p:[{id:'page-1',n:'Page 1',e:[element]}]}}});
  assert.equal(result.status,400,element.id);assert.equal(fx.db.rows.size,0,`${element.id} is rejected before create/receipt writes`);assert.equal(fx.db.calls.some(call=>call.op==='createRow'),false,`${element.id} creates no share or idempotency receipt`);
 }
 const fx=fixture(),room=await createShare(fx,'room'),quotaId=roomQuotaRowId(room.id),beforeRoot=fx.db.rows.get(room.id).payload,beforeQuota=fx.db.rows.get(quotaId).payload,initial=JSON.parse(beforeRoot);
 for(const element of invalid){
  const result=await fx.call({method:'POST',path:`/room/${room.id}`,body:{opId:'a'.repeat(32),baseRev:0,changes:[{t:'put',pid:'page-1',e:element}]},bodyText:'{}'});
  assert.equal(result.status,400,element.id);assert.equal(fx.db.rows.get(room.id).payload,beforeRoot,'invalid element leaves the stored room board/revision untouched');assert.deepEqual(JSON.parse(fx.db.rows.get(room.id).payload).board,initial.board);assert.equal(JSON.parse(fx.db.rows.get(room.id).payload).rev,initial.rev);
  assert.equal(fx.db.rows.get(quotaId).payload,beforeQuota,'invalid element does not increment the durable receipt ledger');assert.equal([...fx.db.rows.keys()].some(id=>id.startsWith('o')||id.startsWith('h')),false,'invalid element creates no operation receipt or history row');
 }
});

test('create bounds the exact stored JSON row including server-generated metadata',async()=>{
 const acceptedFx=fixture(),acceptedBody=createBodyForStoredBytes(MAX_PAYLOAD),accepted=await acceptedFx.call({method:'POST',path:'/create',body:acceptedBody});
 assert.equal(accepted.status,201);assert.equal(Buffer.byteLength(acceptedFx.db.rows.get(accepted.body.id).payload),MAX_PAYLOAD,'exactly 12 MiB is accepted and stored');
 const rejectedFx=fixture(),rejectedBody=createBodyForStoredBytes(MAX_PAYLOAD+1),rejected=await rejectedFx.call({method:'POST',path:'/create',body:rejectedBody});
 assert.equal(rejected.status,413,'one byte over the stored-payload limit is rejected');assert.equal(rejectedFx.db.rows.size,0,'oversized payload and receipt are never written');
});

test('direct anonymous row access is denied even though the Function route is public',async()=>{
 const fx=fixture(),created=await createShare(fx,'view');
 await assert.rejects(fx.db.getRowAsAnonymous(created.id),e=>e.code===401);
 const viaFunction=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(viaFunction.status,200);
 assert.deepEqual(fx.db.tablePermissions,[]);assert.deepEqual(fx.db.rows.get(created.id).$permissions,[]);
});

test('share-create retries with one request ID return the same private receipt and link',async()=>{
 const fx=fixture(),requestId='a'.repeat(32),body={kind:'view',board:board(),requestId};
 const [one,two]=await Promise.all([fx.call({method:'POST',path:'/create',body}),fx.call({method:'POST',path:'/create',body})]);
 assert.equal(one.status,201);assert.equal(two.status,201);assert.equal(one.body.id,two.body.id);assert.equal(one.body.owner,two.body.owner);assert.equal(Number(!!one.body.duplicate)+Number(!!two.body.duplicate),1);
 const root=JSON.parse(fx.db.rows.get(one.body.id).payload),receiptId=root.createReceiptId;assert.equal(receiptId[0],'g');assert.deepEqual(fx.db.rows.get(receiptId).$permissions,[]);
 const links=[...fx.db.rows.keys()].filter(id=>/^[a-f0-9]{32}$/.test(id));assert.equal(links.length,1);
 const reused=await fx.call({method:'POST',path:'/create',body:{...body,board:{p:[{id:'page-1',n:'Different',e:[]} ]}}});assert.equal(reused.status,409);
 const visible=await fx.call({method:'GET',path:`/view/${one.body.id}`});assert.equal('createReceiptId' in visible.body,false);
 const removed=await fx.call({method:'DELETE',path:`/owner/${one.body.id}`,body:{owner:one.body.owner}});assert.equal(removed.status,200);assert.equal(fx.db.rows.has(receiptId),false);
});

test('anonymous room creation and reads expose the sync protocol but never owner or operation secrets',async()=>{
 const fx=fixture(),createdResponse=await fx.call({method:'POST',path:'/create',body:{kind:'room',board:board(),requestId:'b'.repeat(32)}}),created=createdResponse.body;
 assert.equal(createdResponse.status,201);const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.equal(room.status,200);assert.equal(room.body.syncProtocol,'room-ops-v1');assert.equal(room.body.rev,0);assert.equal('owner' in room.body,false);assert.equal('ops' in room.body,false);assert.equal('createReceiptId' in room.body,false);assert.equal('opReceiptCount' in room.body,false);assert.deepEqual(fx.db.rows.get(created.id).$permissions,[]);
 const quota=JSON.parse(fx.db.rows.get(roomQuotaRowId(created.id)).payload);assert.deepEqual({kind:quota.kind,roomId:quota.roomId,count:quota.count,chatCount:quota.chatCount,receiptIds:quota.receiptIds},{kind:'room-op-quota',roomId:created.id,count:0,chatCount:0,receiptIds:[]});assert.deepEqual(fx.db.rows.get(roomQuotaRowId(created.id)).$permissions,[]);
});

test('room operation ACKs, duplicate retries and stale-base rebase survive TablesDB transactions',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const first=await update(fx,created.id);assert.equal(first.status,200);assert.equal(first.body.ack,'11111111111111111111111111111111');assert.equal(first.body.rev,1);
 const receiptEntry=[...fx.db.rows].find(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).opId==='11111111111111111111111111111111');assert.ok(receiptEntry,'an operation receipt is stored separately from the room board');assert.deepEqual(receiptEntry[1].$permissions,[]);assert.equal(JSON.parse(receiptEntry[1].payload).roomId,created.id);
 const retry=await update(fx,created.id);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.rev,1);
 const second=await update(fx,created.id,{opId:'22222222222222222222222222222222',baseRev:0,shapeId:'shape-3'});assert.equal(second.status,200);assert.equal(second.body.rebased,true);assert.equal(second.body.rev,2);
 assert.deepEqual(JSON.parse(fx.db.rows.get(created.id).payload).ops,[],'new operation IDs never grow the room row');const quota=JSON.parse(fx.db.rows.get(roomQuotaRowId(created.id)).payload);assert.equal(quota.count,2,'each unique operation increments the shared private quota row exactly once');assert.equal(quota.chatCount,0);assert.equal(quota.receiptIds.length,2,'the private quota row indexes every board/history receipt for safe owner deletion');
 const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.deepEqual(room.body.board.p[0].e.map(e=>e.id),['shape-1','shape-2','shape-3']);
});

test('room remains writable and deletable after 300 changes; old lost-ACK retries stay deduplicated',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),firstId='f'.repeat(32),first=await update(fx,created.id,{opId:firstId,shapeId:'shape-doomed'});assert.equal(first.status,200);
 for(let i=1;i<=300;i++){
  const opId=i.toString(16).padStart(32,'0'),response=await fx.call({method:'POST',path:`/room/${created.id}`,body:{opId,baseRev:i,changes:[{t:'rename',pid:'page-1',n:`Page-${i}`}]}});
  assert.equal(response.status,200,`revision ${i+1} should remain writable`);
 }
 const root=JSON.parse(fx.db.rows.get(created.id).payload),receiptRows=[...fx.db.rows].filter(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).roomId===created.id);
 assert.equal(root.rev,301);assert.deepEqual(root.ops,[]);assert.ok(Buffer.byteLength(fx.db.rows.get(created.id).payload)<100000,'room payload remains bounded independently of operation count');assert.equal(receiptRows.length,301);const quota=JSON.parse(fx.db.rows.get(roomQuotaRowId(created.id)).payload);assert.equal(quota.count,301);assert.equal(quota.receiptIds.length,301);assert.ok(receiptRows.every(([,row])=>row.$permissions.length===0));
 const retry=await update(fx,created.id,{opId:firstId,baseRev:0,shapeId:'should-not-reappear'});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.rev,301);
 const deletion=await fx.call({method:'POST',path:`/room/${created.id}`,body:{opId:'e'.repeat(32),baseRev:301,changes:[{t:'del',pid:'page-1',eid:'shape-doomed'}]}});assert.equal(deletion.status,200);assert.equal(deletion.body.rev,302);
 const final=await fx.call({method:'GET',path:`/room/${created.id}`});assert.ok(!final.body.board.p[0].e.some(e=>e.id==='shape-doomed'));
});

test('receipt quota boundary rejects new operations without mutation while duplicate retries keep their ACK',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),counterId=roomQuotaRowId(created.id),counter=JSON.parse(fx.db.rows.get(counterId).payload);counter.count=ROOM_OP_RECEIPT_LIMIT-1;counter.receiptIds=Array.from({length:counter.count},(_,i)=>'o'+(i+1).toString(16).padStart(31,'0'));fx.db.rows.get(counterId).payload=JSON.stringify(counter);
 const submit=(opId,baseRev)=>fx.call({method:'POST',path:`/room/${created.id}`,body:{opId,baseRev,changes:[{t:'rename',pid:'page-1',n:'Page 1'}]}});
 const acceptedId='a'.repeat(32),accepted=await submit(acceptedId,0);assert.equal(accepted.status,200,'the final available receipt slot is accepted');assert.equal(accepted.body.rev,1);assert.equal(JSON.parse(fx.db.rows.get(counterId).payload).count,ROOM_OP_RECEIPT_LIMIT);
 const before=fx.db.rows.get(created.id).payload,counterBefore=fx.db.rows.get(counterId).payload,rejectedId='b'.repeat(32),rejected=await submit(rejectedId,1);
 assert.equal(rejected.status,409);assert.equal(rejected.body.error,'room_receipt_limit');assert.match(rejected.body.message,/Create a new room/);assert.equal(fx.db.rows.get(created.id).payload,before,'rejected op cannot mutate board or revision');assert.equal(fx.db.rows.get(counterId).payload,counterBefore,'rejected op cannot increment quota');assert.equal([...fx.db.rows].some(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).opId===rejectedId),false,'no receipt is created for the rejected op');
 const duplicate=await submit(acceptedId,0);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.ack,acceptedId);assert.equal(duplicate.body.rev,1);assert.equal(fx.db.rows.get(created.id).payload,before);assert.equal(fx.db.rows.get(counterId).payload,counterBefore);
});

test('a room without a trusted quota row rejects new operations but still ACKs known receipts',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),known=await update(fx,created.id,{opId:'a'.repeat(32)});assert.equal(known.status,200);const before=fx.db.rows.get(created.id).payload;fx.db.rows.delete(roomQuotaRowId(created.id));
 const retry=await update(fx,created.id,{opId:'a'.repeat(32)});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.ack,'a'.repeat(32));
 const fresh=await update(fx,created.id,{opId:'b'.repeat(32),baseRev:1,shapeId:'unmetered-shape'});assert.equal(fresh.status,409);assert.equal(fresh.body.error,'room_receipt_limit');assert.equal(fx.db.rows.get(created.id).payload,before,'legacy room without counter cannot accept unmetered mutation');
});

test('non-empty room changes require a valid operation ID before any mutation',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),before=fx.db.rows.get(created.id).payload;
 for(const body of [{baseRev:0,changes:[{t:'rename',pid:'page-1',n:'No ID'}]},{opId:'not-a-safe-id',baseRev:0,changes:[{t:'rename',pid:'page-1',n:'Bad ID'}]}]){const result=await fx.call({method:'POST',path:`/room/${created.id}`,body});assert.equal(result.status,400);assert.equal(fx.db.rows.get(created.id).payload,before);assert.equal(JSON.parse(fx.db.rows.get(roomQuotaRowId(created.id)).payload).count,0)}
 assert.equal([...fx.db.rows.keys()].some(rowId=>rowId.startsWith('o')),false,'invalid writes create no receipts');
});

test('legacy d.ops retries return their ACK before a missing quota counter can block them',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),opId='f'.repeat(32),roomRow=fx.db.rows.get(created.id),legacy=JSON.parse(roomRow.payload);legacy.rev=17;legacy.ops=[opId];roomRow.payload=JSON.stringify(legacy);fx.db.rows.delete(roomQuotaRowId(created.id));const before=roomRow.payload;
 const retry=await update(fx,created.id,{opId,baseRev:0,shapeId:'must-not-apply-again'});assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.ack,opId);assert.equal(retry.body.rev,17);assert.equal(roomRow.payload,before,'the legacy duplicate does not mutate board or revision');
});

test('concurrent new operations serialize on the final room receipt slot',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),counterId=roomQuotaRowId(created.id),counter=JSON.parse(fx.db.rows.get(counterId).payload);counter.count=ROOM_OP_RECEIPT_LIMIT-1;counter.receiptIds=Array.from({length:counter.count},(_,i)=>'o'+(i+1).toString(16).padStart(31,'0'));fx.db.rows.get(counterId).payload=JSON.stringify(counter);
 const submit=opId=>fx.call({method:'POST',path:`/room/${created.id}`,body:{opId,baseRev:0,changes:[{t:'rename',pid:'page-1',n:'Page 1'}]}});
 const responses=await Promise.all([submit('c'.repeat(32)),submit('d'.repeat(32))]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal(JSON.parse(fx.db.rows.get(counterId).payload).count,ROOM_OP_RECEIPT_LIMIT);assert.equal(JSON.parse(fx.db.rows.get(created.id).payload).rev,1);
 const receipts=[...fx.db.rows].filter(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).roomId===created.id);assert.equal(receipts.length,1,'only the winning operation creates a receipt in the last slot');
});

test('expired room operation/chat receipts and their shared quota counter are reclaimed by scheduled cleanup',async()=>{
 const roomId='2'.repeat(32),expires=Date.now()-1000,receiptId='o'+'1'.repeat(31),counterId=roomQuotaRowId(roomId),chatReceiptId='j'+'2'.repeat(31),receipt={kind:'room-op-receipt',roomId,opId:'3'.repeat(32),expires},chatReceipt={kind:'live-chat-receipt',roomId,mid:'4'.repeat(32),messageHash:'5'.repeat(64),expires},quota={kind:'room-op-quota',roomId,count:2,chatCount:1,receiptIds:[receiptId],expires};
 const fx=fixture({seed:[[receiptId,{$id:receiptId,...rowData(receipt),$permissions:[]}],[chatReceiptId,{$id:chatReceiptId,...rowData(chatReceipt),$permissions:[]}],[counterId,{$id:counterId,...rowData(quota),$permissions:[]}]]});const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});
 assert.equal(result.status,200);assert.equal(result.body.deleted,3);assert.equal(fx.db.rows.has(receiptId),false);assert.equal(fx.db.rows.has(chatReceiptId),false);assert.equal(fx.db.rows.has(counterId),false);
});

test('live chat returns the full 100-message boundary when every legacy message shares one timestamp',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),rowId='p'+created.id.slice(0,31),ts=1_800_000_000_000,messages=Array.from({length:100},(_,i)=>({id:'legacy'+String(i).padStart(6,'0'),cid:'client02',n:'Old peer',c:'#123456',m:'same-time '+i,ts}));
 fx.db.rows.set(rowId,{$id:rowId,...rowData({kind:'live',expires:created.expires,presence:{},chat:messages}),$permissions:[]});
 const poll=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01',after:ts}});
 assert.equal(poll.status,200);assert.equal(poll.body.chat.length,100,'the complete retained window is returned at its 100-message boundary');assert.deepEqual(poll.body.chat.map(m=>m.id),messages.map(m=>m.id),'equal timestamps do not collapse or skip message IDs');assert.ok(poll.body.chat.every(m=>m.ts===ts),'legacy timestamp fields remain readable');
});

test('live chat returns a late-arriving legacy message even when its timestamp is older than the client cursor',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),rowId='p'+created.id.slice(0,31),messages=[{id:'older',cid:'client02',n:'Old peer',c:'#123456',m:'older',ts:900},{id:'recent',cid:'client02',n:'Old peer',c:'#123456',m:'recent',ts:1_100}];
 fx.db.rows.set(rowId,{$id:rowId,...rowData({kind:'live',expires:created.expires,presence:{},chat:messages}),$permissions:[]});
 const poll=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01',after:1_100}});
 assert.equal(poll.status,200);assert.deepEqual(poll.body.chat.map(m=>m.id),['older','recent'],'the timestamp cursor is ignored so a late commit below it is still delivered');assert.deepEqual(poll.body.chat[0],messages[0],'old stored message shape is preserved without migration');
});

test('live chat retries with one stable mid after a lost ACK and preserves distinct identical-text sends',async()=>{
 let now=5_000;const fx=fixture({clock:()=>now}),created=await createShare(fx,'room'),path=`/live/${created.id}`,mid='a'.repeat(32),request={method:'POST',path,body:{cid:'client01',msg:'same text',mid,after:0}};
 const committedButAckDropped=await fx.call(request);assert.equal(committedButAckDropped.status,200);assert.equal(committedButAckDropped.body.ack,mid);const retry=await fx.call({...request,body:{...request.body,cid:'client02'}});assert.equal(retry.status,200);assert.equal(retry.body.ack,mid);assert.equal(retry.body.chat.filter(m=>m.id===mid).length,1,'retry returns the single committed row with the original stable ID after the client session ID changes');assert.equal(JSON.parse(fx.db.rows.get('p'+created.id.slice(0,31)).payload).chat.length,1,'the lost-ACK retry does not append a duplicate');
 now+=1;const distinct=await fx.call({method:'POST',path,body:{cid:'client01',msg:'same text',mid:'b'.repeat(32),after:0}});assert.equal(distinct.status,200);assert.deepEqual(distinct.body.chat.map(m=>m.id),[mid,'b'.repeat(32)],'separate sends with identical text remain distinct by ID');assert.ok(distinct.body.chat.every(m=>m.m==='same text'));
 const conflict=await fx.call({method:'POST',path,body:{cid:'client01',msg:'different content',mid,after:0}});assert.equal(conflict.status,409);assert.equal(conflict.body.error,'live_message_id_conflict');assert.equal(JSON.parse(fx.db.rows.get('p'+created.id.slice(0,31)).payload).chat.length,2,'reusing an id for different content cannot mutate the row');
});

test('live chat keeps idempotency receipts after messages leave the 100-message window',async()=>{
 let now=5_000;const fx=fixture({clock:()=>now}),created=await createShare(fx,'room'),path=`/live/${created.id}`,mid='a'.repeat(32),original={method:'POST',path,body:{cid:'client01',msg:'delayed retry',mid,after:0}};
 const first=await fx.call(original);assert.equal(first.status,200);assert.equal(first.body.ack,mid);
 for(let i=0;i<100;i++){now+=1_001;const later=await fx.call({method:'POST',path,body:{cid:'client01',msg:'later '+i,mid:i.toString(16).padStart(32,'0'),after:0}});assert.equal(later.status,200,`later message ${i} is accepted`)}
 const liveRowId='p'+created.id.slice(0,31),beforeRetry=JSON.parse(fx.db.rows.get(liveRowId).payload);assert.equal(beforeRetry.chat.length,100);assert.ok(!beforeRetry.chat.some(m=>m.id===mid),'the original message has left the display window');
 const retry=await fx.call({...original,body:{...original.body,cid:'client02'}});assert.equal(retry.status,200);assert.equal(retry.body.ack,mid,'the durable private receipt acknowledges a retry beyond the display window');assert.equal(retry.body.chat.length,100);assert.ok(!retry.body.chat.some(m=>m.id===mid),'retry does not reinsert the evicted message or displace a newer one');assert.equal(JSON.parse(fx.db.rows.get(liveRowId).payload).chat.length,100);
 const receipt=[...fx.db.rows.values()].find(row=>row.$id.startsWith('j')&&JSON.parse(row.payload).mid===mid);assert.ok(receipt,'a separate durable idempotency receipt survives message-window eviction');assert.deepEqual(receipt.$permissions,[],'the message receipt row remains private');
});

test('live chat consumes the shared 9,400 room receipt budget atomically and still ACKs its prior receipt at cap',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),path=`/live/${created.id}`,quotaId=roomQuotaRowId(created.id),quotaRow=fx.db.rows.get(quotaId),quota=JSON.parse(quotaRow.payload),acceptedId='a'.repeat(32),rejectedId='b'.repeat(32),acceptedReceipt=liveChatReceiptRowIdForTest(created.id,acceptedId),rejectedReceipt=liveChatReceiptRowIdForTest(created.id,rejectedId);
 quota.receiptIds=Array.from({length:LIVE_CHAT_RECEIPT_LIMIT-1},(_,i)=>'o'+(i+1).toString(16).padStart(31,'0'));quota.count=LIVE_CHAT_RECEIPT_LIMIT-1;quota.chatCount=0;fx.db.rows.set(quotaId,{$id:quotaId,...rowData(quota),$permissions:quotaRow.$permissions});
 const accepted=await fx.call({method:'POST',path,body:{cid:'client01',mid:acceptedId,msg:'last slot'}});assert.equal(accepted.status,200);assert.equal(accepted.body.ack,acceptedId,'the 9,400th combined receipt slot accepts chat');
 const atLimit=JSON.parse(fx.db.rows.get(quotaId).payload);assert.equal(atLimit.count,LIVE_CHAT_RECEIPT_LIMIT);assert.equal(atLimit.receiptIds.length,LIVE_CHAT_RECEIPT_LIMIT-1);assert.equal(atLimit.chatCount,1);assert.ok(fx.db.rows.has(acceptedReceipt));
 const roomBefore=fx.db.rows.get(created.id).payload,liveId='p'+created.id.slice(0,31),liveBefore=fx.db.rows.get(liveId).payload,quotaBefore=fx.db.rows.get(quotaId).payload,rowCount=fx.db.rows.size;
 const rejected=await fx.call({method:'POST',path,body:{cid:'client02',mid:rejectedId,msg:'must stay queued'}});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'live_chat_receipt_limit');assert.match(rejected.body.message,/shared 9,400 room receipt limit/);
 assert.equal(fx.db.rows.get(created.id).payload,roomBefore);assert.equal(fx.db.rows.get(liveId).payload,liveBefore,'the live row/presence is rolled back when full');assert.equal(fx.db.rows.get(quotaId).payload,quotaBefore);assert.equal(fx.db.rows.size,rowCount);assert.equal(fx.db.rows.has(rejectedReceipt),false,'no receipt row is created for the rejected draft');
 const retry=await fx.call({method:'POST',path,body:{cid:'client03',mid:acceptedId,msg:'last slot'}});assert.equal(retry.status,200);assert.equal(retry.body.ack,acceptedId,'an already receipted message bypasses the full shared cap');assert.equal(fx.db.rows.get(quotaId).payload,quotaBefore);assert.equal(JSON.parse(fx.db.rows.get(liveId).payload).chat.length,1);assert.equal(fx.db.rows.has(rejectedReceipt),false);
 const boardOp=await update(fx,created.id,{opId:'c'.repeat(32),baseRev:0});assert.equal(boardOp.status,409);assert.equal(boardOp.body.error,'room_receipt_limit','chat and board operations compete for exactly the same budget');assert.equal(fx.db.rows.get(quotaId).payload,quotaBefore);assert.equal(fx.db.rows.get(created.id).payload,roomBefore);
});

test('live presence and anonymous chat are stored in private side rows',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const first=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01',n:'A',c:'#123456',x:10,y:20}});assert.equal(first.status,200);assert.deepEqual(first.body.peers,[]);
 const mid='b'.repeat(32),second=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client02',n:'B',msg:'hello',mid,after:0}});assert.equal(second.status,200);assert.equal(second.body.ack,mid);assert.equal(second.body.peers.length,1);assert.equal(second.body.chat[0].m,'hello');
 const liveRow=fx.db.rows.get('p'+created.id.slice(0,31)),receipt=[...fx.db.rows.values()].find(row=>row.$id.startsWith('j')&&JSON.parse(row.payload).mid===mid);assert.ok(liveRow);assert.ok(receipt);assert.deepEqual(liveRow.$permissions,[]);assert.deepEqual(receipt.$permissions,[]);assert.ok(Buffer.byteLength(liveRow.payload)<=LIVE_ROW_MAX_BYTES);assert.ok(Buffer.byteLength(JSON.stringify(second.body))<=LIVE_RESPONSE_MAX_BYTES);
});

test('live presence caps active peers, allows same-peer refresh, and reclaims expired slots',async()=>{
 let now=Date.now();const fx=fixture({clock:()=>now}),created=await createShare(fx,'room'),path=`/live/${created.id}`,send=cid=>fx.call({method:'POST',path,body:{cid}});
 for(let i=0;i<LIVE_ROOM_PEER_LIMIT;i++)assert.equal((await send(`client${String(i).padStart(2,'0')}`)).status,200);
 const rowId='p'+created.id.slice(0,31),row=fx.db.rows.get(rowId),beforeRejected=row.payload,data=JSON.parse(row.payload);assert.equal(Object.keys(data.presence).length,LIVE_ROOM_PEER_LIMIT);
 const refreshed=await send('client00');assert.equal(refreshed.status,200);assert.equal(Object.keys(JSON.parse(fx.db.rows.get(rowId).payload).presence).length,LIVE_ROOM_PEER_LIMIT,'refreshing a peer does not consume another slot');
 const beforeFull=fx.db.rows.get(rowId).payload,rejected=await send('newclient');assert.equal(rejected.status,409);assert.equal(rejected.body.error,'live_peer_limit');assert.equal(fx.db.rows.get(rowId).payload,beforeFull,'capacity rejection rolls back without touching the side row');assert.notEqual(beforeRejected,beforeFull,'the same-peer refresh was accepted');
 now+=15_001;const reclaimed=await send('newclient');assert.equal(reclaimed.status,200);assert.deepEqual(reclaimed.body.peers,[]);const after=JSON.parse(fx.db.rows.get(rowId).payload);assert.deepEqual(Object.keys(after.presence),['newclient'],'expired peers are pruned before a new peer is admitted');assert.ok(Buffer.byteLength(JSON.stringify(reclaimed.body))<=LIVE_RESPONSE_MAX_BYTES);
});

test('parallel live presence joins cannot exceed the per-room peer cap',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),path=`/live/${created.id}`;
 const responses=await Promise.all(Array.from({length:LIVE_ROOM_PEER_LIMIT+8},(_,i)=>fx.call({method:'POST',path,body:{cid:`parallel${String(i).padStart(2,'0')}`}})));
 assert.ok(responses.some(response=>response.status===200));assert.ok(responses.every(response=>[200,409,429].includes(response.status)),JSON.stringify(responses.map(response=>({status:response.status,body:response.body}))));
 const data=JSON.parse(fx.db.rows.get('p'+created.id.slice(0,31)).payload);assert.ok(Object.keys(data.presence).length<=LIVE_ROOM_PEER_LIMIT,'concurrent transactions never store more than the hard cap');
});

test('live presence rejects oversized requests and chat messages without mutation',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),path=`/live/${created.id}`,rowId='p'+created.id.slice(0,31);
 const longMessage=await fx.call({method:'POST',path,body:{cid:'oversize1',msg:'x'.repeat(LIVE_CHAT_MESSAGE_LIMIT+1)}});assert.equal(longMessage.status,413);assert.equal(longMessage.body.error,'live_payload_limit');assert.equal(fx.db.rows.has(rowId),false);
 const largeBody=await fx.call({method:'POST',path,body:{cid:'oversize1'},bodyText:'x'.repeat(LIVE_REQUEST_MAX_BYTES+1)});assert.equal(largeBody.status,413);assert.equal(largeBody.body.error,'live_payload_limit');assert.equal(fx.db.rows.has(rowId),false,'raw oversized input is rejected before any row is created');
});

test('live presence applies an atomic per-room rate limit and resets the next window',async()=>{
 let now=Date.now();const fx=fixture({clock:()=>now}),created=await createShare(fx,'room'),path=`/live/${created.id}`,send=()=>fx.call({method:'POST',path,body:{cid:'rateclient'}});
 for(let i=0;i<LIVE_ROOM_REQUESTS_PER_SECOND;i++)assert.equal((await send()).status,200);
 const rowId='p'+created.id.slice(0,31),before=fx.db.rows.get(rowId).payload,limited=await send();assert.equal(limited.status,429);assert.equal(limited.body.error,'live_rate_limit');assert.equal(fx.db.rows.get(rowId).payload,before,'rate-limit rejection does not mutate the row');
 now+=1_000;assert.equal((await send()).status,200,'a new window allows normal presence refreshes');
});

test('history endpoint exports a version and restores it without losing revision semantics',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 await update(fx,created.id,{opId:'33333333333333333333333333333333',shapeId:'shape-2'});
 const list=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}});assert.equal(list.status,200);assert.ok(list.body.versions.length>=1);
 const version=list.body.versions[0],exported=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'get',ts:version.ts}});assert.equal(exported.status,200);assert.ok(exported.body.board.p[0].e.some(e=>e.id==='shape-2'));
 await update(fx,created.id,{opId:'44444444444444444444444444444444',baseRev:1,shapeId:'shape-3'});
 const restoreId='f'.repeat(32),request={method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts,restoreId}};
 const restored=await fx.call(request);assert.equal(restored.status,200);assert.ok(restored.body.board.p[0].e.some(e=>e.id==='shape-2'));assert.ok(!restored.body.board.p[0].e.some(e=>e.id==='shape-3'));assert.equal(restored.body.rev,3);assert.equal(restored.body.ack,restoreId);assert.equal(restored.body.syncProtocol,'room-ops-v1');assert.equal(restored.body.duplicate,false);
 await update(fx,created.id,{opId:'55555555555555555555555555555555',baseRev:3,shapeId:'shape-4'});
 const duplicate=await fx.call(request);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.ack,restoreId);assert.equal(duplicate.body.rev,4);assert.ok(duplicate.body.board.p[0].e.some(e=>e.id==='shape-4'),'retry after a lost restore ACK returns the current room instead of rewinding a second time');
 const reused=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts+1,restoreId}});assert.equal(reused.status,409);assert.equal(reused.body.error,'restore_id_conflict');
 const missing=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts}});assert.equal(missing.status,400);
 const historyRow=fx.db.rows.get('h'+created.id.slice(0,31));assert.ok(historyRow);assert.deepEqual(historyRow.$permissions,[]);const quota=JSON.parse(fx.db.rows.get(roomQuotaRowId(created.id)).payload);assert.equal(quota.count,4,'restore and board updates share the bounded receipt ledger');
});

test('history restore receipt quota rejection leaves the board and revision unchanged',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});const versions=(await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}})).body.versions;
 const quotaRow=fx.db.rows.get(roomQuotaRowId(created.id)),quota=JSON.parse(quotaRow.payload);quota.count=ROOM_OP_RECEIPT_LIMIT;quota.receiptIds=Array.from({length:ROOM_OP_RECEIPT_LIMIT},(_,i)=>'o'+i.toString(16).padStart(31,'0'));quotaRow.payload=JSON.stringify(quota);
 const before=JSON.parse(fx.db.rows.get(created.id).payload),result=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:versions[0].ts,restoreId:'a'.repeat(32)}});
 assert.equal(result.status,409);assert.equal(result.body.error,'room_receipt_limit');assert.deepEqual(JSON.parse(fx.db.rows.get(created.id).payload),before);assert.equal(fx.db.rows.has('h'+created.id.slice(0,31)),true);assert.equal(fx.db.rows.has(quota.receiptIds[0]),false,'no receipt is silently pruned or fabricated');
});

test('a restore quota 409 during transactional recheck does not mutate room or history rows',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});const version=(await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}})).body.versions[0],historyId='h'+created.id.slice(0,31),quotaId=roomQuotaRowId(created.id),roomRow=fx.db.rows.get(created.id),roomData=JSON.parse(roomRow.payload);roomData.board.p[0].e[0].text='current board not yet in history';roomRow.payload=JSON.stringify(roomData);
 const historyBefore=fx.db.rows.get(historyId).payload,boardBefore=roomRow.payload,originalGetRow=fx.db.getRow.bind(fx.db);let replacedQuota=false;
 fx.db.getRow=async args=>{const result=await originalGetRow(args);if(args.rowId===quotaId&&!args.transactionId&&!replacedQuota){replacedQuota=true;const row=fx.db.rows.get(quotaId),quota=JSON.parse(row.payload);quota.count=ROOM_OP_RECEIPT_LIMIT;quota.receiptIds=Array.from({length:ROOM_OP_RECEIPT_LIMIT},(_,i)=>'o'+(i+100).toString(16).padStart(31,'0'));row.payload=JSON.stringify(quota)}return result};
 const rejected=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts,restoreId:'e'.repeat(32)}});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'room_receipt_limit');assert.equal(replacedQuota,true);assert.equal(fx.db.rows.get(created.id).payload,boardBefore,'the room board is unchanged');assert.equal(fx.db.rows.get(historyId).payload,historyBefore,'the pre-restore snapshot is not written before quota revalidation');
});

test('history restore duplicate ACK survives the receipt cap while new restore IDs are rejected',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});const version=(await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}})).body.versions[0],request={method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts,restoreId:'c'.repeat(32)}};
 const first=await fx.call(request);assert.equal(first.status,200);const receiptId=[...fx.db.rows].find(([,row])=>JSON.parse(row.payload).kind==='history-restore-receipt')[0],quotaRow=fx.db.rows.get(roomQuotaRowId(created.id)),quota=JSON.parse(quotaRow.payload),ids=Array.from({length:ROOM_OP_RECEIPT_LIMIT},(_,i)=>'o'+(i+1000).toString(16).padStart(31,'0'));ids[0]=receiptId;quota.count=ROOM_OP_RECEIPT_LIMIT;quota.receiptIds=ids;quotaRow.payload=JSON.stringify(quota);
 const before=JSON.parse(fx.db.rows.get(created.id).payload),duplicate=await fx.call(request);assert.equal(duplicate.status,200);assert.equal(duplicate.body.duplicate,true);assert.equal(duplicate.body.ack,request.body.restoreId);assert.equal(duplicate.body.rev,before.rev,'a prior receipt retry returns the current revision without rewinding');assert.deepEqual(JSON.parse(fx.db.rows.get(created.id).payload),before);
 const rejected=await fx.call({...request,body:{...request.body,restoreId:'d'.repeat(32)}});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'room_receipt_limit');assert.deepEqual(JSON.parse(fx.db.rows.get(created.id).payload),before,'a new restore does not mutate a full room');
});

test('conditional owner deletion preserves a newer room revision',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),edited=await update(fx,created.id,{opId:'4'.repeat(32),baseRev:0,shapeId:'shape-after-copy'});assert.equal(edited.status,200);assert.equal(edited.body.rev,1);
 const receipt=[...fx.db.rows].find(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).kind==='room-op-receipt'&&JSON.parse(row.payload).roomId===created.id)?.[0];assert.ok(receipt);
 const invalid=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner,expectedRev:'0'}});assert.equal(invalid.status,400);assert.equal(invalid.body.error,'invalid_room_revision');assert.ok(fx.db.rows.has(created.id));
 const stale=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner,expectedRev:0}});assert.equal(stale.status,409);assert.equal(stale.body.error,'room_revision_changed');assert.ok(fx.db.rows.has(created.id));assert.ok(fx.db.rows.has(receipt));assert.ok(JSON.parse(fx.db.rows.get(created.id).payload).board.p[0].e.some(e=>e.id==='shape-after-copy'));
 const current=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner,expectedRev:1}});assert.equal(current.status,200);assert.equal(fx.db.rows.has(created.id),false);assert.equal(fx.db.rows.has(receipt),false);
});

test('owner deletion is token-protected and removes every indexed operation receipt',async()=>{
 const fx=fixture(),created=(await fx.call({method:'POST',path:'/create',body:{kind:'room',board:board(),requestId:'e'.repeat(32)}})).body;
 await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01'}});
 await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});
 await update(fx,created.id,{opId:'d'.repeat(32)});const version=(await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}})).body.versions[0];await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts,restoreId:'b'.repeat(32)}});const opReceipt=[...fx.db.rows].find(([rowId,row])=>rowId.startsWith('o')&&JSON.parse(row.payload).kind==='room-op-receipt'&&JSON.parse(row.payload).roomId===created.id)?.[0],restoreReceipt=[...fx.db.rows].find(([,row])=>JSON.parse(row.payload).kind==='history-restore-receipt')?.[0];assert.ok(opReceipt);assert.ok(restoreReceipt);
 const root=JSON.parse(fx.db.rows.get(created.id).payload),receiptId=root.createReceiptId;
 const denied=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:'wrong'}});assert.equal(denied.status,403);assert.ok(fx.db.rows.has(created.id));
 const removed=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner}});assert.deepEqual(removed.body,{ok:true});assert.equal(fx.db.rows.has(created.id),false);assert.equal(fx.db.rows.has('p'+created.id.slice(0,31)),false);assert.equal(fx.db.rows.has('h'+created.id.slice(0,31)),false);assert.equal(fx.db.rows.has(roomQuotaRowId(created.id)),false);assert.equal(fx.db.rows.has(receiptId),false);assert.equal(fx.db.rows.has(opReceipt),false,'operation receipts are removed atomically with the deleted room');assert.equal(fx.db.rows.has(restoreReceipt),false,'history restore receipts are removed atomically with the deleted room');
});

test('owner deletion removes receipt IDs in bounded batches and rolls back on an incomplete ledger',async()=>{
 const fx=fixture(),created=await createShare(fx,'room'),quotaId=roomQuotaRowId(created.id),row=fx.db.rows.get(quotaId),quota=JSON.parse(row.payload),ids=Array.from({length:205},(_,i)=>'o'+(i+1).toString(16).padStart(31,'0')),expires=JSON.parse(fx.db.rows.get(created.id).payload).expires;
 quota.count=ids.length;quota.receiptIds=ids;row.payload=JSON.stringify(quota);for(const [i,opReceiptId] of ids.entries()){const data={kind:'room-op-receipt',roomId:created.id,opId:i.toString(16).padStart(32,'0'),expires};fx.db.rows.set(opReceiptId,{$id:opReceiptId,...rowData(data),$permissions:[]})}
 const removed=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner}});assert.equal(removed.status,200);assert.ok(ids.every(id=>!fx.db.rows.has(id)));assert.equal(fx.db.calls.filter(call=>call.op==='deleteRows').length,3,'205 IDs are removed through bounded 100-ID queries');
 const failing=fixture(),failingRoom=await createShare(failing,'room'),failingRow=failing.db.rows.get(roomQuotaRowId(failingRoom.id)),failingQuota=JSON.parse(failingRow.payload),failingIds=Array.from({length:205},(_,i)=>'o'+(i+1000).toString(16).padStart(31,'0')),failingExpiry=JSON.parse(failing.db.rows.get(failingRoom.id).payload).expires;failingQuota.count=failingIds.length;failingQuota.receiptIds=failingIds;failingRow.payload=JSON.stringify(failingQuota);for(const [i,opReceiptId] of failingIds.entries())failing.db.rows.set(opReceiptId,{$id:opReceiptId,...rowData({kind:'room-op-receipt',roomId:failingRoom.id,opId:i.toString(16).padStart(32,'0'),expires:failingExpiry}),$permissions:[]});failing.db.failDeleteRowsAt=2;
 const failed=await failing.call({method:'DELETE',path:`/owner/${failingRoom.id}`,body:{owner:failingRoom.owner}});assert.equal(failed.status,500);assert.ok(failing.db.rows.has(failingRoom.id));assert.ok(failingIds.every(id=>failing.db.rows.has(id)),'a failed later batch rolls back all earlier staged receipt deletes');
 const bad=fixture(),room=await createShare(bad,'room'),badQuota=bad.db.rows.get(roomQuotaRowId(room.id));badQuota.payload=JSON.stringify({...JSON.parse(badQuota.payload),count:1,receiptIds:[]});const rejected=await bad.call({method:'DELETE',path:`/owner/${room.id}`,body:{owner:room.owner}});assert.equal(rejected.status,409);assert.equal(rejected.body.error,'room_receipt_ledger_incomplete');assert.ok(bad.db.rows.has(room.id),'an incomplete ledger never deletes a room while leaving receipts behind');
});

test('expired share reads return 410 and remove the expired row',async()=>{
 const fx=fixture(),created=await createShare(fx,'view'),row=fx.db.rows.get(created.id);row.payload=JSON.stringify({...JSON.parse(row.payload),expires:Date.now()-1});
 const result=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(result.status,410);assert.equal(fx.db.rows.has(created.id),false);
});

test('scheduled cleanup uses bounded expiry-only batches and resumes after a bulk failure',async()=>{
 const seed=[],expiredIds=[];for(let i=0;i<205;i++){const id=i.toString(16).padStart(32,'0'),isExpired=i%2===0||i===99||i===199,expires=Date.now()+(isExpired?-1000:86400000);if(isExpired)expiredIds.push(id);seed.push([id,{$id:id,payload:'x'.repeat(50000),expiresAt:new Date(expires).toISOString(),$permissions:[]}])}
 const badId='f'.repeat(32);seed.push([badId,{$id:badId,payload:'not-json',expiresAt:'not-a-date',$permissions:[]}]);
 const fx=fixture({seed});fx.db.failDeleteRowsAt=1;
 const failed=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(failed.status,500);assert.ok(fx.db.rows.has(expiredIds[1]));
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.equal(fx.db.rows.size,101);assert.ok(fx.db.rows.has(badId));for(const id of expiredIds)assert.equal(fx.db.rows.has(id),false);
 const lists=fx.db.calls.filter(c=>c.op==='listRows');assert.ok(lists.length>=3);for(const call of lists){assert.ok(call.queries.includes('orderAsc:expiresAt'));assert.ok(call.queries.includes('limit:100'));assert.ok(call.queries.includes('select:$id,expiresAt'));assert.ok(call.queries.some(q=>q.startsWith('lessThanEqual:expiresAt:')));assert.ok(!call.queries.some(q=>q.includes('payload')))}
 assert.ok(!lists.some(c=>c.queries.some(q=>q.startsWith('cursorAfter:')||q.startsWith('offset:'))));
 const batches=fx.db.calls.filter(c=>c.op==='deleteRows');assert.ok(batches.length>=2);for(const call of batches){const ids=JSON.parse(call.queries.find(q=>q.startsWith('equal:$id:')).slice('equal:$id:'.length));assert.ok(ids.length<=100);assert.ok(call.queries.some(q=>q.startsWith('lessThanEqual:expiresAt:')))}
});

test('scheduled cleanup fails closed when the expiresAt index query is unavailable',async()=>{
 const expiredId='o'+'a'.repeat(31),expired={$id:expiredId,...rowData({kind:'room-op-receipt',expires:Date.now()-1000}),$permissions:[]},fx=fixture({seed:[[expiredId,expired]]}),before=JSON.stringify([...fx.db.rows]);
 fx.db.listRows=async({queries=[]})=>{fx.db.calls.push({op:'listRows',queries:[...queries]});throw Object.assign(new Error('missing expiresAt ascending index'),{code:400,type:'general_query_invalid'})};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});
 assert.equal(result.status,503);assert.match(result.body.error,/ready ascending expiresAt index/);assert.equal(JSON.stringify([...fx.db.rows]),before,'failed preflight query leaves every row unchanged');assert.equal(fx.db.calls.some(call=>call.op==='deleteRow'||call.op==='deleteRows'),false,'cleanup does not delete or report success when the expiry query fails');
});

test('9400 expired receipts converge across bounded runs without skipping concurrent inserts or deleting active rows',async()=>{
 const old=Date.now()-60_000,seed=[];for(let i=1;i<=ROOM_OP_RECEIPT_LIMIT;i++){const id='o'+i.toString(16).padStart(31,'0');seed.push([id,{$id:id,...rowData({kind:'room-op-receipt',expires:old}),$permissions:[]}])}
 const activeId='a'.repeat(32);seed.push([activeId,{$id:activeId,...rowData({kind:'room',expires:Date.now()+86_400_000,board:board()}),$permissions:[]}]);
 const fx=fixture({seed}),list=fx.db.listRows.bind(fx.db),insertedId='0'.repeat(32);let inserted=false;
 fx.db.listRows=async args=>{const page=await list(args);if(!inserted){inserted=true;fx.db.rows.set(insertedId,{$id:insertedId,...rowData({kind:'room-op-receipt',expires:old-1000}),$permissions:[]})}return page};
 let runs=0;while(fx.db.rows.size>1&&runs<20){const beforeCalls=fx.db.calls.length,result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.ok(result.body.deleted<=CLEANUP_ROW_BUDGET);const calls=fx.db.calls.slice(beforeCalls),lists=calls.filter(c=>c.op==='listRows'),deletes=calls.filter(c=>c.op==='deleteRows');assert.ok(lists.length<=CLEANUP_PAGE_BUDGET);assert.ok(lists.length<=Math.ceil(CLEANUP_ROW_BUDGET/100));assert.ok(deletes.length<=Math.ceil(CLEANUP_ROW_BUDGET/100));assert.ok(deletes.every(c=>JSON.parse(c.queries.find(q=>q.startsWith('equal:$id:')).slice('equal:$id:'.length)).length<=100));assert.ok(calls.filter(c=>c.op==='deleteRow').length<=CLEANUP_SPECIAL_ROW_BUDGET);for(const call of lists)assert.ok(call.queries.some(q=>q.startsWith('lessThanEqual:expiresAt:')));runs++}
 assert.ok(runs>=2&&runs<=Math.ceil((ROOM_OP_RECEIPT_LIMIT+1)/CLEANUP_ROW_BUDGET));assert.equal(fx.db.rows.size,1,'successive runs eventually remove every expired receipt');assert.ok(fx.db.rows.has(activeId),'active room stays outside the expiry-filtered cleanup');assert.ok(inserted,'a concurrent expired insert was introduced');assert.equal(fx.db.rows.has(insertedId),false,'an earlier-key concurrent insert is found by re-querying the first expiry page');
});

test('scheduled cleanup stops at its elapsed-work budget and leaves remaining rows for the next run',async()=>{
 let now=Date.now();const seed=Array.from({length:250},(_,i)=>{const id=(i+1).toString(16).padStart(32,'0');return[id,{$id:id,...rowData({kind:'room-op-receipt',expires:now-1000}),$permissions:[]}]}),fx=fixture({seed,clock:()=>now}),list=fx.db.listRows.bind(fx.db);let calls=0;
 fx.db.listRows=async args=>{calls++;const page=await list(args);if(calls===2)now+=CLEANUP_TIME_BUDGET_MS;return page};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.equal(calls,2);assert.equal(result.body.deleted,100);assert.equal(fx.db.rows.size,150,'remaining expired rows are left to a later invocation');
});

test('cleanup transaction preserves an AI quota row renewed after the expiry page was read',async()=>{
 const id='ai-renewed',old=Date.now()-86400000,seed=[[id,{$id:id,...rowData({kind:'ai-quota',expires:old,day:'old',n:0,m:0,minute:0,last:0}),$permissions:[]}]],fx=fixture({seed}),list=fx.db.listRows.bind(fx.db);let renewed=false;
 fx.db.listRows=async args=>{const page=await list(args);if(!renewed){renewed=true;const row=fx.db.rows.get(id),data=JSON.parse(row.payload);data.expires=Date.now()+86400000;row.payload=JSON.stringify(data);row.expiresAt=new Date(data.expires).toISOString()}return page};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.equal(result.body.deleted,0);assert.ok(fx.db.rows.has(id));
});

test('creation cap counts private internal rows separately and remains at 150 under concurrent requests',async()=>{
 const seed=seededShares(149);for(const prefix of ['p','h','j','k','g','o','q']){const id=prefix+'a'.repeat(31),data={kind:'internal',expires:Date.now()+10000};seed.push([id,{$id:id,...rowData(data),$permissions:[]}])}
 for(const id of ['ai-global','ai-'+'b'.repeat(24)]){const data={kind:'ai-quota',expires:Date.now()+10000};seed.push([id,{$id:id,...rowData(data),$permissions:[]}])}
 const fx=fixture({seed});let active=0,maxActive=0;const list=fx.db.listRows.bind(fx.db);
 fx.db.listRows=async args=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));try{return await list(args)}finally{active--}};
 const requests=['a'.repeat(32),'b'.repeat(32)].map(requestId=>fx.call({method:'POST',path:'/create',body:{kind:'view',board:board(),requestId}}));
 const responses=await Promise.all(requests);assert.deepEqual(responses.map(r=>r.status).sort(),[201,429]);assert.equal(maxActive,1);
 const links=[...fx.db.rows.keys()].filter(id=>/^[a-f0-9]{32}$/.test(id));assert.equal(links.length,150);assert.equal(fx.db.rows.size,160);
});

test('full share cap denies a create without adding an idempotency receipt',async()=>{
 const fx=fixture({seed:seededShares(150)}),response=await fx.call({method:'POST',path:'/create',body:{kind:'view',board:board(),requestId:'c'.repeat(32)}});
 assert.equal(response.status,429);assert.equal(fx.db.rows.size,150);assert.ok(fx.db.calls.filter(c=>c.op==='listRows').length>=2);
});

test('invalid update and unknown routes fail closed without leaking row data',async()=>{
 const fx=fixture(),bad=await fx.call({method:'POST',path:'/room/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',body:{changes:'bad'}});assert.equal(bad.status,400);
 const missing=await fx.call({method:'GET',path:'/unknown'});assert.equal(missing.status,404);
});

test('AI endpoint uses private TablesDB quota rows with expiry metadata and test-only provider transport',async()=>{
 const fx=fixture(),result=await fx.call({method:'POST',path:'/ai',body:{op:'correct',text:'hello',clientId:'anon-1'}});assert.equal(result.status,200);assert.deepEqual(result.body,{text:'Hello from test.'});
 assert.ok(fx.db.rows.has('ai-global'));const aiRows=[...fx.db.rows].filter(([id])=>id.startsWith('ai-')).map(([,row])=>row);assert.ok(aiRows.every(row=>Array.isArray(row.$permissions)&&row.$permissions.length===0&&Number.isFinite(Date.parse(row.expiresAt))));
});

test('runtime configuration failures return a generic response and never log the ephemeral key or exception message',async()=>{
 const logs=[],handler=createHandler({env:{},QueryApi:Q});
 const req={method:'GET',path:'/view/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',headers:{'x-appwrite-key':'test-ephemeral-secret'},bodyText:''};
 const res={json:(body,status=200)=>({body,status}),text:(body,status=200)=>({body,status})};
 const result=await handler({req,res,error:m=>logs.push(String(m))});assert.equal(result.status,500);assert.ok(logs.length);assert.ok(!logs.join('').includes('test-ephemeral-secret'));assert.ok(!logs.join('').includes('runtime configuration'));
});

test('scheduled cleanup skips a lock reacquired after its expiry page was read',async()=>{
 const id='k'+'0'.repeat(31),fx=fixture({seed:[lockRow(id,'old-lease',Date.now()-1000)]}),list=fx.db.listRows.bind(fx.db);let reacquired=false;
 fx.db.listRows=async args=>{const page=await list(args);if(!reacquired){reacquired=true;const expires=Date.now()+60000;fx.db.rows.set(id,{$id:id,...rowData({kind:'lock',leaseId:'fresh-lease',ts:Date.now(),expires}),$permissions:[]})}return page};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});
 assert.equal(result.status,200);assert.equal(result.body.deleted,0);assert.equal(reacquired,true);assert.equal(JSON.parse(fx.db.rows.get(id).payload).leaseId,'fresh-lease');assert.ok(Date.parse(fx.db.rows.get(id).expiresAt)>Date.now());
});

test('scheduled cleanup transaction conflicts rather than deleting a lock replaced before commit',async()=>{
 const id='k'+'1'.repeat(31),fx=fixture({seed:[lockRow(id,'old-lease',Date.now()-1000)]});let reacquired=false;
 fx.db.beforeTxCommit=async(_txId,tx)=>{if(!reacquired&&tx.original.has(id)&&!tx.rows.has(id)){reacquired=true;const expires=Date.now()+60000;fx.db.rows.set(id,{$id:id,...rowData({kind:'lock',leaseId:'fresh-lease',ts:Date.now(),expires}),$permissions:[]})}};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});
 assert.equal(result.status,200);assert.equal(result.body.deleted,0);assert.equal(reacquired,true);assert.equal(JSON.parse(fx.db.rows.get(id).payload).leaseId,'fresh-lease');
});

test('a lock holder cannot release a newer lease acquired at the same lock row ID',async()=>{
 const id='k'+'0'.repeat(31),fx=fixture(),list=fx.db.listRows.bind(fx.db);let reacquired=false;
 fx.db.listRows=async args=>{const page=await list(args);if(!reacquired&&fx.db.rows.has(id)){reacquired=true;const expires=Date.now()+60000;fx.db.rows.set(id,{$id:id,...rowData({kind:'lock',leaseId:'other-holder',ts:Date.now(),expires}),$permissions:[]})}return page};
 const response=await fx.call({method:'POST',path:'/create',body:{kind:'view',board:board(),requestId:'f'.repeat(32)}});
 assert.equal(response.status,201);assert.equal(reacquired,true);assert.equal(JSON.parse(fx.db.rows.get(id).payload).leaseId,'other-holder');
});
