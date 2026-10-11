import {Client,Databases,Query} from 'node-appwrite';
import {randomBytes} from 'node:crypto';
const DB='ghdraw',COL='boards',MAX=12*1024*1024;
const validId=x=>typeof x==='string'&&x.length>0&&x.length<=128;
const validElement=e=>e&&validId(e.id)&&['rect','diamond','ellipse','arrow','line','pen','text','image','video','frame','poly'].includes(e.type);
const validPage=p=>p&&validId(p.id)&&typeof p.n==='string'&&p.n.length<=100&&Array.isArray(p.e)&&p.e.length<=10000&&p.e.every(validElement)&&new Set(p.e.map(e=>e.id)).size===p.e.length;
const validBoard=b=>b&&Array.isArray(b.p)&&b.p.length>0&&b.p.length<=100&&b.p.every(validPage)&&new Set(b.p.map(p=>p.id)).size===b.p.length;
const validChange=c=>c&&(['addPage'].includes(c.t)?validPage(c.p):validId(c.pid)&&(c.t==='delPage'||c.t==='rename'&&typeof c.n==='string'||c.t==='put'&&validElement(c.e)||c.t==='del'&&validId(c.eid)||c.t==='order'&&Array.isArray(c.ids)&&c.ids.length<=10000&&c.ids.every(validId)));

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
  if(req.method==='GET'&&req.path==='/health')return reply({ok:true});
  if(req.method==='GET'&&['view','room'].includes(path[0])){const d=await read(id);if(d.kind!==path[0])throw {code:404};const {owner,...publicData}=d;return reply(publicData)}
  if(req.method==='POST'&&req.path==='/create'){
   if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Board exceeds 12 MB'},413);
   const b=req.bodyJson;if(!['view','room'].includes(b.kind)||!validBoard(b.board))return reply({error:'Invalid board'},400);
   // A project-wide bound stops anonymous creation from exhausting free storage.
   const count=await db.listDocuments({databaseId:DB,collectionId:COL,queries:[Query.limit(1)]});if(count.total>=150)return reply({error:'Free storage is full; ask the project owner to remove old links.'},429);
   const id=randomBytes(16).toString('hex'),owner=randomBytes(24).toString('hex'),expires=Date.now()+(b.kind==='view'?7*24:48)*3600000;
   const d={kind:b.kind,expires,board:b.board,room:b.room||null,owner};
   await db.createDocument({databaseId:DB,collectionId:COL,documentId:id,data:{payload:JSON.stringify(d)},permissions:[]});
   return reply({id,expires,owner},201);
  }
  if(req.method==='POST'&&path[0]==='room'){
   if(Buffer.byteLength(req.bodyText||'')>MAX)return reply({error:'Update exceeds 12 MB'},413);
   const b=req.bodyJson;if(!Array.isArray(b.changes)||b.changes.length>5000||!b.changes.every(validChange))return reply({error:'Invalid update'},400);
   for(let attempt=0;attempt<3;attempt++){
    const tx=await db.createTransaction({ttl:60});
    try{
     const d=await read(id,tx.$id);if(d.kind!=='room')throw {code:404};
     for(const c of b.changes){
      if(c.t==='addPage'&&!d.board.p.some(p=>p.id===c.p.id))d.board.p.push(c.p);
      else if(c.t==='delPage'&&d.board.p.length>1)d.board.p=d.board.p.filter(p=>p.id!==c.pid);
      else {const p=d.board.p.find(p=>p.id===c.pid);if(!p)continue;
       if(c.t==='rename')p.n=String(c.n||'').slice(0,24);
       if(c.t==='put'){const i=p.e.findIndex(e=>e.id===c.e.id);if(i<0)p.e.push(c.e);else p.e[i]=c.e}
       if(c.t==='del')p.e=p.e.filter(e=>e.id!==c.eid);
       if(c.t==='order'){const order=new Map(c.ids.map((id,i)=>[id,i]));p.e.sort((a,b)=>(order.get(a.id)??99999)-(order.get(b.id)??99999))}
      }
     }
     if(!validBoard(d.board))throw {code:400};if(Buffer.byteLength(JSON.stringify(d))>MAX)throw {code:413};
     await db.updateDocument({databaseId:DB,collectionId:COL,documentId:id,data:{payload:JSON.stringify(d)},transactionId:tx.$id});
     await db.updateTransaction({transactionId:tx.$id,commit:true});const {owner,...publicData}=d;return reply(publicData);
    }catch(e){await db.updateTransaction({transactionId:tx.$id,rollback:true}).catch(()=>{});if(e.code!==409||attempt===2)throw e}
   }
  }
  if(req.method==='DELETE' &&path[0]==='owner'){const d=await read(id);if(req.bodyJson.owner!==d.owner)return reply({error:'Not authorized'},403);await db.deleteDocument({databaseId:DB,collectionId:COL,documentId:id});return reply({ok:true})}
  return reply({error:'Not found'},404);
 }catch(e){const code=[400,404,410,413,429].includes(e.code)?e.code:500;if(code===500)error('Backend request failed: '+(e.type||e.code||'unknown')+' '+(e.message||''));return reply({error:code===410?'This link has expired':code===404?'Link not found':code===400?'Invalid board':code===413?'Board exceeds 12 MB':'Service unavailable'},code)}
};
