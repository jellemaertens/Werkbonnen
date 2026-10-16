// Sync with the central database (Lovable Cloud / Supabase, via its REST API).
//
// - Every local change goes into the IndexedDB "outbox" (see Sync.put / Sync.del).
//   When the device is online the outbox is pushed; an item is only removed after
//   the server accepted it, so nothing is lost when the connection drops.
// - Monteurs, klanten, machines and onderdelen are pulled from the server
//   incrementally, using the server's `bijgewerkt_op` timestamp as cursor.
// - Werkbonnen are only pushed. The office sees all of them centrally (Beheer).
const Sync = (() => {
  const PUSH_ORDER = ['monteurs', 'klanten', 'machines', 'onderdelen', 'werkbonnen'];
  const PULL = ['monteurs', 'klanten', 'machines', 'onderdelen'];
  // Central tables are prefixed so they don't clash with tables an app builder (Lovable) creates itself
  const table = store => `wb_${store}`;
  const PAGE = 1000;
  const OVERLAP_MS = 30000; // re-read the last 30 s so rows committed out of order are not missed

  const state = { status: 'uit', message: '', pending: 0, lastSync: null };
  const listeners = new Set();
  let getConfig = () => ({});
  let running = null, again = false, debounce = null;

  class HttpError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  const emit = (type) => listeners.forEach(fn => { try { fn(type, state); } catch (e) { console.error(e); } });
  const setStatus = (status, message = '') => { state.status = status; state.message = message; emit('status'); };
  const rev = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  function config() {
    const c = getConfig() || {};
    return { url: (c.url || '').trim().replace(/\/+$/, ''), key: (c.key || '').trim(), teamcode: (c.teamcode || '').trim(), door: c.door || '' };
  }
  const isConfigured = () => { const c = config(); return !!(c.url && c.key && c.teamcode); };

  async function api(path, { method = 'GET', body, prefer } = {}) {
    const c = config();
    const headers = { apikey: c.key, 'x-team-code': c.teamcode };
    // Legacy anon keys are JWTs and go in Authorization too; new "sb_publishable_" keys must not.
    if (c.key.startsWith('eyJ')) headers.Authorization = `Bearer ${c.key}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;
    const res = await fetch(`${c.url}/rest/v1/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
    const text = await res.text();
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { msg = JSON.parse(text).message || msg; } catch { /* not JSON */ }
      throw new HttpError(res.status, msg);
    }
    return text ? JSON.parse(text) : null;
  }

  /* ---------- Local writes (offline first) ---------- */
  const outboxItem = (store, rec, verwijderd) => ({
    id: `${store}:${rec.id}`, store, rev: rev(),
    payload: { id: String(rec.id), data: rec, verwijderd, gewijzigd_door: config().door || null },
  });

  async function refreshPending() { state.pending = await DB.count('outbox'); emit('status'); }

  async function queue(items) {
    // Without a central database there is nothing to send: don't let the outbox grow
    if (!items.length || !config().url) return;
    await DB.bulkPut('outbox', items);
    await refreshPending();
    schedule();
  }

  async function put(store, obj) {
    await DB.put(store, obj);
    await queue([outboxItem(store, obj, false)]);
    return obj;
  }
  async function bulkPut(store, arr) {
    await DB.bulkPut(store, arr);
    await queue(arr.map(o => outboxItem(store, o, false)));
    return arr.length;
  }
  async function del(store, id) {
    const old = await DB.get(store, id);
    await DB.del(store, id);
    await queue([outboxItem(store, old || { id }, true)]);
  }
  // Send everything in these local stores (e.g. to fill an empty central database)
  async function queueAll(stores) {
    let n = 0;
    for (const s of stores) {
      const all = await DB.getAll(s);
      await queue(all.map(o => outboxItem(s, o, false)));
      n += all.length;
    }
    return n;
  }

  /* ---------- Push & pull ---------- */
  async function push() {
    const items = await DB.getAll('outbox');
    for (const store of PUSH_ORDER) {
      const list = items.filter(i => i.store === store);
      const size = store === 'werkbonnen' ? 10 : 200; // werkbonnen carry a signature image
      for (let i = 0; i < list.length; i += size) {
        const batch = list.slice(i, i + size);
        await api(`${table(store)}?on_conflict=id`, { method: 'POST', body: batch.map(b => b.payload), prefer: 'resolution=merge-duplicates,return=minimal' });
        for (const b of batch) await DB.delIfRev('outbox', b.id, b.rev);
        await refreshPending();
      }
    }
  }

  // Cursors only hold for the server they came from: start over after switching database
  async function syncMeta() {
    const meta = await DB.get('settings', 'sync');
    return meta && meta.url === config().url ? meta : { id: 'sync', url: config().url, cursors: {} };
  }

  async function pull(store) {
    const meta = await syncMeta();
    const cursor = meta.cursors[store] || null;
    const pending = new Set((await DB.getAll('outbox')).filter(i => i.store === store).map(i => i.payload.id));
    const since = cursor && !isNaN(Date.parse(cursor)) ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString() : null;
    const seen = new Set();
    let max = cursor, changed = false;

    for (let offset = 0; ; offset += PAGE) {
      let q = `${table(store)}?select=id,data,verwijderd,bijgewerkt_op&order=bijgewerkt_op.asc,id.asc&limit=${PAGE}&offset=${offset}`;
      if (since) q += `&bijgewerkt_op=gt.${encodeURIComponent(since)}`;
      const rows = await api(q);
      const puts = [], dels = [];
      for (const r of rows) {
        if (!r.verwijderd) seen.add(r.id);
        const t = Date.parse(r.bijgewerkt_op);
        if (!max || t > Date.parse(max)) max = r.bijgewerkt_op;
        if (!cursor || t > Date.parse(cursor)) changed = true;
        if (pending.has(r.id)) continue; // local edit not sent yet: keep it
        if (r.verwijderd) dels.push(r.id); else puts.push({ ...r.data, id: r.id });
      }
      if (puts.length) await DB.bulkPut(store, puts);
      if (dels.length) await DB.bulkDel(store, dels);
      if (rows.length < PAGE) break;
    }

    // First download: the central list is leading. Drop local (seed) records it doesn't
    // know, except unsent local ones. An empty central table changes nothing.
    if (!cursor && seen.size) {
      const stale = (await DB.getAll(store)).filter(r => !seen.has(r.id) && !pending.has(r.id)).map(r => r.id);
      if (stale.length) { await DB.bulkDel(store, stale); changed = true; }
    }
    if (max !== cursor) {
      const fresh = await syncMeta();
      fresh.cursors[store] = max;
      await DB.put('settings', fresh);
    }
    return changed;
  }

  async function runOnce() {
    await refreshPending();
    if (!isConfigured()) return setStatus('uit');
    if (!navigator.onLine) return setStatus('offline');
    setStatus('bezig');
    try {
      await push();
      let changed = false;
      for (const t of PULL) changed = (await pull(t)) || changed;
      state.lastSync = new Date().toISOString();
      await refreshPending();
      setStatus('ok');
      if (changed) emit('data');
    } catch (e) {
      console.warn('Sync mislukt', e);
      await refreshPending();
      if (e instanceof HttpError) {
        const bad = e.status === 401 || e.status === 403 || /row-level security/i.test(e.message);
        setStatus('fout', bad ? 'Teamcode klopt niet' : e.message);
      } else {
        setStatus('offline', 'Server niet bereikbaar');
      }
    }
  }

  function syncNow() {
    if (running) { again = true; return running; }
    running = (async () => {
      do { again = false; await runOnce(); } while (again);
    })().finally(() => { running = null; });
    return running;
  }

  function schedule(ms = 1500) {
    clearTimeout(debounce);
    debounce = setTimeout(syncNow, ms);
  }

  /* ---------- Central reads (Beheer) ---------- */
  const werkbonCols = 'id,nummer,datum,status,monteur,klant_naam,gewijzigd_door,bijgewerkt_op';
  const WB = table('werkbonnen');
  const listWerkbonnen = (limit = 500) => api(`${WB}?select=${werkbonCols}&verwijderd=eq.false&order=bijgewerkt_op.desc&limit=${limit}`);
  const fetchWerkbon = id => api(`${WB}?select=data&id=eq.${encodeURIComponent(id)}`).then(rows => rows[0]?.data || null);
  const fetchAlleWerkbonnen = (limit = 1000) => api(`${WB}?select=data&verwijderd=eq.false&order=bijgewerkt_op.desc&limit=${limit}`).then(rows => rows.map(r => r.data));
  async function maxNummer(prefix) {
    const like = `${prefix}-${new Date().getFullYear()}-*`;
    const rows = await api(`${WB}?select=nummer&nummer=like.${encodeURIComponent(like)}&order=nummer.desc&limit=1`);
    return rows[0]?.nummer || null;
  }
  // Highest sequence number this year over all prefixes (all monteurs share one sequence)
  async function maxVolgnummer() {
    const jaar = new Date().getFullYear();
    const rows = await api(`${WB}?select=nummer&nummer=like.${encodeURIComponent(`*-${jaar}-*`)}&limit=100000`);
    let max = 0;
    for (const r of rows) { const m = /-(\d{4})-(\d+)$/.exec(r.nummer || ''); if (m && +m[1] === jaar) max = Math.max(max, +m[2]); }
    return max;
  }
  // true / false, or null when the server can't be reached
  async function checkTeamcode() {
    try { return !!(await api('rpc/wb_teamcode_ok', { method: 'POST', body: {} })); } catch (e) { return e instanceof HttpError ? false : null; }
  }

  let started = false;
  function start(cfgFn) {
    getConfig = cfgFn;
    if (started) return syncNow();
    started = true;
    window.addEventListener('online', () => syncNow());
    window.addEventListener('offline', () => setStatus(isConfigured() ? 'offline' : 'uit'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
    setInterval(() => { if (!document.hidden) syncNow(); }, 60000);
    return syncNow();
  }

  return {
    state, start, syncNow, schedule, isConfigured, put, bulkPut, del, queueAll,
    listWerkbonnen, fetchWerkbon, fetchAlleWerkbonnen, maxNummer, maxVolgnummer, checkTeamcode,
    on: fn => listeners.add(fn),
  };
})();
