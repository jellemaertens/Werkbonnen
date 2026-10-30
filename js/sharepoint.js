// Sync with a SharePoint folder, so every technician sees the same werkbonnen, number sequence,
// customers, parts and photos. Two ways to reach the folder:
//   - "map": the copy of the folder that OneDrive syncs to this PC, chosen once with "Map kiezen"
//     (File System Access API, Edge/Chrome on a PC). The app writes files there and OneDrive
//     uploads them. No app registration needed. Chosen on the device, so it takes precedence.
//   - "graph": straight to SharePoint through Microsoft Graph with a Microsoft sign-in
//     (needs the app registration in js/config.js). Also works on phones and tablets.
//
// Layout in the folder (js/config.js: sharepoint.driveId / mapId):
//   App-gegevens/werkbonnen/<id>.json   one file per werkbon (also concepts), with photo captions
//   App-gegevens/fotos/<id>.jpg         the photos themselves
//   App-gegevens/lijsten.json           klanten, machines, onderdelen, monteurs (+ deleted ids)
//   Klanten/<klant>/<datum uur>/        per visit, once finished: werkbon-PDF, pro forma-PDF, photos
//
// Offline first: every local change goes into the IndexedDB store "spwachtrij" and is sent when
// the device is online and signed in. An item only leaves the queue after SharePoint accepted it.
//
// Sign-in: Microsoft Entra ID, authorization code flow with PKCE for a single-page app
// (sharepoint.tenantId + clientId in js/config.js, set up once by IT). No password ever passes
// through the app; it keeps the Microsoft tokens in this browser only.
// Microsoft lets a single-page app stay signed in for 24 hours at most. Before that runs out, the
// app signs in again by itself (prompt=none with the last account): with an active Microsoft 365
// session that needs no click. Only when that fails does the "Aanmelden" button appear.
const SP = (() => {
  const SCOPES = 'openid profile offline_access User.Read Files.ReadWrite.All';
  const AUTH_KEY = 'werkbonnen.sp.auth';
  const PKCE_KEY = 'werkbonnen.sp.pkce';
  const HINT_KEY = 'werkbonnen.sp.account';    // last signed-in account, for the automatic sign-in
  const STIL_KEY = 'werkbonnen.sp.stil';       // time of the last automatic attempt (this tab)
  const VERNIEUW_NA = 20 * 3600 * 1000;        // renew after 20 h, before Microsoft's 24 h limit
  const STIL_PAUZE = 10 * 60 * 1000;           // at most one automatic attempt per 10 minutes
  const APP = 'App-gegevens';
  const LIJSTEN = ['klanten', 'machines', 'onderdelen', 'monteurs'];
  const MAX_SIMPLE = 3.5 * 1024 * 1024;   // Graph: simple upload up to 4 MB, larger via an upload session
  const CHUNK = 320 * 1024 * 16;          // upload session chunks must be a multiple of 320 KiB

  const state = { status: 'uit', message: '', pending: 0, lastSync: null, gebruiker: '' };
  const listeners = new Set();
  const emit = type => listeners.forEach(fn => { try { fn(type, state); } catch (e) { console.error(e); } });
  const setStatus = (status, message = '') => { state.status = status; state.message = message; emit('status'); };

  class AuthNodig extends Error {}
  class HttpFout extends Error { constructor(status, message) { super(message); this.status = status; } }

  /* ---------- Configuration ---------- */
  function cfg() {
    const c = { ...(window.WERKBON_CONFIG?.sharepoint || {}) };
    // Local tests only: a fake Graph server (serve.ps1 -Graph), without Microsoft sign-in
    if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
      try { Object.assign(c, JSON.parse(localStorage.getItem('werkbonnen.sp.test') || 'null') || {}); } catch { /* ignore */ }
    }
    c.graph = (c.graph || 'https://graph.microsoft.com/v1.0').replace(/\/+$/, '');
    return c;
  }
  const graphIngesteld = () => { const c = cfg(); return !!(c.driveId && c.mapId && (c.testToken || (c.tenantId && c.clientId))); };

  /* ---------- Synced folder (OneDrive) ---------- */
  const MAP_NAAM = 'Werkbonnen Boss';
  let mapHandle = null;      // FileSystemDirectoryHandle of the synced folder, kept in IndexedDB
  let mapToegang = false;    // the browser allows reading and writing it (asked again after a restart)
  const mapMogelijk = () => 'showDirectoryPicker' in window;

  const modus = () => (mapHandle ? 'map' : graphIngesteld() ? 'graph' : null);
  const ingesteld = () => modus() !== null;
  const bereikbaar = () => modus() === 'map' || navigator.onLine;   // the folder is on this PC: also offline

  async function laadMap() {
    // Local tests only: the browser's private storage stands in for the synced folder
    if (cfg().opfs) mapHandle = await (await navigator.storage.getDirectory()).getDirectoryHandle(MAP_NAAM, { create: true });
    else mapHandle = (await DB.get('settings', 'spmap'))?.handle || null;
    mapToegang = !!mapHandle && (await mapHandle.queryPermission({ mode: 'readwrite' })) === 'granted';
  }

  // Lets the technician pick the synced "Werkbonnen Boss" folder (needs a click)
  async function kiesMap() {
    let h;
    try {
      h = await window.showDirectoryPicker({ id: 'werkbonnen-sharepoint', mode: 'readwrite', startIn: 'documents' });
    } catch { return false; }   // cancelled
    if (h.name !== MAP_NAAM) {
      // The parent folder picked by mistake? Then use the folder inside it
      const binnen = await h.getDirectoryHandle(MAP_NAAM).catch(() => null);
      if (binnen) h = binnen;
      else if (!confirm(`De gekozen map heet "${h.name}", niet "${MAP_NAAM}". Toch deze map gebruiken?`)) return false;
    }
    if ((await h.requestPermission({ mode: 'readwrite' })) !== 'granted') return false;
    const anders = !mapHandle || !(await mapHandle.isSameEntry(h));
    await DB.put('settings', { id: 'spmap', handle: h });
    mapHandle = h;
    mapToegang = true;
    if (anders) await nieuweBestemming();
    syncNu();
    return true;
  }

  async function ontkoppelMap() {
    await DB.del('settings', 'spmap');
    mapHandle = null;
    mapToegang = false;
    await nieuweBestemming();
    syncNu();
  }

  // Other folder (or other way to SharePoint): send everything there again, and never delete
  // local werkbonnen because they are not in the new folder yet
  async function nieuweBestemming() {
    for (const w of await DB.getAll('werkbonnen')) {
      if (w.spVersie || w.spMap) { delete w.spVersie; delete w.spMap; await DB.put('werkbonnen', w); }
    }
    for (const f of await DB.getAll('fotos')) if (f.sp) { f.sp = false; await DB.put('fotos', f); }
    const m = await spMeta();
    m.lijstenETag = null;
    await bewaarSpMeta(m);
  }

  const mapFout = e => {
    if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') { mapToegang = false; return new AuthNodig('Geef de app toegang tot de SharePoint-map'); }
    return e;
  };
  const nietGevonden = e => e?.name === 'NotFoundError' || e?.name === 'TypeMismatchError';

  // The folder itself must still exist: otherwise every subfolder would look empty
  async function controleerMap() {
    try { for await (const _ of mapHandle.keys()) break; }
    catch (e) {
      if (nietGevonden(e)) throw new HttpFout(404, `Map "${mapHandle.name}" niet gevonden: kies ze opnieuw bij Instellingen`);
      throw mapFout(e);
    }
  }

  // Walks to a subfolder; null when it does not exist (and maak is false)
  async function mapNaar(delen, maak) {
    let d = mapHandle;
    for (const deel of delen) {
      try { d = await d.getDirectoryHandle(deel, { create: maak }); }
      catch (e) { if (nietGevonden(e) && !maak) return null; throw mapFout(e); }
    }
    return d;
  }
  const splits = pad => { const delen = pad.split('/'); return { mappen: delen.slice(0, -1), naam: delen.at(-1) }; };
  const bestandMeta = (naam, f) => ({ name: naam, eTag: `${f.lastModified}-${f.size}`, lastModifiedDateTime: new Date(f.lastModified).toISOString(), size: f.size });

  async function mapBestand(pad) {
    const { mappen, naam } = splits(pad);
    const d = await mapNaar(mappen, false);
    if (!d) return null;
    try { return await (await d.getFileHandle(naam)).getFile(); }
    catch (e) { if (nietGevonden(e)) return null; throw mapFout(e); }
  }

  const mapMeta = async pad => { const f = await mapBestand(pad); return f && bestandMeta(f.name, f); };

  async function mapLijst(pad) {
    const d = await mapNaar(pad.split('/'), false);
    if (!d) return [];
    const out = [];
    try {
      for await (const [naam, h] of d.entries()) {
        out.push(h.kind === 'file' ? bestandMeta(naam, await h.getFile()) : { name: naam, folder: {} });
      }
    } catch (e) { throw mapFout(e); }
    return out;
  }

  async function mapDownload(pad) {
    const f = await mapBestand(pad);
    if (!f) return null;
    // A copy in memory: a File from disk becomes unreadable once OneDrive changes the file
    const data = await f.arrayBuffer();
    return { json: async () => JSON.parse(new TextDecoder().decode(data)), blob: async () => new Blob([data], { type: f.type || 'application/octet-stream' }) };
  }

  async function mapUpload(pad, inhoud, type, ifMatch) {
    // Best effort instead of If-Match: check right before writing that nobody else wrote in between
    if (ifMatch !== undefined && ((await mapMeta(pad))?.eTag || undefined) !== ifMatch) throw new HttpFout(412, 'Intussen gewijzigd');
    const { mappen, naam } = splits(pad);
    try {
      const w = await (await (await mapNaar(mappen, true)).getFileHandle(naam, { create: true })).createWritable();
      await w.write(inhoud instanceof Blob ? inhoud : new Blob([inhoud], { type }));
      await w.close();
    } catch (e) { throw mapFout(e); }
    return mapMeta(pad);
  }

  async function mapVerwijder(pad) {
    const { mappen, naam } = splits(pad);
    const d = await mapNaar(mappen, false);
    if (!d) return;
    try { await d.removeEntry(naam, { recursive: true }); }
    catch (e) { if (!nietGevonden(e)) throw mapFout(e); }
  }

  /* ---------- Sign-in (PKCE) ---------- */
  const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const random = n => b64url(crypto.getRandomValues(new Uint8Array(n)));
  const redirectUri = () => location.origin + location.pathname;
  const authBase = () => cfg().login || `https://login.microsoftonline.com/${cfg().tenantId}/oauth2/v2.0`;   // login: local tests only
  const leesAuth = () => { try { return JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; } };
  const bewaarAuth = a => { if (a) localStorage.setItem(AUTH_KEY, JSON.stringify(a)); else localStorage.removeItem(AUTH_KEY); };
  // Synced folder: the browser allows access. Graph: signed in at Microsoft.
  const aangemeld = () => (modus() === 'map' ? mapToegang : !!cfg().testToken || !!leesAuth()?.refresh);

  // The "Aanmelden" button: access to the folder again, a folder to choose, or a Microsoft sign-in
  async function aanmelden() {
    if (modus() === 'map') {
      mapToegang = (await mapHandle.requestPermission({ mode: 'readwrite' }).catch(() => 'denied')) === 'granted';
      if (mapToegang) syncNu();
      return mapToegang;
    }
    if (!graphIngesteld()) return mapMogelijk() && kiesMap();
    return microsoftAanmelden();
  }

  // stil: no screen at Microsoft (prompt=none); comes straight back, signed in or with an error
  async function microsoftAanmelden(stil = false) {
    const verifier = random(48);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const st = random(16);
    sessionStorage.setItem(PKCE_KEY, JSON.stringify({ verifier, state: st, hash: location.hash, stil }));
    const q = new URLSearchParams({
      client_id: cfg().clientId, response_type: 'code', redirect_uri: redirectUri(), response_mode: 'query',
      scope: SCOPES, state: st, code_challenge: challenge, code_challenge_method: 'S256',
      prompt: stil ? 'none' : 'select_account',
    });
    const hint = localStorage.getItem(HINT_KEY);
    if (stil && hint) q.set('login_hint', hint);
    location.href = `${authBase()}/authorize?${q}`;
  }

  // Automatic sign-in: only with a known account, online, and when nobody is busy in a werkbon or dialog
  function magStilAanmelden() {
    if (modus() !== 'graph' || cfg().testToken || !navigator.onLine || !localStorage.getItem(HINT_KEY)) return false;
    const a = leesAuth();
    if (a?.refresh && Date.now() - (a.sinds || 0) < VERNIEUW_NA) return false;   // still valid long enough
    if (Date.now() - Number(sessionStorage.getItem(STIL_KEY) || 0) < STIL_PAUZE) return false;
    if (openWerkbon() || document.querySelector('#modal-root')?.children.length) return false;
    return true;
  }
  function stilAanmelden() {
    sessionStorage.setItem(STIL_KEY, String(Date.now()));
    microsoftAanmelden(true);
  }

  async function tokenAanvraag(params) {
    const res = await fetch(`${authBase()}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: cfg().clientId, scope: SCOPES, ...params }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error((data.error_description || `Aanmelden mislukt (${res.status})`).split(/\r?\n/)[0]);
      e.auth = true;   // Microsoft refused: sign in again (unlike a network error)
      throw e;
    }
    const vorige = leesAuth() || {};
    const a = { access: data.access_token, exp: Date.now() + (data.expires_in - 120) * 1000, refresh: data.refresh_token || vorige.refresh, naam: vorige.naam, sinds: vorige.sinds };
    // A refresh does not extend the 24 h of a single-page app: only a new sign-in starts them again
    if (params.grant_type === 'authorization_code') a.sinds = Date.now();
    if (data.id_token) {
      try {
        const p = JSON.parse(decodeURIComponent(escape(atob(data.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))));
        a.naam = p.name || p.preferred_username || a.naam;
        if (p.preferred_username) localStorage.setItem(HINT_KEY, p.preferred_username);
      } catch { /* name is optional */ }
    }
    bewaarAuth(a);
    state.gebruiker = a.naam || '';
    return a;
  }

  // At startup: finish a sign-in that came back from Microsoft (?code=... in the address)
  async function verwerkAanmelding() {
    state.gebruiker = leesAuth()?.naam || '';
    const p = new URLSearchParams(location.search);
    if (!p.has('code') && !p.has('error')) return;
    const pk = JSON.parse(sessionStorage.getItem(PKCE_KEY) || 'null');
    sessionStorage.removeItem(PKCE_KEY);
    history.replaceState(null, '', redirectUri() + (pk?.hash || ''));
    // Automatic sign-in not possible (no Microsoft session, consent needed...): just show the button
    if (p.has('error') && pk?.stil) return setStatus('aanmelden', 'Meld je aan met je BOSS-account');
    if (p.has('error')) return setStatus('aanmelden', (p.get('error_description') || p.get('error')).split(/\r?\n/)[0]);
    if (!pk || pk.state !== p.get('state')) return setStatus('aanmelden', 'Aanmelden onderbroken, probeer opnieuw');
    try {
      await tokenAanvraag({ grant_type: 'authorization_code', code: p.get('code'), redirect_uri: redirectUri(), code_verifier: pk.verifier });
    } catch (e) {
      setStatus('aanmelden', e.message);
    }
  }

  async function token() {
    if (cfg().testToken) return 'test';
    const a = leesAuth();
    if (!a?.refresh) return null;
    if (a.access && Date.now() < a.exp) return a.access;
    try {
      return (await tokenAanvraag({ grant_type: 'refresh_token', refresh_token: a.refresh })).access;
    } catch (e) {
      if (e.auth) { bewaarAuth(null); return null; }
      throw e;   // offline: try again later, keep the sign-in
    }
  }

  // Signing out on purpose also stops the automatic sign-in
  function afmelden() {
    bewaarAuth(null);
    localStorage.removeItem(HINT_KEY);
    state.gebruiker = '';
    setStatus(ingesteld() ? 'aanmelden' : 'uit', 'Afgemeld');
  }

  /* ---------- Microsoft Graph ---------- */
  const encPad = p => p.split('/').map(encodeURIComponent).join('/');
  const itemUrl = p => `${cfg().graph}/drives/${cfg().driveId}/items/${cfg().mapId}:/${encPad(p)}:`;

  async function g(url, { method = 'GET', body, headers = {} } = {}) {
    const t = await token();
    if (!t) throw new AuthNodig('Meld je aan met je BOSS-account');
    const res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${t}`, ...headers }, cache: 'no-store' });
    if (res.status === 401) {
      const a = leesAuth();
      if (a) { a.exp = 0; bewaarAuth(a); }
      throw new AuthNodig('Aanmelding verlopen, meld je opnieuw aan');
    }
    return res;
  }
  async function foutTekst(res) {
    try { const j = await res.json(); return j.error?.message || `HTTP ${res.status}`; } catch { return `HTTP ${res.status}`; }
  }
  async function gJson(url, opts) {
    const res = await g(url, opts);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpFout(res.status, await foutTekst(res));
    return res.status === 204 ? null : res.json();
  }
  // meta / lijst / download / upload / verwijder: through Graph, or in the synced folder
  const meta = pad => (modus() === 'map' ? mapMeta(pad) : gJson(`${itemUrl(pad)}?$select=id,name,eTag,lastModifiedDateTime,size,webUrl`));

  async function lijst(pad) {
    if (modus() === 'map') return mapLijst(pad);
    const out = [];
    let url = `${itemUrl(pad)}/children?$select=id,name,eTag,lastModifiedDateTime,size&$top=999`;
    while (url) {
      const j = await gJson(url);
      if (!j) break;
      out.push(...j.value);
      url = j['@odata.nextLink'];
    }
    return out;
  }

  async function download(pad) {
    if (modus() === 'map') return mapDownload(pad);
    const res = await g(`${itemUrl(pad)}/content`);
    if (res.status === 404) return null;
    if (!res.ok) throw new HttpFout(res.status, await foutTekst(res));
    return res;
  }

  async function upload(pad, inhoud, type, ifMatch) {
    if (modus() === 'map') return mapUpload(pad, inhoud, type, ifMatch);
    const blob =inhoud instanceof Blob ? inhoud : new Blob([inhoud], { type });
    if (blob.size <= MAX_SIMPLE) {
      const headers = { 'Content-Type': type || blob.type || 'application/octet-stream' };
      if (ifMatch) headers['If-Match'] = ifMatch;
      const res = await g(`${itemUrl(pad)}/content`, { method: 'PUT', body: blob, headers });
      if (!res.ok) throw new HttpFout(res.status, res.status === 412 ? 'Intussen gewijzigd' : await foutTekst(res));
      return res.json();
    }
    const sessie = await gJson(`${itemUrl(pad)}/createUploadSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    let res;
    for (let start = 0; start < blob.size; start += CHUNK) {
      const end = Math.min(blob.size, start + CHUNK);
      // The upload URL is pre-authorised: no Authorization header
      res = await fetch(sessie.uploadUrl, { method: 'PUT', body: blob.slice(start, end), headers: { 'Content-Range': `bytes ${start}-${end - 1}/${blob.size}` } });
      if (!res.ok) throw new HttpFout(res.status, 'Upload van een groot bestand mislukt');
    }
    return res.json();
  }

  async function verwijder(pad) {
    if (modus() === 'map') return mapVerwijder(pad);
    const res = await g(itemUrl(pad), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new HttpFout(res.status, await foutTekst(res));
  }

  // SharePoint does not allow " * : < > ? / \ | in names, nor a leading or trailing dot or space
  const veilig = s => String(s || '').replace(/["*:<>?/\\|#%\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 120) || 'Zonder naam';

  /* ---------- Local bookkeeping ---------- */
  const spMeta = async () => (await DB.get('settings', 'sp')) || { id: 'sp', lijstenETag: null, verwijderd: {} };
  const bewaarSpMeta = m => DB.put('settings', m);

  async function telWachtrij() { state.pending = await DB.count('spwachtrij'); emit('status'); }

  async function zetInWachtrij(id, data = {}) {
    if (!ingesteld()) return;
    await DB.put('spwachtrij', { id, ...data, rev: Date.now() + Math.random() });
    await telWachtrij();
    schedule();
  }

  // Called by Sync.put / Sync.bulkPut before a list record is written: remember when it changed
  function stempel(store, objs) {
    if (!LIJSTEN.includes(store)) return;
    const nu = new Date().toISOString();
    for (const o of objs) o.gewijzigd = nu;
  }

  // Called by Sync.put / Sync.bulkPut / Sync.del after a local change
  async function lokaal(store, objs, verwijderd = false) {
    if (!ingesteld()) return;
    if (store === 'werkbonnen') {
      for (const o of objs) await zetInWachtrij(`werkbon:${o.id}`, { soort: 'werkbon', ref: o.id, map: o.spMap || '' });
    } else if (LIJSTEN.includes(store)) {
      if (verwijderd) {
        const m = await spMeta();
        const nu = new Date().toISOString();
        m.verwijderd[store] ??= {};
        for (const o of objs) m.verwijderd[store][o.id] = nu;
        await bewaarSpMeta(m);
      }
      await zetInWachtrij('lijsten', { soort: 'lijsten' });
    }
  }

  // A photo was added, changed (caption) or deleted
  async function foto(fotoId, werkbonId) {
    await zetInWachtrij(`foto:${fotoId}`, { soort: 'foto', ref: fotoId });
    await zetInWachtrij(`werkbon:${werkbonId}`, { soort: 'werkbon', ref: werkbonId });
  }

  // The werkbon was finished or reopened: bring its customer folder up to date
  const publiceer = werkbonId => zetInWachtrij(`publiceer:${werkbonId}`, { soort: 'publiceer', ref: werkbonId });

  /* ---------- Lists: merge per record, newest change wins ---------- */
  function voegSamen(a, b) {
    const uit = { versie: 1, verwijderd: {} };
    for (const store of LIJSTEN) {
      const del = { ...(a.verwijderd?.[store] || {}) };
      for (const [id, t] of Object.entries(b.verwijderd?.[store] || {})) if (!del[id] || t > del[id]) del[id] = t;
      const map = new Map();
      for (const r of [...(a[store] || []), ...(b[store] || [])]) {
        const huidig = map.get(r.id);
        if (!huidig || (r.gewijzigd || '') > (huidig.gewijzigd || '')) map.set(r.id, r);
      }
      uit[store] = [...map.values()].filter(r => !(del[r.id] && del[r.id] >= (r.gewijzigd || '')));
      uit.verwijderd[store] = del;
    }
    return uit;
  }

  async function lokaleLijsten() {
    const m = await spMeta();
    const l = { verwijderd: m.verwijderd || {} };
    for (const store of LIJSTEN) l[store] = await DB.getAll(store);
    return l;
  }

  // Makes the local lists equal to the merged lists
  async function pasLijstenToe(samen) {
    let gewijzigd = false;
    for (const store of LIJSTEN) {
      const lokaal = new Map((await DB.getAll(store)).map(r => [r.id, r]));
      const nieuw = samen[store] || [];
      const puts = nieuw.filter(r => JSON.stringify(lokaal.get(r.id)) !== JSON.stringify(r));
      const ids = new Set(nieuw.map(r => r.id));
      const dels = [...lokaal.keys()].filter(id => !ids.has(id));
      if (puts.length) await DB.bulkPut(store, puts);
      if (dels.length) await DB.bulkDel(store, dels);
      gewijzigd ||= !!(puts.length || dels.length);
    }
    const m = await spMeta();
    m.verwijderd = samen.verwijderd || {};
    await bewaarSpMeta(m);
    return gewijzigd;
  }

  // Synced folder: when two PCs saved the lists at the same time, OneDrive keeps both and names
  // one "lijsten-<PC>.json". Those copies are merged back in and then removed.
  const lijstKopieen = async () => (modus() === 'map' ? (await lijst(APP)).filter(r => /^lijsten.+\.json$/i.test(r.name)) : []);

  async function stuurLijsten() {
    const pad = `${APP}/lijsten.json`;
    for (let poging = 0; poging < 4; poging++) {
      const m = await meta(pad);
      let remote = m ? await (await download(pad)).json() : {};
      const kopieen = await lijstKopieen();
      for (const k of kopieen) remote = voegSamen(remote, await (await download(`${APP}/${k.name}`))?.json() || {});
      const samen = voegSamen(remote, await lokaleLijsten());
      try {
        const r = await upload(pad, JSON.stringify(samen), 'application/json', m?.eTag);
        for (const k of kopieen) await verwijder(`${APP}/${k.name}`);
        await pasLijstenToe(samen);
        const sm = await spMeta();
        sm.lijstenETag = r.eTag;
        await bewaarSpMeta(sm);
        return;
      } catch (e) {
        if (e.status === 412) continue;   // someone else saved in between: merge again
        throw e;
      }
    }
    throw new Error('De lijsten werden te vaak tegelijk gewijzigd, probeer later opnieuw');
  }

  async function haalLijsten(wachtrij) {
    if (wachtrij.has('lijsten')) return false;
    const pad = `${APP}/lijsten.json`;
    if ((await lijstKopieen()).length) { await stuurLijsten(); return true; }
    const m = await meta(pad);
    if (!m) {
      // Nothing in SharePoint yet: this device fills it with its lists
      if ((await DB.count('klanten')) || (await DB.count('onderdelen'))) await stuurLijsten();
      return false;
    }
    const sm = await spMeta();
    if (m.eTag === sm.lijstenETag) return false;
    const remote = await (await download(pad)).json();
    const gewijzigd = await pasLijstenToe(voegSamen(remote, {}));
    const sm2 = await spMeta();
    sm2.lijstenETag = m.eTag;
    await bewaarSpMeta(sm2);
    return gewijzigd;
  }

  /* ---------- Werkbonnen and photos ---------- */
  async function werkbonFotos(werkbonId) { return DB.byIndex('fotos', 'werkbonId', werkbonId); }
  // The werkbon open in the editor (App is declared in app.js)
  const openWerkbon = () => (typeof App !== 'undefined' ? App.wb : null);

  // Sets fields on the stored werkbon (and the open one) without queueing it again
  async function zetVelden(id, velden) {
    const wb = await DB.get('werkbonnen', id);
    if (!wb) return;
    Object.assign(wb, velden);
    await DB.put('werkbonnen', wb);
    if (openWerkbon()?.id === id) Object.assign(App.wb, velden);
  }

  async function stuurWerkbon(item) {
    const pad = `${APP}/werkbonnen/${item.ref}.json`;
    const wb = await DB.get('werkbonnen', item.ref);
    if (!wb) {
      await verwijder(pad);
      if (item.map) await verwijder(item.map);
      return;
    }
    const fotos = (await werkbonFotos(wb.id)).map(({ blob, ...f }) => f);
    const { spVersie, ...data } = wb;
    const r = await upload(pad, JSON.stringify({ ...data, fotos }), 'application/json');
    await zetVelden(wb.id, { spVersie: r.eTag });
  }

  async function stuurFoto(item) {
    const pad = `${APP}/fotos/${item.ref}.jpg`;
    const f = await DB.get('fotos', item.ref);
    if (!f) return verwijder(pad);
    if (!f.blob) return;   // only metadata on this device: the image is already in SharePoint
    await upload(pad, f.blob, 'image/jpeg');
    if (!f.sp) { f.sp = true; await DB.put('fotos', f); }
  }

  // Downloads the images of this werkbon that are only known by their caption on this device
  async function zorgVoorFotos(werkbonId) {
    if (!ingesteld() || !aangemeld() || !bereikbaar()) return false;
    let nieuw = false;
    for (const f of await werkbonFotos(werkbonId)) {
      if (f.blob) continue;
      try {
        const res = await download(`${APP}/fotos/${f.id}.jpg`);
        if (!res) continue;
        f.blob = await res.blob();
        await DB.put('fotos', f);
        nieuw = true;
      } catch (e) { console.warn('Foto ophalen mislukt', e); }
    }
    return nieuw;
  }

  // Customer folder of a finished werkbon: werkbon-PDF, pro forma-PDF and the photos
  // One folder per visit, named after the moment the werkbon was made (local time, e.g.
  // "2026-10-30 14.05.32"; ':' is not allowed in SharePoint names)
  function bezoekMap(wb) {
    const d = new Date(wb.aangemaakt);
    if (isNaN(d)) return veilig(wb.nummer);
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}.${p(d.getMinutes())}.${p(d.getSeconds())}`;
  }

  async function stuurPubliceer(item) {
    const wb = await DB.get('werkbonnen', item.ref);
    if (!wb) return;
    const map = wb.status === 'afgerond' ? `Klanten/${veilig(wb.klant?.naam || 'Zonder klant')}/${bezoekMap(wb)}` : '';
    if (wb.spMap && wb.spMap !== map) await verwijder(wb.spMap);
    if (map) {
      await verwijder(map);   // start clean: no photos that were removed in the meantime
      await zorgVoorFotos(wb.id);
      const fotos = (await werkbonFotos(wb.id)).filter(f => f.blob).sort((a, b) => a.datum.localeCompare(b.datum));
      const items = fotos.map(f => ({ src: URL.createObjectURL(f.blob), bijschrift: f.bijschrift }));
      try {
        const wbPdf = await PDF.render(werkbonPrintHtml(wb, App.settings, wb.fotosOpPdf === false ? [] : items), `Werkbon ${wb.nummer}`);
        await upload(`${map}/Werkbon ${veilig(wb.nummer)}.pdf`, wbPdf, 'application/pdf');
        const pfPdf = await PDF.render(proformaPrintHtml(wb, App.settings), `Pro forma ${wb.nummer}`);
        await upload(`${map}/Pro forma ${veilig(wb.nummer)}.pdf`, pfPdf, 'application/pdf');
        let i = 0;
        for (const f of fotos) {
          const naam = `Foto ${String(++i).padStart(2, '0')}${f.bijschrift ? ' - ' + veilig(f.bijschrift).slice(0, 60) : ''}.jpg`;
          await upload(`${map}/${naam}`, f.blob, 'image/jpeg');
        }
      } finally {
        items.forEach(it => URL.revokeObjectURL(it.src));
      }
    }
    if ((wb.spMap || '') !== map) {
      await zetVelden(wb.id, { spMap: map });
      await zetInWachtrij(`werkbon:${wb.id}`, { soort: 'werkbon', ref: wb.id });
    }
  }

  async function haalWerkbonnen(wachtrij) {
    const remote = await lijst(`${APP}/werkbonnen`);
    const open = openWerkbon()?.id;
    const ids = new Set();
    let gewijzigd = false;
    for (const r of remote) {
      // Only "<id>.json": not a OneDrive conflict copy like "<id>-PC.json"
      if (!/^[a-z0-9]+\.json$/.test(r.name)) continue;
      const id = r.name.slice(0, -5);
      ids.add(id);
      if (wachtrij.has(`werkbon:${id}`) || id === open) continue;   // own unsent change, or open in the editor
      const lokaal = await DB.get('werkbonnen', id);
      if (lokaal && lokaal.spVersie === r.eTag) continue;
      const res = await download(`${APP}/werkbonnen/${r.name}`);
      if (!res) continue;
      const { fotos = [], ...wb } = await res.json();
      wb.spVersie = r.eTag;
      await DB.put('werkbonnen', wb);
      // Photo captions now; the images are downloaded when someone opens the werkbon
      const lokaleFotos = await werkbonFotos(id);
      for (const f of fotos) {
        const l = lokaleFotos.find(x => x.id === f.id);
        await DB.put('fotos', { ...f, werkbonId: id, blob: l?.blob || null, sp: true });
      }
      for (const l of lokaleFotos) {
        if (!fotos.some(f => f.id === l.id) && !wachtrij.has(`foto:${l.id}`)) await DB.del('fotos', l.id);
      }
      gewijzigd = true;
    }
    // Werkbonnen that were deleted on another device. An empty folder while this device has
    // werkbonnen from it is more likely a folder that is not (yet) synced: then delete nothing.
    if (!ids.size) return gewijzigd;
    for (const w of await DB.getAll('werkbonnen')) {
      if (w.spVersie && !ids.has(w.id) && !wachtrij.has(`werkbon:${w.id}`) && w.id !== open) {
        for (const f of await werkbonFotos(w.id)) await DB.del('fotos', f.id);
        await DB.del('werkbonnen', w.id);
        gewijzigd = true;
      }
    }
    return gewijzigd;
  }

  // Local data that never reached SharePoint (made before signing in, or before this version)
  async function nogNietVerzonden(wachtrij) {
    for (const w of await DB.getAll('werkbonnen')) {
      if (!w.spVersie && !wachtrij.has(`werkbon:${w.id}`)) await zetInWachtrij(`werkbon:${w.id}`, { soort: 'werkbon', ref: w.id });
      // Finished before SharePoint was switched on: publish its customer folder now
      if (!w.spVersie && w.status === 'afgerond' && !w.spMap && !wachtrij.has(`publiceer:${w.id}`)) await publiceer(w.id);
    }
    for (const f of await DB.getAll('fotos')) {
      if (f.blob && !f.sp && !wachtrij.has(`foto:${f.id}`)) await zetInWachtrij(`foto:${f.id}`, { soort: 'foto', ref: f.id });
    }
  }

  const VOLGORDE = { lijsten: 0, foto: 1, werkbon: 2, publiceer: 3 };
  async function verwerkWachtrij() {
    const items = (await DB.getAll('spwachtrij')).sort((a, b) => VOLGORDE[a.soort] - VOLGORDE[b.soort] || a.rev - b.rev);
    for (const item of items) {
      if (item.soort === 'lijsten') await stuurLijsten();
      else if (item.soort === 'foto') await stuurFoto(item);
      else if (item.soort === 'werkbon') await stuurWerkbon(item);
      else if (item.soort === 'publiceer') await stuurPubliceer(item);
      await DB.delIfRev('spwachtrij', item.id, item.rev);   // unless it changed again meanwhile
      await telWachtrij();
    }
  }

  /* ---------- Sync loop ---------- */
  let running = null, again = false, debounce = null;

  async function runOnce() {
    await telWachtrij();
    if (!ingesteld()) return setStatus('uit');
    if (magStilAanmelden()) { setStatus('aanmelden', 'Opnieuw aanmelden…'); return stilAanmelden(); }
    if (!aangemeld()) return setStatus('aanmelden', modus() === 'map' ? 'Geef de app toegang tot de SharePoint-map' : 'Meld je aan met je BOSS-account');
    if (!bereikbaar()) return setStatus('offline', 'Geen internet');
    setStatus('bezig');
    try {
      if (modus() === 'map') await controleerMap();
      await nogNietVerzonden(new Set((await DB.getAll('spwachtrij')).map(i => i.id)));
      await verwerkWachtrij();
      const wachtrij = new Set((await DB.getAll('spwachtrij')).map(i => i.id));
      const l = await haalLijsten(wachtrij);
      const w = await haalWerkbonnen(wachtrij);
      state.lastSync = new Date().toISOString();
      await telWachtrij();
      setStatus('ok');
      if (l || w) emit('data');
    } catch (e) {
      console.warn('SharePoint-sync mislukt', e);
      await telWachtrij();
      if (e instanceof AuthNodig && magStilAanmelden()) { setStatus('aanmelden', 'Opnieuw aanmelden…'); stilAanmelden(); }
      else if (e instanceof AuthNodig) setStatus('aanmelden', e.message);
      else if (e instanceof HttpFout) setStatus('fout', e.status === 403 ? 'Geen toegang tot de SharePoint-map' : e.message);
      else if (modus() === 'map') setStatus('fout', `Map: ${e.message || e.name}`);
      else setStatus('offline', 'SharePoint niet bereikbaar');
    }
  }

  function syncNu() {
    if (running) { again = true; return running; }
    running = (async () => { do { again = false; await runOnce(); } while (again); })().finally(() => { running = null; });
    return running;
  }

  function schedule(ms = 1500) {
    clearTimeout(debounce);
    debounce = setTimeout(syncNu, ms);
  }

  // Before handing out a new werkbon number: fetch the newest numbers first (max. 5 s)
  async function syncVoorNieuw() {
    if (!ingesteld() || !aangemeld() || !bereikbaar()) return;
    await Promise.race([syncNu(), new Promise(r => setTimeout(r, 5000))]);
  }

  // Waits only for a sign-in that just came back; the sync itself runs in the background
  let gestart = false;
  async function start() {
    await verwerkAanmelding();
    if (mapMogelijk() || cfg().opfs) await laadMap().catch(e => console.warn('Map laden mislukt', e));
    if (!gestart) {
      gestart = true;
      window.addEventListener('online', () => syncNu());
      window.addEventListener('offline', () => { if (modus() !== 'map') setStatus(ingesteld() ? 'offline' : 'uit', 'Geen internet'); });
      document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNu(); });
      setInterval(() => { if (!document.hidden) syncNu(); }, 60000);
    }
    syncNu();
  }

  return {
    state, start, syncNu, syncVoorNieuw, schedule, ingesteld, aangemeld, aanmelden, afmelden,
    stempel, lokaal, foto, publiceer, zorgVoorFotos,
    modus, mapMogelijk, kiesMap, ontkoppelMap, graphIngesteld,
    mapNaam: () => mapHandle?.name || '',
    mapLink: () => cfg().link || '',
    on: fn => listeners.add(fn),
  };
})();
