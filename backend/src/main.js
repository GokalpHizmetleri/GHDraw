import {Client,TablesDB,Query} from 'node-appwrite';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {handleAI} from './ai.js';
import {applyRoomUpdate,validOpId} from './room-sync.js';
import BoardElementContract from '../shared/board-element-contract.js';
const DB='ghdraw',TABLE='boards',MAX=12*1024*1024,PAGE_SIZE=100,CREATE_LOCK_SEED='00000000000000000000000000000000',LOCK_LEASE_MS=60000;
// Shared Free-plan per-room receipt budget: board operations, history restores and chat sends.
export const ROOM_OP_RECEIPT_LIMIT=9_400,LIVE_CHAT_RECEIPT_LIMIT=ROOM_OP_RECEIPT_LIMIT;
export const BOARD_COORD_LIMIT=BoardElementContract.COORD_LIMIT,BOARD_POINT_LIMIT=BoardElementContract.POINT_LIMIT;
export const CLEANUP_ROW_BUDGET=1_000,CLEANUP_SPECIAL_ROW_BUDGET=25,CLEANUP_PAGE_BUDGET=10,CLEANUP_TIME_BUDGET_MS=20_000;
export const LIVE_ROOM_PEER_LIMIT=32,LIVE_ROOM_REQUESTS_PER_SECOND=40,LIVE_REQUEST_MAX_BYTES=8*1024,LIVE_ROW_MAX_BYTES=384*1024,LIVE_RESPONSE_MAX_BYTES=320*1024,LIVE_CHAT_MESSAGE_LIMIT=500,LIVE_CHAT_LIMIT=100;
const LIVE_PEER_TTL_MS=15_000,LIVE_PEER_VISIBLE_MS=12_000,LIVE_RATE_WINDOW_MS=1_000;
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const validElementId=x=>typeof x==='string'&&x.length>0&&x.length<=BoardElementContract.MAX_ELEMENT_ID_LENGTH;
const validElement=BoardElementContract.validElement;
// Appwrite projects expiry metadata as a narrow DateTime column so scans never download board payloads.
const rowData=d=>({payload:JSON.stringify(d),expiresAt:new Date(d.expires).toISOString()});
const createReceiptRowId=requestId=>'g'+createHash('sha256').update('ghdraw-create:'+requestId).digest('hex').slice(0,31);
const roomOpReceiptRowId=(roomId,opId)=>'o'+createHash('sha256').update('ghdraw-room-op:'+roomId+':'+opId).digest('hex').slice(0,31);
const historyRestoreReceiptRowId=(roomId,restoreId)=>'o'+createHash('sha256').update('ghdraw-room-restore:'+roomId+':'+restoreId).digest('hex').slice(0,31);
const liveChatReceiptRowId=(roomId,mid)=>'j'+createHash('sha256').update('ghdraw-live-chat:'+roomId+':'+mid).digest('hex').slice(0,31);
const roomOpQuotaRowId=id=>'q'+id.slice(0,31);
const roomChatCount=q=>q?.chatCount===undefined?0:q.chatCount;
const validRoomReceiptQuota=(q,id)=>{const chatCount=roomChatCount(q),ids=q?.receiptIds;return q?.kind==='room-op-quota'&&q.roomId===id&&Number.isSafeInteger(q.count)&&q.count>=0&&q.count<=ROOM_OP_RECEIPT_LIMIT&&Number.isSafeInteger(chatCount)&&chatCount>=0&&Array.isArray(ids)&&ids.length+chatCount===q.count&&ids.every(x=>typeof x==='string'&&/^o[a-f0-9]{31}$/.test(x))&&new Set(ids).size===ids.length};
// Board history: one side row per room ('h'+id), same expiry as the room. Newest 20 versions, gzip+base64, 8 MB total.
const HID=id=>'h'+id.slice(0,31),HMAX_N=20,HMAX_TOTAL=8e6,HMAX_ONE=3e6,HGAP=120000;
const validPage=p=>p&&validId(p.id)&&typeof p.n==='string'&&p.n.length<=100&&Array.isArray(p.e)&&p.e.length<=10000&&p.e.every(validElement)&&new Set(p.e.map(e=>e.id)).size===p.e.length;
const validBoard=b=>b&&Array.isArray(b.p)&&b.p.length>0&&b.p.length<=100&&b.p.every(validPage)&&new Set(b.p.map(p=>p.id)).size===b.p.length;
const validChange=c=>c&&(['addPage'].includes(c.t)?validPage(c.p):validId(c.pid)&&(c.t==='delPage'||c.t==='rename'&&typeof c.n==='string'||c.t==='put'&&validElement(c.e)||c.t==='del'&&validElementId(c.eid)||c.t==='order'&&Array.isArray(c.ids)&&c.ids.length<=10000&&c.ids.every(validElementId)));
const hasCommentOverflow=elements=>Array.isArray(elements)&&elements.some(e=>Array.isArray(e?.th)&&e.th.length>BoardElementContract.MAX_COMMENTS);
const boardHasCommentOverflow=board=>Array.isArray(board?.p)&&board.p.some(page=>hasCommentOverflow(page?.e));
const changesHaveCommentOverflow=changes=>Array.isArray(changes)&&changes.some(change=>change?.t==='put'&&hasCommentOverflow([change.e])||change?.t==='addPage'&&boardHasCommentOverflow({p:[change.p]}));
const commentLimitMessage='This thread has reached the 10,000-comment limit. The update was not applied and existing comments were preserved.';

// Appwrite Functions supply a short-lived scoped key per execution. No persistent API key is needed.
export function createAppwriteDb({req,env=process.env,ClientClass=Client,TablesDBClass=TablesDB}={}){
 const endpoint=env.APPWRITE_FUNCTION_API_ENDPOINT,project=env.APPWRITE_FUNCTION_PROJECT_ID,key=req?.headers?.['x-appwrite-key'];
 if(typeof endpoint!=='string'||!endpoint||typeof project!=='string'||!project||typeof key!=='string'||!key)throw Object.assign(new Error('Appwrite Function runtime configuration is incomplete'),{code:500});
 const client=new ClientClass();
 client.setEndpoint(endpoint);client.setProject(project);client.setKey(key);
 return new TablesDBClass(client);
}

// Remove a stale fixed-row lock only after reading its current lease inside the transaction.
const clearExpiredLock=async(db,rowId,cutoff=Date.now())=>{
 const tx=await db.createTransaction({ttl:60});
 try{
  const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id}),data=JSON.parse(row.payload);
  const expiry=Date.parse(row.expiresAt);
  if(data.kind!=='lock'||!Number.isFinite(expiry)||expiry>cutoff){await db.updateTransaction({transactionId:tx.$id,rollback:true});return false}
  await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id});
  await db.updateTransaction({transactionId:tx.$id,commit:true});return true;
 }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code===404||e.code===409)return false;throw e}
};
const releaseLock=async(db,rowId,leaseId)=>{
 const tx=await db.createTransaction({ttl:60});
 try{
  const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id}),data=JSON.parse(row.payload);
  if(data.kind!=='lock'||data.leaseId!==leaseId){await db.updateTransaction({transactionId:tx.$id,rollback:true});return false}
  await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id});
  await db.updateTransaction({transactionId:tx.$id,commit:true});return true;
 }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code===404||e.code===409)return false;throw e}
};
// Fixed-row lock serializes room writes and the global share-cap count+insert. Function timeout must be < LOCK_LEASE_MS.
const withLock=async(db,id,fn,{leaseMs=LOCK_LEASE_MS}={})=>{
 const rowId='k'+id.slice(0,31);let got=false,leaseId=null;
 for(let i=0;i<50&&!got;i++){
  const now=Date.now();leaseId=randomBytes(16).toString('hex');const lock={kind:'lock',leaseId,ts:now,expires:now+leaseMs};
  try{await db.createRow({databaseId:DB,tableId:TABLE,rowId,data:rowData(lock),permissions:[]});got=true}
  catch(e){if(e.code!==409)throw e;await clearExpiredLock(db,rowId).catch(()=>{});await new Promise(r=>setTimeout(r,120+Math.random()*120))}
 }
 if(!got)throw {code:429};
 try{return await fn()}finally{await releaseLock(db,rowId,leaseId).catch(()=>{})}
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
 if(rowId.startsWith('k'))return clearExpiredLock(db,rowId,cutoff);
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

export function createHandler({dbFactory=createAppwriteDb,QueryApi=Query,env=process.env,fetcher=fetch,clock=()=>Date.now()}={}){
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
    const db=await getDb(),started=clock(),cutoff=started,cutoffIso=new Date(cutoff).toISOString();let deleted=0,scanned=0,pages=0,specialRows=0;
    while(scanned<CLEANUP_ROW_BUDGET&&pages<CLEANUP_PAGE_BUDGET&&clock()-started<CLEANUP_TIME_BUDGET_MS){
     const limit=Math.min(PAGE_SIZE,CLEANUP_ROW_BUDGET-scanned),queries=[QueryApi.lessThanEqual('expiresAt',cutoffIso),QueryApi.orderAsc('expiresAt'),QueryApi.limit(limit),QueryApi.select(['$id','expiresAt'])];
     let page;try{page=await db.listRows({databaseId:DB,tableId:TABLE,queries})}catch(_){return reply({error:'Cleanup could not run. Verify that boards has a ready ascending expiresAt index; no successful cleanup was reported.'},503)}
     if(!page||!Array.isArray(page.rows))throw new Error('Unexpected TablesDB row-list response');
     if(!page.rows.length)break;
     pages++;scanned+=page.rows.length;const directIds=[];let budgetReached=false;
     for(const row of page.rows){
      if(clock()-started>=CLEANUP_TIME_BUDGET_MS){budgetReached=true;break}
      if(typeof row.$id!=='string')continue;
      if(row.$id.startsWith('ai-')||row.$id.startsWith('k')){
       if(specialRows>=CLEANUP_SPECIAL_ROW_BUDGET||clock()-started>=CLEANUP_TIME_BUDGET_MS){budgetReached=true;break}
       specialRows++;if(await deleteExpiredRow(db,row.$id,cutoff))deleted++;
      }else directIds.push(row.$id);
     }
     if(directIds.length&&!budgetReached&&clock()-started<CLEANUP_TIME_BUDGET_MS){
      const result=await db.deleteRows({databaseId:DB,tableId:TABLE,queries:[QueryApi.equal('$id',directIds),QueryApi.lessThanEqual('expiresAt',cutoffIso)]});
      deleted+=Number.isSafeInteger(result?.total)?result.total:directIds.length;
     }
     if(budgetReached||page.rows.length<limit||clock()-started>=CLEANUP_TIME_BUDGET_MS)break;
    }
    return reply({deleted});
   }
   const path=(req.path||'').split('/').filter(Boolean),id=path[1];
   if(req.method==='POST'&&req.path==='/ai'){const db=await getDb(),r=await handleAI(req,db,env.GROQ_API_KEY,fetcher);return reply(r.body,r.status)}
   if(req.method==='GET'&&['view','room'].includes(path[0])){const d=await read(id);if(d.kind!==path[0])throw {code:404};const {owner,ops,createReceiptId,...publicData}=d;return reply(path[0]==='room'?{...publicData,syncProtocol:'room-ops-v1'}:publicData)}
   if(req.method==='POST'&&path[0]==='live'){
    // One bounded, private side row per room; transactionally cap active peers and writes.
    const bodyText=typeof req.bodyText==='string'?req.bodyText:JSON.stringify(req.bodyJson||{});
    if(Buffer.byteLength(bodyText)>LIVE_REQUEST_MAX_BYTES)return reply({error:'live_payload_limit',message:'Presence request exceeds 8 KiB.'},413);
    const b=req.bodyJson||{};if(typeof b.cid!=='string'||!/^[a-z0-9]{6,24}$/.test(b.cid)||b.mid!==undefined&&(typeof b.mid!=='string'||!/^[a-f0-9]{32}$/.test(b.mid)))throw {code:400};
    if(typeof b.msg==='string'&&b.msg.length>LIVE_CHAT_MESSAGE_LIMIT)return reply({error:'live_payload_limit',message:'Chat message exceeds 500 characters.'},413);
    const db=await getDb(),room=await read(id);if(room.kind!=='room')throw {code:404};
    const pid='p'+id.slice(0,31),now=clock();
    const num=v=>typeof v==='number'&&isFinite(v)&&Math.abs(v)<1e7?v:null;
    const me={n:String(b.n||'?').slice(0,20),c:/^#[0-9a-fA-F]{6}$/.test(b.c||'')?b.c:'#6965db',x:num(b.x),y:num(b.y),pg:typeof b.pg==='string'?b.pg.slice(0,128):'',ts:now};
    const msg=typeof b.msg==='string'?b.msg.trim().slice(0,LIVE_CHAT_MESSAGE_LIMIT):'';
    if(b.mid!==undefined&&!msg)throw {code:400};
    for(let attempt=0;attempt<4;attempt++){
     const tx=await db.createTransaction({ttl:60});
     let chatAck=null;
     try{
      let data,exists=true;
      try{const row=await db.getRow({databaseId:DB,tableId:TABLE,rowId:pid,transactionId:tx.$id});data=JSON.parse(row.payload)}catch(e){if(e.code!==404)throw e;exists=false;data={kind:'live',expires:room.expires,presence:{},chat:[]}}
      if(data.kind!=='live'||!data.presence||typeof data.presence!=='object'||Array.isArray(data.presence)||!Array.isArray(data.chat)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_data_invalid'},409)}
      for(const [peerId,peer] of Object.entries(data.presence))if(!/^[a-z0-9]{6,24}$/.test(peerId)||!peer||!Number.isSafeInteger(peer.ts)||peer.ts<now-LIVE_PEER_TTL_MS)delete data.presence[peerId];
      const activeCount=Object.keys(data.presence).length,alreadyPresent=Object.prototype.hasOwnProperty.call(data.presence,b.cid);
      if(activeCount>LIVE_ROOM_PEER_LIMIT||!alreadyPresent&&activeCount>=LIVE_ROOM_PEER_LIMIT){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_peer_limit',message:'This room reached its 32 active-peer limit.'},409)}
      const rateWindow=Math.floor(now/LIVE_RATE_WINDOW_MS)*LIVE_RATE_WINDOW_MS;
      if(data.rateWindow!==rateWindow){data.rateWindow=rateWindow;data.rateCount=0}
      if(!Number.isSafeInteger(data.rateCount)||data.rateCount<0)data.rateCount=0;
      if(data.rateCount>=LIVE_ROOM_REQUESTS_PER_SECOND){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_rate_limit',message:'This room reached its 40-requests-per-second limit.'},429)}
      data.rateCount++;
      data.presence[b.cid]=me;
      if(msg){
       let receipt=null,prior=null,messageHash=null,receiptId=null;
       if(b.mid){
        messageHash=createHash('sha256').update(msg).digest('hex');receiptId=liveChatReceiptRowId(id,b.mid);
        try{receipt=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:receiptId,transactionId:tx.$id})).payload)}catch(e){if(e.code!==404)throw e}
        prior=data.chat.find(m=>m?.id===b.mid);
        if(prior&&prior.m!==msg||receipt&&(receipt.kind!=='live-chat-receipt'||receipt.roomId!==id||receipt.mid!==b.mid||receipt.messageHash!==messageHash)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_message_id_conflict',message:'This message ID was already used for a different message.'},409)}
        if(receipt)chatAck=b.mid;
       }
       if(!chatAck){
        let quota;try{quota=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),transactionId:tx.$id})).payload)}catch(e){if(e.code!==404)throw e;await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room has no safe shared receipt counter. The message was not sent.'},409)}
        if(!validRoomReceiptQuota(quota,id)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room has no complete safe receipt ledger. The message was not sent.'},409)}
        if(quota.count>=LIVE_CHAT_RECEIPT_LIMIT){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_chat_receipt_limit',message:'This room reached its shared 9,400 room receipt limit. The message remains queued and was not sent.'},409)}
        const nextQuota={...quota,count:quota.count+1,chatCount:roomChatCount(quota)+1};
        if(b.mid){if(!prior)data.chat.push({id:b.mid,cid:b.cid,n:me.n,c:me.c,m:msg,ts:now});const record={kind:'live-chat-receipt',roomId:id,mid:b.mid,messageHash,expires:room.expires};await db.createRow({databaseId:DB,tableId:TABLE,rowId:receiptId,data:rowData(record),permissions:[],transactionId:tx.$id});chatAck=b.mid}
        else data.chat.push({id:randomBytes(6).toString('hex'),cid:b.cid,n:me.n,c:me.c,m:msg,ts:now});
        await db.updateRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),data:rowData(nextQuota),transactionId:tx.$id});
       }
      }
      data.chat=data.chat.slice(-LIVE_CHAT_LIMIT);
      const peers=Object.entries(data.presence).filter(([k,v])=>k!==b.cid&&v.ts>=now-LIVE_PEER_VISIBLE_MS).map(([k,v])=>({cid:k,...v}));
      // Return the complete bounded window: timestamps are not unique or commit-ordered, so filtering by `after` can skip equal-time or late-committing messages. Legacy clients may still send `after`; it is intentionally ignored.
      const response={peers,chat:data.chat,...(chatAck?{ack:chatAck}:{}),now},stored=rowData(data);
      if(Buffer.byteLength(stored.payload)>LIVE_ROW_MAX_BYTES){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_payload_limit',message:'Presence data exceeds its storage limit.'},413)}
      if(Buffer.byteLength(JSON.stringify(response))>LIVE_RESPONSE_MAX_BYTES){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'live_response_limit'},409)}
      const args={databaseId:DB,tableId:TABLE,rowId:pid,data:stored,transactionId:tx.$id};
      if(exists)await db.updateRow(args);else await db.createRow({...args,permissions:[]});
      await db.updateTransaction({transactionId:tx.$id,commit:true});
      return reply(response);
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code===409&&attempt===3)return reply({error:'live_contention',message:'Presence changed concurrently; retry shortly.'},409);if(e.code!==409)throw e}
    }
   }
   if(req.method==='POST'&&path[0]==='hist'){
    const db=await getDb(),room=await read(id);if(room.kind!=='room')throw {code:404};
    const b=req.bodyJson||{};
    if(b.op==='save')return await withLock(db,id,async()=>{const cur=await read(id);return reply({result:await histSnap(db,id,cur.board,cur.expires,true)})});
    if(b.op==='get'){
     const h=await histRead(db,id),v=h.v.find(x=>x.ts===b.ts);if(!v)throw {code:404};
     const board=JSON.parse(gunzipSync(Buffer.from(v.z,'base64')).toString());if(!validBoard(board))throw {code:400};return reply({board});
    }
    if(b.op==='restore'){
     if(!validOpId(b.restoreId)||!Number.isSafeInteger(b.ts)||b.ts<0)return reply({error:'Invalid history restore request'},400);
     return await withLock(db,id,async()=>{
      const receiptId=historyRestoreReceiptRowId(id,b.restoreId);
      try{
       const receipt=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:receiptId})).payload);
       if(receipt.kind!=='history-restore-receipt'||receipt.roomId!==id||receipt.restoreId!==b.restoreId)return reply({error:'History restore receipt is invalid'},409);
       if(receipt.ts!==b.ts)return reply({error:'restore_id_conflict'},409);
       const current=await read(id),{owner,ops,createReceiptId,...publicData}=current;
       return reply({...publicData,syncProtocol:'room-ops-v1',ack:b.restoreId,duplicate:true});
      }catch(e){if(e.code!==404)throw e}
      const h=await histRead(db,id),v=h.v.find(x=>x.ts===b.ts);if(!v)throw {code:404};
      const board=JSON.parse(gunzipSync(Buffer.from(v.z,'base64')).toString());if(!validBoard(board))throw {code:400};
      const current=await read(id);let quota;
      try{quota=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id)})).payload)}catch(e){if(e.code!==404)throw e;return reply({error:'room_receipt_limit',message:'This room has no safe receipt counter. Create a new room to continue.'},409)}
      const receiptIds=quota.receiptIds;
      if(!validRoomReceiptQuota(quota,id))return reply({error:'room_receipt_limit',message:'This room has no complete safe receipt ledger. Create a new room to continue.'},409);
      if(quota.count>=ROOM_OP_RECEIPT_LIMIT)return reply({error:'room_receipt_limit',message:'This room reached its shared 9,400 room receipt limit. Create a new room to continue; existing receipts are retained for safe retries.'},409);
      for(let attempt=0;attempt<4;attempt++){
       const tx=await db.createTransaction({ttl:60});
       try{
        const d=await read(id,tx.$id),q=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),transactionId:tx.$id})).payload),ids=q.receiptIds;
        if(!validRoomReceiptQuota(q,id)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room has no complete safe receipt ledger. Create a new room to continue.'},409)}
        if(q.count>=ROOM_OP_RECEIPT_LIMIT){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room reached its shared 9,400 room receipt limit. Create a new room to continue; existing receipts are retained for safe retries.'},409)}
        await histSnap(db,id,d.board,d.expires,true);
        d.board=board;d.rev=(Number.isSafeInteger(d.rev)?d.rev:0)+1;const nextQuota={...q,count:q.count+1,chatCount:roomChatCount(q),receiptIds:[...ids,receiptId]},receipt={kind:'history-restore-receipt',roomId:id,restoreId:b.restoreId,ts:b.ts,expires:d.expires};
        await db.updateRow({databaseId:DB,tableId:TABLE,rowId:id,data:rowData(d),transactionId:tx.$id});
        await db.updateRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),data:rowData(nextQuota),transactionId:tx.$id});
        await db.createRow({databaseId:DB,tableId:TABLE,rowId:receiptId,data:rowData(receipt),permissions:[],transactionId:tx.$id});
        await db.updateTransaction({transactionId:tx.$id,commit:true});const {owner,ops,createReceiptId,...publicData}=d;return reply({...publicData,syncProtocol:'room-ops-v1',ack:b.restoreId,duplicate:false});
       }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
      }
     });
    }
    const h=await histRead(db,id);return reply({versions:h.v.map(x=>({ts:x.ts,manual:!!x.m,n:x.n,pc:x.pc,size:x.z.length})).reverse(),expires:room.expires,max:HMAX_N});
   }
   if(req.method==='POST'&&req.path==='/create'){
    if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Board exceeds 12 MB'},413);
    const b=req.bodyJson||{};if(boardHasCommentOverflow(b.board))return reply({error:'comment_limit',message:commentLimitMessage},409);if(!['view','room'].includes(b.kind)||!validBoard(b.board)||(b.requestId!==undefined&&!validOpId(b.requestId)))return reply({error:'Invalid board'},400);
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
     const id=randomBytes(16).toString('hex'),owner=randomBytes(24).toString('hex'),expires=Date.now()+(b.kind==='view'?7*24:48)*3600000;
     const d={kind:b.kind,expires,board:b.board,room:b.room||null,owner,...(receiptId?{createReceiptId:receiptId}:{}),...(b.kind==='room'?{rev:0,ops:[]}: {})};
     const stored=rowData(d);if(Buffer.byteLength(stored.payload)>MAX)return reply({error:'Board exceeds 12 MB'},413);
     let shareCount=0;
     await forEachRows({select:['$id']},rows=>{for(const row of rows)if(typeof row.$id==='string'&&!/^[phjkgoq]/.test(row.$id)&&!row.$id.startsWith('ai-'))shareCount++;return shareCount<150});
     if(shareCount>=150)return reply({error:'Free storage is full; ask the project owner to remove old links.'},429);
     const tx=await db.createTransaction({ttl:60});
     try{
      await db.createRow({databaseId:DB,tableId:TABLE,rowId:id,data:stored,permissions:[],transactionId:tx.$id});
      if(b.kind==='room'){const quota={kind:'room-op-quota',roomId:id,count:0,chatCount:0,receiptIds:[],expires};await db.createRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),data:rowData(quota),permissions:[],transactionId:tx.$id})}
      if(receiptId){const receipt={kind:'create-receipt',id,owner,expires,requestHash};await db.createRow({databaseId:DB,tableId:TABLE,rowId:receiptId,data:rowData(receipt),permissions:[],transactionId:tx.$id})}
      await db.updateTransaction({transactionId:tx.$id,commit:true});
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});throw e}
     return reply({id,expires,owner},201);
    });
   }
   if(req.method==='POST'&&path[0]==='room'){
    if(!/^[a-f0-9]{32}$/.test(id||''))throw {code:404};
    if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Update exceeds 12 MB'},413);
    const b=req.bodyJson||{};if(changesHaveCommentOverflow(b.changes))return reply({error:'comment_limit',message:commentLimitMessage},409);if(!Array.isArray(b.changes)||b.changes.length>5000||!b.changes.every(validChange)||(b.changes.length>0&&!validOpId(b.opId))||(b.opId!==undefined&&!validOpId(b.opId))||(b.baseRev!==undefined&&(!Number.isSafeInteger(b.baseRev)||b.baseRev<0)))return reply({error:'Invalid update; a valid opId is required for changes'},400);
    const db=await getDb();
    return await withLock(db,id,async()=>{for(let attempt=0;attempt<6;attempt++){
     const tx=await db.createTransaction({ttl:60});
     try{
      const d=await read(id,tx.$id);if(d.kind!=='room')throw {code:404};
      const opReceiptId=b.opId&&b.changes.length?roomOpReceiptRowId(id,b.opId):null;let alreadyApplied=false,quota=null;
      if(opReceiptId){try{const receipt=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:opReceiptId,transactionId:tx.$id})).payload);if(receipt.kind!=='room-op-receipt'||receipt.roomId!==id||receipt.opId!==b.opId)throw {code:409};alreadyApplied=true}catch(e){if(e.code!==404)throw e}if(!alreadyApplied&&Array.isArray(d.ops)&&d.ops.includes(b.opId))alreadyApplied=true}
      if(opReceiptId&&!alreadyApplied){
       try{quota=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),transactionId:tx.$id})).payload)}catch(e){if(e.code!==404)throw e;await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room has no safe receipt counter. Create a new room to continue.'},409)}
       if(!Array.isArray(quota.receiptIds)&&quota.count===0)quota.receiptIds=[];
       if(!validRoomReceiptQuota(quota,id)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room has no complete safe receipt ledger. Create a new room to continue.'},409)}
       if(quota.count>=ROOM_OP_RECEIPT_LIMIT){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_limit',message:'This room reached its shared 9,400 room receipt limit. Create a new room to continue; existing receipts are retained for safe retries.'},409)}
       quota={...quota,count:quota.count+1,chatCount:roomChatCount(quota),receiptIds:[...quota.receiptIds,opReceiptId]};
      }
      const op=applyRoomUpdate(d,b,{alreadyApplied});
      if(op.duplicate){await db.updateTransaction({transactionId:tx.$id,rollback:true});const {owner,ops,createReceiptId,...publicData}=d;return reply({...publicData,syncProtocol:'room-ops-v1',ack:op.ack,duplicate:true,rebased:op.rebased})}
      if(!validBoard(d.board)){if(boardHasCommentOverflow(d.board)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'comment_limit',message:commentLimitMessage},409)}throw {code:400}}if(Buffer.byteLength(JSON.stringify(d))>MAX)throw {code:413};
      await db.updateRow({databaseId:DB,tableId:TABLE,rowId:id,data:rowData(d),transactionId:tx.$id});
      if(opReceiptId&&!alreadyApplied){await db.updateRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),data:rowData(quota),transactionId:tx.$id});const receipt={kind:'room-op-receipt',roomId:id,opId:b.opId,expires:d.expires};await db.createRow({databaseId:DB,tableId:TABLE,rowId:opReceiptId,data:rowData(receipt),permissions:[],transactionId:tx.$id})}
      await db.updateTransaction({transactionId:tx.$id,commit:true});
      if(b.changes.length)await histSnap(db,id,d.board,d.expires,false).catch(()=>{});
      const {owner,ops,createReceiptId,...publicData}=d;return reply({...publicData,syncProtocol:'room-ops-v1',ack:op.ack,rebased:op.rebased});
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===5)throw e}
    }});
   }
   if(req.method==='DELETE'&&path[0]==='owner'){
    if(!/^[a-f0-9]{32}$/.test(id||''))throw {code:404};
    const db=await getDb();return await withLock(db,id,async()=>{
     const tx=await db.createTransaction({ttl:60});
     try{
      const d=await read(id,tx.$id);if(req.bodyJson?.owner!==d.owner){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'Not authorized'},403)}
      const expectedRev=req.bodyJson?.expectedRev;if(expectedRev!==undefined&&!Number.isSafeInteger(expectedRev)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'invalid_room_revision'},400)}if(expectedRev!==undefined&&(d.kind!=='room'||d.rev!==expectedRev)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_revision_changed',message:'The room changed after the requested snapshot; it was not deleted.'},409)}
      let receiptIds=[];if(d.kind==='room'){
       let quota;try{quota=JSON.parse((await db.getRow({databaseId:DB,tableId:TABLE,rowId:roomOpQuotaRowId(id),transactionId:tx.$id})).payload)}catch(e){if(e.code!==404)throw e;await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_ledger_incomplete',message:'The room receipt ledger is unavailable; the room was not deleted.'},409)}
       receiptIds=quota.receiptIds;if(!validRoomReceiptQuota(quota,id)){await db.updateTransaction({transactionId:tx.$id,rollback:true});return reply({error:'room_receipt_ledger_incomplete',message:'The room receipt ledger is incomplete; the room was not deleted.'},409)}
      }
      for(let i=0;i<receiptIds.length;i+=100)await db.deleteRows({databaseId:DB,tableId:TABLE,queries:[QueryApi.equal('$id',receiptIds.slice(i,i+100))],transactionId:tx.$id});
      for(const rowId of [id,'p'+id.slice(0,31),HID(id),roomOpQuotaRowId(id),d.createReceiptId].filter(Boolean))await db.deleteRow({databaseId:DB,tableId:TABLE,rowId,transactionId:tx.$id}).catch(e=>{if(e.code!==404)throw e});
      await db.updateTransaction({transactionId:tx.$id,commit:true});return reply({ok:true});
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});throw e}
    });
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
