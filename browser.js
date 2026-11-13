// Bot browsers: one long-lived headless Chromium per bot, like the preview in Claude Code desktop.
// The Browser plugin (Playwright MCP) attaches to it over CDP, so the page the bot works on is the one
// you watch live in the chat's Browser pane, and you can click, type or take over (to sign in, say).
// Its profile lives in the bot's folder, so sign-ins survive restarts. Uses Node's built-in WebSocket.
import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { botDir } from './db.js';

const IDLE_MS = 60 * 60_000; // close a browser nobody has used or watched for an hour
const W = 1280, H = 800;
const browsers = new Map(); // "<bot>" or "<bot>@<person>" -> { proc, port, ready, page, viewers:Set, info, used }

export function findChrome() {
  if (process.env.NIMBUS_CHROME) return process.env.NIMBUS_CHROME;
  const pw = process.env.PLAYWRIGHT_BROWSERS_PATH || (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || '', 'ms-playwright') : path.join(os.homedir(), '.cache', 'ms-playwright'));
  try {
    const dirs = fs.readdirSync(pw).filter((d) => /^chromium-\d+$/.test(d)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const d of dirs) for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome', 'chrome-win/chrome.exe', 'chrome-win64/chrome.exe']) {
      const p = path.join(pw, d, sub);
      if (fs.existsSync(p)) return p;
    }
  } catch {}
  const names = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe')]
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/snap/bin/chromium'];
  return names.find((p) => fs.existsSync(p)) || null;
}

const freePort = () => new Promise((ok, fail) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); }).on('error', fail);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cdpJson = (port, p, method = 'GET') => fetch(`http://127.0.0.1:${port}${p}`, { method, signal: AbortSignal.timeout(3000) }).then((r) => r.json());

// Headless Chromium says "HeadlessChrome" in its user agent, and some sites refuse it as an unsupported
// browser. Present the same version as plain desktop Chrome instead.
let UA = null;
function userAgent(chrome) {
  if (UA) return UA;
  let v = '';
  try { v = (execFileSync(chrome, ['--version'], { timeout: 10_000 }).toString().match(/(\d+)\.\d+\.\d+\.\d+/) || [])[1] || ''; } catch {}
  return (UA = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v || '140'}.0.0.0 Safari/537.36`);
}

// Start (or reuse) the bot's browser; resolves to its CDP port.
export function ensureBrowser(botId) {
  botId = String(botId);
  const b = browsers.get(botId);
  if (b && !b.proc.killed && b.proc.exitCode === null) { b.used = Date.now(); return b.ready; }
  const chrome = findChrome();
  if (!chrome) return Promise.reject(new Error('No Chromium found. Install it with: npx playwright install chromium (or set NIMBUS_CHROME).'));
  const nb = { proc: null, port: 0, page: null, viewers: new Set(), info: { url: '', title: '' }, used: Date.now() };
  nb.ready = (async () => {
    nb.port = await freePort();
    // "5" is the bot's shared browser (its shared chat); "5@12" is person 12's own browser for a private chat,
    // so one person's sign-ins never show up for someone else.
    const [bot, user] = botId.split('@');
    const profile = path.join(botDir(Number(bot)), user ? `browser-profile-u${Number(user)}` : 'browser-profile');
    // --no-sandbox: Ubuntu 23.10+ blocks Chromium's sandbox for unprivileged users (AppArmor), as Playwright does by default.
    nb.proc = spawn(chrome, ['--headless=new', '--no-sandbox', `--remote-debugging-port=${nb.port}`, '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${profile}`, `--window-size=${W},${H}`, `--user-agent=${userAgent(chrome)}`, '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage', 'about:blank'],
      { stdio: 'ignore' });
    nb.proc.on('exit', () => { if (browsers.get(botId) === nb) browsers.delete(botId); nb.page?.ws.close(); for (const v of nb.viewers) v({ type: 'closed' }); });
    for (let i = 0; i < 60; i++) { try { await cdpJson(nb.port, '/json/version'); return nb.port; } catch { await sleep(250); } }
    nb.proc.kill();
    throw new Error('The browser didn’t start. On the server, as root: npx playwright install-deps chromium');
  })();
  browsers.set(botId, nb);
  nb.ready.catch(() => browsers.delete(botId));
  return nb.ready;
}

export function closeBrowser(botId) { browsers.get(String(botId))?.proc.kill(); }
export const browserRunning = (botId) => browsers.has(String(botId));

// ---------- live view ----------
// The pane follows the tab most recently brought to front (Chrome lists pages by recency).
async function attach(botId, nb) {
  const pages = (await cdpJson(nb.port, '/json/list')).filter((t) => t.type === 'page');
  const target = pages[0] || await cdpJson(nb.port, '/json/new?about:blank', 'PUT');
  if (nb.page?.id === target.id) return;
  nb.page?.ws.close();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const page = { id: target.id, ws, seq: 0, pending: new Map() };
  page.send = (method, params = {}) => new Promise((ok, fail) => {
    if (ws.readyState !== 1) return fail(new Error('Browser not connected'));
    const id = ++page.seq; page.pending.set(id, { ok, fail }); ws.send(JSON.stringify({ id, method, params }));
  });
  nb.page = page;
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id) { const p = page.pending.get(m.id); page.pending.delete(m.id); return m.error ? p?.fail(new Error(m.error.message)) : p?.ok(m.result); }
    if (m.method === 'Page.screencastFrame') {
      page.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
      const md = m.params.metadata;
      nb.last = { type: 'frame', data: m.params.data, w: md.deviceWidth, h: md.deviceHeight };
      for (const v of nb.viewers) v(nb.last);
    }
    if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) { nb.info.url = m.params.frame.url; publishInfo(nb); }
  };
  ws.onclose = () => { if (nb.page === page) nb.page = null; for (const p of page.pending.values()) p.fail(new Error('closed')); };
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = () => fail(new Error('Couldn’t connect to the browser')); });
  nb.info = { url: target.url, title: target.title };
  publishInfo(nb);
  await page.send('Page.enable');
  await applyView(nb);
}
// The page is sized to fit the pane you watch it in (at your screen's pixel density), so it fills it sharply.
async function applyView(nb) {
  const s = nb.page?.send; if (!s) return;
  const { w, h, dpr } = nb.view || { w: W, h: H, dpr: 1 };
  if (nb.view) await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
  await s('Page.stopScreencast').catch(() => {});
  await s('Page.startScreencast', { format: 'jpeg', quality: 75, maxWidth: Math.round(w * dpr), maxHeight: Math.round(h * dpr), everyNthFrame: 1 });
}
function publishInfo(nb) { for (const v of nb.viewers) v({ type: 'info', ...nb.info }); }

// Watch a bot's browser. send(event) gets {type:'frame'|'info'|'closed'|'error'}; returns an unsubscribe function.
export async function watchBrowser(botId, send) {
  botId = String(botId);
  await ensureBrowser(botId);
  const nb = browsers.get(botId);
  nb.viewers.add(send);
  await attach(botId, nb);
  if (nb.last) send(nb.last);
  send({ type: 'info', ...nb.info });
  // Follow new tabs and titles; screencasts only send frames when something changes.
  const timer = setInterval(async () => {
    try {
      const pages = (await cdpJson(nb.port, '/json/list')).filter((t) => t.type === 'page');
      if (pages[0] && pages[0].id !== nb.page?.id) await attach(botId, nb);
      const cur = pages.find((p) => p.id === nb.page?.id);
      if (cur && (cur.title !== nb.info.title || cur.url !== nb.info.url)) { nb.info = { url: cur.url, title: cur.title }; publishInfo(nb); }
    } catch {}
  }, 1500);
  return () => { clearInterval(timer); nb.viewers.delete(send); nb.used = Date.now(); };
}

// Address bar: a URL opens it; anything else is a web search.
export function toUrl(text) {
  const s = String(text || '').trim();
  if (/^[a-z][\w+.-]*:\/\//i.test(s) || /^(about|data|view-source):/i.test(s)) return s;
  if (/^(localhost|[\w-]+(\.[\w-]+)+|\d+\.\d+\.\d+\.\d+)(:\d+)?(\/\S*)?$/i.test(s) && !/\s/.test(s)) return (/^(localhost|\d)/.test(s) ? 'http://' : 'https://') + s;
  return 'https://duckduckgo.com/?q=' + encodeURIComponent(s);
}

const KEYS = { Enter: 13, Backspace: 8, Tab: 9, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
// What you do in the pane: { action: 'navigate'|'back'|'forward'|'reload'|'click'|'scroll'|'key'|'text', ... }
export async function browserInput(botId, a) {
  const nb = browsers.get(String(botId));
  if (!nb?.page) throw new Error('The browser isn’t open.');
  nb.used = Date.now();
  const s = nb.page.send;
  switch (a.action) {
    case 'navigate': return s('Page.navigate', { url: toUrl(a.url) });
    case 'back': case 'forward': return s('Runtime.evaluate', { expression: `history.${a.action}()` });
    case 'reload': return s('Page.reload');
    case 'resize': {
      const w = Math.max(320, Math.min(2560, Math.round(Number(a.w) || W))), h = Math.max(240, Math.min(1600, Math.round(Number(a.h) || H)));
      const dpr = Math.max(1, Math.min(2, Number(a.dpr) || 1));
      if (nb.view && nb.view.w === w && nb.view.h === h && nb.view.dpr === dpr) return;
      nb.view = { w, h, dpr };
      return applyView(nb);
    }
    case 'click': {
      const p = { x: Number(a.x), y: Number(a.y), button: 'left', clickCount: 1 };
      await s('Input.dispatchMouseEvent', { type: 'mouseMoved', ...p });
      await s('Input.dispatchMouseEvent', { type: 'mousePressed', ...p });
      return s('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p });
    }
    case 'scroll': return s('Input.dispatchMouseEvent', { type: 'mouseWheel', x: Number(a.x), y: Number(a.y), deltaX: Number(a.dx) || 0, deltaY: Number(a.dy) || 0 });
    // Mouse down/move/up, so you can drag to select text.
    case 'mouse': {
      const type = { down: 'mousePressed', move: 'mouseMoved', up: 'mouseReleased' }[a.type]; if (!type) return;
      return s('Input.dispatchMouseEvent', { type, x: Number(a.x), y: Number(a.y), button: a.type === 'move' && !a.held ? 'none' : 'left', buttons: a.held || a.type === 'down' ? 1 : 0, clickCount: 1 });
    }
    // Ctrl+C / Ctrl+X: hand back the page's selected text (in a text box too) for your clipboard. Ctrl+A selects all.
    case 'copy': case 'cut': {
      const r = await s('Runtime.evaluate', { returnByValue: true, expression: `(() => { const e = document.activeElement;
        if (e && (e.tagName === 'TEXTAREA' || (e.tagName === 'INPUT' && /^(text|search|url|email|tel|password|number)$/i.test(e.type))) && e.selectionStart !== e.selectionEnd) {
          const t = e.value.slice(e.selectionStart, e.selectionEnd); ${a.action === 'cut' ? "document.execCommand('delete');" : ''} return t; }
        const t = String(getSelection()); ${a.action === 'cut' ? "if (t) document.execCommand('delete');" : ''} return t; })()` });
      return { text: r?.result?.value || '' };
    }
    case 'selectall': return s('Runtime.evaluate', { expression: `(() => { const e = document.activeElement; if (e && e.select && /^(INPUT|TEXTAREA)$/.test(e.tagName)) e.select(); else document.execCommand('selectAll'); })()` });
    case 'text': return s('Input.insertText', { text: String(a.text || '').slice(0, 2000) });
    case 'key': {
      const code = KEYS[a.key]; if (!code) return;
      const k = { key: a.key, code: a.key, windowsVirtualKeyCode: code, ...(a.key === 'Enter' ? { text: '\r' } : {}) };
      await s('Input.dispatchKeyEvent', { type: 'keyDown', ...k });
      return s('Input.dispatchKeyEvent', { type: 'keyUp', ...k });
    }
  }
}

setInterval(() => {
  for (const [id, nb] of browsers) if (!nb.viewers.size && Date.now() - nb.used > IDLE_MS) closeBrowser(id);
}, 60_000).unref();
process.on('exit', () => { for (const nb of browsers.values()) nb.proc?.kill(); });
