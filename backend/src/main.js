import {Client,TablesDB,Query} from 'node-appwrite';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {handleAI} from './ai.js';
import {applyRoomUpdate,validOpId} from './room-sync.js';
const DB='ghdraw',TABLE='boards',MAX=12*1024*1024,PAGE_SIZE=100,CREATE_LOCK_SEED='00000000000000000000000000000000',LOCK_LEASE_MS=60000;
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const validThread=th=>th===undefined||Array.isArray(th)&&th.length<=300&&th.every(m=>m&&typeof m.t==='string'&&m.t.length<=500);
const validElement=e=>e&&validId(e.id)&&['rect','diamond','ellipse','arrow','line','pen','text','image','video','frame','poly'].includes(e.type)&&validThread(e.th);
// Appwrite projects expiry metadata as a narrow DateTime column so scans never download board payloads.
const rowData=d=>({payload:JSON.stringify(d),expiresAt:new Date(d.expires).toISOString()});
const createReceiptRowId=requestId=>'g'+createHash('sha256').update('ghdraw-create:'+requestId).digest('hex').slice(0,31);
// Board history: one side row per room ('h'+id), same expiry as the room. Newest 20 versions, gzip+base64, 8 MB total.
const HID=id=>'h'+id.slice(0,31),HMAX_N=20,HMAX_TOTAL=8e6,HMAX_ONE=3e6,HGAP=120000;
const validPage=p=>p&&validId(p.id)&&typeof p.n==='string'&&p.n.length<=100&&Array.isArray(p.e)&&p.e.length<=10000&&p.e.every(validElement)&&new Set(p.e.map(e=>e.id)).size===p.e.length;
const validBoard=b=>b&&Array.isArray(b.p)&&b.p.length>0&&b.p.length<=100&&b.p.every(validPage)&&new Set(b.p.map(p=>p.id)).size===b.p.length;
const validChange=c=>c&&(['addPage'].includes(c.t)?validPage(c.p):validId(c.pid)&&(c.t==='delPage'||c.t==='rename'&&typeof c.n==='string'||c.t==='put'&&validElement(c.e)||c.t==='del'&&validId(c.eid)||c.t==='order'&&Array.isArray(c.ids)&&c.ids.length<=10000&&c.ids.every(validId)));

// Appwrite Functions supply a short-lived scoped key per execution. No persistent API key is needed.
export function createAppwriteDb({req,env=process.env,ClientClass=Client,TablesDBClass=TablesDB}={}){
 const endpoint=env.APPWRITE_FUNCTION_API_ENDPOINT,project=env.APPWRITE_FUNCTION_PROJECT_ID,key=req?.headers?.['x-appwrite-key'];
 if(typeof endpoint!=='string'||!endpoint||typeof project!=='string'||!project||typeof key!=='string'||!key)throw Object.assign(new Error('Appwrite Function runtime configuration is incomplete'),{code:500});
 const client=new ClientClass();
 client.setEndpoint(endpoint);client.setProject(project);client.setKey(key);
 return new TablesDBClass(client);
}

// Remove an expired fixed-row lock through a transaction so two contenders cannot delete a newly acquired lock.
const clearExpiredLock=async(db,rowId)=>{
 const tx=await db.createTransaction({ttl:60});
 try{
  const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id});
  const expiry=Date.parse(row.expiresAt);
  if(Number.isFinite(expiry)&&expiry>Date.now()){await db.updateTransaction({transactionId:tx.$id,rollback:true});return false}
  await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id});
  await db.updateTransaction({transactionId:tx.$id,commit:true});return true;
 }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code===404||e.code===409)return false;throw e}
};
// Fixed-row lock serializes room writes and the global share-cap count+insert. Function timeout must be < LOCK_LEASE_MS.
const withLock=async(db,id,fn,{leaseMs=LOCK_LEASE_MS}={})=>{
 const rowId='k'+id.slice(0,31);let got=false;
 for(let i=0;i<50&&!got;i++){
  const now=Date.now(),lock={kind:'lock',ts:now,expires:now+leaseMs};
  try{await db.createRow({databaseId:DB,tableId:TABLE,rowId,data:rowData(lock),permissions:[]});got=true}
  catch(e){if(e.code!==409)throw e;await clearExpiredLock(db,rowId).catch(()=>{});await new Promise(r=>setTimeout(r,120+Math.random()*120))}
 }
 if(!got)throw {code:429};
 try{return await fn()}finally{await db.deleteRow({databaseId:DB,tableId:TABLE,rowId}).catch(()=>{})}
};
// AI quota rows can be renewed while cleanup runs, so re-check and delete them in one transaction.
const deleteExpiredAiRow=async(db,rowId,cutoff)=>{
 for(let attempt=0;attempt<3;attempt++){
  const tx=await db.createTransaction({ttl:60});
  try{
   const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id}),expiry=Date.parse(row.expiresAt);
   if(!Number.isFinite(expiry)||expiry>cutoff){await db.updateTransaction({transactionId:tx.$id,rollback:true});return false}
   await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id});
   await db.updateTransaction({transactionId:tx.$id,commit:true});return true;
  }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code===404)return false;if(e.code!==409||attempt===2)throw e}
 }
 return false;
};
const deleteExpiredRow=async(db,rowId,cutoff)=>{
 if(rowId.startsWith('ai-'))return deleteExpiredAiRow(db,rowId,cutoff);
 try{await db.deleteRow({databaseId:DB,tableId:TABLE,rowId});return true}catch(e){if(e.code===404)return false;throw e}
};

// Per-room write lock: a row created with a fixed id succeeds for exactly one caller (409 for the rest).
const histSnap=async (db,id,board,expires,manual)=>{
 const json=JSON.stringify(board),hash=createHash('sha1').update(json).digest('hex');
 let z=null;const n=board.p.reduce((a,p)=>a+p.e.length,0),pc=board.p.length,now=Date.now();
 for(let attempt=0;attempt<4;attempt++){
  const tx=await db.createTransaction({ttl:60});
  try{
   let data,exists=true;
   try{const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId:HID(id),transactionId:tx.$id});data=JSON.parse(row.payload)}catch(e){if(e.code!==404)throw e;exists=false;data={kind:'hist',expires,v:[]}}
   const last=data.v[data.v.length-1];
   if(last&&(last.h===hash||(!manual&&now-last.ts<HGAP))){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});return 'skipped'}
   z=z||gzipSync(json).toString('base64');if(z.length>HMAX_ONE){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});return 'toolarge'}
   data.v.push({ts:now,m:manual?1:0,h:hash,n,pc,z});
   while(data.v.length>HMAX_N||(data.v.length>1&&data.v.reduce((a,x)=>a+x.z.length,0)>HMAX_TOTAL))data.v.shift();
   const args={databaseId:DB,tableId:TABLE,rowId:HID(id),data:rowData(data),transactionId:tx.$id};
   if(exists)await db.updateRow(args);
   else await db.createRow({...args,permissions:[]});
   await db.updateTransaction({transactionId:tx.$id,commit:true});return 'saved';
  }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
 }
};
const histRead=async (db,id)=>{try{const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId:HID(id)});return JSON.parse(row.payload)}catch(e){if(e.code===404)return {v:[]};throw e}};

export function createHandler({dbFactory=createAppwriteDb,QueryApi=Query,env=process.env,fetcher=fetch}={}){
 return async ({req,res,error})=>{
  const headers={'Access-Control-Allow-Origin':'https://ghdraw.vercel.app','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
  const reply=(v,status=200)=>res.json(v,status,headers);
  if(req.method==='OPTIONS')return res.text('',204,headers);
  let dbInstance;
  const getDb=()=>dbInstance||(dbInstance=dbFactory({req,env}));
  const read=async (id,transactionId)=>{if(!/^[a-f0-9]{32}$/.test(id||''))throw {code:404};const row=await (await getDb()).getRow({databaseId:DB,tableId:TABLE,rowId:id,transactionId});const data=JSON.parse(row.payload);if(data.expires<=Date.now()){await (await getDb()).deleteRow({databaseId:DB,tableId:TABLE,rowId:id}).catch(()=>{});throw {code:410}}return data};
  const forEachRows=async ({select,pageSize=PAGE_SIZE},visit)=>{
   const db=await getDb();let cursor=null;
   for(;;){
    const queries=[QueryApi.orderAsc('$id'),QueryApi.limit(pageSize)];if(cursor)queries.push(QueryApi.cursorAfter(cursor));if(select)queries.push(QueryApi.select(select));
    const page=await db.listRows({databaseId:DB,tableId:TABLE,queries});
    if(!page||!Array.isArray(page.rows))throw new Error('Unexpected TablesDB row-list response');
    const keepGoing=await visit(page.rows),lastId=page.rows.length?page.rows[page.rows.length-1].$id:null;
    if(keepGoing===false||page.rows.length<pageSize)break;
    if(typeof lastId!=='string'||lastId===cursor)throw new Error('TablesDB row cursor did not advance');
    cursor=lastId;
   }
  };
  try{
   if(req.method==='GET'&&req.path==='/health')return reply({ok:true});
   if(req.headers?.['x-appwrite-trigger']==='schedule'){
    const db=await getDb(),cutoff=Date.now();let deleted=0,pendingCursorDelete=null;
    await forEachRows({select:['$id','expiresAt']},async rows=>{
     // Keep the previous page's final row until cursorAfter has successfully fetched this page.
     if(pendingCursorDelete){if(await deleteExpiredRow(db,pendingCursorDelete,cutoff))deleted++;pendingCursorDelete=null}
     const fullPage=rows.length===PAGE_SIZE,lastId=rows.length?rows[rows.length-1].$id:null;
     for(const row of rows){if(typeof row.$id!=='string')continue;const expiry=Date.parse(row.expiresAt);if(!Number.isFinite(expiry)||expiry>cutoff)continue;
      if(fullPage&&row.$id===lastId){pendingCursorDelete=row.$id;continue}
      if(await deleteExpiredRow(db,row.$id,cutoff))deleted++;
     }
    });
    if(pendingCursorDelete&&await deleteExpiredRow(db,pendingCursorDelete,cutoff))deleted++;
    return reply({deleted});
   }
   const path=(req.path||'').split('/').filter(Boolean),id=path[1];
   if(req.method==='POST'&&req.path==='/ai'){const db=await getDb(),r=await handleAI(req,db,env.GROQ_API_KEY,fetcher);return reply(r.body,r.status)}
   if(req.method==='GET'&&['view','room'].includes(path[0])){const d=await read(id);if(d.kind!==path[0])throw {code:404};const {owner,ops,createReceiptId,...publicData}=d;return reply(path[0]==='room'?{...publicData,syncProtocol:'room-ops-v1'}:publicData)}
   if(req.method==='POST'&&path[0]==='live'){
    // Presence and chat live in one small side row per room; same expiry as the room.
    const db=await getDb(),room=await read(id);if(room.kind!=='room')throw {code:404};
    const b=req.bodyJson||{};if(typeof b.cid!=='string'||!/^[a-z0-9]{6,24}$/.test(b.cid))throw {code:400};
    const pid='p'+id.slice(0,31),now=Date.now();
    const num=v=>typeof v==='number'&&isFinite(v)&&Math.abs(v)<1e7?v:null;
    const me={n:String(b.n||'?').slice(0,20),c:/^#[0-9a-fA-F]{6}$/.test(b.c||'')?b.c:'#6965db',x:num(b.x),y:num(b.y),pg:typeof b.pg==='string'?b.pg.slice(0,128):'',ts:now};
    const msg=typeof b.msg==='string'?b.msg.trim().slice(0,500):'';const after=num(b.after)||0;
    for(let attempt=0;attempt<4;attempt++){
     const tx=await db.createTransaction({ttl:60});
     try{
      let data,exists=true;
      try{const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId:pid,transactionId:tx.$id});data=JSON.parse(row.payload)}catch(e){if(e.code!==404)throw e;exists=false;data={kind:'live',expires:room.expires,presence:{},chat:[]}}
      data.presence[b.cid]=me;for(const k of Object.keys(data.presence))if(data.presence[k].ts<now-15000)delete data.presence[k];
      if(msg){data.chat.push({id:randomBytes(6).toString('hex'),cid:b.cid,n:me.n,c:me.c,m:msg,ts:now});data.chat=data.chat.slice(-100)}
      const args={databaseId:DB,tableId:TABLE,rowId:pid,data:rowData(data),transactionId:tx.$id};
      if(exists)await db.updateRow(args);else await db.createRow({...args,permissions:[]});
      await db.updateTransaction({transactionId:tx.$id,commit:true});
      const peers=Object.entries(data.presence).filter(([k,v])=>k!==b.cid&&v.ts>=now-12000).map(([k,v])=>({cid:k,...v}));
      return reply({peers,chat:data.chat.filter(m=>m.ts>after),now});
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
    }
   }
   if(req.method==='POST'&&path[0]==='hist'){
    const db=await getDb(),room=await read(id);if(room.kind!=='room')throw {code:404};
    const b=req.bodyJson||{};
    if(b.op==='save')return await withLock(db,id,async()=>{const cur=await read(id);return reply({result:await histSnap(db,id,cur.board,cur.expires,true)})});
    if(b.op==='get'||b.op==='restore'){
     const h=await histRead(db,id),v=h.v.find(x=>x.ts===b.ts);if(!v)throw {code:404};
     const board=JSON.parse(gunzipSync(Buffer.from(v.z,'base64')).toString());if(!validBoard(board))throw {code:400};
     if(b.op==='get')return reply({board});
     return await withLock(db,id,async()=>{const cur=await read(id);await histSnap(db,id,cur.board,cur.expires,true);
     for(let attempt=0;attempt<4;attempt++){
      const tx=await db.createTransaction({ttl:60});
      try{const d=await read(id,tx.$id);d.board=board;d.rev=(Number.isSafeInteger(d.rev)?d.rev:0)+1;
       await db.updateRow({databaseId:DB,tableId:TABLE,rowId:id,data:rowData(d),transactionId:tx.$id});
       await db.updateTransaction({transactionId:tx.$id,commit:true});const {owner,ops,createReceiptId,...publicData}=d;return reply(publicData);
      }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
     }});
    }
    const h=await histRead(db,id);return reply({versions:h.v.map(x=>({ts:x.ts,manual:!!x.m,n:x.n,pc:x.pc,size:x.z.length})).reverse(),expires:room.expires,max:HMAX_N});
   }
   if(req.method==='POST'&&req.path==='/create'){
    if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Board exceeds 12 MB'},413);
    const b=req.bodyJson||{};if(!['view','room'].includes(b.kind)||!validBoard(b.board)||(b.requestId!==undefined&&!validOpId(b.requestId)))return reply({error:'Invalid board'},400);
    const requestHash=b.requestId?createHash('sha256').update(JSON.stringify({kind:b.kind,board:b.board,room:b.room||null})).digest('hex'):null;
    const db=await getDb();
    return await withLock(db,CREATE_LOCK_SEED,async()=>{
     const receiptId=b.requestId?createReceiptRowId(b.requestId):null;
     if(receiptId){
      try{const prior=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:receiptId})).payload);
       if(prior.requestHash!==requestHash)return reply({error:'Create request ID was already used'},409);
       if(prior.expires<=Date.now())return reply({error:'This link has expired'},410);
       return reply({id:prior.id,expires:prior.expires,owner:prior.owner,duplicate:true},201);
      }catch(e){if(e.code!==404)throw e}
     }
     let shareCount=0;
     await forEachRows({select:['$id']},rows=>{for(const row of rows)if(typeof row.$id==='string'&&!/^[phkg]/.test(row.$id)&&!row.$id.startsWith('ai-'))shareCount++;return shareCount<150});
     if(shareCount>=150)return reply({error:'Free storage is full; ask the project owner to remove old links.'},429);
     const id=randomBytes(16).toString('hex'),owner=randomBytes(24).toString('hex'),expires=Date.now()+(b.kind==='view'?7*24:48)*3600000;
     const d={kind:b.kind,expires,board:b.board,room:b.room||null,owner,...(receiptId?{createReceiptId:receiptId}:{}),...(b.kind==='room'?{rev:0,ops:[]}: {})};
     const tx=await db.createTransaction({ttl:60});
     try{
      await db.createRow({databaseId:DB,tableId:TABLE,rowId:id,data:rowData(d),permissions:[],transactionId:tx.$id});
      if(receiptId){const receipt={kind:'create-receipt',id,owner,expires,requestHash};await db.createRow({databaseId:DB,tableId:TABLE,rowId:receiptId,data:rowData(receipt),permissions:[],transactionId:tx.$id})}
      await db.updateTransaction({transactionId:tx.$id,commit:true});
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});throw e}
     return reply({id,expires,owner},201);
    });
   }
   if(req.method==='POST'&&path[0]==='room'){
    if(!/^[a-f0-9]{32}$/.test(id||''))throw {code:404};
    if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Update exceeds 12 MB'},413);
    const b=req.bodyJson||{};if(!Array.isArray(b.changes)||b.changes.length>5000||!b.changes.every(validChange)||(b.opId!==undefined&&!validOpId(b.opId))||(b.baseRev!==undefined&&(!Number.isSafeInteger(b.baseRev)||b.baseRev<0)))return reply({error:'Invalid update'},400);
    return await withLock(await getDb(),id,async()=>{for(let attempt=0;attempt<6;attempt++){
     const tx=await (await getDb()).createTransaction({ttl:60});
     try{
      const d=await read(id,tx.$id);if(d.kind!=='room')throw {code:404};
      const op=applyRoomUpdate(d,b);
      if(op.duplicate){await (await getDb()).updateTransaction({transactionId:tx.$id,rollback:true});const {owner,ops,createReceiptId,...publicData}=d;return reply({...publicData,syncProtocol:'room-ops-v1',ack:op.ack,duplicate:true,rebased:op.rebased})}
      if(!validBoard(d.board))throw {code:400};if(Buffer.byteLength(JSON.stringify(d))>MAX)throw {code:413};
      await (await getDb()).updateRow({databaseId:DB,tableId:TABLE,rowId:id,data:rowData(d),transactionId:tx.$id});
      await (await getDb()).updateTransaction({transactionId:tx.$id,commit:true});
      if(b.changes.length)await histSnap(await getDb(),id,d.board,d.expires,false).catch(()=>{});
      const {owner,ops,createReceiptId,...publicData}=d;return reply({...publicData,syncProtocol:'room-ops-v1',ack:op.ack,rebased:op.rebased});
     }catch(e){await (await getDb()).updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===5)throw e}
    }});
   }
   if(req.method==='DELETE'&&path[0]==='owner'){
    const db=await getDb(),tx=await db.createTransaction({ttl:60});
    try{
     const d=await read(id,tx.$id);if(req.bodyJson?.owner!==d.owner){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'Not authorized'},403)}
     for(const rowId of [id,'p'+id.slice(0,31),HID(id),d.createReceiptId].filter(Boolean))await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id}).catch(e=>{if(e.code!==404)throw e});
     await db.updateTransaction({transactionId:tx.$id,commit:true});return reply({ok:true});
    }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});throw e}
   }
   return reply({error:'Not found'},404);
  }catch(e){
   const code=[400,404,410,413,429].includes(e?.code)?e.code:500;
   // Do not log exception messages: SDK/network errors can contain request metadata.
   if(code===500&&typeof error==='function')error(`Backend request failed (code ${Number.isInteger(e?.code)?e.code:'unknown'})`);
   return reply({error:code===410?'This link has expired':code===404?'Link not found':code===400?'Invalid board':code===413?'Board exceeds 12 MB':'Service unavailable'},code);
  }
 };
}
export default createHandler();
