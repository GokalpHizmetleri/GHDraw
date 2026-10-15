"""Optional real-browser E2E tests for GHDraw offline handoff and restore.

Run with: /opt/manus/python/bin/python tests/offline_sync_browser.py
Requires Playwright Python and a local Chromium binary. All cloud requests are
intercepted and handled by an in-memory fake; this test never contacts Appwrite.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import subprocess
import tempfile
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
APP_ROOT: Path = ROOT
BACKEND_ORIGIN: str | None = None
OLD_ID = "a" * 32
NEW_ID = "b" * 32
OWNER = "test-old-owner"
NEW_OWNER = "test-new-owner"
EXPIRES = 1_900_000_000_000

BRIDGE = r"""
window.__ghdrawIdbAudit=[];
window.__ghdrawFault={get:null,tx:null};
(()=>{
 const originalGet=IDBObjectStore.prototype.get;
 IDBObjectStore.prototype.get=function(key){
  const storeName=this.name,store=this,request=originalGet.call(this,key),keyText=String(key);
  request.addEventListener('success',()=>{
   const value=request.result||null,expected=window.__ghdrawExpectedBoard;
   let event={store:storeName,key:keyText,id:value?.id||null,ok:false};
   if(storeName==='rooms'&&value?.id&&expected)event.ok=value.id===window.__ghdrawExpectedRoom&&value.rev===0&&!value.inflight&&!value.restoreIntent&&JSON.stringify(value.base)===JSON.stringify(expected);
   if(storeName==='snapshots'&&value?.id&&expected)event.ok=value.id===window.__ghdrawExpectedRoom&&value.generation===0&&JSON.stringify(value.board)===JSON.stringify(expected);
   window.__ghdrawIdbAudit.push(event);
  });
  const fault=window.__ghdrawFault.get;
  if(fault&&fault.store===storeName&&fault.key===keyText){fault.count++;if(fault.count===fault.ordinal)queueMicrotask(()=>{try{store.transaction.abort()}catch(_){}})}
  return request;
 };
 const originalTransaction=IDBDatabase.prototype.transaction;
 IDBDatabase.prototype.transaction=function(names,mode='readonly',options){
  const tx=originalTransaction.apply(this,arguments),stores=typeof names==='string'?[names]:Array.from(names||[]),fault=window.__ghdrawFault.tx;
  if(fault&&fault.mode===mode&&fault.stores.every(name=>stores.includes(name))){fault.count++;if(fault.count===fault.ordinal){window.__ghdrawFault.tx=null;queueMicrotask(()=>{try{tx.abort()}catch(_){}})}}
  return tx;
 };
 window.__GHDrawTest={
  configure({id,board,owner=OWNER_PLACEHOLDER,rev=4,expires=1900000000000,inflight=null}){
   const b=structuredClone(board);pages=b.p.map(p=>({id:p.id,name:p.n||'',els:structuredClone(p.e),cam:{x:0,y:0,z:1}}));pi=0;els=pages[0].els;cam={x:0,y:0,z:1};dark=!!b.d;defaults={};grid=false;
   cloudRoom={id,expires,generation:0};cloudBase=structuredClone(b);cloudRev=rev;cloudInflight=inflight?structuredClone(inflight):null;cloudPending=!!inflight;cloudProtocolVerified=true;cloudProtocolBlocked=false;cloudReceiptQuotaBlocked=false;cloudCommentLimitBlocked=false;cloudOwner=owner;isHost=true;collabOn=true;roomId=id;viewOnly=false;
   localStorage.setItem('ghdraw:cloudOwner:'+id,owner);localStorage.setItem('ghdraw:v2',localBoardRecord(id,0));window.confirm=()=>true;
   window.__ghdrawExpectedBoard=structuredClone(b);window.__ghdrawExpectedRoom=id;window.__ghdrawIdbAudit=[];return true;
  },
  async seedCheckpoint(){return await saveCloudCheckpoint(cloudRoom.id,cloudBase,cloudRev,cloudRoom.expires,cloudInflight,cloudBoard(true),null,0,null)},
  async seedJoinBackup(){return writeLocalBoardBackup(localBoardRecord())},
  async seedChatOutbox(id){const roomId=cloudRoom?.id||window.__ghdrawExpectedRoom;return (await mutateLiveChatOutbox(roomId,items=>{if(items.some(item=>item.id===id))return true;items.push({id,m:'queued offline chat',failed:false,blocked:false,createdAt:Date.now()});return true})).ok},
  prepareJoin(){clearInterval(cloudTimer);cloudTimer=0;liveStop();cloudRoom=null;cloudBase=null;cloudRev=0;cloudInflight=null;cloudPending=false;cloudProtocolVerified=false;collabOn=false;isHost=false;roomId=null;return true},
  failNextLocalBoardWrite(){const prototype=Storage.prototype,original=prototype.setItem;let armed=true;prototype.setItem=function(key,value){if(armed&&key==='ghdraw:v2'){armed=false;prototype.setItem=original;throw new DOMException('Injected local board persistence failure','QuotaExceededError')}return original.call(this,key,value)};return true},
  async joinSelection(id){const cached=await cloudCheckpoint(id),snapshot=await cloudLocalSnapshot(id),savedId=localBoardRoomId(),generation=cloudGenerationValue(cached),currentGeneration=localBoardRestoreGeneration(),current=cloudBoard(),savedRev=localBoardCheckpointRev(id),snapshotGeneration=snapshot?cloudGenerationValue(snapshot):null,snapshotRev=snapshot?.rev,snapshotBase=snapshot?.base,valid=!!snapshot&&snapshotGeneration===generation&&Number.isSafeInteger(snapshotRev)&&snapshotRev>=0&&!!normalizeCloudRoomBoard(snapshotBase,false)&&snapshotRev<=cached.rev&&(snapshotRev!==cached.rev||JSON.stringify(snapshotBase)===JSON.stringify(cached.base)),use=valid&&(savedId!==id||savedRev===null?snapshot.updatedAt>localBoardSavedAt()||savedId!==id:snapshotRev>savedRev||snapshotRev===savedRev&&snapshot.updatedAt>localBoardSavedAt()),selected=use?snapshot.board:null,safe=cloudRejoinGenerationBoard(id,savedId,currentGeneration,current,selected,selected?snapshotGeneration:null,cached.base,null,generation);return{savedId,currentGeneration,generation,savedRev,updatedAt:snapshot?.updatedAt,savedAt:localBoardSavedAt(),valid,use,current,safe,snapshotBoard:snapshot?.board}},
  async joinStorageState(id){const backupKeys=localBoardBackupEntries().map(item=>[item.key,item.record]),transitionKeys=Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(key=>key&&key.startsWith('ghdraw:cloudTransition')).sort().map(key=>[key,localStorage.getItem(key)]);return{board:localStorage.getItem('ghdraw:v2'),backups:backupKeys,transitions:transitionKeys,checkpoint:await cloudCheckpoint(id),snapshot:await cloudLocalSnapshot(id),outbox:await loadLiveChatOutbox(id),room:cloudRoom&&{id:cloudRoom.id,generation:cloudRoom.generation}}},
  armGetAbort(store,key,ordinal){window.__ghdrawFault.get={store,key:String(key),ordinal,count:0}},
  armTransactionAbort(stores,mode,ordinal=1){window.__ghdrawFault.tx={stores,mode,ordinal,count:0}},
  startHandoff(){window.__ghdrawHandoffPromise=cloudStartNewRoom();return true},
  startRestore(ts){window.__ghdrawRestorePromise=histRestoreCloud(ts);return true},
  startJoin(id){window.__ghdrawJoinPromise=cloudJoin(id,true,false);return true},
  tryLock(id){window.__lockEntered=false;window.__lockPromise=runCloudRoomLocked(id,async()=>{window.__lockEntered=true;return true});return true},
  async checkpoint(id){return await cloudCheckpoint(id)},
  async snapshot(id){return await cloudLocalSnapshot(id)},
  async snapshotCurrent(updatedAt=Date.now()+5000){try{return await saveCloudLocalSnapshot(cloudRoom.id,cloudBoard(true),updatedAt,cloudRoom.generation,null,structuredClone(cloudBase),cloudRev)}catch(_){return false}},
  async forceLegacyStaleSnapshotForRegression(updatedAt=Date.now()+10000){const id=cloudRoom.id,record={id,board:cloudBoard(true),base:structuredClone(cloudBase),rev:cloudRev,updatedAt,generation:cloudRoom.generation||0},db=await cloudDB();return await new Promise((resolve,reject)=>{const tx=db.transaction('snapshots','readwrite');tx.objectStore('snapshots').put(record);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error||new Error('test snapshot write failed'));tx.onabort=()=>reject(tx.error||new Error('test snapshot write aborted'))})},
  setBoard(board){const b=structuredClone(board);pages=b.p.map(p=>({id:p.id,name:p.n||'',els:structuredClone(p.e),cam:{x:0,y:0,z:1}}));pi=0;els=pages[0].els;cam={x:0,y:0,z:1};return true},
  addShape(shape){pages[pi].els.push(structuredClone(shape));els=pages[pi].els;save();return true},
  saveBoard(){return save()},
  async syncNow(){clearTimeout(cloudTimer);await cloudSync();return true},
  async transition(id){return await cloudRoomTransition(id)},
  async configureLive(id){cloudRoom={id,expires:EXPIRES_PLACEHOLDER,generation:0};myName='Test user';myColor='#123456';cloudRequest=async(path,body)=>{const response=await fetch('/__fake_live'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();if(!response.ok)throw Object.assign(new Error(data.message||data.error||'Cloud error'),{status:response.status,code:data.error||null});return data};await liveStart();clearTimeout(liveT);liveT=0;return true},
  async submitLiveMessage(text,failIdb=false,failOrdinal=1){if(!chatOpen)toggleChat();const input=document.querySelector('#chi');input.value=text;if(failIdb)window.__GHDrawTest.armTransactionAbort(['chatOutbox'],'readwrite',failOrdinal);await document.querySelector('#chf').onsubmit({preventDefault(){}});return true},
  async enqueueLiveMessage(id,text){const original=newLiveChatMessageId;newLiveChatMessageId=()=>id;try{return await queueLiveChatMessage(text)}finally{newLiveChatMessageId=original}},
  openLiveChat(){if(!chatOpen)toggleChat();return true},
  async tickLive(){clearTimeout(liveT);liveT=0;await liveTick();clearTimeout(liveT);liveT=0;return true},
  async durableChat(){return await loadLiveChatOutbox(cloudRoom&&cloudRoom.id)},
  liveState(){return{outbox:structuredClone(chatOut),messages:structuredClone(chatMsgs),rendered:document.querySelector('#chl')?.innerText||'',stored:JSON.stringify(chatOut),ready:liveChatReady}},
  state(){return{room:cloudRoom&&{id:cloudRoom.id,generation:cloudRoom.generation},rev:cloudRev,inflight:cloudInflight,pending:cloudPending,diff:cloudBase?cloudDiff(cloudBase,cloudBoard()):null,owner:cloudOwner,oldOwner:localStorage.getItem('ghdraw:cloudOwner:'+OLD_ID_PLACEHOLDER),transition:localStorage.getItem(cloudRoomTransitionKey(OLD_ID_PLACEHOLDER)),base:cloudBase&&structuredClone(cloudBase),board:structuredClone(cloudBoard(true)),events:window.__ghdrawIdbAudit.slice()}},
  unsafe(id){return cloudCheckpointUnsafeMarker(id)},
  async clearDatabase(){
   if(cloudDBPromise){const db=await cloudDB().catch(()=>null);if(db)db.close();cloudDBPromise=null}
   await new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('ghdraw-cloud-sync-v1');q.onsuccess=()=>resolve();q.onerror=()=>reject(q.error);q.onblocked=()=>reject(new Error('database deletion blocked'))});
   return true;
  }
 };
})();
""".replace("OWNER_PLACEHOLDER", json.dumps(OWNER)).replace("OLD_ID_PLACEHOLDER", json.dumps(OLD_ID)).replace("EXPIRES_PLACEHOLDER", str(EXPIRES))

BASE_BOARD = {
    "v": 2,
    "d": 0,
    "p": [{"id": "page-1", "n": "Board", "e": [{"id": "shape-a", "type": "rect", "x": 0, "y": 0, "w": 10, "h": 10, "seed": 1, "stroke": "#1e1e1e", "bg": "transparent", "fill": "hachure", "sw": 2, "style": "solid", "rough": 1, "round": True, "opacity": 100, "align": "left"}]}],
}


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


class FakeCloud:
    def __init__(self, *, failure=None, outbox_conflict=False, restore_mode=None, page=None):
        self.failure = failure
        self.outbox_conflict = outbox_conflict
        self.restore_mode = restore_mode
        self.page = page
        self.rooms = {
            OLD_ID: {"id": OLD_ID, "owner": OWNER, "kind": "room", "board": copy.deepcopy(BASE_BOARD), "rev": 4, "expires": EXPIRES}
        }
        self.create_receipts = {}
        self.create_attempts = []
        self.restore_receipts = {}
        self.restore_mutations = 0
        self.events = []
        self.deleted = []
        self.room_changes = []

    @staticmethod
    def room_response(room):
        return {k: copy.deepcopy(room[k]) for k in ("kind", "board", "rev", "expires")} | {"syncProtocol": "room-ops-v1"}

    async def handle(self, route):
        req = route.request
        path = urlparse(req.url).path
        method = req.method
        body = req.post_data_json if req.post_data else None
        if path.startswith("/room/"):
            rid = path.rsplit("/", 1)[-1]
            room = self.rooms.get(rid)
            if room is None:
                await route.fulfill(status=404, json={"error": "not found"}); return
            if method == "GET":
                self.events.append("get-room:" + rid)
                await route.fulfill(json=self.room_response(room)); return
            if method == "POST":
                self.events.append("post-room:" + rid)
                if rid == OLD_ID and self.outbox_conflict:
                    await route.fulfill(status=409, json={"error": "comment_limit", "message": "comment limit"}); return
                changes = copy.deepcopy(body.get("changes", []))
                self.room_changes.append(changes)
                for change in changes:
                    page = next((p for p in room["board"]["p"] if p["id"] == change.get("pid")), None)
                    if change.get("t") == "put" and page:
                        el = change["e"]
                        idx = next((i for i, item in enumerate(page["e"]) if item["id"] == el["id"]), None)
                        if idx is None: page["e"].append(copy.deepcopy(el))
                        else: page["e"][idx] = copy.deepcopy(el)
                    elif change.get("t") == "del" and page:
                        page["e"] = [item for item in page["e"] if item["id"] != change["eid"]]
                    elif change.get("t") == "order" and page:
                        by_id = {item["id"]: item for item in page["e"]}
                        page["e"] = [by_id[item_id] for item_id in change["ids"] if item_id in by_id] + [item for item in page["e"] if item["id"] not in change["ids"]]
                room["rev"] += 1
                await route.fulfill(json=self.room_response(room) | {"ack": body.get("opId")}); return
        if path == "/create" and method == "POST":
            rid = path
            request_id = body["requestId"]
            self.create_attempts.append(request_id)
            if self.failure == "create":
                self.events.append("create-failed")
                await route.fulfill(status=503, json={"error": "temporary"}); return
            first = request_id not in self.create_receipts
            if first:
                self.create_receipts[request_id] = NEW_ID
                self.rooms[NEW_ID] = {"id": NEW_ID, "owner": NEW_OWNER, "kind": "room", "board": copy.deepcopy(body["board"]), "rev": 0, "expires": EXPIRES}
                self.events.append("create-committed")
                if self.failure == "lost-create-ack":
                    self.failure = "hold-create-retry"
                    await route.abort("failed"); return
            self.events.append("create-ack")
            if self.failure == "hold-create-retry":
                self.failure = None
                self.create_retry_arrived.set()
                await self.release_create.wait()
            await route.fulfill(status=201, json={"id": self.create_receipts[request_id], "owner": NEW_OWNER}); return
        if path.startswith("/owner/") and method == "DELETE":
            rid = path.rsplit("/", 1)[-1]
            self.events.append("delete:" + rid)
            if rid == OLD_ID and self.page:
                audit = await self.page.evaluate("window.__GHDrawTest.state().events")
                self.delete_audit = audit
            if self.failure == "delete":
                await route.fulfill(status=503, json={"error": "temporary"}); return
            room = self.rooms.get(rid)
            if not room or body.get("owner") != room["owner"]:
                await route.fulfill(status=403, json={"error": "Not authorized"}); return
            if body.get("expectedRev") != room["rev"]:
                await route.fulfill(status=409, json={"error": "room_revision_changed"}); return
            del self.rooms[rid]; self.deleted.append(rid)
            await route.fulfill(json={"ok": True}); return
        if path.startswith("/hist/") and method == "POST":
            rid = path.rsplit("/", 1)[-1]
            body = body or {}
            if body.get("op") == "restore":
                restore_id = body["restoreId"]
                self.events.append("restore:" + restore_id)
                if restore_id not in self.restore_receipts:
                    room = self.rooms[rid]
                    room["board"] = copy.deepcopy(BASE_BOARD)
                    room["rev"] += 1
                    self.restore_receipts[restore_id] = {"ts": body["ts"], "rev": room["rev"]}
                    self.restore_mutations += 1
                room = self.rooms[rid]
                response = self.room_response(room) | {"ack": restore_id, "duplicate": self.restore_mutations > 1}
                if self.restore_mode == "lost-ack" and len([e for e in self.events if e.startswith("restore:")]) == 1:
                    await route.abort("failed"); return
                if self.restore_mode == "checkpoint-failure" and len([e for e in self.events if e.startswith("restore:")]) == 1:
                    await self.page.evaluate("window.__GHDrawTest.armTransactionAbort(['rooms','snapshots'],'readwrite',1)")
                await route.fulfill(json=response); return
            await route.fulfill(json={"result": "saved"}); return
        await route.fulfill(status=404, json={"error": "unexpected route", "path": path, "method": method})


class FakeLiveChat:
    def __init__(self, *, drop_first_ack=False):
        self.drop_first_ack = drop_first_ack
        self.reject_next = False
        self.reject_limit_next = False
        self.contention_next = False
        self.contention_arrived = asyncio.Event()
        self.silence_ack_ids = set()
        self.messages = []
        self.receipts = {}
        self.attempts = []

    async def handle(self, route):
        body = route.request.post_data_json or {}
        if body.get("msg"):
            message_id = body.get("mid")
            self.attempts.append(message_id)
            if self.contention_next:
                self.contention_next = False
                self.contention_arrived.set()
                await route.fulfill(status=409, json={"error": "live_contention", "message": "retry shortly"}); return
            if self.reject_limit_next:
                self.reject_limit_next = False
                await route.fulfill(status=409, json={"error": "live_chat_receipt_limit", "message": "shared receipt cap reached"}); return
            if self.reject_next:
                self.reject_next = False
                await route.fulfill(status=400, json={"error": "test_rejection", "message": "test message rejected"}); return
            existing = self.receipts.get(message_id)
            if existing is None:
                self.receipts[message_id] = body["msg"]
                self.messages.append({"id": message_id, "cid": body["cid"], "n": body.get("n", "?"), "c": body.get("c", "#6965db"), "m": body["msg"], "ts": 5_000})
                self.messages = self.messages[-100:]
            elif existing != body["msg"]:
                await route.fulfill(status=409, json={"error": "live_message_id_conflict"}); return
            if self.drop_first_ack:
                self.drop_first_ack = False
                await route.abort("failed"); return
        response = {"peers": [], "chat": copy.deepcopy([message for message in self.messages[-100:] if message["id"] not in self.silence_ack_ids]), "now": 5_000}
        if body.get("mid") and body["mid"] not in self.silence_ack_ids:
            response["ack"] = body["mid"]
        await route.fulfill(json=response)


async def launch_test_page(browser, origin, *, viewport=None, mobile=False):
    options = {"service_workers": "block"}
    if viewport:
        options.update({"viewport": viewport, "is_mobile": mobile, "has_touch": mobile})
    context = await browser.new_context(**options)
    page = await context.new_page()
    await context.route("https://**/*", lambda route: route.abort())
    async def local_route(route):
        path = urlparse(route.request.url).path
        if path in ("/", "/index.html"):
            html = (APP_ROOT / "index.html").read_text()
            marker = "})();"
            at = html.rfind(marker)
            if at < 0:
                raise AssertionError("Cannot find GHDraw IIFE end for test-only bridge injection")
            html = html[:at] + BRIDGE + "\n" + html[at:]
            await route.fulfill(status=200, content_type="text/html; charset=utf-8", body=html)
        else:
            await route.continue_()
    await context.route(origin + "/**", local_route)
    await page.goto(origin + "/", wait_until="load", timeout=20000)
    await page.wait_for_function("!!window.__GHDrawTest", timeout=10000)
    return context, page


async def seed(page, *, board=None, inflight=None, rev=4):
    board = copy.deepcopy(board or BASE_BOARD)
    await page.evaluate("cfg => window.__GHDrawTest.configure(cfg)", {"id": OLD_ID, "board": board, "owner": OWNER, "rev": rev, "expires": EXPIRES, "inflight": inflight})
    result = await page.evaluate("window.__GHDrawTest.seedCheckpoint()")
    assert result is True, "real IndexedDB source checkpoint write should succeed"
    checkpoint = await page.evaluate("id=>window.__GHDrawTest.checkpoint(id)", OLD_ID)
    assert checkpoint and checkpoint["id"] == OLD_ID


async def start_handoff(page):
    await page.evaluate("window.__GHDrawTest.startHandoff()")
    return await page.evaluate("window.__ghdrawHandoffPromise")


async def test_handoff_success_and_two_tab_lock(browser, origin):
    context, page = await launch_test_page(browser, origin)
    cloud = FakeCloud(failure="lost-create-ack", page=page)
    cloud.create_retry_arrived = asyncio.Event()
    cloud.release_create = asyncio.Event()
    await page.route(BACKEND_ORIGIN + "/**", cloud.handle)
    await seed(page)
    second = await context.new_page()
    await second.goto(origin + "/", wait_until="load")
    await page.evaluate("window.__GHDrawTest.startHandoff()")
    try:
        await asyncio.wait_for(cloud.create_retry_arrived.wait(), timeout=20)
    except asyncio.TimeoutError as exc:
        raise AssertionError(f"handoff never reached its retried create request; events={cloud.events}") from exc
    await second.evaluate("id=>window.__GHDrawTest.tryLock(id)", OLD_ID)
    blocked = await second.evaluate("Promise.race([window.__lockPromise.then(()=>false),new Promise(resolve=>setTimeout(()=>resolve(!window.__lockEntered),150))])")
    assert blocked is True and await second.evaluate("!window.__lockEntered"), "the second page must wait on the actual Web Lock while handoff is in progress"
    cloud.release_create.set()
    assert await page.evaluate("window.__ghdrawHandoffPromise") is True
    assert len(cloud.create_attempts) == 2 and cloud.create_attempts[0] == cloud.create_attempts[1], "lost create ACK retries use the exact same durable request ID"
    assert cloud.deleted == [OLD_ID], f"source delete expected after verified replacement; deleted={cloud.deleted} events={cloud.events} rooms={list(cloud.rooms)} state={await page.evaluate('window.__GHDrawTest.state()')}"
    assert cloud.events.index("create-ack") < cloud.events.index("delete:" + OLD_ID)
    audit = cloud.delete_audit
    assert any(x["store"] == "rooms" and x["key"] == NEW_ID and x["id"] == NEW_ID for x in audit), "a real destination checkpoint readback must precede source deletion"
    assert any(x["store"] == "snapshots" and x["key"] == NEW_ID and x["id"] == NEW_ID for x in audit), "a real destination snapshot readback must precede source deletion"
    assert cloud.events.index("delete:" + OLD_ID) > cloud.events.index("get-room:" + NEW_ID)
    assert await page.evaluate("window.__GHDrawTest.state().room.id") == NEW_ID
    durable = await page.evaluate("async id=>({checkpoint:await window.__GHDrawTest.checkpoint(id),snapshot:await window.__GHDrawTest.snapshot(id),board:window.__GHDrawTest.state().board})", NEW_ID)
    assert durable["checkpoint"]["rev"] == 0 and durable["checkpoint"]["base"] == durable["board"]
    assert durable["snapshot"]["board"] == durable["board"], "persisted checkpoint and snapshot contents must match after cleanup"
    await second.evaluate("window.__lockPromise")
    assert await second.evaluate("window.__lockEntered") is True
    await context.close()
    print("PASS handoff: real IndexedDB readbacks, conditional source delete, stable create retry, two-tab Web Lock")


async def test_handoff_failures(browser, origin):
    cases = [
        ("source checkpoint write abort", "source-write", ("tx", ["rooms", "snapshots"], "readwrite", 1)),
        ("source checkpoint readback abort", "source-checkpoint-read", ("get", "rooms", OLD_ID, 3)),
        ("source snapshot readback abort", "source-snapshot-read", ("tx", ["snapshots"], "readonly", 2)),
        ("replacement create rejected", "create", None),
        ("destination checkpoint readback abort", "dest-checkpoint-read", ("get", "rooms", NEW_ID, 2)),
        ("destination snapshot readback abort", "dest-snapshot-read", ("tx", ["snapshots"], "readonly", 4)),
        ("conditional source delete fails", "delete", None),
    ]
    for label, failure, injection in cases:
        context, page = await launch_test_page(browser, origin)
        cloud = FakeCloud(failure="create" if failure == "create" else "delete" if failure == "delete" else None, page=page)
        await page.route(BACKEND_ORIGIN + "/**", cloud.handle)
        await seed(page)
        if injection:
            if injection[0] == "tx":
                await page.evaluate("x=>window.__GHDrawTest.armTransactionAbort(x[0],x[1],x[2])", injection[1:])
            else:
                await page.evaluate("x=>window.__GHDrawTest.armGetAbort(x[0],x[1],x[2])", list(injection[1:]))
        result = await start_handoff(page)
        assert OLD_ID in cloud.rooms, f"{label}: source room must remain server-side"
        assert OLD_ID not in cloud.deleted, f"{label}: source deletion must not pass failed verification"
        source = await page.evaluate("id=>window.__GHDrawTest.checkpoint(id)", OLD_ID)
        assert source and source["id"] == OLD_ID and source["inflight"] is None, f"{label}: durable source checkpoint must survive"
        if failure in ("source-write", "source-checkpoint-read", "source-snapshot-read", "create"):
            assert result is False, f"{label}: transition must stop before verified destination"
            assert NEW_ID not in cloud.rooms, f"{label}: no destination room should be committed before source persistence is verified"
        if failure.startswith("dest-"):
            assert result is False, f"{label}: destination readback failure must stop cleanup"
            assert NEW_ID in cloud.rooms, f"{label}: created destination may remain for retry, but source is retained"
        if failure == "delete":
            assert result is True, "a verified destination remains usable even if conditional source deletion fails"
            assert NEW_ID in cloud.rooms
            assert await page.evaluate("id=>window.__GHDrawTest.transition(id)", OLD_ID), "transition sidecar remains available for retry"
        await context.close()
        print("PASS handoff failure:", label)


async def test_unresolved_outbox_survives_handoff(browser, origin):
    context, page = await launch_test_page(browser, origin)
    local = copy.deepcopy(BASE_BOARD)
    local["p"][0]["e"][0]["x"] = 1
    op = {"opId": "c" * 32, "baseRev": 4, "changes": [{"t": "put", "pid": "page-1", "e": copy.deepcopy(local["p"][0]["e"][0])}]}
    cloud = FakeCloud(outbox_conflict=True, page=page)
    await page.route(BACKEND_ORIGIN + "/**", cloud.handle)
    await page.evaluate("cfg=>window.__GHDrawTest.configure(cfg)", {"id": OLD_ID, "board": local, "owner": OWNER, "rev": 4, "expires": EXPIRES, "inflight": op})
    assert await page.evaluate("window.__GHDrawTest.seedCheckpoint()") is True
    assert await start_handoff(page) is True
    assert OLD_ID in cloud.rooms and OLD_ID not in cloud.deleted
    source = await page.evaluate("id=>window.__GHDrawTest.checkpoint(id)", OLD_ID)
    assert source["inflight"]["opId"] == op["opId"], "a rejected server operation stays in the actual IndexedDB outbox"
    assert source["inflight"]["changes"] == op["changes"]
    assert cloud.events.count("delete:" + OLD_ID) == 0
    await context.close()
    print("PASS handoff: rejected operation leaves durable source outbox and source room intact")


async def prepare_selected_snapshot_join(page, *, seed_outbox=False):
    await page.evaluate("cfg=>window.__GHDrawTest.configure(cfg)", {"id": OLD_ID, "board": BASE_BOARD, "owner": OWNER, "rev": 4, "expires": EXPIRES})
    assert await page.evaluate("window.__GHDrawTest.seedCheckpoint()") is True
    selected = copy.deepcopy(BASE_BOARD)
    selected["p"][0]["e"][0]["x"] = 22
    current = copy.deepcopy(BASE_BOARD)
    current["p"][0]["e"][0]["x"] = 33
    await page.evaluate("b=>window.__GHDrawTest.setBoard(b)", selected)
    assert await page.evaluate("window.__GHDrawTest.snapshotCurrent(Date.now()+60000)") is True
    await page.evaluate("b=>window.__GHDrawTest.setBoard(b)", current)
    assert await page.evaluate("window.__GHDrawTest.saveBoard()") is True
    await page.evaluate("window.__GHDrawTest.prepareJoin()")
    assert await page.evaluate("window.__GHDrawTest.seedJoinBackup()") is True
    if seed_outbox:
        assert await page.evaluate("id=>window.__GHDrawTest.seedChatOutbox(id)", "d" * 32) is True


async def test_selected_snapshot_join_gate(browser, origin, failure):
    context, page = await launch_test_page(browser, origin)
    cloud = FakeCloud(page=page)
    await page.route(BACKEND_ORIGIN + "/**", cloud.handle)
    await prepare_selected_snapshot_join(page, seed_outbox=failure is not None)
    selection = await page.evaluate("id=>window.__GHDrawTest.joinSelection(id)", OLD_ID)
    assert selection["valid"] and selection["use"] and selection["safe"]["p"][0]["e"][0]["x"] == 22, f"the fixture must select the saved offline snapshot, not the current board: {selection}"
    before = await page.evaluate("id=>window.__GHDrawTest.joinStorageState(id)", OLD_ID)
    if failure == "indexeddb-readback":
        await page.evaluate("window.__GHDrawTest.armTransactionAbort(['snapshots'],'readonly',2)")
    elif failure == "board-persistence":
        await page.evaluate("window.__GHDrawTest.failNextLocalBoardWrite()")
    await page.evaluate("id=>window.__GHDrawTest.startJoin(id)", OLD_ID)
    await page.evaluate("window.__ghdrawJoinPromise")
    after = await page.evaluate("id=>window.__GHDrawTest.joinStorageState(id)", OLD_ID)
    if failure:
        assert not any(event == "get-room:" + OLD_ID for event in cloud.events), f"{failure}: join must stop before the remote room read; events={cloud.events}"
        assert after["board"] == before["board"], f"{failure}: persisted local board stays byte-for-byte unchanged"
        assert after["backups"] == before["backups"], f"{failure}: existing recovery backups are unchanged"
        assert after["checkpoint"] == before["checkpoint"], f"{failure}: checkpoint/outbox remains unchanged"
        assert after["snapshot"] == before["snapshot"], f"{failure}: offline snapshot remains unchanged"
        assert after["outbox"] == before["outbox"], f"{failure}: durable chat outbox remains unchanged"
        assert after["transitions"] == before["transitions"] and after["room"] is None
        state = await page.evaluate("window.__GHDrawTest.state()")
        assert state["board"]["p"][0]["e"][0]["x"] == 33, f"{failure}: current local edits remain in memory"
        assert "export a .ghdraw" in (await page.locator("#toast").inner_text()).lower() or "dışa aktar" in (await page.locator("#toast").inner_text()).lower()
        await context.close()
        print("PASS selected offline snapshot join abort:", failure, "local board, backups, checkpoint/outbox and room state preserved")
        return
    assert any(event == "get-room:" + OLD_ID for event in cloud.events), "verified snapshot restoration must continue to the room request"
    state = await page.evaluate("window.__GHDrawTest.state()")
    assert state["room"]["id"] == OLD_ID and state["board"]["p"][0]["e"][0]["x"] == 22, "a successfully restored offline snapshot joins and keeps its local edit"
    await context.close()
    print("PASS selected offline snapshot join: verified restore proceeds and rebases the selected local edit")


async def test_restore_intent_recovery(browser, origin, mode):
    context, page = await launch_test_page(browser, origin)
    current = copy.deepcopy(BASE_BOARD)
    current["p"][0]["e"][0]["x"] = 8
    cloud = FakeCloud(restore_mode=mode, page=page)
    cloud.rooms[OLD_ID]["board"] = copy.deepcopy(current)
    cloud.rooms[OLD_ID]["rev"] = 7
    await page.route(BACKEND_ORIGIN + "/**", cloud.handle)
    await page.evaluate("cfg=>window.__GHDrawTest.configure(cfg)", {"id": OLD_ID, "board": current, "owner": OWNER, "rev": 7, "expires": EXPIRES})
    assert await page.evaluate("window.__GHDrawTest.seedCheckpoint()") is True
    await page.evaluate("window.__GHDrawTest.startRestore(123)")
    await page.evaluate("window.__ghdrawRestorePromise")
    pending = await page.evaluate("id=>window.__GHDrawTest.checkpoint(id)", OLD_ID)
    assert pending and pending["restoreIntent"], f"{mode}: restore intent must survive a lost ACK or checkpoint failure"
    restore_id = pending["restoreIntent"]["restoreId"]
    assert pending["inflight"] is None
    assert await page.evaluate("id=>window.__GHDrawTest.unsafe(id)", OLD_ID) == restore_id
    await page.reload(wait_until="load")
    await page.wait_for_function("!!window.__GHDrawTest")
    await page.evaluate("id=>window.__GHDrawTest.startJoin(id)", OLD_ID)
    await page.evaluate("window.__ghdrawJoinPromise")
    final = await page.evaluate("id=>window.__GHDrawTest.checkpoint(id)", OLD_ID)
    assert final and final.get("restoreIntent") is None and final.get("inflight") is None
    assert final["generation"] == 1
    assert final["base"] == BASE_BOARD, "the durable checkpoint must converge to the authoritative restored board"
    assert cloud.restore_mutations == 1, "same restoreId must deduplicate the already-committed server restore"
    assert [e.split(":", 1)[1] for e in cloud.events if e.startswith("restore:")] == [restore_id, restore_id]
    assert await page.evaluate("id=>window.__GHDrawTest.unsafe(id)", OLD_ID) is None
    saved = await page.evaluate("id=>window.__GHDrawTest.snapshot(id)", OLD_ID)
    assert saved and saved["generation"] == 1 and saved["board"] == BASE_BOARD, "recovery ends with matching durable checkpoint/snapshot"
    await context.close()
    print("PASS restore intent:", mode, "same restoreId, one server mutation, durable checkpoint and snapshot")


async def test_chat_outbox_survives_reload_and_lost_ack(browser, origin):
    context, page = await launch_test_page(browser, origin)
    cloud = FakeLiveChat(drop_first_ack=True)
    await page.route(origin + "/__fake_live/**", cloud.handle)
    room_id = "c" * 32
    await page.evaluate("id=>window.__GHDrawTest.configureLive(id)", room_id)
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "repeatable text")
    before = await page.evaluate("window.__GHDrawTest.liveState()")
    queued = json.loads(before["stored"])
    assert len(queued) == 1 and queued[0]["m"] == "repeatable text"
    message_id = queued[0]["id"]
    await page.wait_for_timeout(100)  # submit's real liveNudge sends once; the fake server drops that ACK.
    assert cloud.attempts == [message_id], f"expected one first send with the durable ID; got {cloud.attempts}"
    uncertain = await page.evaluate("window.__GHDrawTest.liveState()")
    assert len(cloud.messages) == 1 and cloud.messages[0]["id"] == message_id and cloud.messages[0]["m"] == "repeatable text", "the fake server commits exactly once before dropping the ACK"
    assert uncertain["outbox"][0]["id"] == message_id and "repeatable text" in uncertain["rendered"] and ("Gönderiliyor" in uncertain["rendered"] or "Sending" in uncertain["rendered"]), "an uncertain send remains visibly queued with pending status"
    await page.reload(wait_until="load")
    await page.wait_for_function("!!window.__GHDrawTest")
    await page.evaluate("id=>window.__GHDrawTest.configureLive(id)", room_id)
    restored = await page.evaluate("window.__GHDrawTest.liveState()")
    assert restored["outbox"][0]["id"] == message_id, "reload restores the exact durable message ID"
    await page.evaluate("window.__GHDrawTest.tickLive()")
    await page.evaluate("window.__GHDrawTest.openLiveChat()")
    sent = await page.evaluate("window.__GHDrawTest.liveState()")
    assert cloud.attempts == [message_id, message_id], "the retry after reload reuses the same idempotency ID"
    assert len(cloud.messages) == 1 and len(sent["outbox"]) == 0, f"the ACK clears the durable queue without duplicating the server message; attempts={cloud.attempts}, server={cloud.messages}, client={sent}"
    assert len([message for message in sent["messages"] if message["id"] == message_id]) == 1 and "Gönderiliyor" not in sent["rendered"] and "Sending" not in sent["rendered"] and ("Sen" in sent["rendered"] or "You" in sent["rendered"]), "the retried own message is rendered as the current user's sent message"
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "repeatable text")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.length===0", timeout=5000)
    final = await page.evaluate("window.__GHDrawTest.liveState()")
    assert len(cloud.messages) == 2 and cloud.messages[0]["id"] != cloud.messages[1]["id"], "two intentional sends with the same text keep different IDs"
    assert len(final["messages"]) == 2 and all(message["m"] == "repeatable text" for message in final["messages"])
    cloud.reject_next = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "retry stays visible")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.some(item=>item.failed)", timeout=5000)
    failed = await page.evaluate("window.__GHDrawTest.liveState()")
    failed_id = next(item["id"] for item in failed["outbox"] if item["failed"])
    assert "retry stays visible" in failed["rendered"] and ("Not sent · Retry" in failed["rendered"] or "Gönderilemedi" in failed["rendered"]), "a definitive failed send is not silently removed and offers explicit retry"
    await page.evaluate("document.querySelector('#chl button').click()")
    await page.wait_for_function("id=>!window.__GHDrawTest.liveState().outbox.some(item=>item.id===id)", arg=failed_id, timeout=5000)
    retried = await page.evaluate("window.__GHDrawTest.liveState()")
    assert cloud.attempts[-2:] == [failed_id, failed_id] and any(message["id"] == failed_id and message["m"] == "retry stays visible" for message in cloud.messages), "manual retry reuses the same ID and succeeds"
    assert len(retried["outbox"]) == 0 and len(cloud.messages) == 3
    cloud.drop_first_ack = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "evicted but acknowledged")
    await page.wait_for_timeout(100)
    evicted_id = json.loads((await page.evaluate("window.__GHDrawTest.liveState()"))["stored"])[0]["id"]
    assert cloud.attempts[-1] == evicted_id and any(message["id"] == evicted_id for message in cloud.messages)
    cloud.messages = (cloud.messages + [{"id": "filler" + str(i), "cid": "old-peer", "n": "Old peer", "c": "#123456", "m": "filler", "ts": 5_001 + i} for i in range(100)])[-100:]
    assert not any(message["id"] == evicted_id for message in cloud.messages), "the committed message has left the full 100-message response window"
    await page.reload(wait_until="load")
    await page.wait_for_function("!!window.__GHDrawTest")
    await page.evaluate("id=>window.__GHDrawTest.configureLive(id)", room_id)
    await page.evaluate("window.__GHDrawTest.tickLive()")
    await page.evaluate("window.__GHDrawTest.openLiveChat()")
    aged = await page.evaluate("window.__GHDrawTest.liveState()")
    assert cloud.attempts[-2:] == [evicted_id, evicted_id] and len(aged["outbox"]) == 0, "a durable receipt ACK clears a retry even when its message is no longer in the response window"
    assert not any(message["id"] == evicted_id for message in aged["messages"]) and "Sending" not in aged["rendered"] and "Gönderiliyor" not in aged["rendered"]
    sends_before_abort = len(cloud.attempts)
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text,true)", "storage failure remains visible")
    storage_failure = await page.evaluate("({input:document.querySelector('#chi').value,state:window.__GHDrawTest.liveState()})")
    assert storage_failure["input"] == "storage failure remains visible" and len(storage_failure["state"]["outbox"]) == 0 and len(cloud.attempts) == sends_before_abort, "an aborted IndexedDB transaction leaves the draft visible and prevents any chat POST"
    cloud.reject_limit_next = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "blocked at shared cap")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.some(item=>item.blocked)", timeout=5000)
    blocked = await page.evaluate("window.__GHDrawTest.liveState()")
    blocked_id = next(item["id"] for item in blocked["outbox"] if item["blocked"])
    blocked_attempts = len(cloud.attempts)
    assert "blocked at shared cap" in blocked["rendered"] and ("9.400" in blocked["rendered"] or "9,400" in blocked["rendered"]) and blocked["outbox"][-1]["id"] == blocked_id, "a cap response keeps the durable message visibly blocked in IndexedDB"
    await page.wait_for_timeout(100)
    assert len(cloud.attempts) == blocked_attempts and any(item["id"] == blocked_id and item["blocked"] for item in (await page.evaluate("window.__GHDrawTest.liveState()"))["outbox"]), "blocked messages are not automatically retried or removed"
    await context.close()
    print("PASS chat: durable retry/eviction ACK, reload recovery, visible failed/blocked states, IndexedDB abort prevents POST and preserves draft, distinct duplicate-text sends")


async def test_chat_manual_retry_after_status_write_failure(browser, origin):
    context, page = await launch_test_page(browser, origin)
    cloud = FakeLiveChat()
    await page.route(origin + "/__fake_live/**", cloud.handle)
    await page.evaluate("id=>window.__GHDrawTest.configureLive(id)", "e" * 32)
    cloud.reject_next = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text,true,2)", "status write retry")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.some(item=>item.failed)", timeout=5000)
    failed = await page.evaluate("window.__GHDrawTest.liveState()")
    message_id = next(item["id"] for item in failed["outbox"] if item["failed"])
    durable = await page.evaluate("window.__GHDrawTest.durableChat()")
    assert failed["ready"] is False and len(durable) == 1 and durable[0]["id"] == message_id and durable[0]["failed"] is False, "a failed status write closes readiness and leaves the unchanged message durable"
    assert cloud.attempts == [message_id] and len(cloud.messages) == 0, "the first permanent rejection is not treated as delivered"

    await page.evaluate("window.__GHDrawTest.armTransactionAbort(['chatOutbox'],'readwrite',1)")
    await page.evaluate("document.querySelector('#chl button').click()")
    await page.wait_for_timeout(100)
    blocked = await page.evaluate("window.__GHDrawTest.liveState()")
    durable_blocked = await page.evaluate("window.__GHDrawTest.durableChat()")
    assert blocked["ready"] is False and len(durable_blocked) == 1 and durable_blocked[0]["id"] == message_id, "a failed retry-state persistence keeps sending closed and the same item queued"
    assert cloud.attempts == [message_id], "no POST occurs before the retry status is durably verified"

    await page.evaluate("document.querySelector('#chl button').click()")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.length===0", timeout=5000)
    final = await page.evaluate("window.__GHDrawTest.liveState()")
    assert final["ready"] is True and cloud.attempts == [message_id, message_id], "after readback, manual retry sends exactly once using the same idempotency ID"
    assert len(cloud.messages) == 1 and cloud.messages[0]["id"] == message_id and cloud.messages[0]["m"] == "status write retry", "the successful server receipt clears only the matching durable item"
    await context.close()
    print("PASS chat retry after IDB status-write failure: readiness remains closed until durable retry readback; same messageId sends once and ACK clears it")


async def test_stale_tab_snapshot_is_rejected_and_rejoin_is_safe(browser, origin):
    context, first = await launch_test_page(browser, origin)
    cloud = FakeCloud(page=first)
    cloud.rooms[OLD_ID] = {"id": OLD_ID, "owner": OWNER, "kind": "room", "board": copy.deepcopy(BASE_BOARD), "rev": 0, "expires": EXPIRES}
    await context.route(BACKEND_ORIGIN + "/**", cloud.handle)
    await seed(first, board=BASE_BOARD, rev=0)
    second = await context.new_page()
    await second.goto(origin + "/", wait_until="load")
    await second.wait_for_function("!!window.__GHDrawTest")
    await second.evaluate("cfg=>window.__GHDrawTest.configure(cfg)", {"id": OLD_ID, "board": BASE_BOARD, "owner": OWNER, "rev": 0, "expires": EXPIRES})
    board_b = copy.deepcopy(BASE_BOARD)
    board_b["p"][0]["e"].append({"id": "shape-b", "type": "rect", "x": 30, "y": 4, "w": 8, "h": 9, "seed": 2, "stroke": "#1e1e1e", "bg": "transparent", "fill": "hachure", "sw": 2, "style": "solid", "rough": 1, "round": True, "opacity": 100, "align": "left"})
    await second.evaluate("b=>window.__GHDrawTest.setBoard(b)", {"v": 2, "d": 0, "p": [{"id": "page-1", "n": "Board", "e": board_b["p"][0]["e"]}]})
    await second.evaluate("window.__GHDrawTest.syncNow()")
    assert cloud.rooms[OLD_ID]["rev"] == 1 and any(e["id"] == "shape-b" for e in cloud.rooms[OLD_ID]["board"]["p"][0]["e"]), "the second tab's accepted shape is at remote revision 1"
    latest = await first.evaluate("id=>window.__GHDrawTest.snapshot(id)", OLD_ID)
    assert latest["rev"] == 1 and latest["base"] == cloud.rooms[OLD_ID]["board"] and any(e["id"] == "shape-b" for e in latest["board"]["p"][0]["e"]), "the durable snapshot carries its own accepted base and revision"
    stale_board = copy.deepcopy(BASE_BOARD)
    stale_board["p"][0]["e"].append({"id": "shape-stale-local", "type": "rect", "x": 40, "y": 5, "w": 6, "h": 7, "seed": 3, "stroke": "#1e1e1e", "bg": "transparent", "fill": "hachure", "sw": 2, "style": "solid", "rough": 1, "round": True, "opacity": 100, "align": "left"})
    await first.evaluate("b=>window.__GHDrawTest.setBoard(b)", {"v": 2, "d": 0, "p": [{"id": "page-1", "n": "Board", "e": stale_board["p"][0]["e"]}]})
    await first.evaluate("window.__GHDrawTest.saveBoard()")
    assert await first.evaluate("window.__GHDrawTest.snapshotCurrent()") is False, "a revision-0 tab cannot overwrite the revision-1 snapshot"
    await first.wait_for_timeout(350)  # let the normal debounced stale snapshot path attempt and reject too.
    still_latest = await first.evaluate("id=>window.__GHDrawTest.snapshot(id)", OLD_ID)
    assert still_latest["rev"] == 1 and any(e["id"] == "shape-b" for e in still_latest["board"]["p"][0]["e"]), "stale timer writes cannot replace the accepted snapshot"
    # Model a stale record left by an older client build: its own rev-0 base and local edits remain paired.
    await first.evaluate("window.__GHDrawTest.forceLegacyStaleSnapshotForRegression()")
    legacy_stale = await first.evaluate("id=>window.__GHDrawTest.snapshot(id)", OLD_ID)
    assert legacy_stale["rev"] == 0 and legacy_stale["base"] == BASE_BOARD and any(e["id"] == "shape-stale-local" for e in legacy_stale["board"]["p"][0]["e"]), "legacy stale board keeps its actual revision-0 base"
    await first.reload(wait_until="load")
    await first.wait_for_function("!!window.__GHDrawTest")
    await first.evaluate("id=>window.__GHDrawTest.startJoin(id)", OLD_ID)
    await first.evaluate("window.__ghdrawJoinPromise")
    joined = await first.evaluate("window.__GHDrawTest.state()")
    joined_ids = [e["id"] for e in joined["board"]["p"][0]["e"]]
    assert joined["room"]["id"] == OLD_ID and "shape-b" in joined_ids and "shape-stale-local" in joined_ids, "rejoin rebases the stale local edit from its paired revision-0 base onto the accepted remote revision-1 shape"
    assert not any(change.get("t") == "del" for batch in cloud.room_changes for change in batch), f"no destructive stale delete may reach the backend: {cloud.room_changes}"
    await first.evaluate("shape=>window.__GHDrawTest.addShape(shape)", {"id": "shape-fresh-after-rejoin", "type": "rect", "x": 55, "y": 6, "w": 7, "h": 8, "seed": 4, "stroke": "#1e1e1e", "bg": "transparent", "fill": "hachure", "sw": 2, "style": "solid", "rough": 1, "round": True, "opacity": 100, "align": "left"})
    await first.evaluate("window.__GHDrawTest.syncNow()")
    remote_ids = [e["id"] for e in cloud.rooms[OLD_ID]["board"]["p"][0]["e"]]
    assert cloud.rooms[OLD_ID]["rev"] == 2 and "shape-b" in remote_ids and "shape-stale-local" in remote_ids and "shape-fresh-after-rejoin" in remote_ids, "rebased local work and a new post-rejoin edit synchronize normally"
    await context.close()
    print("PASS stale-tab snapshot: revision CAS, paired-base rejoin, no stale delete, fresh edits sync")


async def test_chat_contention_retries_but_permanent_errors_do_not(browser, origin):
    context, page = await launch_test_page(browser, origin)
    cloud = FakeLiveChat()
    await page.route(origin + "/__fake_live/**", cloud.handle)
    await page.evaluate("id=>window.__GHDrawTest.configureLive(id)", "c" * 32)
    cloud.contention_next = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "retry after contention")
    await asyncio.wait_for(cloud.contention_arrived.wait(), timeout=5)
    pending = await page.evaluate("window.__GHDrawTest.liveState()")
    assert len(pending["outbox"]) == 1 and not pending["outbox"][0].get("failed") and not pending["outbox"][0].get("blocked"), "live_contention keeps the durable message queued for automatic retry"
    message_id = pending["outbox"][0]["id"]
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.length===0", timeout=5000)
    assert cloud.attempts == [message_id, message_id] and len(cloud.messages) == 1 and cloud.messages[0]["id"] == message_id, "retry reuses the same receipt ID and commits once"
    cloud.reject_next = True
    await page.evaluate("text=>window.__GHDrawTest.submitLiveMessage(text)", "permanent failure")
    await page.wait_for_function("window.__GHDrawTest.liveState().outbox.some(item=>item.failed)", timeout=5000)
    permanent = await page.evaluate("window.__GHDrawTest.liveState()")
    failed_id = next(item["id"] for item in permanent["outbox"] if item["failed"])
    attempts_before = list(cloud.attempts)
    await page.wait_for_timeout(700)
    assert cloud.attempts == attempts_before and failed_id in [item["id"] for item in (await page.evaluate("window.__GHDrawTest.liveState()"))["outbox"]], "permanent 4xx errors remain failed and are not automatically retried"
    await context.close()
    print("PASS live chat retry: contention backs off; permanent 4xx stays blocked")


async def test_chat_outbox_cross_tab_merge(browser, origin):
    context, first = await launch_test_page(browser, origin)
    cloud = FakeLiveChat()
    await first.route(origin + "/__fake_live/**", cloud.handle)
    second = await context.new_page()
    await second.route(origin + "/__fake_live/**", cloud.handle)
    await second.goto(origin + "/", wait_until="load")
    await second.wait_for_function("!!window.__GHDrawTest")
    room_id = "d" * 32
    await first.evaluate("id=>window.__GHDrawTest.configureLive(id)", room_id)
    await second.evaluate("id=>window.__GHDrawTest.configureLive(id)", room_id)
    first_id, second_id = "a" * 32, "b" * 32
    cloud.silence_ack_ids.add(second_id)
    await asyncio.gather(
        first.evaluate("(x)=>window.__GHDrawTest.enqueueLiveMessage(x[0],x[1])", [first_id, "from first tab"]),
        second.evaluate("(x)=>window.__GHDrawTest.enqueueLiveMessage(x[0],x[1])", [second_id, "from second tab"]),
    )
    await first.wait_for_function("id=>{const o=window.__GHDrawTest.liveState().outbox;return o.length===1&&o[0].id===id}", arg=second_id, timeout=5000)
    await second.wait_for_function("id=>{const o=window.__GHDrawTest.liveState().outbox;return o.length===1&&o[0].id===id}", arg=second_id, timeout=5000)
    for _ in range(50):
        if {message["id"] for message in cloud.messages} == {first_id, second_id}:
            break
        await asyncio.sleep(0.1)
    messages = cloud.messages
    assert len(messages) == 2 and {message["id"] for message in messages} == {first_id, second_id} and {message["m"] for message in messages} == {"from first tab", "from second tab"}, "both simultaneous sends must survive the shared IndexedDB read/modify/write"
    assert len({message["id"] for message in messages}) == 2, "each tab keeps its own stable message ID"
    first_state = await first.evaluate("window.__GHDrawTest.liveState()")
    assert len(first_state["outbox"]) == 1 and first_state["outbox"][0]["id"] == second_id, "ACK for A removes only A; B remains durable and visible while its ACK is withheld"
    await context.close()
    print("PASS chat cross-tab: concurrent IndexedDB enqueues merge; ACK removes only its ID and preserves the other tab's pending item")


async def test_mobile_tablet_layout(browser, origin):
    for label, viewport in (("mobile", {"width": 390, "height": 844}), ("tablet", {"width": 768, "height": 1024})):
        context, page = await launch_test_page(browser, origin, viewport=viewport, mobile=True)
        metrics = await page.evaluate("""() => {
          const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom}};
          const tools=document.querySelector('#tools'),buttons=[...tools.querySelectorAll('.ib')],heights=buttons.map(b=>b.getBoundingClientRect().height);
          return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,pointerCoarse:matchMedia('(pointer: coarse)').matches,tools:rect('#tools'),menu:rect('#menuWrap'),right:rect('#right'),overflow:getComputedStyle(tools).overflowX,buttonMinHeight:Math.min(...heights),buttonCount:buttons.length};
        }""")
        assert metrics["scrollWidth"] <= metrics["width"] + 1, f"{label}: page must not introduce horizontal viewport overflow: {metrics}"
        assert metrics["pointerCoarse"] is True and metrics["buttonMinHeight"] >= 44, f"{label}: drawing controls must have touch-sized targets: {metrics}"
        assert metrics["tools"]["x"] >= 0 and metrics["tools"]["right"] <= metrics["width"] + 1 and metrics["tools"]["bottom"] <= metrics["height"] + 1, f"{label}: bottom toolbar must stay within safe viewport bounds: {metrics}"
        assert metrics["overflow"] == "auto" and metrics["buttonCount"] > 0
        await page.screenshot(path=f"/tmp/ghdraw-{label}-preview.png")
        await context.close()
        print("PASS responsive touch layout:", label, metrics["width"], "x", metrics["height"])


async def main():
    global APP_ROOT, BACKEND_ORIGIN
    with tempfile.TemporaryDirectory(prefix="ghdraw-browser-build-") as build_dir:
        app_root = Path(build_dir) / "site"
        subprocess.run([
            "node", str(ROOT / "scripts" / "build.mjs"), "--target", "test", "--out-dir", str(app_root)
        ], cwd=ROOT, check=True, capture_output=True, text=True)
        built_html = (app_root / "index.html").read_text(encoding="utf-8")
        configured = re.search(r'window\.GHDRAW_CLOUD_ENDPOINT=("(?:\\.|[^"\\])*");', built_html)
        if not configured:
            raise AssertionError("test build did not inject a cloud endpoint")
        BACKEND_ORIGIN = json.loads(configured.group(1))
        if urlparse(BACKEND_ORIGIN).scheme != "https":
            raise AssertionError(f"test build selected a non-HTTPS backend: {BACKEND_ORIGIN}")
        APP_ROOT = app_root

        server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(app_root)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        origin = f"http://127.0.0.1:{server.server_port}"
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=True, executable_path=os.environ.get("GH_DRAW_CHROMIUM", "/usr/bin/chromium"), args=["--no-sandbox"])
                try:
                    await test_handoff_success_and_two_tab_lock(browser, origin)
                    await test_handoff_failures(browser, origin)
                    await test_unresolved_outbox_survives_handoff(browser, origin)
                    await test_selected_snapshot_join_gate(browser, origin, "indexeddb-readback")
                    await test_selected_snapshot_join_gate(browser, origin, "board-persistence")
                    await test_selected_snapshot_join_gate(browser, origin, None)
                    await test_restore_intent_recovery(browser, origin, "lost-ack")
                    await test_restore_intent_recovery(browser, origin, "checkpoint-failure")
                    await test_chat_outbox_survives_reload_and_lost_ack(browser, origin)
                    await test_chat_manual_retry_after_status_write_failure(browser, origin)
                    await test_stale_tab_snapshot_is_rejected_and_rejoin_is_safe(browser, origin)
                    await test_chat_contention_retries_but_permanent_errors_do_not(browser, origin)
                    await test_chat_outbox_cross_tab_merge(browser, origin)
                    await test_mobile_tablet_layout(browser, origin)
                finally:
                    await browser.close()
        finally:
            server.shutdown()
            server.server_close()
    print("All real-browser offline-sync E2E cases passed; remote Appwrite was not contacted.")


if __name__ == "__main__":
    asyncio.run(main())
