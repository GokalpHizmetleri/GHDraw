import assert from 'node:assert/strict';
import {reserveAI,handleAI} from './ai.js';
class DB{constructor(){this.rows=new Map()}async createTransaction(){return {$id:'tx'}}async updateTransaction(){}async getDocument({documentId}){if(!this.rows.has(documentId))throw {code:404};return {payload:this.rows.get(documentId)}}async createDocument({documentId,data}){this.rows.set(documentId,data.payload)}async updateDocument({documentId,data}){this.rows.set(documentId,data.payload)}}
const db=new DB(),day=Date.UTC(2026,9,11,12);
assert.equal(await reserveAI(db,'ip','key',day),true);assert.equal(await reserveAI(db,'ip','key',day),true);assert.equal(await reserveAI(db,'ip','key',day),false);
for(let i=1;i<10;i++){assert.equal(await reserveAI(db,'ip','key',day+i*60000),true);assert.equal(await reserveAI(db,'ip','key',day+i*60000),true)}assert.equal(await reserveAI(db,'ip','key',day+10*60000),false);
assert.equal(await reserveAI(db,'ip','key',day+86400000),true);
const req={bodyJson:{op:'correct',text:'hello'},headers:{'x-appwrite-client-ip':'other'}};
assert.equal((await handleAI(req,new DB(),'')).status,503);
assert.equal((await handleAI({...req,bodyJson:{...req.bodyJson,text:'x'.repeat(2001)}},new DB(),'key')).status,400);
assert.equal((await handleAI({...req,bodyJson:{op:'translate',text:'hello',language:'invalid'}},new DB(),'key')).status,400);
assert.equal((await handleAI({...req,headers:{}},new DB(),'key')).status,400);
let called=0;const mock=async(u,o)=>{called++;assert.equal(u,'https://api.groq.com/openai/v1/chat/completions');assert.equal(JSON.parse(o.body).messages[1].content,'hello');return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:'Hello.'}}]})}};
assert.deepEqual(await handleAI(req,new DB(),'key',mock),{status:200,body:{text:'Hello.'}});assert.equal(called,1);
assert.equal((await handleAI(req,new DB(),'key',async()=>({ok:false,status:429}))).status,429);
assert.equal((await handleAI(req,new DB(),'key',async()=>({ok:true,json:async()=>({choices:[{finish_reason:'length',message:{content:'partial'}}]})}))).status,502);
assert.equal([...db.rows.values()].some(x=>x.includes('hello')||x.includes('"ip"')),false);
console.log('AI validation, limits, reset, success, provider errors and truncation tests passed.');
