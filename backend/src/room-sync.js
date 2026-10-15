
export const validOpId = x => typeof x === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(x);
const msgKey = m => m.id || (m.ts + '|' + m.n + '|' + m.t);

// Apply one serialized room update. The op id is recorded in the same board document
// as its changes, so a retried request cannot apply twice after a lost response.
export function applyRoomUpdate(d, b) {
  const prevRev = Number.isSafeInteger(d.rev) ? d.rev : 0;
  if (b.opId && Array.isArray(d.ops) && d.ops.includes(b.opId)) {
    return {duplicate: true, ack: b.opId, rebased: b.baseRev !== undefined && b.baseRev < prevRev, prevRev};
  }

  for (const c of b.changes) {
    if (c.t === 'addPage' && !d.board.p.some(p => p.id === c.p.id)) d.board.p.push(c.p);
    else if (c.t === 'delPage' && d.board.p.length > 1) d.board.p = d.board.p.filter(p => p.id !== c.pid);
    else {
      const p = d.board.p.find(p => p.id === c.pid);
      if (!p) continue;
      if (c.t === 'rename') p.n = String(c.n || '').slice(0, 24);
      if (c.t === 'put') {
        const i = p.e.findIndex(e => e.id === c.e.id);
        if (i < 0) p.e.push(c.e);
        else {
          const ne = c.e;
          if (ne.cm || ne.th) {
            const cur = p.e[i], have = new Set((cur.th || []).map(msgKey));
            ne.th = (cur.th || []).concat((ne.th || []).filter(m => !have.has(msgKey(m))));
          }
          p.e[i] = ne;
        }
      }
      if (c.t === 'del') p.e = p.e.filter(e => e.id !== c.eid);
      if (c.t === 'order') {
        const order = new Map(c.ids.map((id, i) => [id, i]));
        p.e.sort((a, b) => (order.get(a.id) ?? 99999) - (order.get(b.id) ?? 99999));
      }
    }
  }

  d.rev = prevRev + (b.changes.length ? 1 : 0);
  // Keep IDs for the room lifetime; the backend's 12 MiB row guard rejects overflow atomically.
  // Empty operations do not mutate state, so they need no durable deduplication receipt.
  if (b.opId && b.changes.length) {
    d.ops = Array.isArray(d.ops) ? d.ops : [];
    d.ops.push(b.opId);
  }
  return {duplicate: false, ack: b.opId || null, rebased: b.baseRev !== undefined && b.baseRev < prevRev, prevRev};
}
