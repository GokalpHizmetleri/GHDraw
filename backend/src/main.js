import {Client,Databases,Query} from 'node-appwrite';
import {randomBytes,createHash} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {handleAI} from './ai.js';
import {applyRoomUpdate,validOpId} from './room-sync.js';
const DB='ghdraw',COL='boards',MAX=12*1024*1024;
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const validThread=th=>th===undefined||Array.isArray(th)&&th.length<=300&&th.every(m=>m&&typeof m.t==='string'&&m.t.length<=500);
const validElement=e=>e&&validId(e.id)&&['rect','diamond','ellipse','arrow','line','pen','text','image','video','frame','poly'].includes(e.type)&&validThread(e.th);
// Board history: one side document per room ('h'+id), same expiry as the room. Newest 20 versions, gzip+base64, 8 MB total.
const HID=id=>'h'+id.slice(0,31),HMAX_N=20,HMAX_TOTAL=8e6,HMAX_ONE=3e6,HGAP=120000;
const validPage=p=>p&&validId(p.id)&&typeof p.n==='string'&&p.n.length<=100&&Array.isArray(p.e)&&p.e.length<=10000&&p.e.every(validElement)&&new Set(p.e.map(e=>e.id)).size===p.e.length;
const validBoard=b=>b&&Array.isArray(b.p)&&b.p.length>0&&b.p.length<=100&&b.p.every(validPage)&&new Set(b.p.map(p=>p.id)).size===b.p.length;
const validChange=c=>c&&(['addPage'].includes(c.t)?validPage(c.p):validId(c.pid)&&(c.t==='delPage'||c.t==='rename'&&typeof c.n==='string'||c.t==='put'&&validElement(c.e)||c.t==='del'&&validId(c.eid)||c.t==='order'&&Array.isArray(c.ids)&&c.ids.length<=10000&&c.ids.every(validId)));

// Per-room write lock: a document created with a fixed id succeeds for exactly one caller (409 for the rest),
// so room updates and restores run one at a time and no write is lost. A lock older than 15 s is treated as stale.
const withLock=async (db,id,fn)=>{
 const kid='k'+id.slice(0,31);let got=false;
 for(let i=0;i<50&&!got;i++){
  try{await db.createDocument({databaseId:DB,collectionId:COL,documentId:kid,data:{payload:JSON.stringify({kind:'lock',ts:Date.now(),expires:Date.now()+60000})},permissions:[]});got=true}
  catch(e){if(e.code!==409)throw e;
   try{const doc=await db.getDocument({databaseId:DB,collectionId:COL,documentId:kid});if(JSON.parse(doc.payload).ts<Date.now()-15000)await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:kid}).catch(()=>{})}catch(_){}
   await new Promise(r=>setTimeout(r,120+Math.random()*120));
  }
 }
 if(!got)throw {code:429};
 try{return await fn()}finally{await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:kid}).catch(()=>{})}
};
const histSnap=async (db,id,board,expires,manual)=>{
 const json=JSON.stringify(board),hash=createHash('sha1').update(json).digest('hex');
 let z=null;const n=board.p.reduce((a,p)=>a+p.e.length,0),pc=board.p.length,now=Date.now();
 for(let attempt=0;attempt<4;attempt++){
  const tx=await db.createTransaction({ttl:60});
  try{
   let data,exists=true;
   try{const doc=await db.getDocument({databaseId:DB,collectionId:COL,documentId:HID(id),transactionId:tx.$id});data=JSON.parse(doc.payload)}catch(e){if(e.code!==404)throw e;exists=false;data={kind:'hist',expires,v:[]}}
   const last=data.v[data.v.length-1];
   if(last&&(last.h===hash||(!manual&&now-last.ts<HGAP))){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});return 'skipped'}
   z=z||gzipSync(json).toString('base64');if(z.length>HMAX_ONE){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});return 'toolarge'}
   data.v.push({ts:now,m:manual?1:0,h:hash,n,pc,z});
   while(data.v.length>HMAX_N||(data.v.length>1&&data.v.reduce((a,x)=>a+x.z.length,0)>HMAX_TOTAL))data.v.shift();
   const payload=JSON.stringify(data);
   if(exists)await db.updateDocument({databaseId:DB,collectionId:COL,documentId:HID(id),data:{payload},transactionId:tx.$id});
   else await db.createDocument({databaseId:DB,collectionId:COL,documentId:HID(id),data:{payload},permissions:[],transactionId:tx.$id});
   await db.updateTransaction({transactionId:tx.$id,commit:true});return 'saved';
  }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
 }
};
const histRead=async (db,id)=>{try{const doc=await db.getDocument({databaseId:DB,collectionId:COL,documentId:HID(id)});return JSON.parse(doc.payload)}catch(e){if(e.code===404)return {v:[]};throw e}};

export default async ({req,res,error})=>{
 const headers={'Access-Control-Allow-Origin':'https://ghdraw.vercel.app','Access-Control-Allow-Methods':'GET,POST,DELETE,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'};
 const reply=(v,status=200)=>res.json(v,status,headers);
 if(req.method==='OPTIONS')return res.text('',204,headers);
 const client=new Client().setEndpoint(process.env.APPWRITE_FUNCTION_API_ENDPOINT||'https://fra.cloud.appwrite.io/v1').setProject(process.env.APPWRITE_FUNCTION_PROJECT_ID).setKey(req.headers['x-appwrite-key']);
 const db=new Databases(client);
 const read=async (id,transactionId)=>{if(!/^[a-f0-9]{32}$/.test(id))throw {code:404};const doc=await db.getDocument({databaseId:DB,collectionId:COL,documentId:id,transactionId});const data=JSON.parse(doc.payload);if(data.expires<=Date.now()){await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:id}).catch(()=>{});throw {code:410}}return data};
 try{
  if(req.headers['x-appwrite-trigger']==='schedule'){
   const docs=await db.listDocuments({databaseId:DB,collectionId:COL,queries:[Query.limit(200)]});let deleted=0;
   for(const doc of docs.documents)if(JSON.parse(doc.payload).expires<=Date.now()){await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:doc.$id});deleted++}
   return reply({deleted});
  }
  const path=req.path.split('/').filter(Boolean),id=path[1];
  if(req.method==='POST'&&req.path==='/ai'){const r=await handleAI(req,db,process.env.GROQ_API_KEY);return reply(r.body,r.status)}
  if(req.method==='GET'&&req.path==='/health')return reply({ok:true});
  if(req.method==='GET'&&['view','room'].includes(path[0])){const d=await read(id);if(d.kind!==path[0])throw {code:404};const {owner,ops,...publicData}=d;return reply(publicData)}
  if(req.method==='POST'&&path[0]==='live'){
   // Presence and chat live in one small side document per room; same expiry as the room.
   const room=await read(id);if(room.kind!=='room')throw {code:404};
   const b=req.bodyJson||{};if(typeof b.cid!=='string'||!/^[a-z0-9]{6,24}$/.test(b.cid))throw {code:400};
   const pid='p'+id.slice(0,31),now=Date.now();
   const num=v=>typeof v==='number'&&isFinite(v)&&Math.abs(v)<1e7?v:null;
   const me={n:String(b.n||'?').slice(0,20),c:/^#[0-9a-fA-F]{6}$/.test(b.c||'')?b.c:'#6965db',x:num(b.x),y:num(b.y),pg:typeof b.pg==='string'?b.pg.slice(0,128):'',ts:now};
   const msg=typeof b.msg==='string'?b.msg.trim().slice(0,500):'';const after=num(b.after)||0;
   for(let attempt=0;attempt<4;attempt++){
    const tx=await db.createTransaction({ttl:60});
    try{
     let data,exists=true;
     try{const doc=await db.getDocument({databaseId:DB,collectionId:COL,documentId:pid,transactionId:tx.$id});data=JSON.parse(doc.payload)}catch(e){if(e.code!==404)throw e;exists=false;data={kind:'live',expires:room.expires,presence:{},chat:[]}}
     data.presence[b.cid]=me;for(const k of Object.keys(data.presence))if(data.presence[k].ts<now-15000)delete data.presence[k];
     if(msg){data.chat.push({id:randomBytes(6).toString('hex'),cid:b.cid,n:me.n,c:me.c,m:msg,ts:now});data.chat=data.chat.slice(-100)}
     const payload=JSON.stringify(data);
     if(exists)await db.updateDocument({databaseId:DB,collectionId:COL,documentId:pid,data:{payload},transactionId:tx.$id});
     else await db.createDocument({databaseId:DB,collectionId:COL,documentId:pid,data:{payload},permissions:[],transactionId:tx.$id});
     await db.updateTransaction({transactionId:tx.$id,commit:true});
     const peers=Object.entries(data.presence).filter(([k,v])=>k!==b.cid&&v.ts>=now-12000).map(([k,v])=>({cid:k,...v}));
     return reply({peers,chat:data.chat.filter(m=>m.ts>after),now});
    }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
   }
  }
  if(req.method==='POST'&&path[0]==='hist'){
   const room=await read(id);if(room.kind!=='room')throw {code:404};
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
      await db.updateDocument({databaseId:DB,collectionId:COL,documentId:id,data:{payload:JSON.stringify(d)},transactionId:tx.$id});
      await db.updateTransaction({transactionId:tx.$id,commit:true});const {owner,ops,...publicData}=d;return reply(publicData);
     }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===3)throw e}
    }});
   }
   const h=await histRead(db,id);return reply({versions:h.v.map(x=>({ts:x.ts,manual:!!x.m,n:x.n,pc:x.pc,size:x.z.length})).reverse(),expires:room.expires,max:HMAX_N});
  }
  if(req.method==='POST'&&req.path==='/create'){
   if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Board exceeds 12 MB'},413);
   const b=req.bodyJson;if(!['view','room'].includes(b.kind)||!validBoard(b.board))return reply({error:'Invalid board'},400);
   // A project-wide bound stops anonymous creation from exhausting free storage.
   const count=await db.listDocuments({databaseId:DB,collectionId:COL,queries:[Query.select(['$id']),Query.limit(500)]});if(count.documents.filter(d=>!/^[phk]/.test(d.$id)).length>=150)return reply({error:'Free storage is full; ask the project owner to remove old links.'},429);
   const id=randomBytes(16).toString('hex'),owner=randomBytes(24).toString('hex'),expires=Date.now()+(b.kind==='view'?7*24:48)*3600000;
   const d={kind:b.kind,expires,board:b.board,room:b.room||null,owner,...(b.kind==='room'?{rev:0,ops:[]}: {})};
   await db.createDocument({databaseId:DB,collectionId:COL,documentId:id,data:{payload:JSON.stringify(d)},permissions:[]});
   return reply({id,expires,owner},201);
  }
  if(req.method==='POST'&&path[0]==='room'){
   if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Update exceeds 12 MB'},413);
   const b=req.bodyJson;if(!Array.isArray(b.changes)||b.changes.length>5000||!b.changes.every(validChange)||(b.opId!==undefined&&!validOpId(b.opId))||(b.baseRev!==undefined&&(!Number.isSafeInteger(b.baseRev)||b.baseRev<0)))return reply({error:'Invalid update'},400);
   return await withLock(db,id,async()=>{for(let attempt=0;attempt<6;attempt++){
    const tx=await db.createTransaction({ttl:60});
    try{
     const d=await read(id,tx.$id);if(d.kind!=='room')throw {code:404};
     const op=applyRoomUpdate(d,b);
     if(op.duplicate){await db.updateTransaction({transactionId:tx.$id,rollback:true});const {owner,ops,...publicData}=d;return reply({...publicData,ack:op.ack,duplicate:true,rebased:op.rebased})}
     if(!validBoard(d.board))throw {code:400};if(Buffer.byteLength(JSON.stringify(d))>MAX)throw {code:413};
     await db.updateDocument({databaseId:DB,collectionId:COL,documentId:id,data:{payload:JSON.stringify(d)},transactionId:tx.$id});
     await db.updateTransaction({transactionId:tx.$id,commit:true});
     if(b.changes.length)await histSnap(db,id,d.board,d.expires,false).catch(()=>{});
     const {owner,ops,...publicData}=d;return reply({...publicData,ack:op.ack,rebased:op.rebased});
    }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===5)throw e}
   }});
  }
  if(req.method==='DELETE' &&path[0]==='owner'){const d=await read(id);if(req.bodyJson.owner!==d.owner)return reply({error:'Not authorized'},403);await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:id});await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:'p'+id.slice(0,31)}).catch(()=>{});await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:HID(id)}).catch(()=>{});return reply({ok:true})}
  return reply({error:'Not found'},404);
 }catch(e){const code=[400,404,410,413,429].includes(e.code)?e.code:500;if(code===500)error('Backend request failed: '+(e.type||e.code||'unknown')+' '+(e.message||''));return reply({error:code===410?'This link has expired':code===404?'Link not found':code===400?'Invalid board':code===413?'Board exceeds 12 MB':'Service unavailable'},code)}
};
