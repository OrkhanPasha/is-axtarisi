/* Job search board — no libraries. Requirements: ../telebler.md
 * Run from the job_search folder:  python -m http.server 8000  →  http://localhost:8000/panel/
 */
'use strict';

(() => {
  // ───────────────────────── Constants ─────────────────────────
  const DATA_URL = '../data/vakansiyalar.json';
  const DEMO_URL = 'demo.json';
  const DATA_FILE = 'vakansiyalar.json';
  const BACKUP_FILE = 'vakansiyalar.backup.json';
  const PREFS_KEY = 'vakansiya-panel:prefs';
  const DRAG_TYPE = 'application/x-vacancy-id';
  const PAGE_SIZE = 50;
  const DEADLINE_DAYS = 3;
  const INTERVIEW_DAYS = 7;
  const DEFAULT_SETTINGS = { defaultCurrency: 'USD', followUpDays: 7, noResponseDays: 30 };

  const STATUSES = [
    { code: 'saved', label: 'Saved', open: true },
    { code: 'applied', label: 'Applied', open: true },
    { code: 'hr_screen', label: 'HR Screen', open: true },
    { code: 'test_task', label: 'Test Task', open: true },
    { code: 'interview', label: 'Interview', open: true },
    { code: 'offer', label: 'Offer', open: true },
    { code: 'rejected', label: 'Rejected', open: false },
    { code: 'withdrawn', label: 'Withdrawn', open: false },
    { code: 'no_response', label: 'No Response', open: false },
  ];
  const STATUS = Object.fromEntries(STATUSES.map((s, i) => [s.code, { ...s, order: i }]));
  const OPEN_STATUSES = STATUSES.filter(s => s.open);
  const CLOSED_STATUSES = STATUSES.filter(s => !s.open);
  const FUNNEL = ['applied', 'hr_screen', 'interview', 'offer'];

  const WORK_MODES = { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' };
  const PERIODS = { hour: 'hr', month: 'mo', year: 'yr' };
  const PERIOD_LABELS = { hour: 'per hour', month: 'per month', year: 'per year' };
  const DOC_TYPES = { cv: 'CV', cover_letter: 'Cover letter', other: 'Other' };
  const INTERVIEW_TYPES = { phone: 'Phone', video: 'Video', onsite: 'On-site', technical: 'Technical', hr: 'HR', final: 'Final' };
  const OUTCOMES = { pending: 'Pending', passed: 'Passed', failed: 'Failed', cancelled: 'Cancelled' };
  const PRIORITIES = { 1: 'High', 2: 'Medium', 3: 'Low' };
  const COMMON_CURRENCIES = ['USD', 'AZN', 'EUR', 'CAD', 'GBP', 'TRY'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const VIEWS = ['table', 'board', 'stats', 'reminders'];

  const canWrite = typeof window.showDirectoryPicker === 'function';
  const nf = new Intl.NumberFormat('en-US');

  // ───────────────────────── State ─────────────────────────
  const state = {
    data: null,        // { schemaVersion, updatedAt, settings, documents, vacancies }
    invalid: [],       // raw records that failed validation; written back unchanged on save
    loadErrors: [],
    notice: null,      // { kind: 'file' | 'error', msg }
    mode: 'none',      // 'file' | 'demo' | 'opened' | 'none'
    sourceName: '',
    diskText: null,    // file text as last read/written, to detect edits made outside the panel
    dirty: false,
    dirHandle: null,
    view: 'table',
    filters: defaultFilters(),
    sort: { key: 'updated', dir: -1 },
    page: 0,
    closedOpen: false,
  };
  let cache = new WeakMap();

  function defaultFilters() {
    return { q: '', statuses: [], country: '', city: '', workMode: '', source: '', priority: '', tag: '', from: '', to: '', archived: false };
  }

  // ───────────────────────── Dates ─────────────────────────
  const pad = n => String(n).padStart(2, '0');
  const isoDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => isoDate(new Date());
  const nowStamp = () => { const d = new Date(); return `${isoDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/;

  function isDate(s) {
    const m = typeof s === 'string' && DATE_RE.exec(s);
    if (!m) return false;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && (!m[4] || (+m[4] < 24 && +m[5] < 60));
  }
  // Whole days since epoch for the date part of an ISO string (DST-safe).
  const dayNum = s => Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5);
  const daysBetween = (a, b) => dayNum(b) - dayNum(a);
  const fromDayNum = n => new Date(n * 864e5).toISOString().slice(0, 10);
  const addDays = (s, n) => fromDayNum(dayNum(s) + n);
  const weekStart = s => { const n = dayNum(s); return n - ((new Date(n * 864e5).getUTCDay() + 6) % 7); };

  function fmtDate(s, withYear) {
    if (!s) return '';
    const y = s.slice(0, 4);
    const yr = withYear || y !== today().slice(0, 4) ? ` ${y}` : '';
    const time = s.length > 10 ? ` ${s.slice(11, 16)}` : '';
    return `${+s.slice(8, 10)} ${MONTHS[+s.slice(5, 7) - 1]}${yr}${time}`;
  }
  function relDays(n) {
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    return n > 0 ? `in ${n} days` : `${-n} days ago`;
  }

  // ───────────────────────── DOM helpers ─────────────────────────
  const $ = (sel, root = document) => root.querySelector(sel);

  function el(tag, props, ...kids) {
    const n = document.createElement(tag);
    if (props) {
      for (const [k, v] of Object.entries(props)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = String(v);
        else if (k === 'dataset') Object.assign(n.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
        else if (k === 'list' || k.includes('-') || !(k in n)) n.setAttribute(k, v === true ? '' : v);
        else {
          try { n[k] = v; } catch { n.setAttribute(k, v); }
        }
      }
    }
    for (const k of kids.flat(Infinity)) {
      if (k == null || k === false) continue;
      n.append(k instanceof Node ? k : String(k));
    }
    return n;
  }
  function clear(node, ...kids) {
    node.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false).map(k => (k instanceof Node ? k : String(k))));
    return node;
  }
  const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u.trim()) ? u.trim() : null);

  function toast(msg, kind) {
    const t = el('div', { class: `toast ${kind || ''}`, role: kind === 'error' ? 'alert' : 'status', text: msg });
    $('#toasts').append(t);
    setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
  }

  function ask(message, buttons) {
    return new Promise(resolve => {
      const dlg = $('#ask');
      clear($('#ask-msg'), message);
      clear($('#ask-actions'), buttons.map(([value, label, kind]) =>
        el('button', { type: 'button', class: `btn ${kind || ''}`, text: label, onclick: () => dlg.close(value) })));
      dlg.returnValue = '';
      dlg.onclose = () => resolve(dlg.returnValue || 'cancel');
      dlg.showModal();
    });
  }

  // ───────────────────────── Derived data ─────────────────────────
  function info(v) {
    let i = cache.get(v);
    if (i) return i;
    const history = v.statusHistory
      .map((h, idx) => ({ ...h, idx }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.idx - b.idx));
    const last = history[history.length - 1];
    const appliedEntry = history.find(h => h.status === 'applied');
    const applied = v.dates.applied || (appliedEntry ? appliedEntry.date.slice(0, 10) : null);
    let maxOpen = -1;
    for (const h of history) if (STATUS[h.status].open) maxOpen = Math.max(maxOpen, STATUS[h.status].order);
    let firstResponse = null;
    if (applied) {
      const r = history.find(h => h.date.slice(0, 10) >= applied &&
        (h.status === 'rejected' || (STATUS[h.status].open && STATUS[h.status].order > STATUS.applied.order)));
      if (r) firstResponse = r.date.slice(0, 10);
    }
    i = { history, status: last.status, lastChange: last.date.slice(0, 10), applied, maxOpen, firstResponse,
      rejected: history.some(h => h.status === 'rejected') };
    cache.set(v, i);
    return i;
  }
  // Has the vacancy ever reached this pipeline stage (closed statuses don't count as progress)?
  const reached = (v, code) => info(v).maxOpen >= STATUS[code].order;
  const responded = v => reached(v, 'hr_screen') || (reached(v, 'applied') && info(v).rejected);
  const isOpen = v => STATUS[info(v).status].open;

  function nextAction(v) {
    const i = info(v);
    if (!STATUS[i.status].open) return null;
    const t = today();
    const c = [];
    for (const iv of v.interviews) {
      if (iv && iv.date && iv.date.slice(0, 10) >= t && (!iv.outcome || iv.outcome === 'pending')) {
        c.push({ date: iv.date, label: `${INTERVIEW_TYPES[iv.type] || ''} interview`.trim() });
      }
    }
    if (v.dates.nextFollowUp) c.push({ date: v.dates.nextFollowUp, label: 'Follow up' });
    if (i.status === 'saved' && v.dates.deadline) c.push({ date: v.dates.deadline, label: 'Apply by' });
    c.sort((a, b) => (a.date < b.date ? -1 : 1));
    return c[0] || null;
  }

  const locText = v => [v.location.city, v.location.country].filter(Boolean).join(', ');
  function salaryText(s) {
    if (s.min == null && s.max == null) return '';
    const range = s.min != null && s.max != null && s.min !== s.max
      ? `${nf.format(s.min)}–${nf.format(s.max)}` : nf.format(s.min ?? s.max);
    return `${range}${s.currency ? ` ${s.currency}` : ''}${s.period ? `/${PERIODS[s.period] || s.period}` : ''}`;
  }
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');

  function nextId() {
    let max = 0;
    for (const v of [...state.data.vacancies, ...state.invalid]) {
      const m = /^v-(\d+)$/.exec(v && v.id);
      if (m) max = Math.max(max, +m[1]);
    }
    return `v-${String(max + 1).padStart(4, '0')}`;
  }

  // ───────────────────────── Load & validate ─────────────────────────
  function emptyData() {
    return { schemaVersion: 1, updatedAt: null, settings: { ...DEFAULT_SETTINGS }, documents: [], vacancies: [] };
  }

  function normalize(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.vacancies)) throw new Error('the file has no "vacancies" array');
    const data = {
      ...raw,
      schemaVersion: raw.schemaVersion || 1,
      settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
      documents: Array.isArray(raw.documents) ? raw.documents.filter(d => d && d.id) : [],
      vacancies: [],
    };
    const errors = [];
    const invalid = [];
    const ids = new Set();
    raw.vacancies.forEach((v, n) => {
      const problems = problemsOf(v, ids);
      if (problems.length) {
        invalid.push(v);
        errors.push(`Record ${n + 1}${v && v.id ? ` (${v.id})` : ''}: ${problems.join('; ')}`);
      } else {
        ids.add(v.id);
        data.vacancies.push(withDefaults(v));
      }
    });
    return { data, errors, invalid };
  }

  function problemsOf(v, ids) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return ['not an object'];
    const p = [];
    if (!v.id || typeof v.id !== 'string') p.push('missing id');
    else if (ids.has(v.id)) p.push(`duplicate id "${v.id}"`);
    if (!v.title) p.push('missing title');
    if (!v.company) p.push('missing company');
    if (!Array.isArray(v.statusHistory) || !v.statusHistory.length) p.push('statusHistory needs at least one entry');
    else v.statusHistory.forEach((h, j) => {
      if (!h || !STATUS[h.status]) p.push(`statusHistory[${j}]: unknown status "${h && h.status}"`);
      if (!h || !isDate(h.date)) p.push(`statusHistory[${j}]: bad date "${h && h.date}"`);
    });
    for (const k of ['posted', 'deadline', 'applied', 'nextFollowUp']) {
      const d = v.dates && v.dates[k];
      if (d != null && !isDate(d)) p.push(`dates.${k}: bad date "${d}"`);
    }
    (Array.isArray(v.interviews) ? v.interviews : []).forEach((iv, j) => {
      if (iv && iv.date != null && !isDate(iv.date)) p.push(`interviews[${j}].date: bad date "${iv.date}"`);
    });
    return p;
  }

  function withDefaults(v) {
    return {
      ...v,
      title: String(v.title),
      company: String(v.company),
      location: v.location || {},
      salary: v.salary || {},
      dates: v.dates || {},
      tags: Array.isArray(v.tags) ? v.tags : [],
      contacts: Array.isArray(v.contacts) ? v.contacts.filter(Boolean) : [],
      interviews: Array.isArray(v.interviews) ? v.interviews.filter(Boolean) : [],
      documentsSent: v.documentsSent || {},
      archived: !!v.archived,
    };
  }

  const serialize = () => ({ ...state.data, vacancies: [...state.data.vacancies, ...state.invalid] });

  function setData(raw, mode, name, text) {
    const { data, errors, invalid } = normalize(raw);
    Object.assign(state, { data, invalid, loadErrors: errors, mode, sourceName: name, diskText: text ?? null, page: 0, notice: null });
    cache = new WeakMap();
    setDirty(false);
    render();
  }

  function loadText(text, mode, name) {
    let raw;
    try { raw = JSON.parse(text); } catch (e) { throw new Error(`${name} is not valid JSON: ${e.message}`); }
    try { setData(raw, mode, name, mode === 'file' ? text : null); } catch (e) { throw new Error(`${name}: ${e.message}`); }
  }

  async function boot() {
    restorePrefs();
    bindChrome();
    syncFilterInputs();
    if (location.protocol === 'file:') {
      state.notice = { kind: 'file' };
      render();
      return;
    }
    try {
      const r = await fetch(DATA_URL, { cache: 'no-store' });
      if (r.ok) { loadText(await r.text(), 'file', `data/${DATA_FILE}`); return; }
      if (r.status !== 404) throw new Error(`${DATA_URL}: HTTP ${r.status}`);
      const d = await fetch(DEMO_URL, { cache: 'no-store' });
      if (!d.ok) throw new Error(`${DEMO_URL}: HTTP ${d.status}`);
      loadText(await d.text(), 'demo', 'demo.json');
    } catch (e) {
      state.notice = { kind: 'error', msg: e.message };
      render();
    }
  }

  async function openFile(file) {
    if (!file) return;
    if (state.dirty && !confirm('You have unsaved changes. Discard them and open another file?')) return;
    try {
      loadText(await file.text(), 'opened', file.name);
      toast(`Opened ${file.name}. "Save" writes it to data/${DATA_FILE}.`);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // ───────────────────────── Save (File System Access API) ─────────────────────────
  const IDB = {
    open() {
      return new Promise((res, rej) => {
        const q = indexedDB.open('vakansiya-panel', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('kv');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const q = db.transaction('kv').objectStore('kv').get(key);
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
    },
    async set(key, value) {
      const db = await this.open();
      return new Promise((res, rej) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(value, key);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    },
  };

  async function getDataDir() {
    let h = state.dirHandle;
    if (!h) { try { h = await IDB.get('dataDir'); } catch { h = null; } }
    if (h) {
      const opts = { mode: 'readwrite' };
      if ((await h.queryPermission(opts)) === 'granted' || (await h.requestPermission(opts)) === 'granted') {
        state.dirHandle = h;
        return h;
      }
    }
    toast('Choose the job_search/data folder to save into.');
    h = await window.showDirectoryPicker({ id: 'vakansiya-data', mode: 'readwrite' });
    if (h.name !== 'data' && !confirm(`The selected folder is "${h.name}", not "data". The panel reads ../data/${DATA_FILE}. Save here anyway?`)) return null;
    state.dirHandle = h;
    try { await IDB.set('dataDir', h); } catch { /* remembering the folder is optional */ }
    return h;
  }

  async function writeText(fileHandle, text) {
    const w = await fileHandle.createWritable();
    await w.write(text);
    await w.close();
  }

  async function writeToDisk() {
    try {
      const dir = await getDataDir();
      if (!dir) return false;
      let old = null;
      try {
        old = await (await (await dir.getFileHandle(DATA_FILE)).getFile()).text();
      } catch (e) {
        if (e.name !== 'NotFoundError') throw e;
      }
      if (old !== null && old !== state.diskText) {
        const msg = state.diskText === null
          ? `${dir.name}/${DATA_FILE} already exists. Overwrite it? (The current file is kept as ${BACKUP_FILE}.)`
          : `${DATA_FILE} was changed outside the panel after it was loaded. Overwrite it with the panel's version? (The current file is kept as ${BACKUP_FILE}.)`;
        if (!confirm(msg)) return false;
      }
      if (old !== null) await writeText(await dir.getFileHandle(BACKUP_FILE, { create: true }), old);
      state.data.updatedAt = nowStamp();
      const text = `${JSON.stringify(serialize(), null, 2)}\n`;
      await writeText(await dir.getFileHandle(DATA_FILE, { create: true }), text);
      Object.assign(state, { diskText: text, mode: 'file', sourceName: `${dir.name}/${DATA_FILE}`, notice: null });
      setDirty(false);
      render();
      toast(`Saved to ${dir.name}/${DATA_FILE}`);
      return true;
    } catch (e) {
      if (e.name !== 'AbortError') toast(`Save failed: ${e.message}`, 'error');
      return false;
    }
  }

  async function save() {
    if (!state.data) return;
    if (!canWrite) {
      exportJson();
      setDirty(false);
      toast(`This browser cannot write files directly. Put the downloaded ${DATA_FILE} into the data folder.`);
      return;
    }
    if (state.mode === 'demo' &&
      !confirm(`DEMO mode: save the current demo vacancies as data/${DATA_FILE}?\n\nTo start with an empty file instead, use "Start my file".`)) return;
    await writeToDisk();
  }

  async function startMyFile() {
    if (!confirm(`Create an empty data/${DATA_FILE} and leave DEMO mode? The demo vacancies will be discarded.`)) return;
    const prev = { data: state.data, invalid: state.invalid, loadErrors: state.loadErrors };
    Object.assign(state, { data: emptyData(), invalid: [], loadErrors: [], page: 0 });
    cache = new WeakMap();
    if (canWrite) {
      if (!(await writeToDisk())) { Object.assign(state, prev); cache = new WeakMap(); render(); }
    } else {
      exportJson();
      Object.assign(state, { mode: 'opened', sourceName: 'new file' });
      setDirty(false);
      render();
      toast(`Put the downloaded ${DATA_FILE} into the data folder.`);
    }
  }

  function exportJson() {
    if (!state.data) return;
    const blob = new Blob([`${JSON.stringify(serialize(), null, 2)}\n`], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: DATA_FILE });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function setDirty(d) {
    state.dirty = d;
    $('#dirty').hidden = !d;
  }

  // Call after any change to vacancies or documents.
  function commit() {
    cache = new WeakMap();
    setDirty(true);
    render();
  }

  function addStatus(v, code, date, note) {
    v.statusHistory.push({ status: code, date, note: note || null });
    if (code === 'applied' && !v.dates.applied) v.dates.applied = date.slice(0, 10);
    v.updatedAt = today();
  }

  // ───────────────────────── Filters ─────────────────────────
  function matches(v, f, terms) {
    if (v.archived && !f.archived) return false;
    const i = info(v);
    if (f.statuses.length && !f.statuses.includes(i.status)) return false;
    if (f.country && v.location.country !== f.country) return false;
    if (f.city && v.location.city !== f.city) return false;
    if (f.workMode && v.location.workMode !== f.workMode) return false;
    if (f.source && v.source !== f.source) return false;
    if (f.priority && String(v.priority) !== f.priority) return false;
    if (f.tag && !v.tags.includes(f.tag)) return false;
    if (f.from && !(i.applied && i.applied >= f.from)) return false;
    if (f.to && !(i.applied && i.applied <= f.to)) return false;
    if (terms.length) {
      const hay = [v.title, v.company, v.notes, v.tags.join(' ')].join(' ').toLowerCase();
      if (!terms.every(t => hay.includes(t))) return false;
    }
    return true;
  }

  function filtered() {
    if (!state.data) return [];
    const terms = state.filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    return state.data.vacancies.filter(v => matches(v, state.filters, terms));
  }

  function activeFilterCount() {
    const f = state.filters;
    return ['country', 'city', 'workMode', 'source', 'priority', 'tag', 'from', 'to'].filter(k => f[k]).length +
      (f.statuses.length ? 1 : 0) + (f.archived ? 1 : 0);
  }

  function fillSelect(sel, pairs, allLabel, current) {
    if (current && !pairs.some(([v]) => v === current)) pairs = [...pairs, [current, current]];
    clear(sel, el('option', { value: '', text: allLabel }), pairs.map(([v, l]) => el('option', { value: v, text: l })));
    sel.value = current || '';
  }

  function distinct(fn) {
    const vs = state.data ? state.data.vacancies : [];
    return [...new Set(vs.flatMap(v => [].concat(fn(v) ?? [])).filter(x => x !== '' && x != null).map(String))]
      .sort((a, b) => a.localeCompare(b));
  }

  function refreshFilterOptions() {
    const f = state.filters;
    const same = x => [x, x];
    fillSelect($('#f-country'), distinct(v => v.location.country).map(same), 'All countries', f.country);
    fillSelect($('#f-city'), distinct(v => v.location.city).map(same), 'All cities', f.city);
    fillSelect($('#f-mode'), Object.entries(WORK_MODES), 'Any mode', f.workMode);
    fillSelect($('#f-source'), distinct(v => v.source).map(same), 'All sources', f.source);
    fillSelect($('#f-priority'), Object.entries(PRIORITIES), 'Any priority', f.priority);
    fillSelect($('#f-tag'), distinct(v => v.tags).map(same), 'All tags', f.tag);
  }

  function syncFilterInputs() {
    const f = state.filters;
    $('#f-q').value = f.q;
    $('#f-from').value = f.from;
    $('#f-to').value = f.to;
    $('#f-archived').checked = f.archived;
    refreshFilterOptions();
  }

  function setFilter(key, value) {
    state.filters[key] = value;
    state.page = 0;
    renderView();
  }

  function renderStatusChips() {
    clear($('#f-status'), STATUSES.map(s => {
      const on = state.filters.statuses.includes(s.code);
      return el('button', {
        type: 'button', class: `chip s-${s.code}${on ? ' on' : ''}`, 'aria-pressed': String(on), text: s.label,
        onclick: () => {
          const list = state.filters.statuses;
          setFilter('statuses', on ? list.filter(c => c !== s.code) : [...list, s.code]);
        },
      });
    }));
    const n = activeFilterCount();
    $('#f-toggle').textContent = n ? `Filters (${n})` : 'Filters';
  }

  // ───────────────────────── Prefs ─────────────────────────
  function savePrefs() {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view: state.view, filters: state.filters, sort: state.sort, closedOpen: state.closedOpen }));
    } catch { /* storage unavailable */ }
  }
  function restorePrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (!p) return;
      if (VIEWS.includes(p.view)) state.view = p.view;
      if (p.filters && typeof p.filters === 'object') {
        state.filters = { ...defaultFilters(), ...p.filters };
        if (!Array.isArray(state.filters.statuses)) state.filters.statuses = [];
        state.filters.statuses = state.filters.statuses.filter(c => STATUS[c]);
      }
      if (p.sort && COLUMNS.some(c => c.key === p.sort.key)) state.sort = { key: p.sort.key, dir: p.sort.dir === 1 ? 1 : -1 };
      state.closedOpen = !!p.closedOpen;
    } catch { /* ignore broken prefs */ }
  }

  // ───────────────────────── Shared bits ─────────────────────────
  const statusPill = code => el('span', { class: `pill s-${code}`, text: STATUS[code] ? STATUS[code].label : code });
  const statusDot = code => el('span', { class: `dot s-${code}`, 'aria-hidden': 'true' });
  const priorityBadge = p => (PRIORITIES[p] ? el('span', { class: `prio p${p}`, title: `${PRIORITIES[p]} priority`, text: PRIORITIES[p] }) : null);
  const extLink = url => {
    const u = safeUrl(url);
    return u ? el('a', { class: 'ext', href: u, target: '_blank', rel: 'noopener noreferrer', title: 'Open posting', 'aria-label': 'Open posting', text: '↗', onclick: e => e.stopPropagation() }) : null;
  };

  function emptyState() {
    if (!state.data) return el('div', { class: 'empty' }, el('p', { text: 'No data loaded.' }));
    if (!state.data.vacancies.length) {
      return el('div', { class: 'empty' }, el('p', { text: 'No vacancies yet.' }),
        el('button', { type: 'button', class: 'btn primary', text: '+ Add the first vacancy', onclick: () => openEditor(null) }));
    }
    return el('div', { class: 'empty' }, el('p', { text: 'No vacancies match the filters.' }),
      el('button', { type: 'button', class: 'btn', text: 'Reset filters', onclick: resetFilters }));
  }

  function resetFilters() {
    state.filters = defaultFilters();
    state.page = 0;
    syncFilterInputs();
    renderView();
  }

  // ───────────────────────── Render ─────────────────────────
  function render() {
    renderHeader();
    renderNotices();
    refreshFilterOptions();
    renderView();
  }

  function renderHeader() {
    const badge = $('#mode-badge');
    badge.hidden = state.mode === 'none';
    badge.className = `badge ${state.mode === 'demo' ? 'demo' : ''}`;
    badge.textContent = state.mode === 'demo' ? 'DEMO'
      : state.mode === 'opened' ? `Opened: ${state.sourceName} (not saved to data/ yet)` : state.sourceName;
    const has = !!state.data;
    for (const id of ['#btn-new', '#btn-docs', '#btn-save', '#btn-export']) $(id).disabled = !has;
    $('#btn-start').hidden = state.mode !== 'demo';
    $('#btn-save').hidden = !canWrite;
  }

  function renderNotices() {
    const n = [];
    if (state.notice && state.notice.kind === 'file') {
      n.push(el('div', { class: 'notice warn' },
        el('strong', { text: 'Open the panel through the local server.' }),
        el('p', null, 'The browser does not let a file:// page read ', el('code', { text: `../data/${DATA_FILE}` }),
          '. In the ', el('code', { text: 'job_search' }), ' folder run ', el('code', { text: 'python -m http.server 8000' }),
          ' and open ', el('code', { text: 'http://localhost:8000/panel/' }), '. Or use "Open file" / drop a JSON file onto the page.')));
    }
    if (state.notice && state.notice.kind === 'error') {
      n.push(el('div', { class: 'notice error' }, el('strong', { text: 'Could not load data. ' }), el('span', { text: state.notice.msg })));
    }
    if (state.mode === 'demo') {
      n.push(el('div', { class: 'notice demo' }, el('strong', { text: 'DEMO data. ' }),
        `data/${DATA_FILE} was not found, so sample vacancies from demo.json are shown. Use "Start my file" to begin with an empty file${canWrite ? ', or "Save" to keep these samples' : ''}.`));
    }
    if (state.loadErrors.length) {
      n.push(el('details', { class: 'notice error' },
        el('summary', { text: `${state.loadErrors.length} record(s) could not be loaded. They are hidden here but kept unchanged in the file.` }),
        el('ul', null, state.loadErrors.map(e => el('li', { text: e })))));
    }
    if (!canWrite && state.data) {
      n.push(el('div', { class: 'notice info' }, 'This browser cannot write files directly. Use "Export" and put the file into the data folder (Chrome or Edge can save in place).'));
    }
    clear($('#notices'), n);
  }

  function renderView() {
    const list = filtered();
    document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.view === state.view)));
    renderStatusChips();
    const total = state.data ? state.data.vacancies.length : 0;
    $('#count').textContent = state.data ? `${list.length} shown of ${total}` : '';
    const rem = state.data ? buildReminders(list) : [];
    const badge = $('#rem-badge');
    badge.hidden = !rem.length;
    badge.textContent = rem.length;
    const root = $('#view');
    if (!list.length && state.view !== 'reminders') clear(root, emptyState());
    else if (state.view === 'table') renderTable(root, list);
    else if (state.view === 'board') renderBoard(root, list);
    else if (state.view === 'stats') renderStats(root, list);
    else renderReminders(root, list, rem);
    savePrefs();
  }

  // ── Table
  const COLUMNS = [
    { key: 'title', label: 'Title', get: v => v.title.toLowerCase() },
    { key: 'company', label: 'Company', get: v => v.company.toLowerCase() },
    { key: 'location', label: 'Location', get: v => locText(v).toLowerCase() || null },
    { key: 'workMode', label: 'Mode', get: v => v.location.workMode || null },
    { key: 'salary', label: 'Salary', get: v => v.salary.min ?? v.salary.max ?? null },
    { key: 'status', label: 'Status', get: v => STATUS[info(v).status].order },
    { key: 'applied', label: 'Applied', get: v => info(v).applied },
    { key: 'updated', label: 'Last update', get: v => info(v).lastChange },
    { key: 'next', label: 'Next action', get: v => { const n = nextAction(v); return n ? n.date : null; } },
    { key: 'priority', label: 'Priority', get: v => v.priority ?? null },
  ];
  const DESC_FIRST = ['applied', 'updated'];

  function sortList(list) {
    const col = COLUMNS.find(c => c.key === state.sort.key) || COLUMNS[7];
    const dir = state.sort.dir;
    return list.map(v => [col.get(v), v])
      .sort((a, b) => {
        if (a[0] == null) return b[0] == null ? 0 : 1;
        if (b[0] == null) return -1;
        return (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0) * dir;
      })
      .map(x => x[1]);
  }

  function renderTable(root, list) {
    const sorted = sortList(list);
    const pages = Math.ceil(sorted.length / PAGE_SIZE);
    state.page = Math.max(0, Math.min(state.page, pages - 1));
    const start = state.page * PAGE_SIZE;
    const rows = sorted.slice(start, start + PAGE_SIZE);
    const t = today();

    const head = el('thead', null, el('tr', null, COLUMNS.map(c => {
      const active = state.sort.key === c.key;
      return el('th', { 'aria-sort': active ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none' },
        el('button', {
          type: 'button', class: 'th-btn',
          onclick: () => {
            state.sort = { key: c.key, dir: active ? -state.sort.dir : DESC_FIRST.includes(c.key) ? -1 : 1 };
            renderView();
          },
        }, c.label, active ? (state.sort.dir > 0 ? ' ▲' : ' ▼') : ''));
    })));

    const body = el('tbody', null, rows.map(v => {
      const i = info(v);
      const n = nextAction(v);
      return el('tr', {
        tabindex: 0, class: v.archived ? 'archived' : null,
        onclick: () => openEditor(v),
        onkeydown: e => { if (e.key === 'Enter') openEditor(v); },
      },
      el('td', { class: 'cell-title' }, el('span', { text: v.title }), extLink(v.url),
        v.archived ? el('span', { class: 'tag', text: 'archived' }) : null),
      el('td', { text: v.company }),
      el('td', { text: locText(v) }),
      el('td', { text: WORK_MODES[v.location.workMode] || '' }),
      el('td', { class: 'num', text: salaryText(v.salary) }),
      el('td', null, statusPill(i.status)),
      el('td', { class: 'nowrap', text: fmtDate(i.applied) }),
      el('td', { class: 'nowrap', text: fmtDate(i.lastChange) }),
      el('td', { class: `nowrap${n && n.date.slice(0, 10) < t ? ' overdue' : ''}` },
        n ? [el('span', { class: 'next-label', text: n.label }), ' ', fmtDate(n.date)] : ''),
      el('td', null, priorityBadge(v.priority)));
    }));

    const pager = pages > 1 ? el('div', { class: 'pager' },
      el('button', { type: 'button', class: 'btn ghost', text: '← Prev', disabled: state.page === 0, onclick: () => { state.page--; renderView(); } }),
      el('span', { text: `${start + 1}–${start + rows.length} of ${sorted.length}` }),
      el('button', { type: 'button', class: 'btn ghost', text: 'Next →', disabled: state.page >= pages - 1, onclick: () => { state.page++; renderView(); } }))
      : null;

    clear(root, el('div', { class: 'table-wrap' }, el('table', { class: 'grid' }, head, body)), pager);
  }

  // ── Board
  function dropZone(code, node) {
    const hasCard = e => [...e.dataTransfer.types].includes(DRAG_TYPE);
    node.addEventListener('dragover', e => {
      if (!hasCard(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      node.classList.add('drop-target');
    });
    node.addEventListener('dragleave', e => { if (!node.contains(e.relatedTarget)) node.classList.remove('drop-target'); });
    node.addEventListener('drop', e => {
      if (!hasCard(e)) return;
      e.preventDefault();
      e.stopPropagation();
      node.classList.remove('drop-target');
      const v = state.data.vacancies.find(x => x.id === e.dataTransfer.getData(DRAG_TYPE));
      if (v && info(v).status !== code) {
        addStatus(v, code, today(), null);
        commit();
        toast(`${v.title} → ${STATUS[code].label}`);
      }
    });
    return node;
  }

  function card(v) {
    const i = info(v);
    const age = daysBetween(i.lastChange, today());
    return el('article', {
      class: `card${v.archived ? ' archived' : ''}`, draggable: true, tabindex: 0,
      ondragstart: e => { e.dataTransfer.setData(DRAG_TYPE, v.id); e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: e => e.currentTarget.classList.remove('dragging'),
      onclick: () => openEditor(v),
      onkeydown: e => { if (e.key === 'Enter') openEditor(v); },
    },
    el('div', { class: 'card-top' }, el('strong', { class: 'card-title', text: v.title }), priorityBadge(v.priority)),
    el('div', { class: 'card-company', text: v.company }),
    el('div', { class: 'card-meta' },
      el('span', { text: [locText(v), WORK_MODES[v.location.workMode]].filter(Boolean).join(' · ') }),
      el('span', { class: 'age', title: `Last change ${fmtDate(i.lastChange, true)}`, text: age <= 0 ? 'today' : `${age}d` })));
  }

  function renderBoard(root, list) {
    const by = Object.fromEntries(STATUSES.map(s => [s.code, []]));
    list.forEach(v => by[info(v).status].push(v));
    for (const k of Object.keys(by)) {
      by[k].sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9) || (info(a).lastChange < info(b).lastChange ? 1 : -1));
    }
    const cols = OPEN_STATUSES.map(s => dropZone(s.code, el('section', { class: 'col' },
      el('header', { class: 'col-head' }, statusDot(s.code), el('span', { text: s.label }), el('span', { class: 'count', text: by[s.code].length })),
      el('div', { class: 'col-body' }, by[s.code].length ? by[s.code].map(card) : el('p', { class: 'col-empty', text: 'Drop cards here' })))));

    const closedCount = CLOSED_STATUSES.reduce((n, s) => n + by[s.code].length, 0);
    const closed = el('section', { class: `col col-closed${state.closedOpen ? ' open' : ''}` },
      el('header', { class: 'col-head' },
        el('button', {
          type: 'button', class: 'link', 'aria-expanded': String(state.closedOpen),
          onclick: () => { state.closedOpen = !state.closedOpen; renderView(); },
        }, `${state.closedOpen ? '▾' : '▸'} Closed`),
        el('span', { class: 'count', text: closedCount })),
      el('div', { class: 'col-body' }, CLOSED_STATUSES.map(s => dropZone(s.code, el('div', { class: 'zone' },
        el('div', { class: 'zone-head' }, statusPill(s.code), el('span', { class: 'count', text: by[s.code].length })),
        state.closedOpen ? by[s.code].map(card) : null)))));

    clear(root, el('div', { class: 'board' }, cols, closed));
  }

  // ── Stats
  function barRow(label, n, max, extra) {
    return el('div', { class: 'bar-row' },
      el('div', { class: 'bar-label' }, label),
      el('div', { class: 'bar-track' }, el('div', { class: 'bar-fill', style: `width:${max ? (n / max) * 100 : 0}%` })),
      el('div', { class: 'bar-value', text: extra ? `${n} · ${extra}` : n }));
  }

  function renderStats(root, list) {
    const applied = list.filter(v => reached(v, 'applied'));
    const respondedN = applied.filter(responded).length;
    const funnel = FUNNEL.map(code => ({ code, n: list.filter(v => reached(v, code)).length }));
    const respDays = applied.map(info).filter(i => i.applied && i.firstResponse).map(i => daysBetween(i.applied, i.firstResponse));
    const avg = respDays.length ? respDays.reduce((a, b) => a + b, 0) / respDays.length : null;

    const tiles = [
      ['Vacancies', list.length],
      ['Active', list.filter(isOpen).length],
      ['Applied', applied.length],
      ['Response rate', pct(respondedN, applied.length)],
      ['Interview rate', pct(funnel[2].n, applied.length)],
      ['Offers', funnel[3].n],
      ['Avg. days to first reply', avg == null ? '—' : avg.toFixed(1)],
    ].map(([label, value]) => el('div', { class: 'tile' }, el('div', { class: 'tile-value', text: value }), el('div', { class: 'tile-label', text: label })));

    const counts = STATUSES.map(s => ({ s, n: list.filter(v => info(v).status === s.code).length }));
    const maxCount = Math.max(...counts.map(c => c.n), 1);
    const byStatus = el('div', { class: 'panel' }, el('h3', { text: 'By current status' }),
      counts.map(({ s, n }) => barRow(statusPill(s.code), n, maxCount)));

    const base = funnel[0].n;
    const funnelPanel = el('div', { class: 'panel' }, el('h3', { text: 'Funnel (stage ever reached)' }),
      funnel.map(f => barRow(statusPill(f.code), f.n, base, pct(f.n, base))),
      el('p', { class: 'muted small', text: 'A rejected vacancy still counts for the stages it reached before the rejection.' }));

    // Applications per week, last 12 weeks
    const end = weekStart(today());
    const weeks = Array.from({ length: 12 }, (_, k) => end - (11 - k) * 7);
    const perWeek = new Map(weeks.map(w => [w, 0]));
    for (const v of applied) {
      const a = info(v).applied;
      if (!a) continue;
      const w = weekStart(a);
      if (perWeek.has(w)) perWeek.set(w, perWeek.get(w) + 1);
    }
    const maxWeek = Math.max(...perWeek.values(), 1);
    const weekly = el('div', { class: 'panel' }, el('h3', { text: 'Applications per week (last 12 weeks)' }),
      el('div', { class: 'columns-chart' }, weeks.map(w => {
        const n = perWeek.get(w);
        return el('div', { class: 'cc-col', title: `Week of ${fmtDate(fromDayNum(w), true)}: ${n}` },
          el('div', { class: 'cc-value', text: n || '' }),
          el('div', { class: 'cc-bar-wrap' }, el('div', { class: 'cc-bar', style: `height:${(n / maxWeek) * 100}%` })),
          el('div', { class: 'cc-label', text: fmtDate(fromDayNum(w)) }));
      })));

    const sources = new Map();
    for (const v of list) {
      const key = v.source || '(unknown)';
      const s = sources.get(key) || { total: 0, applied: 0, responded: 0 };
      s.total++;
      if (reached(v, 'applied')) { s.applied++; if (responded(v)) s.responded++; }
      sources.set(key, s);
    }
    const srcPanel = el('div', { class: 'panel' }, el('h3', { text: 'By source' }),
      el('div', { class: 'table-wrap' }, el('table', { class: 'grid compact' },
        el('thead', null, el('tr', null, ['Source', 'Vacancies', 'Applied', 'Replied', 'Response rate'].map(h => el('th', { text: h })))),
        el('tbody', null, [...sources.entries()].sort((a, b) => b[1].total - a[1].total).map(([name, s]) =>
          el('tr', null, el('td', { text: name }), el('td', { class: 'num', text: s.total }), el('td', { class: 'num', text: s.applied }),
            el('td', { class: 'num', text: s.responded }), el('td', { class: 'num', text: pct(s.responded, s.applied) })))))));

    clear(root, el('div', { class: 'stats' },
      el('div', { class: 'tiles' }, tiles),
      el('div', { class: 'two-col' }, byStatus, funnelPanel),
      weekly, srcPanel));
  }

  // ── Reminders
  function buildReminders(list) {
    const t = today();
    const s = state.data.settings;
    const out = [];
    for (const v of list) {
      const i = info(v);
      if (v.archived || !STATUS[i.status].open) continue;
      if (i.status === 'saved' && v.dates.deadline) {
        const d = daysBetween(t, v.dates.deadline);
        if (d >= 0 && d <= DEADLINE_DAYS) out.push({ v, kind: 'deadline', due: v.dates.deadline, text: `Application deadline ${relDays(d)}` });
      }
      for (const iv of v.interviews) {
        if (!iv.date || (iv.outcome && iv.outcome !== 'pending')) continue;
        const d = daysBetween(t, iv.date);
        if (d >= 0 && d <= INTERVIEW_DAYS) {
          out.push({ v, kind: 'interview', due: iv.date,
            text: `${INTERVIEW_TYPES[iv.type] || ''} interview ${relDays(d)}${iv.date.length > 10 ? ` at ${iv.date.slice(11, 16)}` : ''}`.trim() });
        }
      }
      const fu = v.dates.nextFollowUp;
      if (fu && fu.slice(0, 10) <= t) out.push({ v, kind: 'followup', due: fu, text: `Follow-up due ${relDays(daysBetween(t, fu))}` });
      if (i.status === 'applied') {
        const idle = daysBetween(i.lastChange, t);
        if (idle >= s.noResponseDays) {
          out.push({ v, kind: 'noresponse', due: addDays(i.lastChange, s.noResponseDays), text: `No reply for ${idle} days. Mark as No Response?` });
        } else if (!fu && idle >= s.followUpDays) {
          out.push({ v, kind: 'followup', due: addDays(i.lastChange, s.followUpDays), text: `No reply for ${idle} days. Time to follow up.` });
        }
      }
    }
    return out.sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  }

  const KIND_LABELS = { deadline: 'Deadline', interview: 'Interview', followup: 'Follow-up', noresponse: 'No response' };

  function renderReminders(root, list, rem) {
    const allCount = buildReminders(state.data ? state.data.vacancies : []).length;
    const hidden = allCount - rem.length;
    const followed = v => { v.dates.nextFollowUp = addDays(today(), state.data.settings.followUpDays); v.updatedAt = today(); commit(); };
    const items = rem.map(r => el('li', { class: `reminder k-${r.kind}${r.due.slice(0, 10) < today() ? ' overdue' : ''}` },
      el('span', { class: 'r-kind', text: KIND_LABELS[r.kind] }),
      el('div', { class: 'r-main' },
        el('button', { type: 'button', class: 'link r-title', onclick: () => openEditor(r.v) }, `${r.v.title} · ${r.v.company}`),
        el('div', { class: 'r-text', text: r.text })),
      el('div', { class: 'r-actions' },
        r.kind === 'deadline' ? el('button', { type: 'button', class: 'btn small', text: 'Mark applied', onclick: () => { addStatus(r.v, 'applied', today(), null); commit(); } }) : null,
        r.kind === 'noresponse' ? el('button', { type: 'button', class: 'btn small', text: 'Mark No Response', onclick: () => { addStatus(r.v, 'no_response', today(), null); commit(); } }) : null,
        r.kind === 'followup' || r.kind === 'noresponse'
          ? el('button', { type: 'button', class: 'btn small ghost', text: `Followed up (next in ${state.data.settings.followUpDays}d)`, onclick: () => followed(r.v) }) : null)));
    clear(root, el('div', { class: 'reminders' },
      rem.length ? el('ul', { class: 'reminder-list' }, items) : el('div', { class: 'empty' }, el('p', { text: state.data ? 'Nothing needs attention right now.' : 'No data loaded.' })),
      hidden > 0 ? el('p', { class: 'muted' }, `${hidden} more reminder(s) hidden by the current filters. `,
        el('button', { type: 'button', class: 'link', text: 'Reset filters', onclick: resetFilters })) : null));
  }

  // ───────────────────────── Editor ─────────────────────────
  function field(label, control, cls) {
    return el('label', { class: `field ${cls || ''}` }, el('span', { class: 'field-label', text: label }), control);
  }
  function bindText(obj, key, attrs = {}) {
    return el('input', { type: 'text', ...attrs, value: obj[key] ?? '', oninput: e => { obj[key] = e.target.value === '' ? null : e.target.value; } });
  }
  function bindNumber(obj, key) {
    return el('input', { type: 'number', min: 0, step: 'any', value: obj[key] ?? '', oninput: e => { obj[key] = e.target.value === '' ? null : Number(e.target.value); } });
  }
  function bindDate(obj, key, withTime) {
    let value = obj[key] || '';
    if (withTime && value.length === 10) value += 'T00:00';
    return el('input', { type: withTime ? 'datetime-local' : 'date', value, oninput: e => { obj[key] = e.target.value || null; } });
  }
  function bindSelect(obj, key, map, opts = {}) {
    const cur = obj[key] == null ? '' : String(obj[key]);
    return el('select', { onchange: e => { const val = e.target.value; obj[key] = val === '' ? null : opts.numeric ? Number(val) : val; } },
      opts.empty !== undefined ? el('option', { value: '', text: opts.empty, selected: cur === '' }) : null,
      Object.entries(map).map(([v, l]) => el('option', { value: v, text: l, selected: v === cur })),
      cur && !(cur in map) ? el('option', { value: cur, text: cur, selected: true }) : null);
  }
  const datalist = (id, values) => el('datalist', { id }, values.map(v => el('option', { value: v })));
  const section = (title, ...kids) => el('fieldset', { class: 'sec' }, el('legend', { text: title }), kids);

  function listSection(items, makeBlank, renderItem, addLabel) {
    const wrap = el('div', { class: 'rows' });
    const draw = () => clear(wrap,
      items.map((it, idx) => el('div', { class: 'row-item' }, renderItem(it),
        el('button', { type: 'button', class: 'btn icon ghost danger', title: 'Remove', 'aria-label': 'Remove', text: '✕', onclick: () => { items.splice(idx, 1); draw(); } }))),
      el('button', { type: 'button', class: 'btn ghost small', text: addLabel, onclick: () => { items.push(makeBlank()); draw(); } }));
    draw();
    return wrap;
  }

  function newDraft() {
    const t = today();
    return {
      id: nextId(), title: '', company: '', url: null, source: null,
      location: { city: null, country: null, workMode: null },
      salary: { min: null, max: null, currency: state.data.settings.defaultCurrency || 'USD', period: 'month' },
      priority: 2, tags: [],
      dates: { posted: null, deadline: null, applied: null, nextFollowUp: null },
      statusHistory: [{ status: 'saved', date: t, note: null }],
      contacts: [], documentsSent: { cv: null, coverLetter: null }, interviews: [],
      notes: null, archived: false, createdAt: t, updatedAt: t,
    };
  }

  const normUrl = u => (u || '').trim().toLowerCase().replace(/\/+$/, '');
  const normKey = v => `${v.company}|${v.title}`.toLowerCase().replace(/\s+/g, ' ').trim();
  function findDuplicate(d) {
    const u = normUrl(d.url);
    const k = normKey(d);
    return state.data.vacancies.find(x => x.id !== d.id && ((u && normUrl(x.url) === u) || normKey(x) === k));
  }

  function statusSection(draft, onApplied) {
    const wrap = el('div', { class: 'status-sec' });
    const draw = () => {
      const hist = draft.statusHistory.map((h, idx) => ({ ...h, idx }))
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.idx - b.idx));
      const cur = hist[hist.length - 1].status;
      const o = STATUS[cur].order;
      const suggested = STATUS[cur].open && o < OPEN_STATUSES.length - 1 ? STATUSES[o + 1].code : cur;
      const sel = el('select', { 'aria-label': 'New status' }, STATUSES.map(s => el('option', { value: s.code, text: s.label, selected: s.code === suggested })));
      const date = el('input', { type: 'date', value: today(), 'aria-label': 'Status date' });
      const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Status note' });
      clear(wrap,
        el('div', { class: 'status-current' }, 'Current status: ', statusPill(cur)),
        el('ol', { class: 'history' }, hist.slice().reverse().map(h => el('li', null,
          statusPill(h.status), el('span', { class: 'muted nowrap', text: fmtDate(h.date, true) }),
          el('span', { class: 'h-note', text: h.note || '' }),
          draft.statusHistory.length > 1 ? el('button', {
            type: 'button', class: 'btn icon ghost', title: 'Remove this entry', 'aria-label': 'Remove this status entry', text: '✕',
            onclick: () => { draft.statusHistory.splice(h.idx, 1); draw(); },
          }) : null))),
        el('div', { class: 'status-add' }, sel, date, note,
          el('button', {
            type: 'button', class: 'btn', text: 'Add status',
            onclick: () => {
              if (!date.value) { date.focus(); return; }
              draft.statusHistory.push({ status: sel.value, date: date.value, note: note.value.trim() || null });
              if (sel.value === 'applied' && !draft.dates.applied) { draft.dates.applied = date.value; onApplied(date.value); }
              draw();
            },
          })));
    };
    draw();
    return wrap;
  }

  function docsSentSection(draft) {
    const wrap = el('div', { class: 'grid' });
    const draw = () => {
      const ids = new Set(state.data.documents.map(d => d.id));
      for (const k of ['cv', 'coverLetter']) if (draft.documentsSent[k] && !ids.has(draft.documentsSent[k])) draft.documentsSent[k] = null;
      const pick = (key, type) => {
        const cur = draft.documentsSent[key] || '';
        return el('select', { onchange: e => { draft.documentsSent[key] = e.target.value || null; } },
          el('option', { value: '', text: '— none —' }),
          state.data.documents.filter(d => d.type === type || d.id === cur).map(d => el('option', { value: d.id, text: d.name || d.id, selected: d.id === cur })));
      };
      clear(wrap,
        field('CV sent', pick('cv', 'cv')),
        field('Cover letter sent', pick('coverLetter', 'cover_letter')),
        el('div', { class: 'field align-end' }, el('button', { type: 'button', class: 'btn ghost', text: 'Manage documents…', onclick: () => openDocuments(draw) })));
    };
    draw();
    return wrap;
  }

  function openEditor(original) {
    if (!state.data) return;
    const isNew = !original;
    const draft = isNew ? newDraft() : structuredClone(original);
    const snapshot = JSON.stringify(draft);
    const dlg = $('#editor');
    const errorBox = el('span', { class: 'form-error', role: 'alert' });

    const appliedInput = bindDate(draft.dates, 'applied');
    const urlInput = bindText(draft, 'url', { type: 'url', placeholder: 'https://…' });
    const tagsInput = el('input', {
      type: 'text', value: draft.tags.join(', '), placeholder: 'sql, power-bi',
      oninput: e => { draft.tags = e.target.value.split(',').map(t => t.trim()).filter(Boolean); },
    });

    const cancel = () => {
      if (JSON.stringify(draft) !== snapshot && !confirm('Discard your changes to this vacancy?')) return;
      dlg.close();
    };

    const submit = () => {
      draft.title = (draft.title || '').trim();
      draft.company = (draft.company || '').trim();
      if (!draft.title || !draft.company) { errorBox.textContent = 'Title and company are required.'; return; }
      if (draft.salary.min != null && draft.salary.max != null && draft.salary.min > draft.salary.max) {
        errorBox.textContent = 'Salary min is greater than max.';
        return;
      }
      draft.contacts = draft.contacts.filter(c => Object.values(c).some(x => x));
      draft.interviews = draft.interviews.filter(iv => iv.date || iv.with || iv.notes);
      const dup = findDuplicate(draft);
      if (dup && !confirm(`Possible duplicate of "${dup.title}" at ${dup.company} (${dup.id}). Save anyway?`)) return;
      draft.updatedAt = today();
      const idx = isNew ? -1 : state.data.vacancies.indexOf(original);
      if (idx < 0) state.data.vacancies.push(draft);
      else state.data.vacancies[idx] = draft;
      dlg.close();
      commit();
      toast(isNew ? `Added "${draft.title}"` : 'Changes applied. Remember to save.');
    };

    const remove = async () => {
      const buttons = original.archived
        ? [['delete', 'Delete', 'danger'], ['cancel', 'Cancel']]
        : [['archive', 'Archive instead', 'primary'], ['delete', 'Delete', 'danger'], ['cancel', 'Cancel']];
      const choice = await ask(`Delete "${original.title}" at ${original.company}? After saving this cannot be undone.`, buttons);
      if (choice === 'cancel') return;
      dlg.close();
      if (choice === 'archive') { original.archived = true; original.updatedAt = today(); toast('Archived'); }
      else { state.data.vacancies = state.data.vacancies.filter(x => x !== original); toast('Deleted'); }
      commit();
    };

    const sources = [...new Set([...distinct(v => v.source), 'LinkedIn', 'hh.az', 'boss.az', 'Indeed', 'Referral', 'Company website'])];
    const currencies = [...new Set([...COMMON_CURRENCIES, ...distinct(v => v.salary.currency)])];

    clear(dlg, el('form', { class: 'dlg-form', novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } },
      el('header', { class: 'dlg-head' },
        el('h2', { text: isNew ? 'New vacancy' : original.title }),
        el('span', { class: 'muted', text: draft.id }),
        el('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Close', text: '✕', onclick: cancel })),
      el('div', { class: 'dlg-body' },
        datalist('dl-sources', sources), datalist('dl-currencies', currencies),
        datalist('dl-countries', distinct(v => v.location.country)), datalist('dl-cities', distinct(v => v.location.city)),
        section('Basics', el('div', { class: 'grid' },
          field('Title *', bindText(draft, 'title', { required: true, autocomplete: 'off' })),
          field('Company *', bindText(draft, 'company', { required: true, autocomplete: 'off' })),
          field('Posting URL', el('div', { class: 'inline' }, urlInput, extLink(draft.url)), 'wide'),
          field('Source', bindText(draft, 'source', { list: 'dl-sources' })),
          field('Priority', bindSelect(draft, 'priority', PRIORITIES, { empty: '—', numeric: true })),
          field('Tags (comma separated)', tagsInput, 'wide'))),
        section('Location & salary', el('div', { class: 'grid' },
          field('City', bindText(draft.location, 'city', { list: 'dl-cities' })),
          field('Country', bindText(draft.location, 'country', { list: 'dl-countries' })),
          field('Work mode', bindSelect(draft.location, 'workMode', WORK_MODES, { empty: '—' })),
          field('Salary min', bindNumber(draft.salary, 'min')),
          field('Salary max', bindNumber(draft.salary, 'max')),
          field('Currency', bindText(draft.salary, 'currency', { list: 'dl-currencies', maxlength: 3 })),
          field('Period', bindSelect(draft.salary, 'period', PERIOD_LABELS, { empty: '—' })))),
        section('Dates', el('div', { class: 'grid' },
          field('Posted', bindDate(draft.dates, 'posted')),
          field('Application deadline', bindDate(draft.dates, 'deadline')),
          field('Applied', appliedInput),
          field('Next follow-up', bindDate(draft.dates, 'nextFollowUp')))),
        section('Status', statusSection(draft, d => { appliedInput.value = d; })),
        section('Interviews', listSection(draft.interviews,
          () => ({ date: null, type: 'video', with: null, notes: null, outcome: 'pending' }),
          iv => el('div', { class: 'grid' },
            field('Date & time', bindDate(iv, 'date', true)),
            field('Type', bindSelect(iv, 'type', INTERVIEW_TYPES)),
            field('With', bindText(iv, 'with')),
            field('Outcome', bindSelect(iv, 'outcome', OUTCOMES)),
            field('Notes', bindText(iv, 'notes'), 'wide')),
          '+ Add interview')),
        section('Contacts', listSection(draft.contacts,
          () => ({ name: null, role: null, email: null, phone: null, linkedin: null }),
          c => el('div', { class: 'grid' },
            field('Name', bindText(c, 'name')),
            field('Role', bindText(c, 'role')),
            field('Email', bindText(c, 'email', { type: 'email' })),
            field('Phone', bindText(c, 'phone', { type: 'tel' })),
            field('LinkedIn', bindText(c, 'linkedin', { type: 'url' }), 'wide')),
          '+ Add contact')),
        section('Documents', docsSentSection(draft)),
        section('Notes', el('textarea', { rows: 4, value: draft.notes ?? '', oninput: e => { draft.notes = e.target.value || null; } }),
          el('label', { class: 'check' },
            el('input', { type: 'checkbox', checked: draft.archived, onchange: e => { draft.archived = e.target.checked; } }),
            ' Archived (hidden unless "Show archived" is on)'))),
      el('footer', { class: 'dlg-actions' },
        isNew ? null : el('button', { type: 'button', class: 'btn ghost danger', text: 'Delete…', onclick: remove }),
        el('span', { class: 'spacer' }), errorBox,
        el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: cancel }),
        el('button', { type: 'submit', class: 'btn primary', text: isNew ? 'Add vacancy' : 'Apply changes' }))));

    dlg.oncancel = e => { e.preventDefault(); cancel(); };
    dlg.showModal();
    const first = dlg.querySelector('.dlg-body input');
    if (isNew && first) first.focus();
  }

  // ───────────────────────── Documents dialog ─────────────────────────
  function slugId(name, taken) {
    const base = (name || 'doc').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'doc';
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    return id;
  }

  function openDocuments(onDone) {
    if (!state.data) return;
    const dlg = $('#docs');
    const draft = structuredClone(state.data.documents);
    const errorBox = el('span', { class: 'form-error', role: 'alert' });
    const usage = id => state.data.vacancies.filter(v => v.documentsSent.cv === id || v.documentsSent.coverLetter === id).length;

    const rows = el('div', { class: 'rows' });
    const draw = () => clear(rows,
      draft.length ? draft.map((d, i) => el('div', { class: 'row-item' },
        el('div', { class: 'grid' },
          field('Name', bindText(d, 'name')),
          field('Type', bindSelect(d, 'type', DOC_TYPES)),
          field('File path or link', bindText(d, 'file'), 'wide'),
          d.id ? el('div', { class: 'muted small', text: `id: ${d.id} · used by ${usage(d.id)} vacancies` }) : null),
        el('button', {
          type: 'button', class: 'btn icon ghost danger', title: 'Remove', 'aria-label': 'Remove document', text: '✕',
          onclick: () => {
            const n = d.id ? usage(d.id) : 0;
            if (n && !confirm(`"${d.name}" is linked to ${n} vacancies. Remove it anyway? Those links will be cleared.`)) return;
            draft.splice(i, 1);
            draw();
          },
        }))) : el('p', { class: 'muted', text: 'No documents yet.' }),
      el('button', { type: 'button', class: 'btn ghost small', text: '+ Add document', onclick: () => { draft.push({ id: null, type: 'cv', name: null, file: null }); draw(); } }));
    draw();

    const submit = () => {
      if (draft.some(d => !d.name || !d.name.trim())) { errorBox.textContent = 'Every document needs a name.'; return; }
      const taken = new Set(draft.filter(d => d.id).map(d => d.id));
      for (const d of draft) {
        d.name = d.name.trim();
        if (!d.id) { d.id = slugId(d.name, taken); taken.add(d.id); }
      }
      for (const v of state.data.vacancies) {
        for (const k of ['cv', 'coverLetter']) if (v.documentsSent[k] && !taken.has(v.documentsSent[k])) v.documentsSent[k] = null;
      }
      state.data.documents = draft;
      dlg.close();
      commit();
      if (onDone) onDone();
    };

    clear(dlg, el('form', { class: 'dlg-form', onsubmit: e => { e.preventDefault(); submit(); } },
      el('header', { class: 'dlg-head' }, el('h2', { text: 'Documents' }),
        el('button', { type: 'button', class: 'btn icon ghost', 'aria-label': 'Close', text: '✕', onclick: () => dlg.close() })),
      el('div', { class: 'dlg-body' },
        el('p', { class: 'muted small', text: 'CV and cover letter versions you send. Each vacancy can point to the ones it received.' }), rows),
      el('footer', { class: 'dlg-actions' }, el('span', { class: 'spacer' }), errorBox,
        el('button', { type: 'button', class: 'btn', text: 'Cancel', onclick: () => dlg.close() }),
        el('button', { type: 'submit', class: 'btn primary', text: 'Apply' }))));
    dlg.oncancel = null;
    dlg.showModal();
  }

  // ───────────────────────── Wiring ─────────────────────────
  function bindChrome() {
    $('#btn-new').addEventListener('click', () => openEditor(null));
    $('#btn-docs').addEventListener('click', () => openDocuments(null));
    $('#btn-save').addEventListener('click', save);
    $('#btn-export').addEventListener('click', () => { exportJson(); if (!canWrite) setDirty(false); });
    $('#btn-start').addEventListener('click', startMyFile);
    $('#btn-open').addEventListener('click', () => $('#file-input').click());
    $('#file-input').addEventListener('change', e => { openFile(e.target.files[0]); e.target.value = ''; });

    document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { state.view = t.dataset.view; renderView(); }));

    const selects = { country: '#f-country', city: '#f-city', workMode: '#f-mode', source: '#f-source', priority: '#f-priority', tag: '#f-tag' };
    for (const [k, sel] of Object.entries(selects)) $(sel).addEventListener('change', e => setFilter(k, e.target.value));
    $('#f-from').addEventListener('change', e => setFilter('from', e.target.value));
    $('#f-to').addEventListener('change', e => setFilter('to', e.target.value));
    $('#f-archived').addEventListener('change', e => setFilter('archived', e.target.checked));
    let qTimer;
    $('#f-q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => setFilter('q', e.target.value), 150); });
    $('#f-reset').addEventListener('click', resetFilters);
    $('#f-toggle').addEventListener('click', () => {
      const open = $('#filters').classList.toggle('open');
      $('#f-toggle').setAttribute('aria-expanded', String(open));
    });

    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (state.data && !document.querySelector('dialog[open]')) save(); }
    });
    window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

    const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
    document.addEventListener('dragover', e => { if (hasFiles(e)) { e.preventDefault(); document.body.classList.add('file-drag'); } });
    document.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('file-drag'); });
    document.addEventListener('drop', e => {
      document.body.classList.remove('file-drag');
      if (hasFiles(e) && e.dataTransfer.files.length) { e.preventDefault(); openFile(e.dataTransfer.files[0]); }
    });
  }

  boot();
})();
