import { ENDPOINTS, OPTIONS } from './endpoints.js';

const API_ORIGIN = 'https://api.myanimelist.net/v2';
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH']);

const byId = (id) => document.getElementById(id);
const dom = {
  endpoints: byId('endpoints'),
  setupInfo: byId('setup-info'),
  auth: byId('auth'),
  title: byId('ep-title'),
  doc: byId('ep-doc'),
  method: byId('method'),
  path: byId('path'),
  authMode: byId('auth-mode'),
  send: byId('send'),
  resolved: byId('resolved'),
  paramsSection: byId('params-section'),
  params: byId('params'),
  query: byId('query'),
  bodySection: byId('body-section'),
  body: byId('body'),
  addQuery: byId('add-query'),
  addBody: byId('add-body'),
  respMeta: byId('resp-meta'),
  paging: byId('paging'),
  respBody: byId('resp-body'),
  tabs: document.querySelectorAll('[data-tab]'),
  toast: byId('toast'),
  loginGate: byId('login-gate'),
};

const state = {
  endpoint: null,
  params: [], // { k, v, options }
  query: [], // { k, v, on, options }
  body: [],
  status: null,
  response: null,
  tab: 'preview',
};

// ---------------------------------------------------------------- helpers

const DOM_PROPS = new Set(['value', 'checked', 'disabled', 'readOnly', 'innerHTML']);

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (DOM_PROPS.has(key)) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false || child === '') continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

/** replaceChildren, skipping null/false placeholders from conditional children. */
function fill(node, ...children) {
  node.replaceChildren(...children.filter((child) => child != null && child !== false));
}

function datalistId(name) {
  if (!name || !OPTIONS[name]) return null;
  const id = `dl-${name}`;
  if (!byId(id)) document.body.append(el('datalist', { id }, OPTIONS[name].map((value) => el('option', { value }))));
  return id;
}

let toastTimer;
function toast(message, kind = 'info', ms = 4000) {
  dom.toast.textContent = message;
  dom.toast.className = `toast ${kind}`;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (dom.toast.hidden = true), ms);
}

async function copy(text) {
  await navigator.clipboard.writeText(text);
  toast('Disalin ke clipboard', 'ok', 1500);
}

const fmtNumber = (n) => Number(n).toLocaleString('id-ID');

function fmtBytes(bytes) {
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`;
}

function fmtRemaining(timestamp) {
  const mins = Math.round((timestamp - Date.now()) / 60000);
  if (mins <= 0) return 'expired';
  if (mins < 60) return `${mins} menit lagi`;
  if (mins < 48 * 60) return `${Math.round(mins / 60)} jam lagi`;
  return `${Math.round(mins / 1440)} hari lagi`;
}

function highlightJson(value) {
  const json = JSON.stringify(value, null, 2) ?? 'null';
  const escaped = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return escaped.replace(
    /("(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'num';
      if (match.startsWith('"')) cls = match.endsWith(':') ? 'key' : 'str';
      else if (match === 'true' || match === 'false') cls = 'bool';
      else if (match === 'null') cls = 'null';
      return `<span class="${cls}">${match}</span>`;
    },
  );
}

// ------------------------------------------------------------------- auth

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    state.status = await res.json();
  } catch {
    state.status = null;
  }
  renderAuth();
}

async function authAction(path, okMessage) {
  try {
    const res = await fetch(path, { method: 'POST' });
    const json = await res.json();
    if (res.ok) toast(okMessage, 'ok');
    else toast(json.error, 'error', 8000);
  } catch (err) {
    toast(err.message, 'error');
  }
  await loadStatus();
}

// Login runs in a popup so the playground (selected endpoint, last response)
// stays intact. The callback page in the popup posts the result back here;
// if that message never arrives, closing the popup triggers a status re-check.
const login = { popup: null, watch: null };

function startLogin() {
  if (login.popup && !login.popup.closed) {
    login.popup.focus();
    return;
  }
  const width = 520;
  const height = 720;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);
  login.popup = window.open('/oauth/login?popup=1', 'mal-login', `popup,width=${width},height=${height},left=${left},top=${top}`);
  if (!login.popup) {
    // Popup blocked: fall back to a full-page redirect.
    location.href = '/oauth/login';
    return;
  }
  clearInterval(login.watch);
  login.watch = setInterval(() => {
    if (login.popup?.closed) stopWaitingForLogin();
  }, 500);
  renderAuth();
}

function cancelLogin() {
  login.popup?.close();
  stopWaitingForLogin();
}

function clearLoginWait() {
  clearInterval(login.watch);
  login.watch = null;
  login.popup = null;
}

async function stopWaitingForLogin() {
  const wasLoggedIn = Boolean(state.status?.loggedIn);
  clearLoginWait();
  await loadStatus();
  if (!wasLoggedIn && state.status?.loggedIn) onLoggedIn(state.status.user?.name);
}

async function onLoggedIn(userName) {
  toast(`Login berhasil sebagai ${userName ?? 'user'} ✓`, 'ok');
  await loadStatus();
  // The request that just failed for lack of login can simply be retried.
  const r = state.response;
  const needsAuth = r && (r.status === 401 || r.localStatus === 401);
  if (needsAuth && dom.method.value === 'GET') send();
}

const handledAuthResults = new Set();

function handleAuthResult(data) {
  if (data?.type !== 'mal-auth' || handledAuthResults.has(data.id)) return;
  handledAuthResults.add(data.id);
  const wasWaiting = login.popup !== null;
  clearLoginWait();
  if (!data.ok) {
    toast(`Login gagal: ${data.error}`, 'error', 10000);
    loadStatus();
  } else if (wasWaiting || !state.status?.loggedIn) {
    onLoggedIn(data.user);
  } else {
    loadStatus();
  }
}

// Primary channel: postMessage from the popup we opened.
window.addEventListener('message', (event) => {
  if (login.popup && event.source === login.popup) handleAuthResult(event.data);
});
// Backup channel for when the browser drops window.opener during the MAL round-trip.
new BroadcastChannel('mal-auth').addEventListener('message', (event) => handleAuthResult(event.data));

function loginButton(label = 'Login dengan MyAnimeList') {
  if (!state.status?.configured) {
    return el('button', { class: 'mal-login', disabled: true, title: 'Isi MAL_CLIENT_ID di .env lalu restart server' }, el('span', { class: 'mal-mark' }, 'MAL'), label);
  }
  if (login.popup) {
    return el(
      'span',
      { class: 'login-wait' },
      el('span', { class: 'spinner' }),
      'Menunggu otorisasi di jendela MAL…',
      el('button', { class: 'ghost small', onclick: () => login.popup?.focus() }, 'Buka'),
      el('button', { class: 'ghost small', onclick: cancelLogin }, 'Batal'),
    );
  }
  return el('button', { class: 'mal-login', onclick: startLogin }, el('span', { class: 'mal-mark' }, 'MAL'), label);
}

function userMenu(s) {
  const name = s.user?.name ?? 'user';
  const avatar = s.user?.picture
    ? el('img', { class: 'avatar', src: s.user.picture, alt: '' })
    : el('span', { class: 'avatar avatar-fallback' }, name[0].toUpperCase());
  const closeMenu = (e) => e.target.closest('details').removeAttribute('open');
  return el(
    'details',
    { class: 'user-menu' },
    el('summary', {}, avatar, el('span', {}, name), el('span', { class: 'muted' }, '▾')),
    el(
      'div',
      { class: 'menu' },
      el('div', { class: 'menu-head' }, el('strong', {}, name), el('div', { class: 'muted small' }, `Token berlaku ${fmtRemaining(s.expiresAt)}`)),
      el('button', { onclick: (e) => { closeMenu(e); openEndpoint('user-me'); } }, 'Lihat profil saya'),
      el('a', { class: 'button', href: `https://myanimelist.net/profile/${encodeURIComponent(name)}`, target: '_blank', rel: 'noreferrer' }, 'Buka profil di MAL ↗'),
      el('button', { onclick: (e) => { closeMenu(e); authAction('/oauth/refresh', 'Token di-refresh'); } }, 'Refresh token'),
      el('button', { class: 'danger', onclick: (e) => { closeMenu(e); authAction('/oauth/logout', 'Logout berhasil'); } }, 'Logout'),
    ),
  );
}

function renderAuth() {
  const s = state.status;
  if (!s) {
    dom.auth.replaceChildren(el('span', { class: 'pill bad' }, 'Server lokal tidak merespon'));
    dom.setupInfo.replaceChildren();
    renderLoginGate();
    return;
  }

  fill(
    dom.auth,
    s.configured ? null : el('span', { class: 'pill bad', title: 'Isi MAL_CLIENT_ID di .env lalu restart server' }, 'Client ID belum diisi'),
    s.loggedIn ? userMenu(s) : loginButton(),
  );

  const oauthProblem = s.oauth?.ok === false ? s.oauth.message : null;
  fill(
    dom.setupInfo,
    el('div', {}, el('strong', {}, 'Login MAL '), oauthProblem ? el('span', { class: 'warn-text' }, '⚠ bermasalah') : s.oauth?.ok ? el('span', { class: 'ok-text' }, '✓ siap') : null),
    oauthProblem ? el('div', { class: 'small warn-text' }, oauthProblem) : null,
    el('div', { class: 'muted small' }, 'App Redirect URL di MAL harus persis:'),
    el('div', { class: 'mono small' }, s.redirectUri),
    s.hasSecret ? null : el('div', { class: 'muted small warn-text' }, 'MAL_CLIENT_SECRET kosong (oke untuk app type "other", wajib untuk "web").'),
  );
  renderLoginGate();
}

function renderLoginGate() {
  const s = state.status;
  const needsLogin = state.endpoint?.auth === 'user' && s && !s.loggedIn;
  dom.loginGate.hidden = !needsLogin;
  if (!needsLogin) return;
  const oauthProblem = s.oauth?.ok === false ? s.oauth.message : null;
  dom.loginGate.replaceChildren(
    el(
      'div',
      { class: 'login-gate-text' },
      el('strong', {}, 'Endpoint ini butuh akses ke akun MAL kamu.'),
      oauthProblem
        ? el('div', { class: 'small warn-text' }, oauthProblem)
        : el('div', { class: 'muted small' }, 'Cukup sekali: klik login, lalu "Allow" di jendela MAL. Login tersimpan & diperpanjang otomatis.'),
    ),
    loginButton('Login & izinkan akses'),
  );
}

// ---------------------------------------------------------------- editor

function authBadge(auth) {
  return auth === 'user'
    ? el('span', { class: 'badge user', title: 'Butuh OAuth login' }, 'login required')
    : el('span', { class: 'badge public', title: 'Cukup X-MAL-CLIENT-ID' }, 'client id');
}

function toRows(rows = []) {
  return rows.map((r) => ({ k: r.k, v: r.v, on: !r.off, options: r.options }));
}

function loadEndpoint(ep, paramValues = {}) {
  state.endpoint = ep;
  state.params = (ep.params ?? []).map((p) => ({ ...p, v: String(paramValues[p.k] ?? p.v) }));
  state.query = toRows(ep.query);
  state.body = toRows(ep.body);
  dom.method.value = ep.method;
  dom.path.value = ep.path;
  dom.authMode.value = 'auto';
  dom.title.replaceChildren(ep.name, ' ', authBadge(ep.auth));
  dom.doc.textContent = ep.doc ?? '';
  renderLoginGate();
  history.replaceState(null, '', `#${ep.id}`);
  renderSidebar();
  renderParams();
  renderRows(dom.query, state.query);
  renderRows(dom.body, state.body);
  updateResolved();
}

function renderSidebar() {
  const groups = Map.groupBy(ENDPOINTS, (ep) => ep.group);
  dom.endpoints.replaceChildren(
    ...[...groups].map(([group, eps]) =>
      el(
        'div',
        { class: 'group' },
        el('div', { class: 'group-title' }, group),
        eps.map((ep) =>
          el(
            'button',
            { class: `ep${ep === state.endpoint ? ' active' : ''}`, onclick: () => loadEndpoint(ep) },
            el('span', { class: `method m-${ep.method.toLowerCase()}` }, ep.method),
            el('span', { class: 'ep-name' }, ep.name),
            ep.auth === 'user' ? el('span', { class: 'lock', title: 'Butuh login' }, '🔒') : null,
          ),
        ),
      ),
    ),
  );
}

function syncParamsFromPath() {
  const names = [...dom.path.value.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
  const previous = new Map(state.params.map((p) => [p.k, p]));
  state.params = names.map((k) => previous.get(k) ?? { k, v: '' });
  renderParams();
  updateResolved();
}

function renderParams() {
  dom.paramsSection.hidden = state.params.length === 0;
  dom.params.replaceChildren(
    ...state.params.map((p) =>
      el(
        'div',
        { class: 'row param' },
        el('span', { class: 'key mono' }, `{${p.k}}`),
        el('input', {
          class: 'mono',
          value: p.v,
          list: datalistId(p.options),
          placeholder: 'wajib diisi',
          oninput: (e) => {
            p.v = e.target.value;
            updateResolved();
          },
        }),
      ),
    ),
  );
}

function renderRows(container, rows) {
  container.replaceChildren(
    ...rows.map((row, index) =>
      el(
        'div',
        { class: `row${row.on ? '' : ' off'}` },
        el('input', {
          type: 'checkbox',
          checked: row.on,
          title: 'Kirim parameter ini',
          onchange: (e) => {
            row.on = e.target.checked;
            e.target.closest('.row').classList.toggle('off', !row.on);
            updateResolved();
          },
        }),
        el('input', {
          class: 'mono key-input',
          value: row.k,
          placeholder: 'key',
          oninput: (e) => {
            row.k = e.target.value;
            updateResolved();
          },
        }),
        el('input', {
          class: 'mono',
          value: row.v,
          placeholder: 'value',
          list: datalistId(row.options),
          oninput: (e) => {
            row.v = e.target.value;
            updateResolved();
          },
        }),
        el(
          'button',
          {
            class: 'icon',
            title: 'Hapus baris',
            onclick: () => {
              rows.splice(index, 1);
              renderRows(container, rows);
              updateResolved();
            },
          },
          '×',
        ),
      ),
    ),
  );
}

function setQuery(key, value) {
  const row = state.query.find((r) => r.k === key);
  if (value == null) {
    if (row) row.on = false;
    return;
  }
  if (row) Object.assign(row, { v: String(value), on: true });
  else state.query.push({ k: key, v: String(value), on: true });
}

function resolvePath() {
  const missing = [];
  const path = dom.path.value.trim().replace(/\{([^}]+)\}/g, (_, key) => {
    const value = (state.params.find((p) => p.k === key)?.v ?? '').trim();
    if (!value) missing.push(key);
    return encodeURIComponent(value).replace(/%40/g, '@');
  });
  return { path, missing };
}

const enabledPairs = (rows) => rows.filter((r) => r.on && r.k.trim()).map((r) => [r.k.trim(), r.v]);

function updateResolved() {
  const { path } = resolvePath();
  const qs = new URLSearchParams(enabledPairs(state.query)).toString();
  const sep = path.includes('?') ? '&' : '?';
  dom.resolved.textContent = `${dom.method.value} ${API_ORIGIN}${path}${qs ? sep + qs : ''}`;
  dom.bodySection.hidden = !BODY_METHODS.has(dom.method.value);
}

// ------------------------------------------------------------------- send

async function send() {
  const { path, missing } = resolvePath();
  if (missing.length) {
    toast(`Isi path param dulu: ${missing.join(', ')}`, 'error');
    return;
  }
  const method = dom.method.value;
  if (method !== 'GET' && !confirm(`${method} ${path}\n\nRequest ini akan mengubah data di akun MAL kamu. Lanjut?`)) return;

  const payload = {
    method,
    path,
    query: enabledPairs(state.query),
    body: BODY_METHODS.has(method) ? enabledPairs(state.body) : [],
    auth: dom.authMode.value,
  };

  dom.send.disabled = true;
  dom.send.textContent = 'Sending…';
  try {
    const res = await fetch('/api/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    state.response = res.ok ? json : { error: json.error ?? `HTTP ${res.status}`, details: json.details, localStatus: res.status };
  } catch (err) {
    state.response = { error: `Gagal menghubungi server lokal: ${err.message}` };
  } finally {
    dom.send.disabled = false;
    dom.send.textContent = 'Send';
  }
  renderResponse();
  loadStatus();
}

function openEndpoint(id, { params = {}, query = {} } = {}) {
  loadEndpoint(ENDPOINTS.find((ep) => ep.id === id), params);
  for (const [key, value] of Object.entries(query)) setQuery(key, value);
  renderRows(dom.query, state.query);
  updateResolved();
  send();
}

const openDetail = (kind, id) => openEndpoint(`${kind}-details`, { params: { [`${kind}_id`]: id } });

function goPage(url) {
  const sp = new URL(url).searchParams;
  setQuery('offset', sp.get('offset') ?? '0');
  if (sp.has('limit')) setQuery('limit', sp.get('limit'));
  renderRows(dom.query, state.query);
  updateResolved();
  send();
}

// --------------------------------------------------------------- response

function renderResponse() {
  const r = state.response;
  dom.paging.replaceChildren();
  if (!r) {
    dom.respMeta.replaceChildren(el('span', { class: 'muted' }, 'Belum ada request. Pilih endpoint lalu klik Send (Ctrl+Enter).'));
    dom.respBody.replaceChildren();
    renderTabs();
    return;
  }
  if (r.error) {
    dom.respMeta.replaceChildren(el('span', { class: 'status bad' }, r.localStatus ? `Proxy ${r.localStatus}` : 'Error'));
    fill(
      dom.respBody,
      el('div', { class: 'error-box' }, r.error),
      r.localStatus === 401 && !state.status?.loggedIn ? loginButton() : null,
      r.details ? el('pre', { class: 'json', innerHTML: highlightJson(r.details) }) : null,
    );
    renderTabs();
    return;
  }

  const statusClass = r.status < 300 ? 'ok' : r.status < 500 ? 'warn' : 'bad';
  fill(
    dom.respMeta,
    el('span', { class: `status ${statusClass}` }, `${r.status} ${r.statusText}`),
    el('span', { class: 'muted' }, `${r.ms} ms`),
    el('span', { class: 'muted' }, fmtBytes(new Blob([JSON.stringify(r.data) ?? '']).size)),
    el('span', { class: 'muted' }, r.request.auth === 'user' ? 'auth: Bearer token' : 'auth: X-MAL-CLIENT-ID'),
    r.request.retriedAfterRefresh ? el('span', { class: 'pill ok' }, 'token di-refresh otomatis') : null,
  );

  const paging = r.data?.paging;
  if (paging?.previous || paging?.next) {
    dom.paging.append(
      el('button', { class: 'ghost', disabled: !paging.previous, onclick: () => goPage(paging.previous) }, '← Prev'),
      el('button', { class: 'ghost', disabled: !paging.next, onclick: () => goPage(paging.next) }, 'Next →'),
    );
  }
  renderTabs();
}

function renderTabs() {
  for (const tab of dom.tabs) tab.classList.toggle('active', tab.dataset.tab === state.tab);
  const r = state.response;
  if (!r || r.error) return;
  const views = {
    preview: () => previewView(r),
    json: () => jsonView(r.data),
    headers: () => kvTable(r.headers),
    code: () => codeView(r.request),
  };
  dom.respBody.replaceChildren(views[state.tab]());
}

function jsonView(data) {
  const text = JSON.stringify(data, null, 2) ?? '';
  return el(
    'div',
    { class: 'code-wrap' },
    el('button', { class: 'ghost small copy', onclick: () => copy(text) }, 'Copy'),
    el('pre', { class: 'json', innerHTML: highlightJson(data) }),
  );
}

function kvTable(obj) {
  return el(
    'table',
    { class: 'kv-table' },
    el(
      'tbody',
      {},
      Object.entries(obj ?? {}).map(([key, value]) =>
        el('tr', {}, el('th', { class: 'mono' }, key), el('td', { class: 'mono' }, typeof value === 'object' ? JSON.stringify(value) : String(value))),
      ),
    ),
  );
}

function codeView(req) {
  const curl = [
    `curl -X ${req.method} '${req.url}'`,
    req.auth === 'user' ? `-H 'Authorization: Bearer <ACCESS_TOKEN>'` : `-H 'X-MAL-CLIENT-ID: <CLIENT_ID>'`,
    ...(req.body ? [`-H 'Content-Type: application/x-www-form-urlencoded'`, `--data '${req.body}'`] : []),
  ].join(' \\\n  ');

  const headerLines = [
    req.auth === 'user' ? `Authorization: 'Bearer ' + ACCESS_TOKEN,` : `'X-MAL-CLIENT-ID': CLIENT_ID,`,
    ...(req.body ? [`'Content-Type': 'application/x-www-form-urlencoded',`] : []),
  ];
  const fetchCode = [
    `const res = await fetch('${req.url}', {`,
    `  method: '${req.method}',`,
    `  headers: {`,
    ...headerLines.map((line) => `    ${line}`),
    `  },`,
    ...(req.body ? [`  body: '${req.body}',`] : []),
    `});`,
    `const data = await res.json();`,
  ].join('\n');

  const block = (title, text) =>
    el(
      'div',
      { class: 'code-wrap' },
      el('h3', {}, title),
      el('button', { class: 'ghost small copy', onclick: () => copy(text) }, 'Copy'),
      el('pre', { class: 'json' }, text),
    );

  return el(
    'div',
    {},
    el('p', { class: 'muted' }, 'Panggil API MAL dari backend kamu, bukan langsung dari browser: Client ID/Secret & token jangan sampai bocor ke frontend.'),
    block('cURL', curl),
    block('fetch (Node / server-side)', fetchCode),
  );
}

function stat(label, value) {
  if (value == null || value === '') return null;
  return el('div', { class: 'stat' }, el('span', { class: 'muted' }, label), el('strong', {}, String(value)));
}

function errorHint(r) {
  if (/client id/i.test(r.data?.message ?? '')) {
    return el('div', { class: 'muted' }, 'Client ID ditolak MAL: cek MAL_CLIENT_ID di .env lalu restart server.');
  }
  const hints = {
    400: 'Parameter tidak valid: cek query/body.',
    401: r.request.auth === 'user' ? 'Token invalid/expired: coba Refresh token atau login ulang.' : 'Endpoint ini butuh akses akun MAL kamu: login dulu.',
    403: 'Ditolak: cek MAL_CLIENT_ID di .env, atau resource ini memang tidak boleh diakses.',
    404: 'Tidak ditemukan: cek id / path.',
  };
  if (!hints[r.status]) return null;
  const showLogin = r.status === 401 && !state.status?.loggedIn;
  return el('div', { class: 'muted' }, hints[r.status], showLogin ? el('div', { class: 'hint-action' }, loginButton()) : null);
}

function previewView(r) {
  const d = r.data;
  const kind = /\/manga|mangalist/.test(new URL(r.request.url).pathname) ? 'manga' : 'anime';

  if (r.status >= 400) {
    const message = d && typeof d === 'object' ? [d.error, d.message].filter(Boolean).join(': ') : String(d ?? '');
    return el('div', {}, el('div', { class: 'error-box' }, message || `HTTP ${r.status}`), errorHint(r));
  }
  if (d == null || d === '') return el('div', { class: 'empty' }, 'Sukses: response body kosong.');
  if (typeof d !== 'object') return el('pre', { class: 'json' }, String(d));
  if (Array.isArray(d.data) && d.data.length === 0) return el('div', { class: 'empty' }, 'Hasil kosong.');
  if (Array.isArray(d.data) && d.data[0]?.node) return el('div', { class: 'grid' }, d.data.map((item) => card(item, kind)));
  if (Array.isArray(d.categories)) return boardsView(d.categories);
  if (Array.isArray(d.data) && 'number_of_posts' in d.data[0]) return topicsView(d.data);
  if (Array.isArray(d.data?.posts)) return topicView(d.data);
  if (d.id && d.title) return detailView(d, kind);
  if (d.id && d.name) return userView(d);
  if (!Array.isArray(d)) return kvTable(d);
  return el('div', { class: 'empty' }, 'Tidak ada preview khusus: lihat tab JSON.');
}

function card(item, kind) {
  const n = item.node;
  const ls = item.list_status ?? n.my_list_status;
  const meta = [
    item.ranking?.rank ? `#${item.ranking.rank}` : null,
    n.mean ? `★ ${n.mean}` : null,
    n.media_type?.toUpperCase(),
    n.num_episodes ? `${n.num_episodes} eps` : null,
    n.num_chapters ? `${n.num_chapters} ch` : null,
    n.start_season ? `${n.start_season.season} ${n.start_season.year}` : null,
  ].filter(Boolean);
  const picture = n.main_picture?.medium ?? n.main_picture?.large;
  return el(
    'button',
    { class: 'card', title: 'Buka detail', onclick: () => openDetail(kind, n.id) },
    picture ? el('img', { src: picture, alt: '', loading: 'lazy' }) : el('div', { class: 'noimg' }, 'no image'),
    el(
      'div',
      { class: 'card-body' },
      el('div', { class: 'card-title' }, n.title),
      meta.length ? el('div', { class: 'card-meta' }, meta.join(' · ')) : null,
      ls ? el('div', { class: 'card-list' }, [ls.status, ls.score ? `skor ${ls.score}` : null].filter(Boolean).join(' · ')) : null,
      el('div', { class: 'muted small mono' }, `id ${n.id}`),
    ),
  );
}

function relatedSection(title, items, kind) {
  if (!items?.length) return null;
  return el(
    'div',
    { class: 'related' },
    el('h3', {}, title),
    el(
      'div',
      { class: 'mini-grid' },
      items.map((it) =>
        el(
          'button',
          { class: 'mini', onclick: () => openDetail(kind, it.node.id) },
          it.node.main_picture ? el('img', { src: it.node.main_picture.medium, alt: '', loading: 'lazy' }) : null,
          el('span', {}, it.node.title),
          el('span', { class: 'muted small' }, it.relation_type_formatted ?? (it.num_recommendations ? `${it.num_recommendations} rekomendasi` : '')),
        ),
      ),
    ),
  );
}

function detailView(d, kind) {
  const alt = d.alternative_titles;
  const people =
    kind === 'anime'
      ? d.studios?.map((s) => s.name).join(', ')
      : d.authors?.map((a) => [a.node.first_name, a.node.last_name].filter(Boolean).join(' ') + (a.role ? ` (${a.role})` : '')).join(', ');
  const picture = d.main_picture?.large ?? d.main_picture?.medium;
  return el(
    'div',
    { class: 'detail' },
    el(
      'div',
      { class: 'detail-side' },
      picture ? el('img', { src: picture, alt: '' }) : null,
      el('div', { class: 'muted small mono' }, `${kind} id ${d.id}`),
      el('a', { href: `https://myanimelist.net/${kind}/${d.id}`, target: '_blank', rel: 'noreferrer' }, 'Buka di MAL ↗'),
    ),
    el(
      'div',
      { class: 'detail-main' },
      el('h2', {}, d.title),
      alt ? el('div', { class: 'muted' }, [alt.en, alt.ja].filter(Boolean).join(' · ')) : null,
      el(
        'div',
        { class: 'stats' },
        stat('Score', d.mean != null ? `${d.mean}${d.num_scoring_users ? ` (${fmtNumber(d.num_scoring_users)} user)` : ''}` : null),
        stat('Rank', d.rank ? `#${d.rank}` : null),
        stat('Popularity', d.popularity ? `#${d.popularity}` : null),
        stat('Members', d.num_list_users ? fmtNumber(d.num_list_users) : null),
        stat('Type', d.media_type),
        stat('Status', d.status),
        stat('Episodes', d.num_episodes || null),
        stat('Chapters', d.num_chapters || null),
        stat('Volumes', d.num_volumes || null),
        stat('Season', d.start_season ? `${d.start_season.season} ${d.start_season.year}` : null),
        stat('Tanggal', d.start_date ? `${d.start_date} → ${d.end_date ?? '?'}` : null),
        stat('Source', d.source),
        stat('Rating', d.rating),
        stat(kind === 'anime' ? 'Studios' : 'Authors', people || null),
        stat('Serialization', d.serialization?.map((s) => s.node.name).join(', ') || null),
      ),
      d.genres?.length ? el('div', { class: 'chips' }, d.genres.map((g) => el('span', { class: 'chip' }, g.name))) : null,
      d.my_list_status
        ? el('div', { class: 'list-status' }, el('strong', {}, 'My list: '), Object.entries(d.my_list_status).map(([k, v]) => `${k}=${v}`).join(' · '))
        : null,
      d.synopsis ? el('p', { class: 'synopsis' }, d.synopsis) : null,
      relatedSection('Related anime', d.related_anime, 'anime'),
      relatedSection('Related manga', d.related_manga, 'manga'),
      relatedSection('Recommendations', d.recommendations, kind),
    ),
  );
}

function userView(u) {
  return el(
    'div',
    { class: 'detail' },
    el('div', { class: 'detail-side' }, u.picture ? el('img', { src: u.picture, alt: '' }) : null),
    el(
      'div',
      { class: 'detail-main' },
      el('h2', {}, u.name),
      el(
        'div',
        { class: 'stats' },
        stat('User id', u.id),
        stat('Joined', u.joined_at ? new Date(u.joined_at).toLocaleDateString('id-ID') : null),
        stat('Location', u.location),
        stat('Gender', u.gender),
        stat('Birthday', u.birthday),
        stat('Time zone', u.time_zone),
        stat('Supporter', u.is_supporter == null ? null : u.is_supporter ? 'ya' : 'tidak'),
      ),
      u.anime_statistics ? [el('h3', {}, 'Anime statistics'), kvTable(u.anime_statistics)] : null,
    ),
  );
}

function boardsView(categories) {
  const openTopics = (filter) => openEndpoint('forum-topics', { query: { q: null, board_id: null, subboard_id: null, ...filter } });
  return el(
    'div',
    { class: 'forum' },
    categories.map((category) =>
      el(
        'div',
        {},
        el('h3', {}, category.title),
        category.boards.map((board) =>
          el(
            'div',
            { class: 'forum-item' },
            el('button', { class: 'link', onclick: () => openTopics({ board_id: board.id }) }, board.title),
            el('span', { class: 'muted small mono' }, ` board_id ${board.id}`),
            board.description ? el('div', { class: 'muted small' }, board.description) : null,
            board.subboards?.length
              ? el(
                  'div',
                  { class: 'chips' },
                  board.subboards.map((sub) =>
                    el('button', { class: 'chip', onclick: () => openTopics({ subboard_id: sub.id }) }, `${sub.title} (${sub.id})`),
                  ),
                )
              : null,
          ),
        ),
      ),
    ),
  );
}

function topicsView(topics) {
  return el(
    'div',
    { class: 'forum' },
    topics.map((t) =>
      el(
        'button',
        { class: 'forum-item clickable', onclick: () => openEndpoint('forum-topic', { params: { topic_id: t.id } }) },
        el('strong', {}, t.title),
        el(
          'div',
          { class: 'muted small' },
          [`id ${t.id}`, t.created_by?.name && `oleh ${t.created_by.name}`, `${t.number_of_posts} post`, t.last_post_created_at && `terakhir ${new Date(t.last_post_created_at).toLocaleString('id-ID')}`]
            .filter(Boolean)
            .join(' · '),
        ),
      ),
    ),
  );
}

function topicView(topic) {
  return el(
    'div',
    { class: 'forum' },
    el('h2', {}, topic.title),
    topic.posts.map((p) =>
      el(
        'div',
        { class: 'forum-item' },
        el('div', { class: 'muted small' }, `#${p.number} · ${p.created_by?.name ?? '?'} · ${new Date(p.created_at).toLocaleString('id-ID')}`),
        el('div', { class: 'post-body' }, p.body),
      ),
    ),
  );
}

// ------------------------------------------------------------------- init

dom.path.addEventListener('input', syncParamsFromPath);
dom.method.addEventListener('change', updateResolved);
dom.send.addEventListener('click', send);
dom.addQuery.addEventListener('click', () => {
  state.query.push({ k: '', v: '', on: true });
  renderRows(dom.query, state.query);
});
dom.addBody.addEventListener('click', () => {
  state.body.push({ k: '', v: '', on: true });
  renderRows(dom.body, state.body);
});
for (const tab of dom.tabs) {
  tab.addEventListener('click', () => {
    state.tab = tab.dataset.tab;
    renderTabs();
  });
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    send();
  }
});
document.addEventListener('click', (e) => {
  for (const menu of document.querySelectorAll('.user-menu[open]')) {
    if (!menu.contains(e.target)) menu.removeAttribute('open');
  }
});

const search = new URLSearchParams(location.search);
if (search.has('login')) toast('Login MAL berhasil ✓', 'ok');
if (search.has('auth_error')) toast(`Login gagal: ${search.get('auth_error')}`, 'error', 10000);

loadEndpoint(ENDPOINTS.find((ep) => ep.id === location.hash.slice(1)) ?? ENDPOINTS[0]);
history.replaceState(null, '', location.pathname + location.hash);
renderResponse();
loadStatus();
