import test from 'node:test';
import assert from 'node:assert/strict';
import {Client,Query,TablesDB} from 'node-appwrite';
import {createAppwriteDb,createHandler} from './main.js';

const Q={limit:n=>`limit:${n}`,offset:n=>`offset:${n}`,select:fields=>`select:${fields.join(',')}`};
const DB='ghdraw',TABLE='boards';
const board=()=>({p:[{id:'page-1',n:'Page 1',e:[{id:'shape-1',type:'rect'}]}]});
const payload=data=>({payload:JSON.stringify(data)});
const err=code=>Object.assign(new Error('mock database error'),{code});

test('installed Node SDK sends row and transaction calls to TablesDB endpoints',async()=>{
 const client=new Client().setEndpoint('https://fra.cloud.appwrite.io/v1').setProject('project-test').setKey('ephemeral-test-key'),calls=[];
 client.call=async(method,uri,headers,payload)=>{calls.push({method,path:uri.pathname,headers,payload});return {rows:[]}};
 const tables=new TablesDB(client);
 await tables.createRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'},permissions:[]});
 await tables.getRow({databaseId:DB,tableId:TABLE,rowId:'row-test'});
 await tables.updateRow({databaseId:DB,tableId:TABLE,rowId:'row-test',data:{payload:'{}'}});
 await tables.deleteRow({databaseId:DB,tableId:TABLE,rowId:'row-test'});
 await tables.listRows({databaseId:DB,tableId:TABLE,queries:[Query.limit(100)]});
 await tables.createTransaction({ttl:60});
 await tables.updateTransaction({transactionId:'tx-test',commit:true});
 assert.ok(calls.length===7);assert.ok(calls.every(call=>call.path.includes('/tablesdb/')));assert.ok(calls.every(call=>!call.path.includes('/databases/')));
 assert.equal(calls[0].path,'/v1/tablesdb/ghdraw/tables/boards/rows');assert.equal(calls[0].payload.data.payload,'{}');assert.deepEqual(calls[0].payload.permissions,[]);
 assert.ok(calls.some(call=>call.path.endsWith('/rows/row-test')));assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions'));
 assert.ok(calls.some(call=>call.path==='/v1/tablesdb/transactions/tx-test'));
});

class MemoryTablesDB{
 constructor(seed=[]){this.rows=new Map(seed);this.transactions=new Map();this.nextTx=0;this.calls=[];this.tablePermissions=[]}
 #map(transactionId){if(!transactionId)return this.rows;const tx=this.transactions.get(transactionId);if(!tx)throw err(404);return tx.rows}
 async createTransaction(){const $id=`tx-${++this.nextTx}`;this.transactions.set($id,{rows:new Map([...this.rows].map(([id,row])=>[id,structuredClone(row)]))});return {$id}}
 async updateTransaction({transactionId,commit=false}){const tx=this.transactions.get(transactionId);if(!tx)return {};if(commit)this.rows=tx.rows;this.transactions.delete(transactionId);return {status:commit?'committed':'rolled_back'}}
 async getRow({rowId,transactionId}){const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);return structuredClone(rows.get(rowId))}
 async getRowAsAnonymous(rowId){const row=this.rows.get(rowId);if(!row)throw err(404);const permissions=[...this.tablePermissions,...(row.$permissions||[])];if(permissions.some(p=>typeof p==='string'&&/^(read|write)\("any"\)$/.test(p)))return structuredClone(row);throw err(401)}
 async createRow({rowId,data,permissions=[],transactionId}){this.calls.push({op:'createRow',rowId,permissions:structuredClone(permissions)});const rows=this.#map(transactionId);if(rows.has(rowId))throw err(409);const row={$id:rowId,...structuredClone(data),$permissions:structuredClone(permissions)};rows.set(rowId,row);return structuredClone(row)}
 async updateRow({rowId,data,permissions,transactionId}){this.calls.push({op:'updateRow',rowId});const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);const old=rows.get(rowId);const row={...old,...structuredClone(data),$id:rowId};if(permissions!==undefined)row.$permissions=structuredClone(permissions);rows.set(rowId,row);return structuredClone(row)}
 async deleteRow({rowId,transactionId}){this.calls.push({op:'deleteRow',rowId});const rows=this.#map(transactionId);if(!rows.has(rowId))throw err(404);rows.delete(rowId);return {}}
 async listRows({databaseId,tableId,queries=[]}){assert.equal(databaseId,DB);assert.equal(tableId,TABLE);this.calls.push({op:'listRows',queries:[...queries]});let limit=25,offset=0,select=null;for(const q of queries){if(q.startsWith('limit:'))limit=Number(q.slice(6));else if(q.startsWith('offset:'))offset=Number(q.slice(7));else if(q.startsWith('select:'))select=q.slice(7).split(',')}const all=[...this.rows.values()],page=all.slice(offset,offset+limit).map(row=>select?Object.fromEntries(select.filter(k=>k in row).map(k=>[k,row[k]])):structuredClone(row));return {total:all.length,rows:page}}
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
const update=async(fx,id,{opId='11111111111111111111111111111111',baseRev=0,shapeId='shape-2'}={})=>fx.call({method:'POST',path:`/room/${id}`,body:{opId,baseRev,changes:[{t:'put',pid:'page-1',e:{id:shapeId,type:'ellipse'}}]}});

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
 assert.equal('userId' in view.body,false);assert.ok(fx.db.calls.some(c=>c.op==='createRow'&&c.rowId===created.id&&c.permissions.length===0));
});

test('direct anonymous row access is denied even though the Function route is public',async()=>{
 const fx=fixture(),created=await createShare(fx,'view');
 await assert.rejects(fx.db.getRowAsAnonymous(created.id),e=>e.code===401);
 const viaFunction=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(viaFunction.status,200);
 assert.deepEqual(fx.db.tablePermissions,[]);assert.deepEqual(fx.db.rows.get(created.id).$permissions,[]);
});

test('anonymous room creation and reads expose the sync protocol but never owner or operation secrets',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.equal(room.status,200);assert.equal(room.body.syncProtocol,'room-ops-v1');assert.equal(room.body.rev,0);assert.equal('owner' in room.body,false);assert.equal('ops' in room.body,false);assert.deepEqual(fx.db.rows.get(created.id).$permissions,[]);
});

test('room operation ACKs, duplicate retries and stale-base rebase survive TablesDB transactions',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 const first=await update(fx,created.id);assert.equal(first.status,200);assert.equal(first.body.ack,'11111111111111111111111111111111');assert.equal(first.body.rev,1);
 const retry=await update(fx,created.id);assert.equal(retry.status,200);assert.equal(retry.body.duplicate,true);assert.equal(retry.body.rev,1);
 const second=await update(fx,created.id,{opId:'22222222222222222222222222222222',baseRev:0,shapeId:'shape-3'});assert.equal(second.status,200);assert.equal(second.body.rebased,true);assert.equal(second.body.rev,2);
 const room=await fx.call({method:'GET',path:`/room/${created.id}`});assert.deepEqual(room.body.board.p[0].e.map(e=>e.id),['shape-1','shape-2','shape-3']);
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

test('owner deletion is token-protected and removes main, presence and history rows',async()=>{
 const fx=fixture(),created=await createShare(fx,'room');
 await fx.call({method:'POST',path:`/live/${created.id}`,body:{cid:'client01'}});
 await fx.call({method:'POST',path:`/hist/${created.id}`,body:{op:'save'}});
 const denied=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:'wrong'}});assert.equal(denied.status,403);assert.ok(fx.db.rows.has(created.id));
 const removed=await fx.call({method:'DELETE',path:`/owner/${created.id}`,body:{owner:created.owner}});assert.deepEqual(removed.body,{ok:true});assert.equal(fx.db.rows.has(created.id),false);assert.equal(fx.db.rows.has('p'+created.id.slice(0,31)),false);assert.equal(fx.db.rows.has('h'+created.id.slice(0,31)),false);
});

test('expired share reads return 410 and remove the expired row',async()=>{
 const fx=fixture(),created=await createShare(fx,'view'),row=fx.db.rows.get(created.id);row.payload=JSON.stringify({...JSON.parse(row.payload),expires:Date.now()-1});
 const result=await fx.call({method:'GET',path:`/view/${created.id}`});assert.equal(result.status,410);assert.equal(fx.db.rows.has(created.id),false);
});

test('scheduled cleanup paginates all rows, deleting expired items only and tolerating malformed payloads',async()=>{
 const seed=[];for(let i=0;i<205;i++){const id=i.toString(16).padStart(32,'0');seed.push([id,{$id:id,payload:JSON.stringify({kind:'view',expires:i%2===0?Date.now()-1000:Date.now()+86400000}),$permissions:[]}])}
 seed.push(['f'.repeat(32),{$id:'f'.repeat(32),payload:'not-json',$permissions:[]}]);
 const fx=fixture({seed}),result=await fx.call({method:'POST',path:'/ignored',headers:{'x-appwrite-trigger':'schedule'}});
 assert.equal(result.status,200);assert.equal(result.body.deleted,103);assert.equal(fx.db.rows.size,103);assert.ok(fx.db.rows.has('f'.repeat(32)));
 const offsets=fx.db.calls.filter(c=>c.op==='listRows').flatMap(c=>c.queries.filter(q=>q.startsWith('offset:')));assert.deepEqual(offsets,['offset:100','offset:200']);
});

test('creation cap counts paginated share rows but excludes private internal and AI rows',async()=>{
 const seed=[];for(let i=0;i<150;i++){const id=(0x10000+i).toString(16).padStart(32,'0');seed.push([id,{$id:id,payload:JSON.stringify({kind:'view',expires:Date.now()+10000}),$permissions:[]}])}
 for(const prefix of ['p','h','k']){const id=prefix+'a'.repeat(31);seed.push([id,{$id:id,payload:JSON.stringify({kind:'live',expires:Date.now()+10000}),$permissions:[]}])}
 for(const id of ['ai-global','ai-'+'b'.repeat(24)])seed.push([id,{$id:id,payload:JSON.stringify({kind:'ai-quota',expires:Date.now()+10000}),$permissions:[]}]);
 const fx=fixture({seed}),result=await fx.call({method:'POST',path:'/create',body:{kind:'view',board:board()}});assert.equal(result.status,429);assert.equal(fx.db.rows.size,155);assert.ok(fx.db.calls.filter(c=>c.op==='listRows').length>=2);
});

test('invalid update and unknown routes fail closed without leaking row data',async()=>{
 const fx=fixture(),bad=await fx.call({method:'POST',path:'/room/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',body:{changes:'bad'}});assert.equal(bad.status,400);
 const missing=await fx.call({method:'GET',path:'/unknown'});assert.equal(missing.status,404);
});

test('AI endpoint uses private TablesDB quota rows and test-only provider transport',async()=>{
 const fx=fixture(),result=await fx.call({method:'POST',path:'/ai',body:{op:'correct',text:'hello',clientId:'anon-1'}});assert.equal(result.status,200);assert.deepEqual(result.body,{text:'Hello from test.'});
 assert.ok(fx.db.rows.has('ai-global'));assert.ok([...fx.db.rows].filter(([id])=>id.startsWith('ai-')).every(([,row])=>Array.isArray(row.$permissions)&&row.$permissions.length===0));
});

test('runtime configuration failures return a generic response and never log the ephemeral key or exception message',async()=>{
 const logs=[],handler=createHandler({env:{},QueryApi:Q});
 const req={method:'GET',path:'/view/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',headers:{'x-appwrite-key':'test-ephemeral-secret'},bodyText:''};
 const res={json:(body,status=200)=>({body,status}),text:(body,status=200)=>({body,status})};
 const result=await handler({req,res,error:m=>logs.push(String(m))});assert.equal(result.status,500);assert.ok(logs.length);assert.ok(!logs.join('').includes('test-ephemeral-secret'));assert.ok(!logs.join('').includes('runtime configuration'));
});
