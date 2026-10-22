import http from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(ROOT, '.env');
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const CLIENT_ID = (process.env.MAL_CLIENT_ID ?? '').trim();
const CLIENT_SECRET = (process.env.MAL_CLIENT_SECRET ?? '').trim();
// Must equal the app's "App Redirect URL" on MAL exactly; checked at startup.
const REDIRECT_URI = (process.env.MAL_REDIRECT_URI ?? '').trim() || `http://localhost:${PORT}/oauth/callback`;
const CALLBACK_PATH = new URL(REDIRECT_URI).pathname;

const API_BASE = 'https://api.myanimelist.net/v2';
const AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';
const TOKEN_FILE = path.join(ROOT, '.mal-token.json');
const PUBLIC_DIR = path.join(ROOT, 'public');

const ALLOWED_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const AUTH_MODES = new Set(['auto', 'user', 'client']);
const PENDING_LOGIN_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 60 * 1000;
const MAX_BODY_BYTES = 64 * 1024;
const OAUTH_CHECK_TTL_MS = 60 * 1000;
const MAL_PROBE_TIMEOUT_MS = 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Token storage (persisted to .mal-token.json so restarts keep the login)
// ---------------------------------------------------------------------------

/** @type {null | { token_type: string, access_token: string, refresh_token: string, expires_at: number, user?: { id: number, name: string, picture?: string } }} */
let token = null;
let refreshInFlight = null;
/** state -> { verifier, createdAt } */
const pendingLogins = new Map();

async function loadToken() {
  try {
    token = JSON.parse(await readFile(TOKEN_FILE, 'utf8'));
  } catch {
    token = null;
  }
}

async function saveToken(next) {
  token = next;
  await writeFile(TOKEN_FILE, JSON.stringify(next, null, 2));
  return next;
}

async function clearToken() {
  token = null;
  await rm(TOKEN_FILE, { force: true });
}

async function parseBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function requestToken(params) {
  const body = new URLSearchParams({ client_id: CLIENT_ID, ...params });
  if (CLIENT_SECRET) body.set('client_secret', CLIENT_SECRET);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await parseBody(res);
  if (!res.ok) {
    const reason = (data && typeof data === 'object' && (data.hint || data.message || data.error)) || `HTTP ${res.status}`;
    throw new HttpError(res.status, `Token request gagal: ${reason}`, data);
  }
  return {
    token_type: data.token_type,
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000,
  };
}

function refreshToken() {
  if (!token?.refresh_token) return Promise.reject(new HttpError(401, 'Belum login.'));
  refreshInFlight ??= requestToken({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
    .then((next) => saveToken({ ...next, user: token?.user }))
    .catch(async (err) => {
      // Refresh token rejected by MAL -> session is dead, force a fresh login.
      if (err.status === 400 || err.status === 401) await clearToken();
      throw err;
    })
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

async function getAccessToken() {
  if (!token) return null;
  if (token.expires_at - REFRESH_MARGIN_MS <= Date.now()) await refreshToken();
  return token?.access_token ?? null;
}

async function fetchMe(accessToken) {
  const res = await fetch(`${API_BASE}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) return undefined;
  const me = await res.json();
  return { id: me.id, name: me.name, picture: me.picture };
}

// ---------------------------------------------------------------------------
// OAuth2 (Authorization Code + PKCE "plain" — the only method MAL supports)
// ---------------------------------------------------------------------------

function authorizeUrl(state, verifier, redirectUri = REDIRECT_URI) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    state,
    code_challenge: verifier,
    code_challenge_method: 'plain',
  });
  if (redirectUri) params.set('redirect_uri', redirectUri);
  return `${AUTHORIZE_URL}?${params}`;
}

async function probeAuthorize(redirectUri) {
  const res = await fetch(authorizeUrl('probe', 'p'.repeat(43), redirectUri), {
    redirect: 'manual',
    headers: { Accept: 'text/html' },
    signal: AbortSignal.timeout(MAL_PROBE_TIMEOUT_MS),
  });
  // A valid request is bounced to MAL's login/consent page; a bad one gets a 4xx JSON error.
  if (res.status >= 300 && res.status < 400) return { accepted: true };
  const data = await parseBody(res);
  return { accepted: false, reason: (data && typeof data === 'object' && (data.message || data.error)) || `HTTP ${res.status}` };
}

/** @type {null | { at: number, result: { ok: boolean | null, message?: string } }} */
let oauthCheck = null;

/**
 * Asks MAL's authorize endpoint whether it would accept our login request, so a
 * misconfiguration surfaces as a readable message instead of MAL's raw
 * `{"error":"invalid_client"}` page. ok: null means MAL couldn't be reached.
 */
async function checkOAuthConfig({ fresh = false } = {}) {
  if (!CLIENT_ID) return { ok: false, message: 'MAL_CLIENT_ID belum di-set di .env.' };
  if (!fresh && oauthCheck && Date.now() - oauthCheck.at < OAUTH_CHECK_TTL_MS) return oauthCheck.result;
  let result;
  try {
    const probe = await probeAuthorize(REDIRECT_URI);
    if (probe.accepted) {
      result = { ok: true };
    } else if ((await probeAuthorize(null)).accepted) {
      result = {
        ok: false,
        message:
          `"App Redirect URL" di pengaturan app MAL belum sama dengan ${REDIRECT_URI}, jadi setelah Allow MAL akan melempar kamu ke alamat lain. ` +
          `Buka https://myanimelist.net/apiconfig → Edit app → isi App Redirect URL persis: ${REDIRECT_URI} → Submit, lalu coba login lagi.`,
      };
    } else {
      result = { ok: false, message: `MAL menolak Client ID untuk login (${probe.reason}). Cek MAL_CLIENT_ID di .env.` };
    }
  } catch (err) {
    result = { ok: null, message: `Tidak bisa mengecek konfigurasi login ke MAL: ${err.cause?.code ?? err.message}` };
  }
  oauthCheck = { at: Date.now(), result };
  return result;
}

async function startLogin(res, popup) {
  const check = await checkOAuthConfig({ fresh: true });
  if (check.ok === false) return sendCallbackPage(res, { ok: false, error: check.message }, popup ? 'popup' : 'page');

  const now = Date.now();
  for (const [state, entry] of pendingLogins) {
    if (now - entry.createdAt > PENDING_LOGIN_TTL_MS) pendingLogins.delete(state);
  }
  const state = randomBytes(16).toString('hex');
  // 64 random bytes -> 86 base64url chars, inside PKCE's 43..128 [A-Za-z0-9-._~] range.
  const verifier = randomBytes(64).toString('base64url');
  pendingLogins.set(state, { verifier, createdAt: now, popup });
  redirect(res, authorizeUrl(state, verifier));
}

async function finishLogin(params, res) {
  const state = params.get('state') ?? '';
  const pending = pendingLogins.get(state);
  pendingLogins.delete(state);
  const mode = pending ? (pending.popup ? 'popup' : 'page') : 'auto';
  const fail = (error) => sendCallbackPage(res, { ok: false, error }, mode);

  const error = params.get('error');
  if (error === 'access_denied') return fail('Akses ditolak di halaman MAL.');
  if (error) return fail(params.get('message') || params.get('hint') || error);
  if (!pending || Date.now() - pending.createdAt > PENDING_LOGIN_TTL_MS) {
    return fail('Sesi login kedaluwarsa. Coba login ulang.');
  }
  const code = params.get('code');
  if (!code) return fail('MAL tidak mengirim authorization code.');

  try {
    const next = await requestToken({
      grant_type: 'authorization_code',
      code,
      code_verifier: pending.verifier,
      redirect_uri: REDIRECT_URI,
    });
    next.user = await fetchMe(next.access_token).catch(() => undefined);
    await saveToken(next);
    sendCallbackPage(res, { ok: true, user: next.user?.name ?? null }, mode);
  } catch (err) {
    fail(err.message);
  }
}

/**
 * Final page of the OAuth round-trip. The result carries no credentials (only
 * ok / user name / error text).
 *   popup: hand the result to the playground (opener postMessage + BroadcastChannel) and close.
 *   page:  full-page fallback (popup was blocked) -> redirect back home.
 *   auto:  unknown login attempt -> popup behaviour if there is an opener, else page.
 */
function sendCallbackPage(res, result, mode) {
  const payload = { type: 'mal-auth', id: randomBytes(8).toString('hex'), ...result };
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  const html = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${result.ok ? 'Login berhasil' : 'Login gagal'} · MAL API Playground</title>
<link rel="stylesheet" href="/style.css">
</head>
<body class="callback">
<main class="callback-card">
  <div class="callback-icon ${result.ok ? 'ok' : 'bad'}">${result.ok ? '✓' : '✕'}</div>
  <h1 id="title"></h1>
  <p id="message" class="muted"></p>
  <button id="close" class="primary" hidden>Tutup jendela</button>
</main>
<script>
const result = ${json};
const mode = ${JSON.stringify(mode)};
document.getElementById('title').textContent = result.ok
  ? 'Login berhasil' + (result.user ? ' sebagai ' + result.user : '')
  : 'Login gagal';
const message = document.getElementById('message');
if (mode === 'popup' || (mode === 'auto' && window.opener)) {
  try { window.opener?.postMessage(result, '*'); } catch {}
  try { const channel = new BroadcastChannel('mal-auth'); channel.postMessage(result); channel.close(); } catch {}
  message.textContent = result.ok ? 'Jendela ini akan tertutup otomatis…' : result.error;
  const closeBtn = document.getElementById('close');
  closeBtn.hidden = false;
  closeBtn.onclick = () => window.close();
  if (result.ok) {
    setTimeout(() => {
      window.close();
      // Still here: the browser refused to close it.
      setTimeout(() => { message.textContent = 'Silakan tutup jendela ini dan kembali ke playground.'; }, 300);
    }, 800);
  }
} else {
  message.textContent = 'Kembali ke playground…';
  location.replace(result.ok ? '/?login=ok' : '/?auth_error=' + encodeURIComponent(result.error));
}
</script>
</body>
</html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

// ---------------------------------------------------------------------------
// API proxy: the browser can't call api.myanimelist.net directly (no CORS, and
// credentials must stay server-side), so the UI sends request specs here.
// ---------------------------------------------------------------------------

function toPairs(value, label) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, `${label} harus array of [key, value].`);
  return value
    .filter((pair) => Array.isArray(pair) && pair[0])
    .map(([key, val]) => [String(key), val == null ? '' : String(val)]);
}

async function proxyRequest(input) {
  if (!CLIENT_ID) throw new HttpError(500, 'MAL_CLIENT_ID belum di-set di .env (lihat .env.example), lalu restart server.');

  const method = String(input.method ?? 'GET').toUpperCase();
  if (!ALLOWED_METHODS.has(method)) throw new HttpError(400, `Method ${method} tidak didukung.`);

  const rawPath = String(input.path ?? '');
  if (!rawPath.startsWith('/')) throw new HttpError(400, 'Path harus diawali "/" (contoh: /anime).');
  const url = new URL(API_BASE + rawPath);
  if (url.origin !== 'https://api.myanimelist.net' || !url.pathname.startsWith('/v2/')) {
    throw new HttpError(400, 'Path harus mengarah ke https://api.myanimelist.net/v2/...');
  }
  for (const [key, val] of toPairs(input.query, 'query')) url.searchParams.append(key, val);

  const mode = input.auth ?? 'auto';
  if (!AUTH_MODES.has(mode)) throw new HttpError(400, `Auth mode "${mode}" tidak dikenal.`);
  const useUserToken = mode === 'user' || (mode === 'auto' && token !== null);

  const baseHeaders = { Accept: 'application/json' };
  let body;
  const bodyPairs = toPairs(input.body, 'body');
  if (bodyPairs.length && method !== 'GET' && method !== 'DELETE') {
    body = new URLSearchParams(bodyPairs).toString();
    baseHeaders['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  const send = async () => {
    const headers = { ...baseHeaders };
    if (useUserToken) {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new HttpError(401, 'Request ini pakai user token, tapi kamu belum login. Klik "Login MAL" dulu.');
      headers.Authorization = `Bearer ${accessToken}`;
    } else {
      headers['X-MAL-CLIENT-ID'] = CLIENT_ID;
    }
    return fetch(url, { method, headers, body });
  };

  const started = performance.now();
  let res = await send();
  let retriedAfterRefresh = false;
  if (res.status === 401 && useUserToken && token?.refresh_token) {
    await refreshToken();
    res = await send();
    retriedAfterRefresh = true;
  }
  const data = await parseBody(res);
  const ms = Math.round(performance.now() - started);

  return {
    request: {
      method,
      url: url.toString(),
      auth: useUserToken ? 'user' : 'client',
      body: body ?? null,
      retriedAfterRefresh,
    },
    status: res.status,
    statusText: res.statusText,
    ms,
    headers: Object.fromEntries(res.headers),
    data,
  };
}

// ---------------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------------

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}

async function readJson(req) {
  // Requiring application/json forces a CORS preflight, so other websites
  // can't silently drive this proxy (e.g. PATCH your list) from your browser.
  if (!String(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new HttpError(415, 'Content-Type harus application/json.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body terlalu besar.');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new HttpError(400, 'Body harus JSON valid.');
  }
}

async function statusPayload() {
  return {
    configured: Boolean(CLIENT_ID),
    hasSecret: Boolean(CLIENT_SECRET),
    redirectUri: REDIRECT_URI,
    oauth: await checkOAuthConfig(),
    loggedIn: token !== null,
    user: token?.user ?? null,
    expiresAt: token?.expires_at ?? null,
  };
}

async function serveStatic(pathname, res) {
  let rel;
  try {
    rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch {
    throw new HttpError(400, 'Path tidak valid.');
  }
  const file = path.resolve(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(404, 'Not found');
  let content;
  try {
    content = await readFile(file);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(content);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === CALLBACK_PATH) return await finishLogin(url.searchParams, res);

    switch (`${req.method} ${url.pathname}`) {
      case 'GET /api/status':
        return sendJson(res, 200, await statusPayload());
      case 'POST /api/request':
        return sendJson(res, 200, await proxyRequest(await readJson(req)));
      case 'GET /oauth/login':
        return await startLogin(res, url.searchParams.has('popup'));
      case 'POST /oauth/refresh':
        await refreshToken();
        return sendJson(res, 200, await statusPayload());
      case 'POST /oauth/logout':
        await clearToken();
        return sendJson(res, 200, await statusPayload());
    }

    if (req.method === 'GET') return await serveStatic(url.pathname, res);
    throw new HttpError(404, 'Not found');
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    const message = err.cause ? `${err.message}: ${err.cause.code ?? err.cause.message}` : err.message;
    if (res.headersSent) res.end();
    else sendJson(res, status, { error: message, details: err.details });
  }
});

await loadToken();
server.listen(PORT, HOST, async () => {
  console.log(`MAL API Playground jalan di http://localhost:${PORT}`);
  if (!CLIENT_ID) console.warn('! MAL_CLIENT_ID kosong: salin .env.example ke .env, isi, lalu restart.');
  if (token) console.log(`Token tersimpan ditemukan${token.user ? ` (user: ${token.user.name})` : ''}.`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
  if (!CLIENT_ID) return;
  const check = await checkOAuthConfig();
  if (check.ok) console.log('Konfigurasi login MAL: OK');
  else console.warn(`! Login MAL bermasalah: ${check.message}`);
});
