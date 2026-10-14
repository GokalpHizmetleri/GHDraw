import test from 'node:test';
import assert from 'node:assert/strict';
import {applyRoomUpdate,validOpId} from './room-sync.js';

const page=()=>({id:'page-1',n:'Board',e:[{id:'shape-1',type:'rect',x:0,th:[{id:'m1',t:'one'}]}]});
const room=()=>({kind:'room',rev:0,ops:[],board:{v:2,d:0,p:[page()]}});
const id='12345678-1234-1234-1234-123456789abc';

test('validates UUID and compact durable operation ids',()=>{
  assert.equal(validOpId(id),true);
  assert.equal(validOpId('a'.repeat(32)),true);
  assert.equal(validOpId('not-an-operation'),false);
});

test('same operation retry is acknowledged without a second mutation or revision',()=>{
  const d=room();
  const body={opId:id,baseRev:0,changes:[{t:'put',pid:'page-1',e:{id:'shape-1',type:'rect',x:1,th:[{id:'m1',t:'one'},{id:'m2',t:'two'}]}}]};
  const first=applyRoomUpdate(d,body);
  assert.equal(first.duplicate,false);
  assert.equal(d.rev,1);
  assert.equal(d.board.p[0].e[0].th.length,2);

  const retry=applyRoomUpdate(d,{...body,changes:[{t:'del',pid:'page-1',eid:'shape-1'}]});
  assert.equal(retry.duplicate,true);
  assert.equal(retry.ack,id);
  assert.equal(d.rev,1);
  assert.equal(d.board.p[0].e.length,1);
  assert.equal(d.board.p[0].e[0].x,1);
});

test('stale base revision rebases onto latest board and preserves other client elements',()=>{
  const d=room();
  applyRoomUpdate(d,{opId:id,baseRev:0,changes:[{t:'put',pid:'page-1',e:{id:'peer-shape',type:'ellipse',x:5}}]});
  const localId='abcdef12-3456-7890-abcd-ef1234567890';
  const result=applyRoomUpdate(d,{opId:localId,baseRev:0,changes:[{t:'put',pid:'page-1',e:{id:'shape-1',type:'rect',x:2,th:[{id:'m1',t:'one'},{id:'m2',t:'local'}]}}]});
  assert.equal(result.rebased,true);
  assert.equal(d.rev,2);
  assert.ok(d.board.p[0].e.some(e=>e.id==='peer-shape'));
  assert.deepEqual(d.board.p[0].e.find(e=>e.id==='shape-1').th.map(m=>m.id),['m1','m2']);
});
