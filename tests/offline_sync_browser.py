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
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]
BACKEND_ORIGIN = "https://ghdraw-expiring-links.fra.appwrite.run"
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
  async seedCheckpoint(){return await saveCloudCheckpoint(cloudRoom.id,cloudBase,cloudRev,cloudRoom.expires,cloudInflight,cloudBoard(true),null,0)},
  armGetAbort(store,key,ordinal){window.__ghdrawFault.get={store,key:String(key),ordinal,count:0}},
  armTransactionAbort(stores,mode,ordinal=1){window.__ghdrawFault.tx={stores,mode,ordinal,count:0}},
  startHandoff(){window.__ghdrawHandoffPromise=cloudStartNewRoom();return true},
  startRestore(ts){window.__ghdrawRestorePromise=histRestoreCloud(ts);return true},
  startJoin(id){window.__ghdrawJoinPromise=cloudJoin(id,true,false);return true},
  tryLock(id){window.__lockEntered=false;window.__lockPromise=runCloudRoomLocked(id,async()=>{window.__lockEntered=true;return true});return true},
  async checkpoint(id){return await cloudCheckpoint(id)},
  async snapshot(id){return await cloudLocalSnapshot(id)},
  async transition(id){return await cloudRoomTransition(id)},
  state(){return{room:cloudRoom&&{id:cloudRoom.id,generation:cloudRoom.generation},rev:cloudRev,inflight:cloudInflight,pending:cloudPending,diff:cloudBase?cloudDiff(cloudBase,cloudBoard()):null,owner:cloudOwner,oldOwner:localStorage.getItem('ghdraw:cloudOwner:'+OLD_ID_PLACEHOLDER),transition:localStorage.getItem(cloudRoomTransitionKey(OLD_ID_PLACEHOLDER)),base:cloudBase&&structuredClone(cloudBase),board:structuredClone(cloudBoard(true)),events:window.__ghdrawIdbAudit.slice()}},
  unsafe(id){return cloudCheckpointUnsafeMarker(id)},
  async clearDatabase(){
   if(cloudDBPromise){const db=await cloudDB().catch(()=>null);if(db)db.close();cloudDBPromise=null}
   await new Promise((resolve,reject)=>{const q=indexedDB.deleteDatabase('ghdraw-cloud-sync-v1');q.onsuccess=()=>resolve();q.onerror=()=>reject(q.error);q.onblocked=()=>reject(new Error('database deletion blocked'))});
   return true;
  }
 };
})();
""".replace("OWNER_PLACEHOLDER", json.dumps(OWNER)).replace("OLD_ID_PLACEHOLDER", json.dumps(OLD_ID))

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
                for change in body.get("changes", []):
                    if change.get("t") == "put":
                        page = next((p for p in room["board"]["p"] if p["id"] == change["pid"]), None)
                        if page:
                            el = change["e"]
                            idx = next((i for i, item in enumerate(page["e"]) if item["id"] == el["id"]), None)
                            if idx is None: page["e"].append(copy.deepcopy(el))
                            else: page["e"][idx] = copy.deepcopy(el)
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
            html = (ROOT / "index.html").read_text()
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
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, executable_path=os.environ.get("GH_DRAW_CHROMIUM", "/usr/bin/chromium"), args=["--no-sandbox"])
        try:
            await test_handoff_success_and_two_tab_lock(browser, origin)
            await test_handoff_failures(browser, origin)
            await test_unresolved_outbox_survives_handoff(browser, origin)
            await test_restore_intent_recovery(browser, origin, "lost-ack")
            await test_restore_intent_recovery(browser, origin, "checkpoint-failure")
            await test_mobile_tablet_layout(browser, origin)
        finally:
            await browser.close()
    server.shutdown()
    print("All real-browser offline-sync E2E cases passed; remote Appwrite was not contacted.")


if __name__ == "__main__":
    asyncio.run(main())
