
export const validOpId = x => typeof x === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(x);
const msgKey = m => m.id || (m.ts + '|' + m.n + '|' + m.t);

// Apply one serialized room update. The handler writes new operation receipts to
// private expiring side rows in the same TablesDB transaction as the room row.
export function applyRoomUpdate(d, b, {alreadyApplied = false} = {}) {
  const prevRev = Number.isSafeInteger(d.rev) ? d.rev : 0;
  if (alreadyApplied || b.opId && Array.isArray(d.ops) && d.ops.includes(b.opId)) {
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
  // Preserve any legacy d.ops entries for backward compatibility, but new IDs are
  // deliberately not appended here: the backend persists them in side rows.
  return {duplicate: false, ack: b.opId || null, rebased: b.baseRev !== undefined && b.baseRev < prevRev, prevRev};
}
