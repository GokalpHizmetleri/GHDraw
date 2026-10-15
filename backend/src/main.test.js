import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,Query,TablesDB} from 'node-appwrite';
import {createAppwriteDb,createHandler} from './main.js';

const Q={limit:n=>`limit:${n}`,orderAsc:key=>`orderAsc:${key}`,cursorAfter:id=>`cursorAfter:${id}`,select:fields=>`select:${fields.join(',')}`};
const DB='ghdraw',TABLE='boards';
const board=()=>({p:[{id:'page-1',n:'Page 1',e:[{id:'shape-1',type:'rect'}]}]});
const rowData=data=>({payload:JSON.stringify(data),expiresAt:new Date(data.expires).toISOString()});
const err=code=>Object.assign(new Error('mock database error'),{code});

 test('installed Node SDK sends row and cursor query calls to TablesDB endpoints',async()=>{
 const client=new Client().setEndpoint('https://fra.cloud.appwrite.io/v1').setProject('project-test').setKey('ephemeral-test-key'),calls=[];
 client.call=async(method,uri,headers,payload)=>{calls.push({method,path:uri.pathname,headers,payload});return {rows:[]}};
 const tables=new TablesDB(client);
 await tables.createRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'},permissions:[],transactionId:'tx-test'});
 await tables.getRow({databaseId:DB,tableId:TABLE,rowId:'row-test',transactionId:'tx-test'});
 await tables.updateRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'},transactionId:'tx-test'});
 await tables.deleteRow({databaseId:DB,tableId:TABLE,rowId:'row-test',transactionId:'tx-test'});
 await tables.listRows({databaseId:DB,tableId:TABLE,queries:[Query.orderAsc('$id'),Query.limit(100),Query.cursorAfter('row-test'),Query.select(['$id','expiresAt'])]});
 await tables.createTransaction({ttl:60});
 await tables.updateTransaction({transactionId:'tx-test',commit:true});
 assert.equal(calls.length,7);assert.ok(calls.every(call=>call.path.includes('/tablesdb/')));assert.ok(calls.every(call=>!call.path.includes('/databases/')));
 assert.equal(calls[0].path,'/v1/tablesdb/ghdraw/tables/boards/rows');assert.equal(calls[0].payload.data.payload,'{}');assert.deepEqual(calls[0].payload.permissions,[]);assert.equal(calls[0].payload.transactionId,'tx-test');
 assert.ok(calls.some(call=>call.path.endsWith('/rows/row-test')));assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions'));
 assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions/tx-test'));
 });

class MemoryTablesDB{
 constructor(seed=[]){this.rows=new Map(seed);this.transactions=new Map();this.nextTx=0;this.calls=[];this.tablePermissions=[];this.failDeleteOnceId=null}
 #map(transactionId){if(!transactionId)return this.rows;const tx=this.transactions.get(transactionId);if(!tx)throw err(404);return tx.rows}
 async createTransaction(){const $id=`tx-${++this.nextTx}`;this.transactions.set($id,{rows:new Map([...this.rows].map(([id,row])=>[id,structuredClone(row)]))});return {$id}}
 async updateTransaction({transactionId,commit=false}){const tx=this.transactions.get(transactionId);if(!tx)return {};if(commit)this.rows=tx.rows;this.transactions.delete(transactionId);return {status:commit?'committed':'rolled_back'}}
 async getRow({rowId,transactionId}){const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);return structuredClone(rows.get(rowId))}
 async getRowAsAnonymous(rowId){const row=this.rows.get(rowId);if(!row)throw err(404);const permissions=[...this.tablePermissions,...(row.$permissions||[])];if(permissions.some(p=>typeof p==='string'&&/^(read|write)\("any"\)$/.test(p)))return structuredClone(row);throw err(401)}
 async createRow({rowId,data,permissions=[],transactionId}){this.calls.push({op:'createRow',rowId,permissions:structuredClone(permissions)});const rows=this.#map(transactionId);if(rows.has(rowId))throw err(409);const row={$id:rowId,...structuredClone(data),$permissions:structuredClone(permissions)};rows.set(rowId,row);return structuredClone(row)}
 async updateRow({rowId,data,permissions,transactionId}){this.calls.push({op:'updateRow',rowId});const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);const old=rows.get(rowId);const row={...old,...structuredClone(data),$id:rowId};if(permissions!==undefined)row.$permissions=structuredClone(permissions);rows.set(rowId,row);return structuredClone(row)}
 async deleteRow({rowId,transactionId}){this.calls.push({op:'deleteRow',rowId});if(this.failDeleteOnceId===rowId){this.failDeleteOnceId=null;throw err(500)}const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);rows.delete(rowId);return {}}
 async listRows({databaseId,tableId,queries=[]}){
  assert.equal(databaseId,DB);assert.equal(tableId,TABLE);this.calls.push({op:'listRows',queries:[...queries]});let limit=25,cursor=null,select=null,order=null;
  for(const q of queries){if(q.startsWith('limit:'))limit=Number(q.slice(6));else if(q.startsWith('cursorAfter:'))cursor=q.slice(12);else if(q.startsWith('select:'))select=q.slice(7).split(',');else if(q.startsWith('orderAsc:'))order=q.slice(9)}
  let all=[...this.rows.values()];if(order==='$id')all.sort((a,b)=>a.$id.localeCompare(b.$id));
  if(cursor){if(!this.rows.has(cursor))throw err(404);all=all.filter(row=>row.$id.localeCompare(cursor)>0)}
  const page=all.slice(0,limit).map(row=>select?Object.fromEntries(select.filter(k=>k in row).map(k=>[k,row[k]])):structuredClone(row));return {total:all.length,rows:page}
 }
}

function fixture({env={GROQ_API_KEY:'test-groq-key'},seed=[]}={}){
 const db=new MemoryTablesDB(seed),logs=[];let factories=0;
 const handler=createHandler({dbFactory:()=>{factories++;return db},QueryApi:Q,env,fetcher:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'Hello from test.'}}]})})});
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
const update=(fx,id,{opId='11111111111111111111111111111111',baseRev=0,shapeId='shape-2'}={})=>fx.call({method:'POST',path:`/room/${id}`,body:{opId,baseRev,changes:[{t:'put',pid:'page-1',e:{id:shapeId,type:'ellipse'}}]}});
const seededShares=n=>Array.from({length:n},(_,i)=>{const id=(0x10000+i).toString(16).padStart(32,'0'),data={kind:'view',expires:Date.now()+86400000,board:board()};return [id,{$id:id,...rowData(data),$permissions:[]}]});

// Function runtime credentials are ephemeral; no long-lived secret is accepted from the source.
test('Appwrite client uses runtime endpoint/project and the per-execution x-appwrite-key',()=>{
 const seen={};
 class FakeClient{setEndpoint(v){seen.endpoint=v;return this}setProject(v){seen.project=v;return this}setKey(v){seen.key=v;return this}}
 class FakeTablesDB{constructor(client){this.client=client}}
 const db=createAppwriteDb({req:{headers:{'x-appwrite-key':'ephemeral-test-key'}},env:{APPWRITE_FUNCTION_API_ENDPOINT:'https://fra.cloud.appwrite.io/v1',APPWRITE_FUNCTION_PROJECT_ID:'project-test'},ClientClass:FakeClient,TablesDBClass:FakeTablesDB});
 assert.ok(db instanceof FakeTablesDB);assert.deepEqual(seen,{endpoint:'https://fra.cloud.appwrite.io/v1',project:'project-test',key:'ephemeral-test-key'});
 assert.throws(()=>createAppwriteDb({req:{headers:{}},env:{},ClientClass:FakeClient,TablesDBClass:FakeTablesDB}),e=>e.code===500&&!e.message.includes('ephemeral'));
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
 assert.equal(createdResponse.status,201);const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.equal(room.status,200);assert.equal(room.body.syncProtocol,'room-ops-v1');assert.equal(room.body.rev,0);assert.equal('owner' in room.body,false);assert.equal('ops' in room.body,false);assert.equal('createReceiptId' in room.body,false);assert.deepEqual(fx.db.rows.get(created.id).$permissions,[]);
});

test('room operation ACKs, duplicate retries and stale-base rebase survive TablesDB transactions',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const first=await update(fx,created.id);assert.equal(first.status,200);assert.equal(first.body.ack,'11111111111111111111111111111111');assert.equal(first.body.rev,1);
 const retry=await update(fx,created.id);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.rev,1);
 const second=await update(fx,created.id,{opId:'22222222222222222222222222222222',baseRev:0,shapeId:'shape-3'});assert.equal(second.status,200);assert.equal(second.body.rebased,true);assert.equal(second.body.rev,2);
 const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.deepEqual(room.body.board.p[0].e.map(e=>e.id),['shape-1','shape-2','shape-3']);
});

test('room update refuses an over-cap lifetime operation ledger without committing it',async()=>{
 const id='d'.repeat(32),data={kind:'room',expires:Date.now()+86400000,board:board(),room:null,owner:'owner-token',rev:0,ops:Array(380000).fill('0'.repeat(32))};
 const fx=fixture({seed:[[id,{$id:id,...rowData(data),$permissions:[]}]]}),before=fx.db.rows.get(id).payload;
 const response=await update(fx,id,{opId:'f'.repeat(32),shapeId:'new-shape'});
 assert.equal(response.status,413);assert.equal(fx.db.rows.get(id).payload,before);
});

test('live presence and anonymous chat are stored in private side rows',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const first=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01',n:'A',c:'#123456',x:10,y:20}});assert.equal(first.status,200);assert.deepEqual(first.body.peers,[]);
 const second=await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client02',n:'B',msg:'hello',after:0}});assert.equal(second.status,200);assert.equal(second.body.peers.length,1);assert.equal(second.body.chat[0].m,'hello');
 const liveRow=fx.db.rows.get('p'+created.id.slice(0,31));assert.ok(liveRow);assert.deepEqual(liveRow.$permissions,[]);
});

test('history endpoint exports a version and restores it without losing revision semantics',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 await update(fx,created.id,{opId:'33333333333333333333333333333333',shapeId:'shape-2'});
 const list=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'list'}});assert.equal(list.status,200);assert.ok(list.body.versions.length>=1);
 const version=list.body.versions[0],exported=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'get',ts:version.ts}});assert.equal(exported.status,200);assert.ok(exported.body.board.p[0].e.some(e=>e.id==='shape-2'));
 await update(fx,created.id,{opId:'44444444444444444444444444444444',baseRev:1,shapeId:'shape-3'});
 const restored=await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'restore',ts:version.ts}});assert.equal(restored.status,200);assert.ok(restored.body.board.p[0].e.some(e=>e.id==='shape-2'));assert.ok(!restored.body.board.p[0].e.some(e=>e.id==='shape-3'));assert.equal(restored.body.rev,3);
 const historyRow=fx.db.rows.get('h'+created.id.slice(0,31));assert.ok(historyRow);assert.deepEqual(historyRow.$permissions,[]);
});

test('owner deletion is token-protected and atomically removes main, presence, history and receipt rows',async()=>{
 const fx=fixture(),created=(await fx.call({method:'POST',path:'/create',body:{kind:'room',board:board(),requestId:'e'.repeat(32)}})).body;
 await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01'}});
 await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});
 const root=JSON.parse(fx.db.rows.get(created.id).payload),receiptId=root.createReceiptId;
 const denied=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:'wrong'}});assert.equal(denied.status,403);assert.ok(fx.db.rows.has(created.id));
 const removed=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner}});assert.deepEqual(removed.body,{ok:true});assert.equal(fx.db.rows.has(created.id),false);assert.equal(fx.db.rows.has('p'+created.id.slice(0,31)),false);assert.equal(fx.db.rows.has('h'+created.id.slice(0,31)),false);assert.equal(fx.db.rows.has(receiptId),false);
});

test('expired share reads return 410 and remove the expired row',async()=>{
 const fx=fixture(),created=await createShare(fx,'view'),row=fx.db.rows.get(created.id);row.payload=JSON.stringify({...JSON.parse(row.payload),expires:Date.now()-1});
 const result=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(result.status,410);assert.equal(fx.db.rows.has(created.id),false);
});

test('scheduled cleanup pages only expiry metadata, handles mid-page failure and resumes safely',async()=>{
 const seed=[],expiredIds=[];for(let i=0;i<205;i++){const id=i.toString(16).padStart(32,'0'),isExpired=i%2===0||i===99||i===199,expires=Date.now()+(isExpired?-1000:86400000);if(isExpired)expiredIds.push(id);seed.push([id,{$id:id,payload:'x'.repeat(50000),expiresAt:new Date(expires).toISOString(),$permissions:[]}])}
 const badId='f'.repeat(32);seed.push([badId,{$id:badId,payload:'not-json',expiresAt:'not-a-date',$permissions:[]}]);
 const fx=fixture({seed});fx.db.failDeleteOnceId=expiredIds[1];
 const failed=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(failed.status,500);assert.ok(fx.db.rows.has(expiredIds[1]));
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.equal(fx.db.rows.size,101);assert.ok(fx.db.rows.has(badId));for(const id of expiredIds)assert.equal(fx.db.rows.has(id),false);
 const lists=fx.db.calls.filter(c=>c.op==='listRows');assert.ok(lists.length>=4);for(const call of lists){assert.ok(call.queries.includes('orderAsc:$id'));assert.ok(call.queries.includes('limit:100'));assert.ok(call.queries.includes('select:$id,expiresAt'));assert.ok(!call.queries.some(q=>q.includes('payload')))}
 assert.ok(lists.some(c=>c.queries.some(q=>q.startsWith('cursorAfter:'))));assert.ok(!lists.some(c=>c.queries.some(q=>q.startsWith('offset:'))));
});

test('cleanup transaction preserves an AI quota row renewed after the expiry page was read',async()=>{
 const id='ai-renewed',old=Date.now()-86400000,seed=[[id,{$id:id,...rowData({kind:'ai-quota',expires:old,day:'old',n:0,m:0,minute:0,last:0}),$permissions:[]}]],fx=fixture({seed}),list=fx.db.listRows.bind(fx.db);let renewed=false;
 fx.db.listRows=async args=>{const page=await list(args);if(!renewed){renewed=true;const row=fx.db.rows.get(id),data=JSON.parse(row.payload);data.expires=Date.now()+86400000;row.payload=JSON.stringify(data);row.expiresAt=new Date(data.expires).toISOString()}return page};
 const result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});assert.equal(result.status,200);assert.equal(result.body.deleted,0);assert.ok(fx.db.rows.has(id));
});

test('creation cap counts private internal rows separately and remains at 150 under concurrent requests',async()=>{
 const seed=seededShares(149);for(const prefix of ['p','h','k','g']){const id=prefix+'a'.repeat(31),data={kind:'internal',expires:Date.now()+10000};seed.push([id,{$id:id,...rowData(data),$permissions:[]}])}
 for(const id of ['ai-global','ai-'+'b'.repeat(24)]){const data={kind:'ai-quota',expires:Date.now()+10000};seed.push([id,{$id:id,...rowData(data),$permissions:[]}])}
 const fx=fixture({seed});let active=0,maxActive=0;const list=fx.db.listRows.bind(fx.db);
 fx.db.listRows=async args=>{active++;maxActive=Math.max(maxActive,active);await new Promise(r=>setTimeout(r,5));try{return await list(args)}finally{active--}};
 const requests=['a'.repeat(32),'b'.repeat(32)].map(requestId=>fx.call({method:'POST',path:'/create',body:{kind:'view',board:board(),requestId}}));
 const responses=await Promise.all(requests);assert.deepEqual(responses.map(r=>r.status).sort(),[201,429]);assert.equal(maxActive,1);
 const links=[...fx.db.rows.keys()].filter(id=>/^[a-f0-9]{32}$/.test(id));assert.equal(links.length,150);assert.equal(fx.db.rows.size,157);
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
