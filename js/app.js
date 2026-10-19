'use strict';

/* =========================================================================
   Helpers
   ========================================================================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;
const sum = (arr, f) => arr.reduce((t, x) => t + f(x), 0);
const clone = o => JSON.parse(JSON.stringify(o));

const EUR = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' });
const NUM = new Intl.NumberFormat('nl-BE', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const fmtEur = n => EUR.format(n || 0);
const fmtNum = n => NUM.format(n || 0);

// Accepts "1,5", "1.5", "1.234,50" and "€ 12"
function parseNum(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  let s = String(v ?? '').replace(/[^\d,.\-]/g, '');
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '');
  s = s.replace(',', '.');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}
// Value shown in a number input: "1,5" instead of "1.5"
const numVal = n => (n === '' || n == null) ? '' : String(round2(parseNum(n))).replace('.', ',');

const pad2 = n => String(n).padStart(2, '0');
function today() { const d = new Date(); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
function nowTime() { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }
function fmtDate(iso) { if (!iso) return ''; const [y, m, d] = iso.slice(0, 10).split('-'); return `${d}-${m}-${y}`; }
function fmtDateTime(iso) { if (!iso) return ''; const d = new Date(iso); return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function getPath(obj, path) { return path.split('.').reduce((o, k) => o?.[k], obj); }
function setPath(obj, path, val) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((o, k) => (o[k] ??= {}), obj);
  target[last] = val;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

function download(filename, content, type = 'text/plain') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function pickFile(accept) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files[0] || null);
    input.click();
  });
}

/* ---------- CSV ---------- */
const csvCell = v => { const s = v == null ? '' : String(v); return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csvNum = n => String(round2(n || 0)).replace('.', ',');
const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(';')).join('\r\n');

function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}

// Maps CSV columns onto fields using a list of accepted header names per field
function csvToObjects(text, fieldMap) {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0].map(h => norm(h).trim());
  const idx = {};
  for (const [field, names] of Object.entries(fieldMap)) {
    const i = header.findIndex(h => names.includes(h));
    if (i >= 0) idx[field] = i;
  }
  return rows.slice(1).map(r => {
    const o = {};
    for (const [f, i] of Object.entries(idx)) o[f] = (r[i] ?? '').trim();
    return o;
  });
}

/* =========================================================================
   State, settings & data cache
   ========================================================================= */
const DEFAULT_SETTINGS = {
  id: 'app',
  bedrijf: {
    naam: 'NV BOSS paints', adres: 'Nijverheidstraat 81', postcode: '8791', gemeente: 'Beveren-Leie (Waregem)', land: 'België',
    website: 'corporate.bosspaints.be', telefoon: '+32 56 73 82 00', email: '', btw: '', iban: '',
    logo: '', // leeg = officieel BOSS paints-logo (assets/), anders een eigen geüpload logo
  },
  tarieven: {
    uurtarief: 105.91, voorrijtarief: 195, brandstoftoeslag: 10, btw: 21,
    codeUren: 'REAC.UREN', codeVoorrij: 'VOORRIJTARIEF', codeBrandstof: 'BRANDSTOFTOESLAG',
  },
  nummering: { prefix: 'WB', volgend: 1 },
  mijnNaam: '',
  monteurId: '',      // monteur that signed in on this device
  monteurs: [],       // fallback names when there is no monteurs list (central or seed)
  // Central database; empty url/key = use js/config.js
  centraal: { url: '', key: '', teamcode: '' },
  interventietypes: ['Storing', 'Onderhoud', 'Installatie', 'Pasta-gerelateerd', 'Gebruikersfout', 'Interventie'],
  snelteksten: [
    'Machine volledig gecontroleerd.',
    'Circuit gevuld, ontlucht en gekalibreerd.',
    'Alle circuits getest.',
    'Smeerpunten gesmeerd.',
    'Backup gemaakt.',
    'Testdosering ok.',
    'De machine is weer klaar voor gebruik.',
  ],
  machinesoorten: ['Dispenser', 'Shaker', 'Mixer', 'Andere'],
  prijzenOpWerkbon: true,
  voorwaarden: 'Door te ondertekenen bevestigt de klant dat de hierboven beschreven werkzaamheden zijn uitgevoerd en dat de gebruikte onderdelen en gepresteerde uren correct zijn.',
};

const App = {
  settings: null,
  klanten: [],
  machines: [],
  onderdelen: [],
  monteurs: [],
  wb: null,            // werkbon currently open in the editor
  ui: { wbFilter: 'alle', wbQuery: '', klantQuery: '', partQuery: '' },
};

function mergeDeep(base, over) {
  const out = clone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]))
      ? mergeDeep(out[k], v) : v;
  }
  return out;
}

async function loadCache() {
  [App.klanten, App.machines, App.onderdelen, App.monteurs] = await Promise.all([
    DB.getAll('klanten'), DB.getAll('machines'), DB.getAll('onderdelen'), DB.getAll('monteurs'),
  ]);
  App.klanten.sort((a, b) => String(a.naam ?? '').localeCompare(String(b.naam ?? ''), 'nl'));
  App.onderdelen.sort((a, b) => String(a.artikelnr ?? '').localeCompare(String(b.artikelnr ?? ''), 'nl'));
  App.monteurs.sort((a, b) => String(a.naam ?? '').localeCompare(String(b.naam ?? ''), 'nl'));
}

// Seed data is loaded locally only; it is not sent to the central database
// (use Beheer > "Lijsten van dit toestel uploaden" for that).
async function loadSeed() {
  if (!window.SEED) return;
  await DB.bulkPut('klanten', SEED.klanten);
  await DB.bulkPut('machines', SEED.machines);
  await DB.bulkPut('onderdelen', SEED.onderdelen);
  if ((await DB.count('monteurs')) === 0) await DB.bulkPut('monteurs', seedMonteurs(SEED.monteurs || []));
}

const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const initials = naam => String(naam).split(/\s+/).filter(Boolean).map(w => w[0]).filter(c => /[a-z]/i.test(c)).join('').toUpperCase().slice(0, 3);

function seedMonteurs(names) {
  const used = new Set();
  return names.map(naam => {
    let prefix = initials(naam) || 'WB';
    for (let i = 2; used.has(prefix); i++) prefix = initials(naam) + i;
    used.add(prefix);
    return { id: slug(naam), naam, prefix, beheerder: false, actief: true };
  });
}

/* ---------- Monteurs & central database ---------- */
const actieveMonteurs = () => App.monteurs.filter(m => m.actief !== false);
const monteurNamen = () => App.monteurs.length ? actieveMonteurs().map(m => m.naam) : App.settings.monteurs;
const ikBen = () => App.monteurs.find(m => m.id === App.settings.monteurId) || null;
// Without any beheerder set, everyone sees Beheer (so the first one can be appointed)
const magBeheren = () => !App.monteurs.some(m => m.beheerder) || !!ikBen()?.beheerder;

// config.js can switch the central database off for good (centraal: false)
const centraalUit = () => window.WERKBON_CONFIG?.centraal === false;

function centraalConfig() {
  if (centraalUit()) return { url: '', key: '', teamcode: '', door: App.settings.mijnNaam };
  const c = App.settings.centraal || {};
  const def = window.WERKBON_CONFIG || {};
  return { url: c.url || def.supabaseUrl || '', key: c.key || def.supabaseKey || '', teamcode: c.teamcode || '', door: App.settings.mijnNaam };
}
const centraalIngesteld = () => { const c = centraalConfig(); return !!(c.url && c.key); };

let settingsTimer;
function saveSettings(immediate) {
  clearTimeout(settingsTimer);
  const run = () => DB.put('settings', App.settings);
  if (immediate) return run();
  settingsTimer = setTimeout(run, 300);
}

const klantById = id => App.klanten.find(k => k.id === id);
const machinesOf = klantId => App.machines.filter(m => m.klantId === klantId).sort((a, b) => (a.soort + a.model).localeCompare(b.soort + b.model));
const snapKlant = k => ({ nummer: k.nummer || '', naam: k.naam, groep: k.groep || '', adres: k.adres || '', postcode: k.postcode || '', gemeente: k.gemeente || '', land: k.land || '', contact: k.contact || '', email: k.email || '', telefoon: k.telefoon || '', btw: k.btw || '', openingsuren: k.openingsuren || '', sluitingsdag: k.sluitingsdag || '' });
const klantUren = k => k ? [k.openingsuren && `Open: ${k.openingsuren}`, k.sluitingsdag && `Gesloten: ${k.sluitingsdag}`].filter(Boolean).join(' · ') : '';
const snapMachine = m => ({ model: m.model, fabrikant: m.fabrikant || '', soort: m.soort || '', serienummer: m.serienummer || '' });
const klantAdres = k => k ? [k.adres, [k.postcode, k.gemeente].filter(Boolean).join(' '), k.land].filter(Boolean).join('\n') : '';
const machineLabel = m => m ? [m.model, m.fabrikant && `(${m.fabrikant})`].filter(Boolean).join(' ') : '';

/* =========================================================================
   Werkbon model
   ========================================================================= */
// Werkbon numbers use the prefix of the werkbon's monteur. The signed-in monteur uses the
// prefix from Instellingen; other monteurs their own prefix from the monteurs list.
function prefixVoor(monteur) {
  const own = App.settings.nummering.prefix || 'WB';
  if (!monteur || norm(monteur) === norm(App.settings.mijnNaam)) return own;
  const mt = App.monteurs.find(m => norm(m.naam) === norm(monteur));
  return mt?.prefix || initials(monteur) || own;
}
const splitNummer = nr => { const m = /^(.*)-(\d{4})-(\d+)$/.exec(nr || ''); return m ? { prefix: m[1], jaar: m[2], volg: +m[3] } : null; };

const maakNummer = (prefix, jaar, volg) => `${prefix}-${jaar}-${String(volg).padStart(4, '0')}`;

async function nextNumber(monteur) {
  const n = App.settings.nummering;
  // One sequence for all monteurs; "Volgend volgnummer" in Instellingen can only move it forward
  const volg = Math.max(await volgendNummer(), parseNum(n.volgend) || 1);
  n.volgend = volg + 1;
  await saveSettings(true);
  return maakNummer(prefixVoor(monteur), new Date().getFullYear(), volg);
}

// A concept werkbon whose prefix belongs to another monteur keeps its sequence number and gets
// the prefix of its monteur (JMT-2026-0004 -> TDG-2026-0004)
async function nummerVoorMonteur(wb) {
  const cur = splitNummer(wb.nummer);
  const prefix = prefixVoor(wb.monteur);
  if (wb.status !== 'concept' || !cur || cur.prefix === prefix) return false;
  const oud = wb.nummer;
  wb.nummer = maakNummer(prefix, cur.jaar, cur.volg);
  toast(`Werkbonnummer ${oud} gewijzigd naar ${wb.nummer}`);
  return true;
}

// Once: werkbonnen numbered per prefix (before the shared sequence) can share a sequence number,
// e.g. WB-2026-0001 and TDG-2026-0001. The later one gets the next free number; the prefix stays.
async function maakNummerreeksUniek() {
  if (App.settings.nummerreeksGedeeld) return;
  const alle = (await DB.getAll('werkbonnen')).sort((a, b) => String(a.aangemaakt).localeCompare(String(b.aangemaakt)));
  const max = {}, gezien = {}, gewijzigd = [];
  for (const w of alle) { const n = splitNummer(w.nummer); if (n) max[n.jaar] = Math.max(max[n.jaar] || 0, n.volg); }
  for (const w of alle) {
    const n = splitNummer(w.nummer);
    if (!n) continue;
    const seen = (gezien[n.jaar] ??= new Set());
    if (seen.has(n.volg)) {
      const oud = w.nummer;
      max[n.jaar]++;
      w.nummer = maakNummer(n.prefix, n.jaar, max[n.jaar]);
      seen.add(max[n.jaar]);
      await Sync.put('werkbonnen', w);
      gewijzigd.push(`${oud} → ${w.nummer}`);
    } else seen.add(n.volg);
  }
  const jaar = String(new Date().getFullYear());
  const s = App.settings;
  s.nummering.volgend = Math.max(parseNum(s.nummering.volgend) || 1, (max[jaar] || 0) + 1);
  s.nummerreeksGedeeld = true;
  await saveSettings(true);
  if (gewijzigd.length) toast(`Werkbonnummer aangepast: ${gewijzigd.join(', ')}`);
}

async function newWerkbon(monteur = App.settings.mijnNaam || '') {
  const t = App.settings.tarieven;
  const now = new Date().toISOString();
  return {
    id: uid(),
    nummer: await nextNumber(monteur),
    status: 'concept',
    datum: today(), starttijd: nowTime(), eindtijd: '',
    monteur,
    interventie: App.settings.interventietypes[0] || '',
    referentie: '',
    klantId: null, klant: null,
    machineId: null, machine: null,
    melding: '', bevindingen: '', werkzaamheden: '',
    onderdelen: [],
    werkuren: 0, werkurenHandmatig: false, uurtarief: t.uurtarief,
    aanrijkost: { actief: t.voorrijtarief > 0, bedrag: t.voorrijtarief },
    brandstoftoeslag: { actief: t.brandstoftoeslag > 0, bedrag: t.brandstoftoeslag },
    extra: [],
    btw: t.btw,
    handtekening: null, nietOndertekend: '', afgerondOp: null,
    aangemaakt: now, gewijzigd: now,
  };
}

function totals(wb) {
  const lijn = l => parseNum(l.aantal) * parseNum(l.prijs);
  const onderdelen = sum(wb.onderdelen, lijn);
  const arbeid = parseNum(wb.werkuren) * parseNum(wb.uurtarief);
  const aanrij = wb.aanrijkost.actief ? parseNum(wb.aanrijkost.bedrag) : 0;
  const verplaatsing = aanrij + (wb.brandstoftoeslag.actief ? parseNum(wb.brandstoftoeslag.bedrag) : 0);
  const overige = sum(wb.extra, lijn);
  // Garantie: 100% korting on the marked parts, the werkuren and/or the aanrijkost
  const garantie = sum(wb.onderdelen.filter(l => l.garantie), lijn)
    + (wb.werkurenGarantie ? arbeid : 0)
    + (wb.aanrijkost.garantie ? aanrij : 0);
  const bruto = round2(onderdelen + arbeid + verplaatsing + overige);
  const excl = round2(bruto - garantie);
  const btw = round2(excl * parseNum(wb.btw) / 100);
  return { onderdelen: round2(onderdelen), arbeid: round2(arbeid), verplaatsing: round2(verplaatsing), overige: round2(overige), bruto, garantie: round2(garantie), excl, btw, incl: round2(excl + btw) };
}

function hoursBetween(start, end) {
  if (!start || !end) return null;
  const [h1, m1] = start.split(':').map(Number);
  const [h2, m2] = end.split(':').map(Number);
  let min = (h2 * 60 + m2) - (h1 * 60 + m1);
  if (min < 0) min += 24 * 60;
  return Math.round(min / 15) / 4; // rounded to the quarter hour
}

/* ---------- Autosave ---------- */
let saveTimer = null;
function setSaved(text) { const el = $('#saved'); if (el) el.textContent = text; }
function scheduleSave() {
  clearTimeout(saveTimer);
  setSaved('Opslaan…');
  saveTimer = setTimeout(saveNow, 400);
}
async function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!App.wb) return;
  App.wb.gewijzigd = new Date().toISOString();
  await Sync.put('werkbonnen', App.wb);
  setSaved('Opgeslagen ✓');
}
async function flushSave() { if (saveTimer) await saveNow(); }

/* =========================================================================
   Modal & picker
   ========================================================================= */
function openModal({ title, body, foot = '', wide = false, dismissable = true, onClose }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn icon ghost" data-close aria-label="Sluiten">✕</button></div>
      <div class="modal-body">${body}</div>
      ${foot ? `<div class="modal-foot">${foot}</div>` : ''}
    </div>`;
  $('#modal-root').appendChild(wrap);
  document.body.style.overflow = 'hidden';
  const close = () => {
    wrap.remove();
    if (!$('#modal-root').children.length) document.body.style.overflow = '';
    onClose?.();
  };
  wrap.addEventListener('click', e => {
    if ((dismissable && e.target === wrap) || e.target.closest('[data-close]')) close();
  });
  wrap._close = close;
  return { el: wrap, close };
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { const m = $('#modal-root').lastElementChild; if (m) m._close(); }
});

function openPicker({ title, items, render, haystack, onPick, keepOpen = false, extraButton, freeText }) {
  const indexed = items.map((it, i) => ({ it, i, h: norm(haystack(it)) }));
  const m = openModal({
    title,
    body: `
      <div class="row">
        <div class="search"><input type="search" placeholder="Zoeken…" data-q autocomplete="off" enterkeyhint="search"></div>
        ${extraButton ? `<button type="button" class="btn" data-extra>${esc(extraButton.label)}</button>` : ''}
      </div>
      <div class="list" data-results style="margin-top:12px"></div>`,
    foot: keepOpen ? '<button type="button" class="btn primary" data-close>Klaar</button>' : '',
  });
  const input = $('[data-q]', m.el);
  const res = $('[data-results]', m.el);
  const draw = () => {
    const terms = norm(input.value).split(/\s+/).filter(Boolean);
    const hits = indexed.filter(x => terms.every(t => x.h.includes(t))).slice(0, 100);
    let html = hits.map(x => `<div class="list-item" data-i="${x.i}">${render(x.it)}</div>`).join('');
    if (freeText && input.value.trim()) {
      html += `<button type="button" class="btn" data-free style="justify-content:flex-start">＋ ${esc(freeText.label(input.value.trim()))}</button>`;
    }
    res.innerHTML = html || '<div class="empty">Geen resultaten</div>';
  };
  input.addEventListener('input', draw);
  res.addEventListener('click', e => {
    if (e.target.closest('[data-free]')) { freeText.onClick(input.value.trim()); input.value = ''; draw(); if (!keepOpen) m.close(); return; }
    const row = e.target.closest('[data-i]');
    if (!row) return;
    onPick(items[+row.dataset.i]);
    if (keepOpen) { row.style.background = 'var(--success-soft)'; setTimeout(() => (row.style.background = ''), 600); }
    else m.close();
  });
  $('[data-extra]', m.el)?.addEventListener('click', () => { m.close(); extraButton.onClick(); });
  draw();
  setTimeout(() => input.focus(), 50);
  return m;
}

/* ---------- Klant & machine forms (modals) ---------- */
function openKlantModal(klant, onSaved) {
  const k = klant ? clone(klant) : { id: uid(), nummer: '', naam: '', groep: '', adres: '', postcode: '', gemeente: '', land: 'BE', contact: '', email: '', telefoon: '', btw: '', openingsuren: '', sluitingsdag: '' };
  const f = (name, label, type = 'text', cls = '') => `<label class="field ${cls}"><span>${label}</span><input type="${type}" name="${name}" value="${esc(k[name])}"></label>`;
  const m = openModal({
    title: klant ? 'Klant bewerken' : 'Nieuwe klant',
    body: `<form class="grid two" data-form>
      ${f('naam', 'Naam *', 'text', 'full')}
      ${f('nummer', 'Klantnummer')}${f('groep', 'Klantgroep')}${f('btw', 'BTW-nummer')}
      ${f('adres', 'Adres', 'text', 'full')}
      ${f('postcode', 'Postcode')}${f('gemeente', 'Gemeente')}${f('land', 'Land')}
      ${f('contact', 'Contactpersoon')}${f('telefoon', 'Telefoon', 'tel')}${f('email', 'E-mail', 'email')}
      ${f('openingsuren', 'Openingsuren', 'text', 'full')}${f('sluitingsdag', 'Sluitingsdag(en)', 'text', 'full')}
    </form>`,
    foot: '<button type="button" class="btn" data-close>Annuleren</button><button type="button" class="btn primary" data-save>Opslaan</button>',
  });
  $('[data-save]', m.el).addEventListener('click', async () => {
    const form = $('[data-form]', m.el);
    for (const el of form.elements) if (el.name) k[el.name] = el.value.trim();
    if (!k.naam) { toast('Vul een naam in'); form.elements.naam.focus(); return; }
    await Sync.put('klanten', k);
    await loadCache();
    m.close();
    toast('Klant opgeslagen');
    onSaved?.(k);
  });
  setTimeout(() => $('[name=naam]', m.el).focus(), 50);
}

function openMachineModal(klantId, machine, onSaved) {
  const mc = machine ? clone(machine) : { id: uid(), klantId, model: '', fabrikant: '', soort: '', serienummer: '' };
  const soorten = App.settings.machinesoorten;
  const m = openModal({
    title: machine ? 'Machine bewerken' : 'Nieuwe machine',
    body: `<form class="grid two" data-form>
      <label class="field"><span>Model *</span><input name="model" value="${esc(mc.model)}" placeholder="bv. D410-32"></label>
      <label class="field"><span>Serienummer</span><input name="serienummer" value="${esc(mc.serienummer)}"></label>
      <label class="field"><span>Fabrikant</span><input name="fabrikant" value="${esc(mc.fabrikant)}" placeholder="bv. Corob"></label>
      <label class="field"><span>Soort</span><input name="soort" value="${esc(mc.soort)}" list="soorten"><datalist id="soorten">${soorten.map(s => `<option value="${esc(s)}">`).join('')}</datalist></label>
    </form>`,
    foot: '<button type="button" class="btn" data-close>Annuleren</button><button type="button" class="btn primary" data-save>Opslaan</button>',
  });
  $('[data-save]', m.el).addEventListener('click', async () => {
    const form = $('[data-form]', m.el);
    for (const el of form.elements) if (el.name) mc[el.name] = el.value.trim();
    if (!mc.model) { toast('Vul een model in'); return; }
    await Sync.put('machines', mc);
    await loadCache();
    m.close();
    toast('Machine opgeslagen');
    onSaved?.(mc);
  });
  setTimeout(() => $('[name=model]', m.el).focus(), 50);
}

function openOnderdeelModal(part, onSaved) {
  const p = part ? clone(part) : { id: '', artikelnr: '', omschrijving: '', prijs: 0, eenheid: 'st' };
  const m = openModal({
    title: part ? 'Onderdeel bewerken' : 'Nieuw onderdeel',
    body: `<form class="grid two" data-form>
      <label class="field"><span>Artikelnummer *</span><input name="artikelnr" value="${esc(p.artikelnr)}" ${part ? 'readonly' : ''}></label>
      <label class="field"><span>Prijs (excl. BTW)</span><input name="prijs" inputmode="decimal" value="${esc(numVal(p.prijs))}"></label>
      <label class="field full"><span>Omschrijving *</span><input name="omschrijving" value="${esc(p.omschrijving)}"></label>
    </form>`,
    foot: `${part ? '<button type="button" class="btn danger" data-del>Verwijderen</button><span class="spacer"></span>' : ''}<button type="button" class="btn" data-close>Annuleren</button><button type="button" class="btn primary" data-save>Opslaan</button>`,
  });
  $('[data-save]', m.el).addEventListener('click', async () => {
    const form = $('[data-form]', m.el);
    p.artikelnr = form.elements.artikelnr.value.trim();
    p.omschrijving = form.elements.omschrijving.value.trim();
    p.prijs = round2(parseNum(form.elements.prijs.value));
    if (!p.artikelnr || !p.omschrijving) { toast('Vul artikelnummer en omschrijving in'); return; }
    p.id = p.artikelnr;
    await Sync.put('onderdelen', p);
    await loadCache();
    m.close();
    toast('Onderdeel opgeslagen');
    onSaved?.(p);
  });
  $('[data-del]', m.el)?.addEventListener('click', async () => {
    if (!confirm(`Onderdeel ${p.artikelnr} verwijderen?`)) return;
    await Sync.del('onderdelen', p.id);
    await loadCache();
    m.close();
    onSaved?.(null);
  });
}

/* =========================================================================
   Router
   ========================================================================= */
const view = () => $('#view');
// Replace #view with a fresh node so listeners from the previous screen don't pile up
function setView(html) {
  const fresh = view().cloneNode(false);
  view().replaceWith(fresh);
  fresh.innerHTML = html;
  return fresh;
}

const routes = [
  [/^#?\/?$/, viewWerkbonnen, 'werkbonnen'],
  [/^#\/werkbon\/([\w-]+)$/, viewWerkbon, 'werkbonnen'],
  [/^#\/klanten$/, viewKlanten, 'klanten'],
  [/^#\/klant\/([\w-]+)$/, viewKlant, 'klanten'],
  [/^#\/onderdelen$/, viewOnderdelen, 'onderdelen'],
  [/^#\/instellingen$/, viewInstellingen, 'instellingen'],
  [/^#\/beheer$/, viewBeheer, 'beheer'],
];

async function route() {
  await flushSave();
  App.wb = null;
  $('#modal-root').innerHTML = '';
  document.body.style.overflow = '';
  const hash = location.hash || '#/';
  for (const [re, fn, nav] of routes) {
    const m = hash.match(re);
    if (m) {
      $$('.nav a').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
      window.scrollTo(0, 0);
      await fn(...m.slice(1).map(decodeURIComponent));
      return;
    }
  }
  location.hash = '#/';
}

/* =========================================================================
   View: werkbonnen list
   ========================================================================= */
async function viewWerkbonnen() {
  const all = (await DB.getAll('werkbonnen'))
    .sort((a, b) => (b.datum + b.starttijd + b.aangemaakt).localeCompare(a.datum + a.starttijd + a.aangemaakt));
  const ui = App.ui;
  setView(`
    <div class="page-head">
      <h1>Werkbonnen</h1>
      <div class="actions">
        <button type="button" class="btn" data-export ${all.length ? '' : 'disabled'}>Exporteren (CSV)</button>
        <a class="btn primary" href="#/werkbon/nieuw">＋ Nieuwe werkbon</a>
      </div>
    </div>
    <div class="toolbar">
      <div class="search"><input type="search" placeholder="Zoek op klant, nummer, machine, monteur…" value="${esc(ui.wbQuery)}" data-q></div>
      <div class="seg" role="tablist">
        ${[['alle', 'Alle'], ['concept', 'Concept'], ['afgerond', 'Afgerond']].map(([v, l]) => `<button type="button" data-filter="${v}" class="${ui.wbFilter === v ? 'active' : ''}">${l}</button>`).join('')}
      </div>
    </div>
    <div class="list" data-list></div>`);

  const draw = () => {
    const terms = norm(ui.wbQuery).split(/\s+/).filter(Boolean);
    const rows = all.filter(w => (ui.wbFilter === 'alle' || w.status === ui.wbFilter) &&
      terms.every(t => norm([w.nummer, w.klant?.naam, w.klant?.gemeente, w.machine?.model, w.machine?.serienummer, w.monteur, w.interventie, w.referentie].join(' ')).includes(t)));
    $('[data-list]').innerHTML = rows.map(w => `
      <a class="list-item" href="#/werkbon/${w.id}">
        <div class="main">
          <div class="title">${esc(w.klant?.naam || 'Geen klant gekozen')}</div>
          <div class="sub">${esc([w.nummer, fmtDate(w.datum), w.interventie, machineLabel(w.machine)].filter(Boolean).join(' · '))}</div>
        </div>
        <div class="meta">
          <span class="badge ${w.status}">${w.status === 'afgerond' ? (w.handtekening ? 'Ondertekend' : 'Afgerond') : 'Concept'}</span>
          <span class="small muted nowrap">${fmtEur(totals(w).excl)} excl.</span>
        </div>
      </a>`).join('') || `<div class="empty">${all.length ? 'Geen werkbonnen gevonden.' : 'Nog geen werkbonnen. Maak je eerste werkbon aan met <b>＋ Nieuwe werkbon</b>.'}</div>`;
  };
  draw();
  $('[data-q]').addEventListener('input', e => { ui.wbQuery = e.target.value; draw(); });
  $$('[data-filter]').forEach(b => b.addEventListener('click', () => {
    ui.wbFilter = b.dataset.filter;
    $$('[data-filter]').forEach(x => x.classList.toggle('active', x === b));
    draw();
  }));
  $('[data-export]').addEventListener('click', () => exportWerkbonnenCsv(all));
}

function exportWerkbonnenCsv(list) {
  const t = App.settings.tarieven;
  const rows = [['Werkbon', 'Datum', 'Status', 'Klantnummer', 'Klant', 'Gemeente', 'Machine', 'Serienummer', 'Monteur', 'Interventie', 'Referentie', 'Artikel', 'Omschrijving', 'Aantal', 'Prijs', '100% korting', 'Totaal excl. BTW', 'Ondertekend door']];
  for (const w of list) {
    const base = [w.nummer, fmtDate(w.datum), w.status, w.klant?.nummer, w.klant?.naam, w.klant?.gemeente, machineLabel(w.machine), w.machine?.serienummer, w.monteur, w.interventie, w.referentie];
    const signer = w.handtekening?.naam || (w.nietOndertekend ? `Niet ondertekend: ${w.nietOndertekend}` : '');
    // A garantie line keeps its price but is not charged
    const line = (code, desc, qty, price, garantie = false) =>
      rows.push([...base, code, desc, csvNum(qty), csvNum(price), garantie ? 'ja' : '', csvNum(garantie ? 0 : qty * price), signer]);
    for (const l of w.onderdelen) line(l.artikelnr, l.omschrijving, parseNum(l.aantal), parseNum(l.prijs), !!l.garantie);
    if (parseNum(w.werkuren)) line(t.codeUren, `Werkuren ${w.interventie || ''}`.trim(), parseNum(w.werkuren), parseNum(w.uurtarief), !!w.werkurenGarantie);
    if (w.aanrijkost.actief) line(t.codeVoorrij, 'Aanrijkost', 1, parseNum(w.aanrijkost.bedrag), !!w.aanrijkost.garantie);
    if (w.brandstoftoeslag.actief) line(t.codeBrandstof, 'Brandstoftoeslag', 1, parseNum(w.brandstoftoeslag.bedrag));
    for (const l of w.extra) line('', l.omschrijving, parseNum(l.aantal), parseNum(l.prijs));
  }
  download(`werkbonnen-${today()}.csv`, toCsv(rows), 'text/csv;charset=utf-8');
}

/* =========================================================================
   View: werkbon editor
   ========================================================================= */
async function viewWerkbon(id) {
  if (id === 'nieuw') {
    const wb = await newWerkbon();
    await Sync.put('werkbonnen', wb);
    location.replace(`#/werkbon/${wb.id}`);
    return;
  }
  const wb = await DB.get('werkbonnen', id);
  if (!wb) { setView('<div class="empty">Deze werkbon bestaat niet (meer). <a href="#/">Terug naar overzicht</a></div>'); return; }
  App.wb = wb;
  // Older concept werkbonnen may still carry another monteur's prefix
  const renumbered = await nummerVoorMonteur(wb);
  renderWerkbon();
  if (renumbered) scheduleSave();
}

// Renumber after the monteur changed; one at a time, and again if it changed meanwhile
let renumbering = null;
function nummerNaMonteurwissel() {
  const wb = App.wb;
  if (!wb || renumbering) return;
  renumbering = nummerVoorMonteur(wb)
    .then(changed => {
      if (!changed || App.wb !== wb) return;
      const h1 = $('.page-head h1');
      if (h1) h1.textContent = `Werkbon ${wb.nummer}`;
      scheduleSave();
    })
    .finally(() => {
      renumbering = null;
      if (App.wb === wb && wb.status === 'concept' && splitNummer(wb.nummer)?.prefix !== prefixVoor(wb.monteur)) nummerNaMonteurwissel();
    });
}

function renderWerkbon() {
  const wb = App.wb;
  const locked = wb.status === 'afgerond';
  setView(`
    <div class="page-head">
      <div>
        <h1>Werkbon ${esc(wb.nummer)}</h1>
        <div class="muted small">Aangemaakt ${esc(fmtDateTime(wb.aangemaakt))}</div>
      </div>
      <div class="actions">
        <button type="button" class="btn small" data-action="duplicate">Dupliceren</button>
        <button type="button" class="btn small danger" data-action="delete">Verwijderen</button>
      </div>
    </div>
    ${locked ? `<div class="locked-note"><span>✓ Deze werkbon is afgerond${wb.handtekening ? ` en ondertekend door <b>${esc(wb.handtekening.naam)}</b>` : ''}. Hij kan niet meer gewijzigd worden.</span><button type="button" class="btn small" data-action="reopen">Heropenen</button></div>
    <section class="card docs"><h2>Documenten</h2>
      <div class="doc-buttons">
        <button type="button" class="btn primary doc" data-action="print"><span class="doc-icon" aria-hidden="true">📄</span><span><b>Werkbon</b><br><span class="small">PDF met de handtekening van de klant</span></span></button>
        <button type="button" class="btn doc" data-action="proforma"><span class="doc-icon" aria-hidden="true">🧾</span><span><b>Pro forma-factuur</b><br><span class="small">Kosten van het bezoek met prijzen en BTW (PDF)</span></span></button>
      </div>
      <p class="small muted" style="margin:10px 0 0">Je krijgt een PDF-bestand. Open het om het te bewaren of af te drukken, of deel het meteen.</p>
    </section>` : ''}
    <fieldset id="wb-form" ${locked ? 'disabled' : ''} style="border:0;padding:0;margin:0;min-width:0">
      ${secKlant()}
      ${secBezoek()}
      ${secWerk()}
      ${secOnderdelen()}
      ${secKosten()}
    </fieldset>
    ${secHandtekening()}
    <div class="status-bar"><div class="inner">
      <span class="badge ${wb.status}">${locked ? (wb.handtekening ? 'Ondertekend' : 'Afgerond') : 'Concept'}</span>
      <span class="total" data-amount="bar">${fmtEur(totals(wb).incl)}</span><span class="muted small hide-sm">incl. BTW</span>
      <span class="spacer"></span>
      <span class="saved hide-sm" id="saved"></span>
      <a class="btn hide-sm" href="#/">Overzicht</a>
      ${locked ? '<button type="button" class="btn hide-sm" data-action="proforma">Pro forma</button>' : ''}
      <button type="button" class="btn primary" data-action="print">${locked ? 'Werkbon' : 'PDF'}</button>
    </div></div>`);
  bindWerkbon();
}

const sec = (id, title, step, inner) => `<section class="card" data-sec="${id}"><h2>${title}${step ? `<span class="step">${step}</span>` : ''}</h2>${inner}</section>`;

function secKlant() {
  const wb = App.wb;
  let klantHtml;
  if (wb.klant) {
    klantHtml = `<div class="picked">
      <div><div class="who">${esc(wb.klant.naam)}${wb.klant.nummer ? ` <span class="muted small">#${esc(wb.klant.nummer)}</span>` : ''}</div>
      <div class="addr">${esc(klantAdres(wb.klant))}</div>
      ${wb.klant.contact || wb.klant.telefoon || wb.klant.email ? `<div class="addr">${esc([wb.klant.contact, wb.klant.telefoon, wb.klant.email].filter(Boolean).join(' · '))}</div>` : ''}
      ${klantUren(klantById(wb.klantId) || wb.klant) ? `<div class="addr">🕘 ${esc(klantUren(klantById(wb.klantId) || wb.klant))}</div>` : ''}</div>
      <button type="button" class="btn small" data-action="pick-klant">Wijzig</button>
    </div>`;
  } else {
    klantHtml = `<button type="button" class="btn primary" data-action="pick-klant" style="width:100%">Kies klant</button>`;
  }
  let machineHtml = '';
  if (wb.klant) {
    const ms = wb.klantId ? machinesOf(wb.klantId) : [];
    const known = ms.some(m => m.id === wb.machineId);
    machineHtml = `
      <div class="grid two" style="margin-top:12px">
        <label class="field full"><span>Machine</span>
          <select data-machine>
            <option value="">— Geen machine —</option>
            ${ms.map(m => `<option value="${esc(m.id)}" ${m.id === wb.machineId ? 'selected' : ''}>${esc(`${m.soort ? m.soort + ': ' : ''}${m.model}${m.serienummer ? ' — SN ' + m.serienummer : ''}`)}</option>`).join('')}
            ${wb.machine && !known ? `<option value="__snap" selected>${esc(machineLabel(wb.machine))} — SN ${esc(wb.machine.serienummer)}</option>` : ''}
            <option value="__new">＋ Nieuwe machine toevoegen…</option>
          </select>
        </label>
      </div>`;
  }
  return sec('klant', 'Klant & machine', '1', klantHtml + machineHtml);
}

function secBezoek() {
  const wb = App.wb;
  const s = App.settings;
  const opts = (list, cur) => {
    const all = cur && !list.includes(cur) ? [cur, ...list] : list;
    return `<option value="">—</option>` + all.map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  };
  return sec('bezoek', 'Bezoek', '2', `
    <div class="grid">
      <label class="field"><span>Datum</span><input type="date" data-f="datum" value="${esc(wb.datum)}"></label>
      <label class="field"><span>Starttijd</span><input type="time" data-f="starttijd" value="${esc(wb.starttijd)}"></label>
      <label class="field"><span>Eindtijd</span><input type="time" data-f="eindtijd" value="${esc(wb.eindtijd)}"></label>
      <label class="field"><span>Monteur</span><select data-f="monteur">${opts(monteurNamen(), wb.monteur)}</select></label>
      <label class="field"><span>Type interventie</span><select data-f="interventie">${opts(s.interventietypes, wb.interventie)}</select></label>
      <label class="field"><span>Referentie klant / PO</span><input data-f="referentie" value="${esc(wb.referentie)}"></label>
    </div>`);
}

function secWerk() {
  const wb = App.wb;
  return sec('werk', 'Uitgevoerde werken', '3', `
    <div class="grid two">
      <label class="field full"><span>Melding / aanleiding</span><input data-f="melding" value="${esc(wb.melding)}" placeholder="Wat meldde de klant?"></label>
      <label class="field full"><span>Bevindingen</span><textarea data-f="bevindingen" rows="3" placeholder="Wat heb je vastgesteld?">${esc(wb.bevindingen)}</textarea></label>
      <label class="field full"><span>Uitgevoerde werkzaamheden *</span><textarea data-f="werkzaamheden" rows="5" placeholder="Beschrijf de uitgevoerde werken">${esc(wb.werkzaamheden)}</textarea></label>
    </div>
    ${App.settings.snelteksten.length ? `<div class="row" style="margin-top:8px"><span class="label">Snel toevoegen:</span>
      ${App.settings.snelteksten.map(t => `<button type="button" class="btn small" data-action="quick-text" data-text="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}`);
}

function secOnderdelen() {
  const wb = App.wb;
  const rows = wb.onderdelen.map((l, i) => `
    <tr>
      <td class="desc">
        <input data-f="onderdelen.${i}.omschrijving" value="${esc(l.omschrijving)}" aria-label="Omschrijving">
        ${l.artikelnr ? `<div class="code">${esc(l.artikelnr)}</div>` : ''}
        ${garantieCheck(`onderdelen.${i}.garantie`, l.garantie)}
      </td>
      <td class="num w-qty"><input inputmode="decimal" data-f="onderdelen.${i}.aantal" data-t="num" value="${esc(numVal(l.aantal))}" aria-label="Aantal"></td>
      <td class="num w-price"><input inputmode="decimal" data-f="onderdelen.${i}.prijs" data-t="num" value="${esc(numVal(l.prijs))}" aria-label="Prijs"></td>
      <td class="w-total" data-amount="onderdelen.${i}">${fmtEur(parseNum(l.aantal) * parseNum(l.prijs))}</td>
      <td class="w-del"><button type="button" class="btn icon ghost" data-action="del-line" data-list="onderdelen" data-i="${i}" aria-label="Verwijderen">✕</button></td>
    </tr>`).join('');
  return sec('onderdelen', 'Gebruikte onderdelen', '4', `
    ${wb.onderdelen.length ? `<table class="lines">
      <thead><tr><th>Omschrijving</th><th class="right">Aantal</th><th class="right">Prijs/st</th><th class="right">Totaal</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>` : '<p class="muted" style="margin:0 0 8px">Nog geen onderdelen toegevoegd.</p>'}
    <div class="row" style="margin-top:12px">
      <button type="button" class="btn primary" data-action="pick-part">＋ Onderdeel uit lijst</button>
      <button type="button" class="btn" data-action="add-free-part">＋ Vrije regel</button>
    </div>`);
}

// Checkbox for 100% korting (garantie) on a parts line, the werkuren or the aanrijkost
const garantieCheck = (path, checked) =>
  `<label class="check garantie-check"><input type="checkbox" data-f="${path}" ${checked ? 'checked' : ''}> 100% korting</label>`;

function secKosten() {
  const wb = App.wb;
  const t = totals(wb);
  const auto = !wb.werkurenHandmatig && wb.eindtijd ? '<span class="muted small">berekend uit start- en eindtijd</span>' : '';
  const extra = wb.extra.map((l, i) => `
    <div class="cost-row">
      <input class="lbl" data-f="extra.${i}.omschrijving" value="${esc(l.omschrijving)}" placeholder="Omschrijving">
      <input inputmode="decimal" data-f="extra.${i}.aantal" data-t="num" value="${esc(numVal(l.aantal))}" aria-label="Aantal">
      <input inputmode="decimal" data-f="extra.${i}.prijs" data-t="num" value="${esc(numVal(l.prijs))}" aria-label="Prijs">
      <div class="amount"><span data-amount="extra.${i}">${fmtEur(parseNum(l.aantal) * parseNum(l.prijs))}</span>
        <button type="button" class="btn icon ghost" data-action="del-line" data-list="extra" data-i="${i}" aria-label="Verwijderen">✕</button></div>
    </div>`).join('');
  return sec('kosten', 'Werkuren & kosten', '5', `
    <div class="cost-row head" style="padding-top:0">
      <span class="label lbl">&nbsp;</span><span class="label right">Aantal / uren</span><span class="label right">Tarief</span><span class="label right">Bedrag</span>
    </div>
    <div class="cost-row">
      <div class="lbl"><b>Werkuren</b><br>${auto}${garantieCheck('werkurenGarantie', wb.werkurenGarantie)}</div>
      <input inputmode="decimal" data-f="werkuren" data-t="num" value="${esc(numVal(wb.werkuren))}" aria-label="Werkuren">
      <input inputmode="decimal" data-f="uurtarief" data-t="num" value="${esc(numVal(wb.uurtarief))}" aria-label="Uurtarief">
      <div class="amount" data-amount="arbeid">${fmtEur(t.arbeid)}</div>
    </div>
    <div class="cost-row">
      <div class="lbl"><label class="check"><input type="checkbox" data-f="aanrijkost.actief" ${wb.aanrijkost.actief ? 'checked' : ''}> <b>Aanrijkost</b></label>
        ${garantieCheck('aanrijkost.garantie', wb.aanrijkost.garantie)}</div>
      <span></span>
      <input inputmode="decimal" data-f="aanrijkost.bedrag" data-t="num" value="${esc(numVal(wb.aanrijkost.bedrag))}" aria-label="Aanrijkost">
      <div class="amount" data-amount="aanrijkost">${fmtEur(wb.aanrijkost.actief ? parseNum(wb.aanrijkost.bedrag) : 0)}</div>
    </div>
    <div class="cost-row">
      <label class="check lbl"><input type="checkbox" data-f="brandstoftoeslag.actief" ${wb.brandstoftoeslag.actief ? 'checked' : ''}> <b>Brandstoftoeslag</b></label>
      <span></span>
      <input inputmode="decimal" data-f="brandstoftoeslag.bedrag" data-t="num" value="${esc(numVal(wb.brandstoftoeslag.bedrag))}" aria-label="Brandstoftoeslag">
      <div class="amount" data-amount="brandstof">${fmtEur(wb.brandstoftoeslag.actief ? parseNum(wb.brandstoftoeslag.bedrag) : 0)}</div>
    </div>
    ${extra}
    <div class="row" style="margin:12px 0 16px"><button type="button" class="btn" data-action="add-extra">＋ Extra kost</button></div>
    <div class="totals" data-totals>${totalsHtml(t)}</div>`);
}

function totalsHtml(t) {
  const wb = App.wb;
  return `
    <span>Onderdelen</span><span class="right">${fmtEur(t.onderdelen)}</span>
    <span>Werkuren</span><span class="right">${fmtEur(t.arbeid)}</span>
    <span>Verplaatsing</span><span class="right">${fmtEur(t.verplaatsing)}</span>
    ${t.overige ? `<span>Overige</span><span class="right">${fmtEur(t.overige)}</span>` : ''}
    ${t.garantie ? `<span>Subtotaal</span><span class="right">${fmtEur(t.bruto)}</span>
    <span class="garantie">100% korting</span><span class="garantie right">− ${fmtEur(t.garantie)}</span>` : ''}
    <span><b>Totaal excl. BTW</b></span><span class="right"><b>${fmtEur(t.excl)}</b></span>
    <span>BTW ${fmtNum(parseNum(wb.btw))}%</span><span class="right">${fmtEur(t.btw)}</span>
    <span class="grand">Totaal incl. BTW</span><span class="grand right">${fmtEur(t.incl)}</span>`;
}

function secHandtekening() {
  const wb = App.wb;
  let inner;
  if (wb.handtekening) {
    inner = `<div class="sig-preview">
      <img src="${wb.handtekening.beeld}" alt="Handtekening van ${esc(wb.handtekening.naam)}">
      <div style="margin-top:8px"><b>${esc(wb.handtekening.naam)}</b> <span class="muted small">— ondertekend op ${esc(fmtDateTime(wb.handtekening.datum))}</span></div>
    </div>`;
  } else if (wb.status === 'afgerond') {
    inner = `<div class="sig-preview">☑ Niet ondertekend: <b>${esc(wb.nietOndertekend)}</b> <span class="muted small">(${esc(fmtDateTime(wb.afgerondOp))})</span></div>`;
  } else {
    inner = `<p class="muted" style="margin-top:0">Laat de klant de werkbon nakijken en ondertekenen om de uitgevoerde werken goed te keuren.</p>
      <div class="row">
        <button type="button" class="btn success" data-action="sign" style="flex:1;min-width:220px">✍ Laat klant ondertekenen</button>
        <button type="button" class="btn" data-action="finish-unsigned">Afronden zonder handtekening</button>
      </div>`;
  }
  return sec('handtekening', 'Akkoord klant', '6', inner);
}

function refreshSection(id) {
  const fns = { klant: secKlant, bezoek: secBezoek, werk: secWerk, onderdelen: secOnderdelen, kosten: secKosten, handtekening: secHandtekening };
  const el = $(`[data-sec="${id}"]`);
  if (el) el.outerHTML = fns[id]();
  updateAmounts();
}

function updateAmounts() {
  const wb = App.wb;
  if (!wb) return;
  const t = totals(wb);
  const set = (key, val) => { const el = $(`[data-amount="${key}"]`); if (el) el.textContent = fmtEur(val); };
  wb.onderdelen.forEach((l, i) => set(`onderdelen.${i}`, parseNum(l.aantal) * parseNum(l.prijs)));
  wb.extra.forEach((l, i) => set(`extra.${i}`, parseNum(l.aantal) * parseNum(l.prijs)));
  set('arbeid', t.arbeid);
  set('aanrijkost', wb.aanrijkost.actief ? parseNum(wb.aanrijkost.bedrag) : 0);
  set('brandstof', wb.brandstoftoeslag.actief ? parseNum(wb.brandstoftoeslag.bedrag) : 0);
  set('bar', t.incl);
  const tot = $('[data-totals]');
  if (tot) tot.innerHTML = totalsHtml(t);
}

function bindWerkbon() {
  const root = view();

  const onField = e => {
    const el = e.target.closest('[data-f]');
    if (!el || !App.wb) return;
    const path = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.t === 'num') v = parseNum(v);
    setPath(App.wb, path, v);

    if (path === 'werkuren') App.wb.werkurenHandmatig = true;
    if (path === 'monteur') nummerNaMonteurwissel();
    if ((path === 'starttijd' || path === 'eindtijd') && !App.wb.werkurenHandmatig) {
      const h = hoursBetween(App.wb.starttijd, App.wb.eindtijd);
      if (h != null) {
        App.wb.werkuren = h;
        const inp = $('[data-f="werkuren"]');
        if (inp) inp.value = numVal(h);
      }
    }
    updateAmounts();
    scheduleSave();
  };
  root.addEventListener('input', onField);
  root.addEventListener('change', e => {
    if (e.target.matches('[data-machine]')) return onMachineChange(e.target);
    onField(e);
    // Tidy up number inputs once the user leaves them ("1.50" -> "1,5")
    if (e.target.dataset.t === 'num') e.target.value = numVal(getPath(App.wb, e.target.dataset.f));
  });

  root.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || btn.disabled) return;
    const wb = App.wb;
    switch (btn.dataset.action) {
      case 'pick-klant': return pickKlant();
      case 'pick-part': return pickPart();
      case 'add-free-part':
        wb.onderdelen.push({ artikelnr: '', omschrijving: '', aantal: 1, prijs: 0 });
        refreshSection('onderdelen'); scheduleSave();
        $(`[data-f="onderdelen.${wb.onderdelen.length - 1}.omschrijving"]`)?.focus();
        return;
      case 'add-extra':
        wb.extra.push({ omschrijving: '', aantal: 1, prijs: 0 });
        refreshSection('kosten'); scheduleSave();
        $(`[data-f="extra.${wb.extra.length - 1}.omschrijving"]`)?.focus();
        return;
      case 'del-line':
        wb[btn.dataset.list].splice(+btn.dataset.i, 1);
        refreshSection(btn.dataset.list === 'extra' ? 'kosten' : 'onderdelen'); scheduleSave();
        return;
      case 'quick-text': {
        const ta = $('[data-f="werkzaamheden"]');
        const cur = wb.werkzaamheden.trimEnd();
        wb.werkzaamheden = (cur ? cur + '\n' : '') + btn.dataset.text;
        ta.value = wb.werkzaamheden;
        scheduleSave();
        return;
      }
      case 'sign': return openSignModal();
      case 'finish-unsigned': return openUnsignedModal();
      case 'reopen': {
        if (!confirm('Werkbon heropenen? De handtekening van de klant wordt verwijderd en moet opnieuw gezet worden.')) return;
        Object.assign(wb, { status: 'concept', handtekening: null, nietOndertekend: '', afgerondOp: null });
        // A reopened werkbon gets the number series of its monteur, if it carries another prefix
        const renumbered = await nummerVoorMonteur(wb);
        await saveNow(); renderWerkbon();
        if (!renumbered) toast('Werkbon heropend');
        return;
      }
      case 'print':
        await flushSave();
        return pdfWerkbon(wb, App.settings);
      case 'proforma':
        await flushSave();
        return pdfProforma(wb, App.settings);
      case 'duplicate': {
        await flushSave();
        const copy = await newWerkbon(wb.monteur || undefined);
        Object.assign(copy, {
          klantId: wb.klantId, klant: wb.klant, machineId: wb.machineId, machine: wb.machine,
          interventie: wb.interventie, referentie: wb.referentie,
          onderdelen: clone(wb.onderdelen), uurtarief: wb.uurtarief, aanrijkost: clone(wb.aanrijkost),
          brandstoftoeslag: clone(wb.brandstoftoeslag), extra: clone(wb.extra),
        });
        await Sync.put('werkbonnen', copy);
        location.hash = `#/werkbon/${copy.id}`;
        toast(`Kopie ${copy.nummer} aangemaakt`);
        return;
      }
      case 'delete':
        if (!confirm(`Werkbon ${wb.nummer} definitief verwijderen?`)) return;
        clearTimeout(saveTimer); saveTimer = null;
        await Sync.del('werkbonnen', wb.id);
        App.wb = null;
        location.hash = '#/';
        toast('Werkbon verwijderd');
        return;
    }
  });
}

function pickKlant() {
  openPicker({
    title: 'Kies klant',
    items: App.klanten,
    haystack: k => [k.naam, k.nummer, k.gemeente, k.groep, k.adres, k.postcode].join(' '),
    render: k => `<div class="main"><div class="title">${esc(k.naam)}</div><div class="sub">${esc([k.gemeente, k.groep, k.nummer && '#' + k.nummer].filter(Boolean).join(' · '))}</div></div>
      <div class="meta small muted">${machinesOf(k.id).length} machine(s)</div>`,
    extraButton: { label: '＋ Nieuwe klant', onClick: () => openKlantModal(null, setKlant) },
    onPick: setKlant,
  });
}

function setKlant(k) {
  const wb = App.wb;
  if (!wb) return;
  wb.klantId = k.id;
  wb.klant = snapKlant(k);
  const ms = machinesOf(k.id);
  wb.machineId = ms.length === 1 ? ms[0].id : null;
  wb.machine = ms.length === 1 ? snapMachine(ms[0]) : null;
  refreshSection('klant');
  scheduleSave();
}

function onMachineChange(select) {
  const wb = App.wb;
  const v = select.value;
  if (v === '__new') {
    select.value = wb.machineId || '';
    openMachineModal(wb.klantId, null, mc => {
      wb.machineId = mc.id; wb.machine = snapMachine(mc);
      refreshSection('klant'); scheduleSave();
    });
    return;
  }
  if (v === '__snap') return;
  const m = App.machines.find(x => x.id === v);
  wb.machineId = m ? m.id : null;
  wb.machine = m ? snapMachine(m) : null;
  scheduleSave();
}

function pickPart() {
  const addLine = l => {
    const wb = App.wb;
    const existing = l.artikelnr && wb.onderdelen.find(x => x.artikelnr === l.artikelnr);
    if (existing) existing.aantal = parseNum(existing.aantal) + 1;
    else wb.onderdelen.push(l);
    refreshSection('onderdelen');
    scheduleSave();
    toast(`${l.omschrijving} toegevoegd`);
  };
  openPicker({
    title: 'Onderdeel toevoegen',
    items: App.onderdelen,
    keepOpen: true,
    haystack: p => `${p.artikelnr} ${p.omschrijving}`,
    render: p => `<div class="main"><div class="title">${esc(p.omschrijving)}</div><div class="sub">${esc(p.artikelnr)}</div></div><div class="meta nowrap">${fmtEur(p.prijs)}</div>`,
    onPick: p => addLine({ artikelnr: p.artikelnr, omschrijving: p.omschrijving, aantal: 1, prijs: p.prijs }),
    freeText: { label: q => `"${q}" toevoegen als vrije regel`, onClick: q => addLine({ artikelnr: '', omschrijving: q, aantal: 1, prijs: 0 }) },
  });
}

function validateForSigning(wb) {
  if (!wb.klant) { toast('Kies eerst een klant'); $('[data-sec="klant"]').scrollIntoView({ behavior: 'smooth' }); return false; }
  if (!wb.werkzaamheden.trim()) {
    toast('Beschrijf eerst de uitgevoerde werkzaamheden');
    const ta = $('[data-f="werkzaamheden"]');
    ta.scrollIntoView({ behavior: 'smooth', block: 'center' }); ta.focus();
    return false;
  }
  return true;
}

// When the end time is still empty at sign-off, use "now" and recalculate the hours
function fillEndTime(wb) {
  if (wb.eindtijd) return;
  wb.eindtijd = nowTime();
  const el = $('[data-f="eindtijd"]');
  if (el) el.value = wb.eindtijd;
  if (!wb.werkurenHandmatig) {
    const h = hoursBetween(wb.starttijd, wb.eindtijd);
    if (h != null) wb.werkuren = h;
    const inp = $('[data-f="werkuren"]');
    if (inp) inp.value = numVal(wb.werkuren);
  }
  updateAmounts();
  scheduleSave();
}

function openSignModal() {
  const wb = App.wb;
  if (!validateForSigning(wb)) return;
  fillEndTime(wb);
  const t = totals(wb);
  const showPrices = App.settings.prijzenOpWerkbon;
  const m = openModal({
    title: 'Akkoord klant',
    wide: true,
    dismissable: false,
    body: `
      <div class="sign-summary">
        <div class="row-sum"><b>${esc(wb.klant.naam)}</b><span>${esc(wb.nummer)} · ${esc(fmtDate(wb.datum))}</span></div>
        ${wb.machine ? `<div>${esc(machineLabel(wb.machine))}${wb.machine.serienummer ? ' — SN ' + esc(wb.machine.serienummer) : ''}</div>` : ''}
        <div style="white-space:pre-line;margin:8px 0">${esc(wb.werkzaamheden)}</div>
        <div class="row-sum"><span>${wb.onderdelen.length} onderdeel/onderdelen · ${fmtNum(parseNum(wb.werkuren))} u werk</span>${showPrices ? `<b>${fmtEur(t.incl)} incl. BTW</b>` : ''}</div>
      </div>
      <label class="field" style="margin-bottom:12px"><span>Naam ondertekenaar *</span><input data-name value="${esc(wb.klant.contact || '')}" autocomplete="name"></label>
      <div class="sig-wrap"><canvas></canvas><div class="baseline"></div><div class="hint">Teken hier met je vinger of pen</div></div>
      <p class="small muted">${esc(App.settings.voorwaarden)}</p>`,
    foot: `<button type="button" class="btn" data-clear>Wissen</button><span class="spacer"></span>
      <button type="button" class="btn" data-close>Annuleren</button>
      <button type="button" class="btn success" data-ok disabled>Akkoord en ondertekenen</button>`,
  });
  const pad = new SignaturePad($('canvas', m.el));
  const ok = $('[data-ok]', m.el);
  const nameInput = $('[data-name]', m.el);
  const check = () => { ok.disabled = pad.isEmpty() || !nameInput.value.trim(); };
  pad.onChange = check;
  nameInput.addEventListener('input', check);
  $('[data-clear]', m.el).addEventListener('click', () => pad.clear());
  ok.addEventListener('click', async () => {
    const now = new Date().toISOString();
    Object.assign(wb, {
      handtekening: { naam: nameInput.value.trim(), beeld: pad.toDataURL(), datum: now },
      status: 'afgerond', afgerondOp: now, nietOndertekend: '',
    });
    if (!wb.eindtijd) wb.eindtijd = nowTime();
    pad.destroy();
    m.close();
    await saveNow();
    renderWerkbon();
    toast('Werkbon ondertekend ✓');
  });
  check();
}

function openUnsignedModal() {
  const wb = App.wb;
  if (!validateForSigning(wb)) return;
  const reasons = ['Klant niet aanwezig', 'Klant weigert te ondertekenen', 'Ondertekening later (op afstand)'];
  const m = openModal({
    title: 'Afronden zonder handtekening',
    body: `<p class="muted" style="margin-top:0">Kies de reden. Deze wordt op de werkbon vermeld.</p>
      <div class="list">${reasons.map((r, i) => `<label class="check"><input type="radio" name="r" value="${esc(r)}" ${i === 0 ? 'checked' : ''}> ${esc(r)}</label>`).join('')}
      <label class="check"><input type="radio" name="r" value="__other"> Andere: <input data-other style="flex:1"></label></div>`,
    foot: '<button type="button" class="btn" data-close>Annuleren</button><button type="button" class="btn primary" data-ok>Afronden</button>',
  });
  $('[data-other]', m.el).addEventListener('focus', () => { $('[value="__other"]', m.el).checked = true; });
  $('[data-ok]', m.el).addEventListener('click', async () => {
    let r = $('[name=r]:checked', m.el).value;
    if (r === '__other') r = $('[data-other]', m.el).value.trim();
    if (!r) { toast('Vul een reden in'); return; }
    const now = new Date().toISOString();
    fillEndTime(wb);
    Object.assign(wb, { status: 'afgerond', nietOndertekend: r, handtekening: null, afgerondOp: now });
    m.close();
    await saveNow();
    renderWerkbon();
    toast('Werkbon afgerond');
  });
}

/* =========================================================================
   View: klanten
   ========================================================================= */
async function viewKlanten() {
  const ui = App.ui;
  setView(`
    <div class="page-head">
      <h1>Klanten <span class="muted small">(${App.klanten.length})</span></h1>
      <div class="actions">
        <button type="button" class="btn" data-import>Importeren (CSV)</button>
        <button type="button" class="btn" data-export>Exporteren</button>
        <button type="button" class="btn primary" data-new>＋ Nieuwe klant</button>
      </div>
    </div>
    <div class="toolbar"><div class="search"><input type="search" placeholder="Zoek op naam, gemeente, klantnummer…" value="${esc(ui.klantQuery)}" data-q></div></div>
    <div class="list" data-list></div>`);
  const draw = () => {
    const terms = norm(ui.klantQuery).split(/\s+/).filter(Boolean);
    const rows = App.klanten.filter(k => terms.every(t => norm([k.naam, k.gemeente, k.nummer, k.groep, k.postcode].join(' ')).includes(t))).slice(0, 200);
    $('[data-list]').innerHTML = rows.map(k => `
      <a class="list-item" href="#/klant/${encodeURIComponent(k.id)}">
        <div class="main"><div class="title">${esc(k.naam)}</div><div class="sub">${esc([k.gemeente, k.groep, k.nummer && '#' + k.nummer].filter(Boolean).join(' · '))}</div></div>
        <div class="meta small muted">${machinesOf(k.id).length} machine(s)</div>
      </a>`).join('') || '<div class="empty">Geen klanten gevonden.</div>';
  };
  draw();
  $('[data-q]').addEventListener('input', e => { ui.klantQuery = e.target.value; draw(); });
  $('[data-new]').addEventListener('click', () => openKlantModal(null, k => (location.hash = `#/klant/${k.id}`)));
  $('[data-export]').addEventListener('click', () => {
    const cols = ['nummer', 'naam', 'groep', 'adres', 'postcode', 'gemeente', 'land', 'contact', 'telefoon', 'email', 'btw'];
    download(`klanten-${today()}.csv`, toCsv([cols, ...App.klanten.map(k => cols.map(c => k[c]))]), 'text/csv;charset=utf-8');
  });
  $('[data-import]').addEventListener('click', importKlanten);
}

async function importKlanten() {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  const objs = csvToObjects(await file.text(), {
    nummer: ['nummer', 'klantnummer', 'klantnr', 'customer', 'klant nr'],
    naam: ['naam', 'name', 'klant', 'klantnaam'],
    groep: ['groep', 'klantgroep'],
    adres: ['adres', 'address', 'adress', 'straat'],
    postcode: ['postcode', 'zip', 'zip code', 'zipcode'],
    gemeente: ['gemeente', 'stad', 'plaats', 'city', 'woonplaats'],
    land: ['land', 'country'],
    contact: ['contact', 'contactpersoon'],
    telefoon: ['telefoon', 'tel', 'phone', 'gsm'],
    email: ['email', 'e-mail', 'mail'],
    btw: ['btw', 'btw-nummer', 'btw nummer', 'btw-nr', 'btwnr', 'vat', 'ondernemingsnummer'],
  }).filter(o => o.naam);
  if (!objs.length) { toast('Geen klanten gevonden. De eerste rij moet kolomnamen bevatten, bv. naam;adres;postcode;gemeente'); return; }
  let added = 0, updated = 0;
  const out = objs.map(o => {
    const match = App.klanten.find(k => (o.nummer && k.nummer === o.nummer) || norm(k.naam) === norm(o.naam));
    if (match) { updated++; return { ...match, ...Object.fromEntries(Object.entries(o).filter(([, v]) => v)) }; }
    added++;
    return { id: uid(), nummer: '', groep: '', adres: '', postcode: '', gemeente: '', land: 'BE', contact: '', telefoon: '', email: '', ...o };
  });
  await Sync.bulkPut('klanten', out);
  await loadCache();
  toast(`${added} klant(en) toegevoegd, ${updated} bijgewerkt`);
  viewKlanten();
}

async function viewKlant(id) {
  const k = klantById(id);
  if (!k) { setView('<div class="empty">Klant niet gevonden. <a href="#/klanten">Terug</a></div>'); return; }
  const wbs = (await DB.getAll('werkbonnen')).filter(w => w.klantId === id).sort((a, b) => b.datum.localeCompare(a.datum));
  const ms = machinesOf(id);
  setView(`
    <div class="page-head">
      <div><a href="#/klanten" class="small">← Klanten</a><h1>${esc(k.naam)}</h1></div>
      <div class="actions">
        <button type="button" class="btn danger" data-del>Verwijderen</button>
        <button type="button" class="btn" data-edit>Bewerken</button>
        <button type="button" class="btn primary" data-wb>＋ Werkbon voor deze klant</button>
      </div>
    </div>
    <section class="card"><h2>Gegevens</h2>
      <div class="grid two">
        <div><div class="label">Adres</div><div style="white-space:pre-line">${esc(klantAdres(k)) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">Contact</div><div>${esc([k.contact, k.telefoon, k.email].filter(Boolean).join(' · ')) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">Klantnummer</div><div>${esc(k.nummer) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">Klantgroep</div><div>${esc(k.groep) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">BTW-nummer</div><div>${esc(k.btw) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">Openingsuren</div><div>${esc(k.openingsuren) || '<span class="muted">—</span>'}</div></div>
        <div><div class="label">Sluitingsdag(en)</div><div>${esc(k.sluitingsdag) || '<span class="muted">—</span>'}</div></div>
      </div>
    </section>
    <section class="card"><h2>Machines <button type="button" class="btn small" data-add-machine>＋ Machine</button></h2>
      <div class="list">${ms.map(m => `
        <div class="list-item" data-machine="${esc(m.id)}">
          <div class="main"><div class="title">${esc(machineLabel(m))}</div><div class="sub">${esc([m.soort, m.serienummer && 'SN ' + m.serienummer].filter(Boolean).join(' · '))}</div></div>
          <button type="button" class="btn small danger" data-del-machine="${esc(m.id)}">Verwijderen</button>
        </div>`).join('') || '<div class="muted">Nog geen machines.</div>'}</div>
    </section>
    <section class="card"><h2>Werkbonnen</h2>
      <div class="list">${wbs.map(w => `
        <a class="list-item" href="#/werkbon/${w.id}"><div class="main"><div class="title">${esc(w.nummer)} · ${esc(fmtDate(w.datum))}</div>
        <div class="sub">${esc([w.interventie, machineLabel(w.machine), w.werkzaamheden.split('\n')[0]].filter(Boolean).join(' · '))}</div></div>
        <span class="badge ${w.status}">${w.status === 'afgerond' ? 'Afgerond' : 'Concept'}</span></a>`).join('') || '<div class="muted">Nog geen werkbonnen op dit toestel.</div>'}</div>
    </section>`);
  $('[data-edit]').addEventListener('click', () => openKlantModal(k, () => viewKlant(id)));
  $('[data-add-machine]').addEventListener('click', () => openMachineModal(id, null, () => viewKlant(id)));
  $$('[data-machine]').forEach(el => el.addEventListener('click', e => {
    if (e.target.closest('[data-del-machine]')) return;
    openMachineModal(id, App.machines.find(m => m.id === el.dataset.machine), () => viewKlant(id));
  }));
  $$('[data-del-machine]').forEach(b => b.addEventListener('click', async () => {
    if (!confirm('Machine verwijderen? Bestaande werkbonnen behouden hun gegevens.')) return;
    await Sync.del('machines', b.dataset.delMachine);
    await loadCache();
    viewKlant(id);
  }));
  $('[data-del]').addEventListener('click', async () => {
    if (!confirm(`Klant ${k.naam} en zijn machines verwijderen? Bestaande werkbonnen behouden hun gegevens.`)) return;
    for (const m of ms) await Sync.del('machines', m.id);
    await Sync.del('klanten', id);
    await loadCache();
    location.hash = '#/klanten';
  });
  $('[data-wb]').addEventListener('click', async () => {
    const wb = await newWerkbon();
    wb.klantId = k.id; wb.klant = snapKlant(k);
    if (ms.length === 1) { wb.machineId = ms[0].id; wb.machine = snapMachine(ms[0]); }
    await Sync.put('werkbonnen', wb);
    location.hash = `#/werkbon/${wb.id}`;
  });
}

/* =========================================================================
   View: onderdelen
   ========================================================================= */
async function viewOnderdelen() {
  const ui = App.ui;
  setView(`
    <div class="page-head">
      <h1>Onderdelen <span class="muted small">(${App.onderdelen.length})</span></h1>
      <div class="actions">
        <button type="button" class="btn" data-import>Importeren (CSV)</button>
        <button type="button" class="btn" data-export>Exporteren</button>
        <button type="button" class="btn primary" data-new>＋ Nieuw onderdeel</button>
      </div>
    </div>
    <div class="toolbar"><div class="search"><input type="search" placeholder="Zoek op artikelnummer of omschrijving…" value="${esc(ui.partQuery)}" data-q></div></div>
    <div class="list" data-list></div>`);
  const draw = () => {
    const terms = norm(ui.partQuery).split(/\s+/).filter(Boolean);
    const rows = App.onderdelen.filter(p => terms.every(t => norm(p.artikelnr + ' ' + p.omschrijving).includes(t))).slice(0, 300);
    $('[data-list]').innerHTML = rows.map(p => `
      <div class="list-item" data-id="${esc(p.id)}">
        <div class="main"><div class="title">${esc(p.omschrijving)}</div><div class="sub">${esc(p.artikelnr)}</div></div>
        <div class="meta nowrap">${fmtEur(p.prijs)}</div>
      </div>`).join('') || '<div class="empty">Geen onderdelen gevonden.</div>';
  };
  draw();
  $('[data-q]').addEventListener('input', e => { ui.partQuery = e.target.value; draw(); });
  $('[data-list]').addEventListener('click', e => {
    const row = e.target.closest('[data-id]');
    if (row) openOnderdeelModal(App.onderdelen.find(p => p.id === row.dataset.id), () => viewOnderdelen());
  });
  $('[data-new]').addEventListener('click', () => openOnderdeelModal(null, () => viewOnderdelen()));
  $('[data-export]').addEventListener('click', () => {
    download(`onderdelen-${today()}.csv`, toCsv([['artikelnr', 'omschrijving', 'prijs'], ...App.onderdelen.map(p => [p.artikelnr, p.omschrijving, csvNum(p.prijs)])]), 'text/csv;charset=utf-8');
  });
  $('[data-import]').addEventListener('click', async () => {
    const file = await pickFile('.csv,text/csv');
    if (!file) return;
    const objs = csvToObjects(await file.text(), {
      artikelnr: ['artikelnr', 'artikelnummer', 'artikel', 'item', 'code', 'artnr'],
      omschrijving: ['omschrijving', 'description', 'naam', 'benaming'],
      prijs: ['prijs', 'price', 'verkoopprijs', 'eenheidsprijs', 'prijs excl', 'prijs excl. btw'],
    }).filter(o => o.artikelnr && o.omschrijving);
    if (!objs.length) { toast('Geen onderdelen gevonden. Kolommen nodig: artikelnr;omschrijving;prijs'); return; }
    await Sync.bulkPut('onderdelen', objs.map(o => ({ id: o.artikelnr, artikelnr: o.artikelnr, omschrijving: o.omschrijving, prijs: round2(parseNum(o.prijs)), eenheid: 'st' })));
    await loadCache();
    toast(`${objs.length} onderdeel/onderdelen geïmporteerd`);
    viewOnderdelen();
  });
}

/* =========================================================================
   Aanmelden (monteur kiezen), top bar & sync status
   ========================================================================= */
function openAanmelden(onDone) {
  const s = App.settings;
  const list = actieveMonteurs();
  const needCode = centraalIngesteld() && !s.centraal.teamcode;
  const m = openModal({
    title: 'Wie gebruikt dit toestel?',
    dismissable: !!s.monteurId,
    body: `
      <p class="muted" style="margin-top:0">Kies je naam. Werkbonnen die je op dit toestel maakt, worden op jouw naam naar kantoor gestuurd.</p>
      <label class="field"><span>Monteur</span>
        ${list.length
          ? `<select data-m><option value="">— Kies je naam —</option>${list.map(x => `<option value="${esc(x.id)}" ${x.id === s.monteurId ? 'selected' : ''}>${esc(x.naam)}</option>`).join('')}</select>`
          : `<input data-naam value="${esc(s.mijnNaam)}" placeholder="Je naam">`}
      </label>
      ${needCode ? '<label class="field" style="margin-top:12px"><span>Teamcode (krijg je van kantoor)</span><input data-code autocomplete="off"></label>' : ''}`,
    foot: '<button type="button" class="btn primary" data-ok>Aanmelden</button>',
    onClose: () => { if (!App.settings.monteurId && !App.settings.mijnNaam) setTimeout(() => openAanmelden(onDone), 0); },
  });
  $('[data-ok]', m.el).addEventListener('click', async () => {
    let mt = list.length ? App.monteurs.find(x => x.id === $('[data-m]', m.el).value) : null;
    if (!list.length) {
      const naam = $('[data-naam]', m.el).value.trim();
      if (naam) mt = { id: slug(naam), naam, prefix: initials(naam), beheerder: false, actief: true };
    }
    if (!mt) { toast('Kies je naam'); return; }
    if (needCode) {
      const code = $('[data-code]', m.el).value.trim();
      if (!code) { toast('Vul de teamcode in'); return; }
      s.centraal.teamcode = code;
    }
    if (mt.id !== s.monteurId && mt.prefix) {
      s.nummering.prefix = mt.prefix;
      s.nummering.volgend = Math.max(parseNum(s.nummering.volgend) || 1, await volgendNummer());
    }
    s.monteurId = mt.id;
    s.mijnNaam = mt.naam;
    await saveSettings(true);
    m.close();
    drawTopbar();
    toast(`Aangemeld als ${mt.naam}`);
    Sync.syncNow();
    onDone?.();
  });
}

// Next free sequence number this year. All monteurs share one sequence (WB-2026-0001, JMT-2026-0002,
// TDG-2026-0003, ...); the prefix only shows whose werkbon it is. Looks at this device and, if online,
// the central database.
async function volgendNummer() {
  const jaar = String(new Date().getFullYear());
  let max = 0;
  for (const w of await DB.getAll('werkbonnen')) { const n = splitNummer(w.nummer); if (n && n.jaar === jaar) max = Math.max(max, n.volg); }
  if (Sync.isConfigured() && navigator.onLine) {
    try { max = Math.max(max, await Sync.maxVolgnummer()); } catch { /* offline: local numbers only */ }
  }
  return max + 1;
}

function drawTopbar() {
  const bar = $('.topbar');
  if (!$('#who')) {
    bar.insertAdjacentHTML('beforeend', `<div class="topbar-right">
      <button type="button" class="sync-badge" id="sync-badge" hidden></button>
      <button type="button" class="who" id="who" title="Andere monteur"></button></div>`);
    $('#who').addEventListener('click', () => openAanmelden(() => route()));
    $('#sync-badge').addEventListener('click', () => { Sync.syncNow(); location.hash = '#/instellingen'; });
  }
  $('#who').innerHTML = `<span class="who-name">${esc(App.settings.mijnNaam || 'Aanmelden')}</span>`;
  $('#who').setAttribute('aria-label', `Aangemeld als ${App.settings.mijnNaam || '—'}; andere monteur kiezen`);
  let link = $('.nav a[data-nav="beheer"]');
  if (!link) {
    $('.nav').insertAdjacentHTML('beforeend', '<a href="#/beheer" data-nav="beheer">Beheer</a>');
    link = $('.nav a[data-nav="beheer"]');
  }
  link.hidden = !magBeheren();
  drawSyncStatus();
}

// text: full status (Instellingen), short: compact badge in the top bar
function syncStatusText() {
  const { status, message, pending, lastSync } = Sync.state;
  const wacht = pending ? `${pending} te verzenden` : '';
  const tijd = lastSync ? fmtDateTime(lastSync).slice(-5) : '';
  switch (status) {
    case 'uit': return { cls: 'off', text: 'Geen centrale database ingesteld', short: '' };
    case 'offline': return { cls: 'warn', text: [message || 'Offline', wacht].filter(Boolean).join(' · '), short: `Offline${pending ? ' · ' + pending : ''}` };
    case 'bezig': return { cls: 'busy', text: 'Synchroniseren…', short: '↻' };
    case 'fout': return { cls: 'err', text: `⚠ ${message}${wacht ? ' · ' + wacht : ''}`, short: `⚠${pending ? ' ' + pending : ''}` };
    default: return pending
      ? { cls: 'warn', text: wacht, short: `↑ ${pending}` }
      : { cls: 'ok', text: `✓ Gesynchroniseerd ${tijd}`, short: `✓ ${tijd}` };
  }
}

function drawSyncStatus() {
  const { cls, text, short } = syncStatusText();
  const badge = $('#sync-badge');
  if (badge) {
    badge.hidden = Sync.state.status === 'uit';
    badge.className = `sync-badge ${cls}`;
    badge.textContent = short;
    badge.title = text;
  }
  const el = $('[data-sync-status]');
  if (el) el.textContent = text;
}

Sync.on(async type => {
  if (type === 'status') return drawSyncStatus();
  // New data from the central database: refresh lists, but never re-render the werkbon editor or an open dialog
  await loadCache();
  drawTopbar();
  const hash = location.hash || '#/';
  if (!App.wb && !$('#modal-root').children.length && /^#\/(klanten|klant\/|onderdelen|beheer)/.test(hash)) route();
});

/* =========================================================================
   View: beheer (kantoor)
   ========================================================================= */
async function viewBeheer() {
  if (!magBeheren()) { setView('<div class="empty">Deze pagina is enkel voor beheerders.</div>'); return; }
  const centraal = !centraalUit();
  setView(`
    <div class="page-head">
      <h1>Beheer</h1>
      ${centraal ? '<div class="actions"><button type="button" class="btn" data-upload>Lijsten van dit toestel uploaden</button></div>' : ''}
    </div>
    ${centraal ? `
    ${centraalIngesteld() ? '' : '<div class="locked-note"><span>Er is nog geen centrale database ingesteld. Vul ze in bij <a href="#/instellingen">Instellingen</a>.</span></div>'}
    <p class="small muted" style="margin-top:0">Klanten, machines en onderdelen beheer je via <a href="#/klanten">Klanten</a> en <a href="#/onderdelen">Onderdelen</a>: wijzigingen gaan naar de centrale database en komen zo bij alle monteurs.</p>
    <section class="card"><h2>Werkbonnen van alle monteurs
        <span class="row"><button type="button" class="btn small" data-export-all>Exporteren (CSV)</button><button type="button" class="btn small" data-reload>Vernieuwen</button></span></h2>
      <div class="toolbar"><div class="search"><input type="search" placeholder="Zoek op nummer, klant, monteur…" data-q></div></div>
      <div class="list" data-central><div class="muted">Laden…</div></div>
    </section>` : '<p class="small muted" style="margin-top:0">Er is geen centrale database: monteurs, klanten en werkbonnen staan per toestel. Werkbonnen gaan naar kantoor via PDF of de CSV-export.</p>'}
    <section class="card"><h2>Monteurs <button type="button" class="btn small" data-new-monteur>＋ Monteur</button></h2>
      <div class="list">${App.monteurs.map(m => `
        <div class="list-item" data-monteur="${esc(m.id)}">
          <div class="main"><div class="title">${esc(m.naam)}</div>
            <div class="sub">${esc([`voorvoegsel ${m.prefix || '—'}`, m.beheerder && 'beheerder', m.actief === false && 'niet actief'].filter(Boolean).join(' · '))}</div></div>
        </div>`).join('') || '<div class="muted">Nog geen monteurs.</div>'}</div>
    </section>`);

  let rows = [];
  const draw = () => {
    const terms = norm($('[data-q]').value).split(/\s+/).filter(Boolean);
    const hits = rows.filter(r => terms.every(t => norm([r.nummer, r.klant_naam, r.monteur, r.gewijzigd_door, r.status].join(' ')).includes(t)));
    $('[data-central]').innerHTML = hits.map(r => `
      <div class="list-item" data-wb="${esc(r.id)}" style="cursor:pointer">
        <div class="main"><div class="title">${esc(r.klant_naam || 'Geen klant')}</div>
          <div class="sub">${esc([r.nummer, fmtDate(r.datum), r.monteur || r.gewijzigd_door].filter(Boolean).join(' · '))}</div></div>
        <div class="meta"><span class="badge ${esc(r.status)}">${r.status === 'afgerond' ? 'Afgerond' : 'Concept'}</span>
          <span class="small muted nowrap" title="Ontvangen op ${esc(fmtDateTime(r.bijgewerkt_op))}">↓ ${esc(fmtDateTime(r.bijgewerkt_op).slice(0, 5))} ${esc(fmtDateTime(r.bijgewerkt_op).slice(-5))}</span></div>
      </div>`).join('') || `<div class="empty">${rows.length ? 'Niets gevonden.' : 'Nog geen werkbonnen ontvangen.'}</div>`;
  };
  const load = async () => {
    if (!Sync.isConfigured()) { $('[data-central]').innerHTML = '<div class="muted">Geen centrale database ingesteld (of geen teamcode).</div>'; return; }
    $('[data-central]').innerHTML = '<div class="muted">Laden…</div>';
    try { rows = await Sync.listWerkbonnen(); draw(); }
    catch (e) { $('[data-central]').innerHTML = `<div class="muted">Kon de centrale werkbonnen niet ophalen: ${esc(e.message)}</div>`; }
  };
  $('[data-new-monteur]').addEventListener('click', () => openMonteurModal(null));
  $$('[data-monteur]').forEach(el => el.addEventListener('click', () => openMonteurModal(App.monteurs.find(m => m.id === el.dataset.monteur))));
  if (!centraal) return;
  load();
  $('[data-q]').addEventListener('input', draw);
  $('[data-reload]').addEventListener('click', load);
  $('[data-central]').addEventListener('click', async e => {
    const row = e.target.closest('[data-wb]');
    if (!row) return;
    try {
      const wb = await Sync.fetchWerkbon(row.dataset.wb);
      if (wb) pdfWerkbon(wb, App.settings); else toast('Werkbon niet gevonden');
    } catch (err) { toast(`Ophalen mislukt: ${err.message}`); }
  });
  $('[data-export-all]').addEventListener('click', async () => {
    try { exportWerkbonnenCsv(await Sync.fetchAlleWerkbonnen()); } catch (err) { toast(`Ophalen mislukt: ${err.message}`); }
  });
  $('[data-upload]').addEventListener('click', async () => {
    if (!confirm('Alle monteurs, klanten, machines en onderdelen van dit toestel naar de centrale database sturen? Gebruik dit om een lege centrale database te vullen. Bestaande records met hetzelfde id worden overschreven.')) return;
    const n = await Sync.queueAll(['monteurs', 'klanten', 'machines', 'onderdelen']);
    toast(`${n} records klaar om te verzenden`);
    Sync.syncNow();
  });
}

function openMonteurModal(monteur) {
  const mt = monteur ? clone(monteur) : { id: '', naam: '', prefix: '', beheerder: false, actief: true };
  const m = openModal({
    title: monteur ? 'Monteur bewerken' : 'Nieuwe monteur',
    body: `<form class="grid two" data-form>
      <label class="field"><span>Naam *</span><input name="naam" value="${esc(mt.naam)}"></label>
      <label class="field"><span>Voorvoegsel werkbonnummer *</span><input name="prefix" value="${esc(mt.prefix)}" placeholder="bv. BL"></label>
      <label class="check"><input type="checkbox" name="beheerder" ${mt.beheerder ? 'checked' : ''}> Beheerder (ziet de pagina Beheer)</label>
      <label class="check"><input type="checkbox" name="actief" ${mt.actief !== false ? 'checked' : ''}> Actief (staat in de keuzelijst)</label>
    </form>`,
    foot: '<button type="button" class="btn" data-close>Annuleren</button><button type="button" class="btn primary" data-save>Opslaan</button>',
  });
  $('[data-save]', m.el).addEventListener('click', async () => {
    const f = $('[data-form]', m.el).elements;
    mt.naam = f.naam.value.trim();
    mt.prefix = f.prefix.value.trim().toUpperCase();
    mt.beheerder = f.beheerder.checked;
    mt.actief = f.actief.checked;
    if (!mt.naam || !mt.prefix) { toast('Vul naam en voorvoegsel in'); return; }
    if (App.monteurs.some(x => x.id !== mt.id && x.prefix === mt.prefix)) { toast(`Voorvoegsel ${mt.prefix} is al in gebruik`); return; }
    if (!mt.id) mt.id = (!App.monteurs.some(x => x.id === slug(mt.naam)) && slug(mt.naam)) || uid();
    await Sync.put('monteurs', mt);
    await loadCache();
    m.close();
    drawTopbar();
    viewBeheer();
  });
  setTimeout(() => $('[name=naam]', m.el).focus(), 50);
}

/* =========================================================================
   View: instellingen
   ========================================================================= */
async function viewInstellingen() {
  const s = App.settings;
  const inp = (path, label, attrs = '') => `<label class="field"><span>${label}</span><input data-s="${path}" value="${esc(getPath(s, path))}" ${attrs}></label>`;
  const num = (path, label) => inp(path, label, `inputmode="decimal" data-t="num" value="${esc(numVal(getPath(s, path)))}"`);
  const list = (key, label, hint) => `<label class="field full"><span>${label}</span><textarea data-list="${key}" rows="5">${esc(s[key].join('\n'))}</textarea><span class="small muted">${hint}</span></label>`;
  const counts = { wb: await DB.count('werkbonnen') };

  setView(`
    <div class="page-head"><h1>Instellingen</h1><span class="saved" id="saved"></span></div>

    <section class="card"><h2>Dit toestel</h2>
      <div class="grid">
        <div class="field"><span>Aangemeld als</span>
          <div class="row"><b>${esc(s.mijnNaam || '—')}</b><button type="button" class="btn small" data-wissel>Andere monteur</button></div></div>
        ${inp('nummering.prefix', 'Voorvoegsel werkbonnummer')}
        ${num('nummering.volgend', 'Volgend volgnummer')}
      </div>
      <p class="small muted">Alle monteurs delen één nummerreeks; het voorvoegsel (bv. je initialen) toont van wie de werkbon is. Andere monteurs krijgen hun eigen voorvoegsel uit Beheer. Volgende werkbon van jou: <b>${esc(s.nummering.prefix || 'WB')}-${new Date().getFullYear()}-${String(s.nummering.volgend).padStart(4, '0')}</b></p>
    </section>

    <section class="card"><h2>Bedrijfsgegevens <span class="step">komen bovenaan op de werkbon</span></h2>
      <div class="grid two">
        ${inp('bedrijf.naam', 'Bedrijfsnaam')}
        ${inp('bedrijf.adres', 'Adres')}
        ${inp('bedrijf.postcode', 'Postcode')}${inp('bedrijf.gemeente', 'Gemeente')}
        ${inp('bedrijf.land', 'Land')}${inp('bedrijf.btw', 'BTW-nummer')}
        ${inp('bedrijf.telefoon', 'Telefoon')}${inp('bedrijf.email', 'E-mail')}
        ${inp('bedrijf.website', 'Website')}
        ${inp('bedrijf.iban', 'IBAN')}
        <div class="field"><span>Logo op de werkbon</span>
          <img class="logo-preview" src="${esc(s.bedrijf.logo || DEFAULT_LOGO)}" alt="Logo">
          <div class="row"><button type="button" class="btn small" data-logo>Ander logo</button>
          ${s.bedrijf.logo ? '<button type="button" class="btn small" data-logo-del>Standaardlogo terugzetten</button>' : ''}</div>
        </div>
      </div>
    </section>

    <section class="card"><h2>Tarieven <span class="step">excl. BTW, standaard voor nieuwe werkbonnen</span></h2>
      <div class="grid">
        ${num('tarieven.uurtarief', 'Uurtarief (€/u)')}
        ${num('tarieven.voorrijtarief', 'Aanrijkost (€)')}
        ${num('tarieven.brandstoftoeslag', 'Brandstoftoeslag (€)')}
        ${num('tarieven.btw', 'BTW (%)')}
      </div>
      <details style="margin-top:12px"><summary class="small muted">Artikelcodes voor de export</summary>
        <div class="grid" style="margin-top:8px">
          ${inp('tarieven.codeUren', 'Code werkuren')}${inp('tarieven.codeVoorrij', 'Code aanrijkost')}${inp('tarieven.codeBrandstof', 'Code brandstoftoeslag')}
        </div>
      </details>
    </section>

    <section class="card"><h2>Werkbon</h2>
      <label class="check"><input type="checkbox" data-s="prijzenOpWerkbon" ${s.prijzenOpWerkbon ? 'checked' : ''}> Prijzen en totalen tonen op de werkbon (PDF) en bij het ondertekenen</label>
      <label class="field" style="margin-top:8px"><span>Tekst boven de handtekening</span><textarea data-s="voorwaarden" rows="3">${esc(s.voorwaarden)}</textarea></label>
    </section>

    <section class="card"><h2>Keuzelijsten <span class="step">één per regel</span></h2>
      <div class="grid two">
        ${list('interventietypes', 'Types interventie', 'De eerste is de standaard voor nieuwe werkbonnen.')}
        ${list('snelteksten', 'Snelteksten', 'Knoppen om snel tekst toe te voegen aan de werkzaamheden.')}
        ${list('machinesoorten', 'Soorten machines', 'Suggesties bij het toevoegen van een machine.')}
      </div>
    </section>

    ${centraalUit() ? '' : `<section class="card"><h2>Centrale database <span class="step">Lovable Cloud / Supabase</span></h2>
      <div class="grid two">
        <label class="field full"><span>Project-URL</span><input data-s="centraal.url" value="${esc(s.centraal.url)}" placeholder="${esc(window.WERKBON_CONFIG?.supabaseUrl || 'https://xxxx.supabase.co')}" inputmode="url" autocomplete="off"></label>
        <label class="field"><span>Publieke sleutel (anon key)</span><input data-s="centraal.key" value="${esc(s.centraal.key)}" placeholder="${window.WERKBON_CONFIG?.supabaseKey ? 'uit config.js' : ''}" autocomplete="off"></label>
        <label class="field"><span>Teamcode</span><input data-s="centraal.teamcode" value="${esc(s.centraal.teamcode)}" autocomplete="off"></label>
      </div>
      <p class="small muted">Leeg laten = de waarden uit <code>js/config.js</code>. De teamcode krijg je van kantoor.</p>
      <div class="row"><span data-sync-status class="small"></span><span class="spacer"></span>
        <button type="button" class="btn small" data-test>Verbinding testen</button>
        <button type="button" class="btn small primary" data-sync-now>Nu synchroniseren</button></div>
    </section>`}

    <section class="card"><h2>Gegevens</h2>
      <p class="small muted" style="margin-top:0">Op dit toestel: ${counts.wb} werkbonnen, ${App.klanten.length} klanten, ${App.onderdelen.length} onderdelen. ${centraalIngesteld()
        ? 'Werkbonnen worden naar de centrale database gestuurd zodra er verbinding is; klanten, machines en onderdelen komen van daar.'
        : 'Er is geen centrale database ingesteld: alles staat enkel op dit toestel. Maak regelmatig een back-up.'}</p>
      <div class="row">
        <button type="button" class="btn primary" data-backup>Back-up downloaden</button>
        <button type="button" class="btn" data-restore>Back-up terugzetten</button>
        ${centraalIngesteld() ? '' : '<button type="button" class="btn" data-seed-file>Startgegevens uit bestand</button>'}
        ${centraalIngesteld() || !window.SEED?.klanten?.length ? '' : '<button type="button" class="btn" data-seed>Startgegevens opnieuw laden</button>'}
        <button type="button" class="btn danger" data-wipe>Alles wissen</button>
      </div>
    </section>`);

  const root = view();
  const onInput = e => {
    const el = e.target;
    if (el.dataset.s) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      if (el.dataset.t === 'num') v = parseNum(v);
      setPath(s, el.dataset.s, v);
    } else if (el.dataset.list) {
      s[el.dataset.list] = el.value.split('\n').map(x => x.trim()).filter(Boolean);
    } else return;
    saveSettings();
    setSaved('Opgeslagen ✓');
  };
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  root.addEventListener('change', e => { if (e.target.dataset.s?.startsWith('centraal.')) Sync.schedule(500); });

  $('[data-wissel]').addEventListener('click', () => openAanmelden(() => viewInstellingen()));
  $('[data-sync-now]')?.addEventListener('click', async () => { await saveSettings(true); await Sync.syncNow(); });
  $('[data-test]')?.addEventListener('click', async () => {
    await saveSettings(true);
    if (!centraalIngesteld()) { toast('Vul eerst de project-URL en sleutel in'); return; }
    const ok = await Sync.checkTeamcode();
    toast(ok === true ? 'Verbinding ok ✓' : ok === false ? 'Server bereikt, maar de teamcode of sleutel klopt niet' : 'Server niet bereikbaar');
  });
  drawSyncStatus();

  $('[data-logo]').addEventListener('click', async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    s.bedrijf.logo = await resizeImage(file, 600, 240);
    await saveSettings(true);
    viewInstellingen();
  });
  $('[data-logo-del]')?.addEventListener('click', async () => { s.bedrijf.logo = ''; await saveSettings(true); viewInstellingen(); });

  $('[data-backup]').addEventListener('click', async () => {
    const data = { app: 'werkbonnen', versie: 1, gemaakt: new Date().toISOString() };
    for (const st of DB.STORES) data[st] = await DB.getAll(st);
    download(`werkbonnen-backup-${today()}.json`, JSON.stringify(data), 'application/json');
  });
  $('[data-restore]').addEventListener('click', async () => {
    const file = await pickFile('.json,application/json');
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { toast('Dit is geen geldig back-upbestand'); return; }
    if (data.app !== 'werkbonnen') { toast('Dit is geen back-up van deze app'); return; }
    if (!confirm(`Back-up van ${fmtDateTime(data.gemaakt)} terugzetten? Alle huidige gegevens op dit toestel worden vervangen.`)) return;
    for (const st of DB.STORES) { await DB.clear(st); await DB.bulkPut(st, data[st] || []); }
    await boot();
    toast('Back-up teruggezet');
  });
  $('[data-seed-file]')?.addEventListener('click', async () => {
    const file = await pickFile('.js,.json,application/json,text/javascript');
    if (!file) return;
    const seed = leesStartgegevens(await file.text());
    if (!seed) { toast('Dit bestand bevat geen startgegevens (seed.local.js)'); return; }
    if (!confirm(`Alle klanten en machines op dit toestel vervangen door ${seed.klanten.length} klanten en ${(seed.machines || []).length} machines uit "${file.name}"?${seed.monteurs?.length ? ` Ook de monteurs worden vervangen (${seed.monteurs.join(', ')}).` : ''} Werkbonnen blijven behouden.`)) return;
    await vervangStartgegevens(seed);
    await loadCache();
    drawTopbar();
    toast(`${seed.klanten.length} klanten geladen`);
    if (!App.settings.monteurId) openAanmelden(() => viewInstellingen()); else viewInstellingen();
  });
  $('[data-seed]')?.addEventListener('click', async () => {
    if (!confirm('Klanten, machines en onderdelen uit de startgegevens opnieuw laden? Gewijzigde startgegevens worden overschreven; je eigen toevoegingen blijven behouden.')) return;
    await loadSeed(); await loadCache(); toast('Startgegevens geladen'); viewInstellingen();
  });
  $('[data-wipe]').addEventListener('click', async () => {
    if (!confirm('ALLE gegevens op dit toestel wissen, inclusief alle werkbonnen? Dit kan niet ongedaan gemaakt worden.')) return;
    if (prompt('Typ WISSEN om te bevestigen') !== 'WISSEN') return;
    for (const st of DB.STORES) await DB.clear(st);
    await boot();
    toast('Alle gegevens gewist');
  });
}

function resizeImage(file, maxW, maxH) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/* =========================================================================
   Start data
   ========================================================================= */
// Reads start data from a seed.local.js ("window.SEED = {...};") or a plain JSON file
function leesStartgegevens(text) {
  try {
    const i = text.indexOf('window.SEED');
    const json = i >= 0 ? text.slice(text.indexOf('=', i) + 1).trim().replace(/;\s*$/, '') : text;
    const seed = JSON.parse(json);
    return Array.isArray(seed?.klanten) && seed.klanten.length ? seed : null;
  } catch { return null; }
}

// Replaces all customers and machines (and, when given, the monteurs) on this device.
// Parts are added or updated; werkbonnen stay untouched.
async function vervangStartgegevens(seed) {
  await DB.clear('klanten');
  await DB.clear('machines');
  await DB.bulkPut('klanten', seed.klanten);
  await DB.bulkPut('machines', seed.machines || []);
  if (seed.onderdelen?.length) await DB.bulkPut('onderdelen', seed.onderdelen);
  if (seed.monteurs?.length) {
    // Monteurs who stay keep their prefix and beheerder flag; a removed monteur on this device signs in again
    const oud = await DB.getAll('monteurs');
    const nieuw = seedMonteurs(seed.monteurs).map(m => {
      const o = oud.find(x => norm(x.naam) === norm(m.naam));
      return o ? { ...o, prefix: o.prefix || m.prefix } : m;
    });
    await DB.clear('monteurs');
    await DB.bulkPut('monteurs', nieuw);
    App.settings.monteurs = seed.monteurs;
    if (App.settings.monteurId && !nieuw.some(m => m.id === App.settings.monteurId)) {
      App.settings.monteurId = '';
      App.settings.mijnNaam = '';
    }
  }
  if (seed.versie) App.settings.seedVersie = seed.versie;
  await saveSettings(true);
}

/* =========================================================================
   Boot
   ========================================================================= */
async function boot() {
  let stored = await DB.get('settings', 'app');
  if (!stored) {
    stored = clone(DEFAULT_SETTINGS);
    if (window.SEED) stored.monteurs = SEED.monteurs;
    await DB.put('settings', stored);
    await loadSeed();
  }
  App.settings = mergeDeep(DEFAULT_SETTINGS, stored);
  // A new seed version replaces all customers and machines on this device once. Not with a central
  // database: there the server's lists are leading (use Beheer to upload them there instead).
  if (window.SEED?.versie && SEED.klanten?.length && App.settings.seedVersie !== SEED.versie && !centraalIngesteld()) {
    await vervangStartgegevens(SEED);
  }
  // Central database switched off: changes still waiting to be sent will never go anywhere
  if (centraalUit()) await DB.clear('outbox');
  // Devices from before the central database have no monteurs list yet
  if (window.SEED && (await DB.count('monteurs')) === 0) await DB.bulkPut('monteurs', seedMonteurs(SEED.monteurs || []));
  await loadCache();
  drawTopbar();
  Sync.start(centraalConfig); // before route(): views ask Sync whether the central database is set up
  await maakNummerreeksUniek();
  await route();
  if (!App.settings.monteurId) openAanmelden();
}

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushSave(); });
window.addEventListener('pagehide', () => { flushSave(); });

boot().catch(err => {
  console.error(err);
  setView(`<div class="card"><h2>De app kon niet starten</h2><p>${esc(err.message || err)}</p><p class="muted">Gebruik een recente versie van Chrome, Edge of Safari.</p></div>`);
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
