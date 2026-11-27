// Nimbus server: one HTTP(S) server for the app, its API (route table below), login, live updates (SSE), the hooks
// bots call while they run, and the proxies for bot computers and code previews. Feature areas live in their own
// modules (files, docs, code, threads, extras*, pro, pc) and register their routes here. API list: docs/API.md.
import http from 'node:http';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, q, parseBot, botDir, writeBotBrief, DATA_DIR, getSetting, setSetting } from './db.js';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { redact } from './redact.js';
import { addClient, broadcast } from './events.js';
import { execFile, execFileSync, spawn } from 'node:child_process';
import * as Docs from './docs.js';
import { UPLOADS, MAX_UPLOAD, safeName, uploadPath, readUpload, saveUpload, addVersion, registerFiles, deleteUploads } from './files.js';
import { claudeEnv, claudeStatus, setClaudeToken, TOKEN_RE } from './claudeauth.js';
import { CLAUDE_BIN, computersOn, agentConfig, agent, runBot, stopRun, addMessage, updateMessage, botStatus, roomMembers, findMentions, markTraceWaiting, recoverRuns, HOOK_TOKEN, contextReport, cancelQueued, editQueued, threadLimit, allBots } from './runner.js';
import * as TH from './threads.js';
import * as Code from './code.js';
import { createGate, rememberRule } from './gate.js';
import { registerSpeech } from './speech.js';
import { botCommands } from './slash.js';
import { loadTools, approveTool, runTool, SCAN_PROMPT } from './apitools.js';
import { ensureBrowser, watchBrowser, browserInput, closeBrowser, listTabs, tabAction } from './browser.js';
import { TEMPLATES, PLUGINS, publicPlugin } from './catalog.js';
import { startScheduler, nextRun, isValidCron } from './scheduler.js';
import { getPlanUsage, getModels } from './planusage.js';
import { registerPages } from './pages.js';
import { registerAutomation, startAutomation, moods } from './automation.js';
import { registerHomelab, startHomelab, journalBefore, planAllows } from './homelab.js';
import { registerWidgets } from './widgets.js';
import { registerAiTools, startAiTools, autoApprove } from './aitools.js';
import { registerCodeIde, PROBE } from './codeide.js';
import { pluginCatalog, setPlugin } from './ccplugins.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const PORT = Number(process.env.PORT || 8787);
process.env.PORT = String(PORT);
// Address to listen on: 0.0.0.0 = every interface (default); 127.0.0.1 = this machine only, or a reverse proxy's address.
const HOST = process.env.NIMBUS_HOST || process.env.HOST || '0.0.0.0';
const PASSWORD = process.env.NIMBUS_PASSWORD || '';
const ALLOWED_EMAILS = (process.env.NIMBUS_ALLOWED_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const WINDOW_BUDGET = Number(process.env.NIMBUS_WINDOW_BUDGET_USD || 0);
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

recoverRuns();
startScheduler();
startAutomation();
startHomelab();
startAiTools();

// ---------- approvals ----------
const waiters = new Map(); // approvalId -> Set(resolve)
function notifyApproval(id) {
  for (const fn of waiters.get(id) || []) fn();
  waiters.delete(id);
}

// ---------- helpers ----------
const json = (res, code, data) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(data)); };
async function body(req, limit = 2e6) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > limit) throw new Error('too large'); }
  return s ? JSON.parse(s) : {};
}
// Last lines of each bot's MEMORY.md, read again only when the file changes.
const memCache = new Map(); // botId -> { mtime, lines }
function tailMemory(botId, n = 3) {
  const f = path.join(botDir(botId), 'MEMORY.md');
  let mtime; try { mtime = fs.statSync(f).mtimeMs; } catch { return []; }
  let c = memCache.get(botId);
  if (!c || c.mtime !== mtime) {
    try { c = { mtime, lines: fs.readFileSync(f, 'utf8').split('\n').map((l) => l.replace(/^[-*]\s*/, '').trim()).filter((l) => l && !l.startsWith('#')) }; } catch { return []; }
    memCache.set(botId, c);
  }
  return c.lines.slice(-n);
}
// Today's runs and pending approvals for every bot, in one query each (not two per bot).
function botViews(bots) {
  const today = new Map(q("SELECT bot_id, COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost, COALESCE(SUM(ended_at-started_at),0) AS secs FROM runs WHERE started_at >= unixepoch('now','localtime','start of day','utc') GROUP BY bot_id").all().map((r) => [r.bot_id, r]));
  const pending = new Set(q("SELECT DISTINCT bot_id FROM approvals WHERE status='pending'").all().map((r) => r.bot_id));
  return bots.map((b) => {
    const t = today.get(b.id);
    return { ...b, status: pending.has(b.id) ? { state: 'waiting', label: 'Waiting on you' } : botStatus.get(b.id) || { state: 'idle', label: 'Idle' },
      today: { runs: t?.runs || 0, cost: t?.cost || 0, secs: t?.secs || 0 } };
  });
}

function state(req) {
  const bots = botViews(q('SELECT * FROM bots ORDER BY id').all().map(parseBot));
  const rooms = q('SELECT * FROM rooms ORDER BY id').all().map((r) => ({ ...r, members: roomMembers(r.id).map((m) => m.id) }));
  const approvals = q("SELECT * FROM approvals WHERE status='pending' ORDER BY id").all().map((a) => ({ ...a, input: JSON.parse(a.input || '{}') }));
  const routines = q('SELECT * FROM routines ORDER BY id').all();
  const upNext = routines.filter((r) => r.enabled).map((r) => ({ ...r, next: nextRun(r.cron)?.getTime() }))
    .filter((r) => r.next).sort((a, b) => a.next - b.next).slice(0, 6);
  const learned = bots.flatMap((b) => tailMemory(b.id, 2).map((text) => ({ botId: b.id, text }))).slice(-5);
  const windowCost = q("SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE started_at >= unixepoch() - 5*3600").get().c;
  const running = q("SELECT COUNT(*) AS n FROM runs WHERE status='running'").get().n;
  // Share of the last 7 days' usage per bot (Claude Code's reported cost, used as a relative measure).
  const byBot = q("SELECT bot_id, COUNT(*) AS runs, COALESCE(SUM(cost_usd),0) AS cost FROM runs WHERE started_at >= unixepoch() - 7*86400 GROUP BY bot_id ORDER BY cost DESC").all();
  const last = {};
  for (const m of q(`SELECT m.thread, m.author, m.kind, m.body, m.created_at FROM messages m
      JOIN (SELECT thread, MAX(id) AS id FROM messages WHERE kind IN ('text','error','approval') GROUP BY thread) x ON x.id = m.id`).all()) {
    let text = m.body;
    if (m.kind === 'approval') { try { text = 'Needs approval: ' + JSON.parse(m.body).tool; } catch {} }
    last[m.thread] = { author: m.author, text: String(text).replace(/\s+/g, ' ').slice(0, 120), at: m.created_at };
  }
  const botPlugins = {};
  for (const r of q('SELECT * FROM bot_plugins').all()) (botPlugins[r.bot_id] ||= []).push(r.plugin_id);
  for (const b of bots) b.plugins = botPlugins[b.id] || [];
  const installed = q('SELECT id FROM plugins').all().map((r) => r.id);
  const sideOrder = JSON.parse(getSetting('side_order') || 'null'); // custom sidebar order, or null = most recent first
  const sideGroups = JSON.parse(getSetting('side_groups') || '[]'); // sidebar groups: [{ id, name, collapsed, keys }]
  const { threads, projects } = TH.listAll();
  const busyThreads = q("SELECT DISTINCT thread FROM runs WHERE status='running'").all().map((r) => r.thread);
  return { moods: moods(), busyThreads, sideOrder, sideGroups, threads, projects, threadLimit: threadLimit(), bots, rooms, approvals, routines, upNext, learned, last, installed, user: req?.user || null, computers: computersOn(), claude: claudeStatus(), usage: { windowCost, budget: WINDOW_BUDGET, running, byBot } };
}

function postToThread(thread, text, files = [], voice = null) {
  if (thread.startsWith('t:')) {
    const t = TH.threadRow(thread);
    if (!t) throw Object.assign(new Error('This thread was deleted'), { status: 404 });
    if (t.kind === 'inbox') throw Object.assign(new Error('The Inbox is for requests from other bots. Message the bot in another thread.'), { status: 403 });
  } else if (!/^(bot|room):\d+$/.test(thread)) throw Object.assign(new Error('Unknown chat'), { status: 404 });
  files = files.map((f) => addVersion(thread, f, 'user:0')); // attachments join the chat's Files (same name = next version)
  const msg = addMessage(thread, 'user', 'text', text, null, files);
  // Bots see attachments as file paths; Claude Code's Read tool opens images and PDFs too.
  if (files.length) text = `${text || 'See the attached files.'}\n\nAttached files (open them with the Read tool):\n` + files.map((f) => `- ${uploadPath(f)} (${f.type || 'file'}, ${f.size} bytes)`).join('\n');
  if (thread.startsWith('bot:') || thread.startsWith('t:')) {
    TH.autoTitle(thread, msg.body);
    // API tools run since the bot last worked here: tell it what the user saw, so it can answer about it.
    const notes = toolNotes.get(thread);
    if (notes?.length) { toolNotes.delete(thread); text = `(Before this message, the user ran your API tools in Nimbus. What they saw:\n${notes.join('\n\n').slice(-6000)}\n)\n\n` + text; }
    // Nimbus Code: "@Name do this" sends it to that bot in the project (each bot keeps its own conversation here).
    const code = Code.threadCode(thread);
    const targets = code ? findMentions(text, allBots()) : [];
    if (targets.length) for (const b of targets) runBot({ botId: b.id, thread, prompt: text, msgId: b === targets[0] ? msg.id : null, msgText: msg.body, source: 'the user' });
    else runBot({ botId: TH.threadBot(thread), thread, prompt: text, msgId: msg.id, msgText: msg.body, voice });
  } else if (thread.startsWith('room:')) {
    const roomId = Number(thread.slice(5));
    const room = q('SELECT * FROM rooms WHERE id=?').get(roomId);
    const members = roomMembers(roomId);
    let targets = findMentions(text, members);
    if (!targets.length) targets = members.filter((m) => m.id === room.lead_bot_id);
    if (!targets.length && members[0]) targets = [members[0]];
    for (const t of targets) runBot({ botId: t.id, thread, prompt: text, source: 'the user' });
  }
  return msg;
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/state', (req, res) => json(res, 200, state(req)));

route('GET', '/api/events', (req, res) => {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  res.write('retry: 3000\n\n');
  addClient(res);
});

route('GET', '/api/threads/:thread/messages', (req, res, p, url) => {
  const before = Number(url.searchParams.get('before') || 1e15);
  const rows = q('SELECT * FROM messages WHERE thread=? AND id<? ORDER BY id DESC LIMIT 80').all(decodeURIComponent(p.thread), before).reverse();
  json(res, 200, rows);
});

route('POST', '/api/threads/:thread/messages', async (req, res, p) => {
  const { text = '', files: ids = [], voice } = await body(req);
  const files = (Array.isArray(ids) ? ids : []).slice(0, 10).map(readUpload).filter(Boolean);
  if (!String(text).trim() && !files.length) return json(res, 400, { error: 'empty' });
  try { json(res, 200, postToThread(decodeURIComponent(p.thread), String(text).trim(), files, ['fast', 'bot'].includes(voice) ? voice : null)); }
  catch (e) { json(res, e.status || 500, { error: e.message }); }
});

// A message waiting in the bot's queue: change it or take it back before the bot starts.
route('POST', '/api/messages/:id/queued', async (req, res, p) => {
  const id = Number(p.id), { action, text = '' } = await body(req);
  const row = q('SELECT * FROM messages WHERE id=?').get(id);
  if (!row || !row.queued) return json(res, 409, { error: 'The bot already started on this message' });
  if (action === 'cancel') {
    if (!cancelQueued(id)) return json(res, 409, { error: 'The bot already started on this message' });
    q('DELETE FROM messages WHERE id=?').run(id);
    broadcast('message_delete', { id, thread: row.thread });
    return json(res, 200, { ok: true });
  }
  if (action === 'edit') {
    const t = redact(String(text).trim().slice(0, 100_000));
    if (!t) return json(res, 400, { error: 'empty' });
    if (!editQueued(id, t)) return json(res, 409, { error: 'The bot already started on this message' });
    q('UPDATE messages SET body=? WHERE id=?').run(t, id);
    broadcast('message_update', q('SELECT * FROM messages WHERE id=?').get(id));
    return json(res, 200, { ok: true });
  }
  json(res, 400, { error: 'bad action' });
});

// ---------- uploads ----------
// Each upload lives in data/uploads/<id>/ with the original file and meta.json (see files.js).
route('POST', '/api/uploads', async (req, res) => {
  const { name, type, data } = await body(req, Math.ceil(MAX_UPLOAD * 1.4) + 1000);
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) return json(res, 400, { error: 'Empty file' });
  if (buf.length > MAX_UPLOAD) return json(res, 413, { error: 'Files can be up to 20 MB' });
  json(res, 200, saveUpload(name, buf, type ? { type: String(type).slice(0, 100) } : {}));
});
const INLINE = /^image\/(png|jpe?g|gif|webp|avif)$|^application\/pdf$/;
route('GET', '/api/files/:id/:name', (req, res, p, url) => {
  const f = readUpload(p.id);
  if (!f) return json(res, 404, { error: 'not found' });
  // Only safe types open in the browser; anything else (HTML, SVG…) downloads, so it can't run script here.
  // A web page a bot made, shown in Nimbus: its own sandboxed origin (it can run scripts but never reach Nimbus or your
  // session), so the app's script rules don't have to allow inline scripts.
  if (url.searchParams.has('sandbox') && (/\.html?$/i.test(f.name) || f.type === 'text/html')) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': f.size, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=31536000, immutable',
      'content-security-policy': "sandbox allow-scripts allow-forms allow-modals allow-popups; frame-ancestors 'self'" });
    return fs.createReadStream(uploadPath(f)).pipe(res);
  }
  const inline = INLINE.test(f.type) && !url.searchParams.has('download');
  res.writeHead(200, { 'content-type': inline ? f.type : 'application/octet-stream', 'content-length': f.size, 'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'", 'cache-control': 'private, max-age=31536000, immutable',
    'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}` });
  fs.createReadStream(uploadPath(f)).pipe(res);
});

// Files a bot sends into its chat (bin/send-file.mjs). Office files and PDFs get a first-page preview
// image rendered with LibreOffice + pdftoppm, when they're installed.
const OFFICE_RE = /\.(docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;
const FILE_MIME = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', csv: 'text/csv', txt: 'text/plain', md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
const runQuiet = (cmd, args, opts = {}) => new Promise((resolve) => execFile(cmd, args, { timeout: 90_000, ...opts }, (err) => resolve(!err)));
async function renderPreview(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-prev-'));
  try {
    let pdf = file;
    if (OFFICE_RE.test(file)) {
      // A private LibreOffice profile per render, so it never clashes with another instance.
      await runQuiet('soffice', [`-env:UserInstallation=file://${tmp}/lo`, '--headless', '--convert-to', 'pdf', '--outdir', tmp, file]);
      pdf = path.join(tmp, path.basename(file).replace(/\.[^.]+$/, '.pdf'));
    }
    if (!fs.existsSync(pdf)) return null;
    if (!(await runQuiet('pdftoppm', ['-png', '-r', '60', '-f', '1', '-l', '1', '-singlefile', pdf, path.join(tmp, 'page')]))) return null;
    const png = path.join(tmp, 'page.png');
    return fs.existsSync(png) ? fs.readFileSync(png) : null;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
route('POST', '/api/hook/send-file', async (req, res) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const { runId, path: file, caption } = await body(req);
  const run = q("SELECT * FROM runs WHERE id=? AND status='running'").get(Number(runId));
  if (!run) return json(res, 400, { error: 'That run isn’t active' });
  // Only files from the bot's own workspace or the temp folder (not e.g. the server's .env).
  const real = (() => { try { return fs.realpathSync(String(file)); } catch { return null; } })();
  const allowed = [botDir(run.bot_id), os.tmpdir()].map((d) => fs.realpathSync(d) + path.sep);
  if (!real || !allowed.some((d) => real.startsWith(d))) return json(res, 400, { error: 'Put the file in your workspace folder (or /tmp) first' });
  const st = fs.statSync(real);
  if (!st.isFile()) return json(res, 400, { error: 'Not a file' });
  if (st.size > 50 * 1024 * 1024) return json(res, 413, { error: 'Files can be up to 50 MB' });
  const ext = path.extname(real).slice(1).toLowerCase();
  // Each file joins the chat's Files (same name = next version).
  const f = addVersion(run.thread, saveUpload(path.basename(real), fs.readFileSync(real), { type: FILE_MIME[ext] || 'application/octet-stream' }), `bot:${run.bot_id}`);
  if (OFFICE_RE.test(real) || ext === 'pdf') {
    const png = await renderPreview(real).catch(() => null);
    if (png) { const pv = saveUpload(f.name.replace(/\.[^.]+$/, '') + '-preview.png', png, { type: 'image/png' }); f.preview = { id: pv.id, name: pv.name }; fs.writeFileSync(path.join(UPLOADS, f.id, 'meta.json'), JSON.stringify(f)); }
  }
  addMessage(run.thread, run.bot_id, 'text', String(caption || '').slice(0, 2000), run.id, [f]);
  broadcast('docs_changed', { thread: run.thread });
  json(res, 200, { ok: true, name: f.name, size: f.size, preview: !!f.preview });
});

// ---------- live documents (docs.js) ----------
// People edit through /api/docs, bots through /api/hook/docs (bin/doc.mjs). Every change is broadcast so
// open editors update live.
const docFail = (res, e) => json(res, e instanceof Docs.DocError ? (e.code === 'not_found' ? 404 : e.code === 'guard_mismatch' ? 409 : e.code === 'unavailable' ? 503 : 400) : 500,
  { error: e.message, code: e.code || 'error', ...(e.block ? { block: e.block } : {}) });
const docChanged = (id, actor, extra = {}) => broadcast('doc_changed', { id, rev: Docs.getDoc(id)?.rev, actor, ...extra });
const docView = (d) => d && { ...d, blocks: Docs.getBlocks(d.id), comments: Docs.listComments(d.id) };
async function sendDocExport(res, id, format) {
  try {
    const f = await Docs.exportDoc(id, format);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': f.buf.length, 'x-content-type-options': 'nosniff',
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` });
    res.end(f.buf);
  } catch (e) { docFail(res, e); }
}
route('GET', '/api/docs', (req, res) => json(res, 200, q('SELECT id, title, bot_id, thread, rev, updated_at FROM docs ORDER BY updated_at DESC LIMIT 200').all()));
route('POST', '/api/docs', async (req, res) => {
  const { title, markdown } = await body(req);
  try { const d = Docs.createDoc({ title: title || 'Untitled', markdown, actor: 'you' }); json(res, 200, docView(Docs.getDoc(d.id))); } catch (e) { docFail(res, e); }
});
route('GET', '/api/docs/:id', (req, res, p) => { const d = Docs.getDoc(p.id); d ? json(res, 200, docView(d)) : json(res, 404, { error: 'No such document' }); });
route('POST', '/api/docs/:id/ops', async (req, res, p) => {
  try { const r = Docs.applyOps(p.id, await body(req), 'you'); docChanged(p.id, 'you', { blocks: r.blocks.map((b) => b.id) }); json(res, 200, r); } catch (e) { docFail(res, e); }
});
route('DELETE', '/api/docs/:id', (req, res, p) => {
  for (const t of ['doc_blocks', 'doc_versions', 'doc_comments']) q(`DELETE FROM ${t} WHERE doc_id=?`).run(p.id);
  q('DELETE FROM docs WHERE id=?').run(p.id);
  broadcast('doc_changed', { id: p.id, deleted: true });
  json(res, 200, { ok: true });
});
route('GET', '/api/docs/:id/versions', (req, res, p) => json(res, 200, Docs.listVersions(p.id)));
route('POST', '/api/docs/:id/restore', async (req, res, p) => {
  try { const r = Docs.restoreVersion(p.id, (await body(req)).rev, 'you'); docChanged(p.id, 'you'); json(res, 200, r); } catch (e) { docFail(res, e); }
});
route('POST', '/api/docs/:id/comments', async (req, res, p) => {
  try { const r = Docs.addComment(p.id, await body(req), 'you'); docChanged(p.id, 'you', { comments: true }); json(res, 200, r); } catch (e) { docFail(res, e); }
});
route('POST', '/api/docs/:id/comments/:cid/resolve', async (req, res, p) => {
  Docs.resolveComment(p.id, p.cid, (await body(req)).resolved !== false); docChanged(p.id, 'you', { comments: true }); json(res, 200, { ok: true });
});
// Pictures in documents (pasted, dropped or added by a bot).
route('GET', '/api/docs/:id/img/:name', (req, res, p) => {
  const file = Docs.getDoc(p.id) && Docs.imagePath(p.id, p.name);
  if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
  res.writeHead(200, { 'content-type': Docs.imageType(p.name), 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=31536000, immutable', 'content-security-policy': "default-src 'none'" });
  fs.createReadStream(file).pipe(res);
});
route('POST', '/api/docs/:id/images', async (req, res, p) => {
  if (!Docs.getDoc(p.id)) return json(res, 404, { error: 'No such document' });
  const { name, data } = await body(req, 15 * 1024 * 1024);
  try { json(res, 200, Docs.saveImage(p.id, Buffer.from(String(data || ''), 'base64'), String(name || 'image.png'))); } catch (e) { docFail(res, e); }
});
route('GET', '/api/docs/:id/export/:format', (req, res, p) => sendDocExport(res, p.id, p.format));

// Bot side. A bot may use documents it created, or any document in the chat it's working in.
const docRate = new Map(); // runId -> recent call times
function hookDoc(req, res, runId, docId) {
  if (!hookAuth(req)) { json(res, 403, { error: 'forbidden' }); return null; }
  const run = q("SELECT * FROM runs WHERE id=? AND status='running'").get(Number(runId));
  if (!run) { json(res, 400, { error: 'That run isn’t active' }); return null; }
  const now = Date.now(), hits = (docRate.get(run.id) || []).filter((t) => now - t < 60_000);
  if (hits.length >= 120) { json(res, 429, { error: 'Too many document calls; slow down' }); return null; }
  docRate.set(run.id, [...hits, now]);
  if (docId) {
    const d = Docs.getDoc(docId);
    if (!d || (d.bot_id !== run.bot_id && d.thread !== run.thread)) { json(res, 404, { error: 'No such document (or not yours)' }); return null; }
  }
  return run;
}
const botActor = (run) => q('SELECT name FROM bots WHERE id=?').get(run.bot_id)?.name || 'Bot';
// "Used docs": one line in the chat per run that lists what the bot did to which document (read, edit, comment, image).
const docUse = new Map(); // runId -> { msgId, body }
function noteDocUse(run, docId, act) {
  const d = Docs.getDoc(docId); if (!d) return;
  let u = docUse.get(run.id);
  if (!u) { u = { body: { docs: [] } }; docUse.set(run.id, u); }
  let e = u.body.docs.find((x) => x.id === docId);
  if (!e) u.body.docs.push(e = { id: docId, title: d.title, acts: [] });
  e.title = d.title;
  if (e.acts[e.acts.length - 1] === act) return; // "Read doc, Read doc" reads the same as once
  e.acts.push(act);
  if (u.msgId) updateMessage(u.msgId, u.body);
  else u.msgId = addMessage(run.thread, run.bot_id, 'docuse', u.body, run.id).id;
  if (docUse.size > 500) docUse.delete(docUse.keys().next().value);
}
route('POST', '/api/hook/docs', async (req, res) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId);
  if (!run) return;
  try {
    const d = Docs.createDoc({ title: b.title || '', markdown: b.markdown || '', botId: run.bot_id, thread: run.thread, actor: botActor(run) });
    addMessage(run.thread, run.bot_id, 'doc', { docId: d.id, title: Docs.getDoc(d.id).title }, run.id);
    json(res, 200, d);
  } catch (e) { docFail(res, e); }
});
route('POST', '/api/hook/docs/list', async (req, res) => {
  const run = hookDoc(req, res, (await body(req)).runId);
  if (!run) return;
  json(res, 200, q('SELECT id, title, rev, updated_at FROM docs WHERE bot_id=? OR thread=? ORDER BY updated_at DESC LIMIT 50').all(run.bot_id, run.thread));
});
route('POST', '/api/hook/docs/:id/read', async (req, res, p) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId, p.id);
  if (!run) return;
  try {
    const r = Docs.readDoc(p.id, b);
    noteDocUse(run, p.id, 'read');
    // Comments come along with the outline so bots can answer them; their text is data, not instructions.
    if ((b.view || 'outline') === 'outline') r.comments = Docs.listComments(p.id).filter((c) => !c.resolved).map(({ id, block_id, quote, body: text, author, parent }) => ({ id, block: block_id, quote, text, author, parent }));
    json(res, 200, r);
  } catch (e) { docFail(res, e); }
});
route('POST', '/api/hook/docs/:id/ops', async (req, res, p) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId, p.id);
  if (!run) return;
  try { const r = Docs.applyOps(p.id, b, botActor(run)); noteDocUse(run, p.id, 'edit'); docChanged(p.id, botActor(run), { blocks: r.blocks.map((x) => x.id) }); json(res, 200, r); } catch (e) { docFail(res, e); }
});
route('POST', '/api/hook/docs/:id/comment', async (req, res, p) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId, p.id);
  if (!run) return;
  try {
    if (b.resolve) Docs.resolveComment(p.id, b.resolve, true);
    const r = b.body ? Docs.addComment(p.id, b, botActor(run)) : { ok: true };
    noteDocUse(run, p.id, 'comment');
    docChanged(p.id, botActor(run), { comments: true }); json(res, 200, r);
  } catch (e) { docFail(res, e); }
});
// A bot adds a picture from its workspace: returns the Markdown to use, or inserts it after a block (or at the end).
route('POST', '/api/hook/docs/:id/image', async (req, res, p) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId, p.id);
  if (!run) return;
  const real = (() => { try { return fs.realpathSync(String(b.path)); } catch { return null; } })();
  const allowed = [botDir(run.bot_id), os.tmpdir()].map((d) => fs.realpathSync(d) + path.sep);
  if (!real || !allowed.some((d) => real.startsWith(d)) || !fs.statSync(real).isFile()) return json(res, 400, { error: 'Put the image in your workspace folder (or /tmp) first' });
  try {
    const img = Docs.saveImage(p.id, fs.readFileSync(real), path.basename(real));
    if (b.after !== undefined) {
      const target = b.after ? { blocks: [String(b.after)] } : { at: 'end' };
      const r = Docs.applyOps(p.id, { ops: [{ op: 'insert', target, side: 'after', source: { markdown: img.markdown } }] }, botActor(run));
      docChanged(p.id, botActor(run), { blocks: r.blocks.map((x) => x.id) });
      img.block = r.created[0];
    }
    noteDocUse(run, p.id, 'image');
    json(res, 200, img);
  } catch (e) { docFail(res, e); }
});
route('POST', '/api/hook/docs/:id/export', async (req, res, p) => {
  const b = await body(req);
  const run = hookDoc(req, res, b.runId, p.id);
  if (!run) return;
  try {
    const f = await Docs.exportDoc(p.id, b.format || 'docx');
    const up = addVersion(run.thread, saveUpload(f.name, f.buf, { type: f.type }), `bot:${run.bot_id}`);
    if (f.type === 'application/pdf' || /\.docx$/.test(f.name)) {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-exp-')), file = path.join(tmp, f.name);
      fs.writeFileSync(file, f.buf);
      const png = await renderPreview(file).catch(() => null);
      fs.rmSync(tmp, { recursive: true, force: true });
      if (png) { const pv = saveUpload(f.name.replace(/\.[^.]+$/, '') + '-preview.png', png, { type: 'image/png' }); up.preview = { id: pv.id, name: pv.name }; fs.writeFileSync(path.join(UPLOADS, up.id, 'meta.json'), JSON.stringify(up)); }
    }
    addMessage(run.thread, run.bot_id, 'text', String(b.caption || '').slice(0, 2000), run.id, [up]);
    json(res, 200, { ok: true, name: f.name, size: f.buf.length });
  } catch (e) { docFail(res, e); }
});

// Models the Claude login (pasted token or the server's) can use, for the bot model dropdown.
route('GET', '/api/models', async (req, res) => json(res, 200, await getModels(claudeEnv().CLAUDE_CODE_OAUTH_TOKEN || null)));

// Files in a chat: versions, previews (files.js).
registerFiles(route, { json, body, broadcast, addNote: (thread, text, files) => addMessage(thread, 'system', 'note', text, null, files) });

// Feature modules all get the same context and add their own routes.
const featureCtx = { json, body, q, DATA_DIR, broadcast, postToThread };
for (const register of [registerSpeech, registerPages, registerAutomation, registerHomelab, registerAiTools, registerCodeIde]) register(route, featureCtx);
registerWidgets(route, { json, body, hookAuth });

// Restart the service once no bot is mid-run (a restart kills running bots, including one that asked for it).
// Needs a sudoers rule letting this user run `systemctl restart nimbus`.
let restartPending = false;
route('POST', '/api/admin/restart', (req, res) => {
  if (!restartPending) {
    restartPending = true;
    const tick = () => {
      const busy = q("SELECT COUNT(*) AS n FROM runs WHERE status IN ('running','queued')").get().n;
      if (busy) return setTimeout(tick, 3000);
      execFile('sudo', ['-n', '/usr/bin/systemctl', 'restart', 'nimbus'], (err) => { if (err) { restartPending = false; console.error('restart failed:', err.message); } });
    };
    setTimeout(tick, 1000);
  }
  json(res, 200, { ok: true, note: 'Nimbus restarts as soon as no bot is running.' });
});

// Bots
function cleanBot(b) {
  const out = {};
  for (const k of ['name', 'role', 'instructions', 'color', 'model', 'shape']) if (b[k] !== undefined) out[k] = String(b[k]);
  if (b.computer !== undefined) out.computer = b.computer ? 1 : 0;
  if (b.effort !== undefined) { if (!EFFORTS.includes(b.effort)) throw new Error('bad effort'); out.effort = b.effort; }
  for (const k of ['approval_rules', 'allow_rules']) if (b[k] !== undefined) out[k] = JSON.stringify((b[k] || []).map(String).filter(Boolean));
  return out;
}
function saveBot(id, fields) {
  const keys = Object.keys(fields);
  if (keys.length) q(`UPDATE bots SET ${keys.map((k) => `${k}=?`).join(',')} WHERE id=?`).run(...keys.map((k) => fields[k]), id);
  const bot = parseBot(q('SELECT * FROM bots WHERE id=?').get(id));
  writeBotBrief(bot);
  broadcast('state_changed', {});
  return bot;
}
route('POST', '/api/bots', async (req, res) => {
  const b = await body(req);
  if (!b.name?.trim()) return json(res, 400, { error: 'name required' });
  const defaults = JSON.stringify(['Bash(git push*)', 'Bash(rm -rf*)', 'Bash(*gh pr merge*)', 'mcp__*send*', 'mcp__*delete*', 'mcp__*pay*', 'mcp__*create_event*']);
  const r = q('INSERT INTO bots (name, approval_rules) VALUES (?,?)').run(b.name.trim(), defaults);
  json(res, 200, saveBot(r.lastInsertRowid, cleanBot(b)));
});
// ---------- API tools (apitools.js): the bot's own quick commands, run directly without Claude ----------
const toolNotes = new Map(); // thread -> recent tool outputs, handed to the bot with your next message
route('GET', '/api/bots/:id/api-tools', (req, res, p) => json(res, 200, { tools: loadTools(p.id) }));
route('POST', '/api/bots/:id/api-tools/:name/approve', (req, res, p) => approveTool(p.id, p.name) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'No such tool' }));
route('POST', '/api/bots/:id/api-tools-scan', async (req, res, p) => {
  const { thread } = await body(req);
  try { json(res, 200, postToThread(String(thread || 'bot:' + Number(p.id)), '/api-tools scan\n\n' + SCAN_PROMPT)); } catch (e) { json(res, e.status || 500, { error: e.message }); }
});
route('POST', '/api/bots/:id/api-tools/:name/run', async (req, res, p) => {
  const { args = '', thread: th } = await body(req);
  const thread = String(th || 'bot:' + Number(p.id));
  if (TH.threadBot(thread) !== Number(p.id)) return json(res, 400, { error: 'Wrong chat for this bot' });
  try {
    const r = await runTool(p.id, p.name, args, redact);
    const cmd = `/${p.name}${String(args).trim() ? ' ' + String(args).trim() : ''}`;
    addMessage(thread, 'user', 'text', cmd);
    addMessage(thread, String(Number(p.id)), 'text', `${r.ok ? '' : '⚠ '}**${cmd}** · ran directly, no Claude usage${r.ok ? '' : ` (exit ${r.code})`}\n\n\`\`\`\n${r.out.replace(/```/g, "'''") || '(no output)'}\n\`\`\``);
    const list = toolNotes.get(thread) || []; list.push(`${cmd}:\n${r.out.slice(0, 3000)}`); toolNotes.set(thread, list.slice(-5));
    json(res, 200, { ok: r.ok });
  } catch (e) { json(res, e.status || 500, { error: e.message }); }
});
route('GET', '/api/bots/:id/commands', async (req, res, p) => json(res, 200, { commands: await botCommands(p.id) }));
route('PATCH', '/api/bots/:id', async (req, res, p) => json(res, 200, saveBot(Number(p.id), cleanBot(await body(req)))));
route('DELETE', '/api/bots/:id', (req, res, p) => {
  const had = q('SELECT computer FROM bots WHERE id=?').get(p.id)?.computer;
  if (had && computersOn()) agent(`/computers/${Number(p.id)}`, { method: 'DELETE' }).catch(() => {}); // its computer goes too
  q('DELETE FROM bots WHERE id=?').run(p.id);
  q('DELETE FROM room_members WHERE bot_id=?').run(p.id);
  q('DELETE FROM routines WHERE bot_id=?').run(p.id);
  q('DELETE FROM widgets WHERE bot_id=?').run(p.id);
  TH.removeBotThreads(p.id);
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});
// ---------- bot computers ----------
const viewerUrl = (port) => { const u = new URL(agentConfig().url); return `http://${u.hostname}:${port}/`; };
async function computerRoute(res, fn) {
  if (!computersOn()) return json(res, 400, { error: 'Bot computers aren’t set up. Add the computer VM in Server settings (see deploy/computer/README.md).' });
  try { const c = await fn(); json(res, 200, c.port ? { ...c, url: viewerUrl(c.port) } : c); }
  catch (e) { json(res, 502, { error: `Couldn’t reach the computer VM: ${e.message}` }); }
}
route('GET', '/api/bots/:id/computer', (req, res, p) => computerRoute(res, () => agent(`/computers/${Number(p.id)}`)));
route('POST', '/api/bots/:id/computer', (req, res, p) => computerRoute(res, () => agent(`/computers/${Number(p.id)}`, { method: 'POST' })));
route('DELETE', '/api/bots/:id/computer', (req, res, p) => computerRoute(res, async () => {
  await agent(`/computers/${Number(p.id)}`, { method: 'DELETE' });
  saveBot(Number(p.id), { computer: 0 });
  return { ok: true };
}));

// Status of every bot computer plus the VM's memory, for the app (cached briefly; docker stats is slow).
let compCache = null;
route('GET', '/api/computers', async (req, res) => {
  if (!computersOn()) return json(res, 200, { on: false });
  if (compCache && Date.now() - compCache.at < 10_000) return json(res, 200, compCache.data);
  try { compCache = { at: Date.now(), data: { on: true, ...(await agent('/computers')), sleepAfterMin: SLEEP_AFTER_MIN } }; json(res, 200, compCache.data); }
  catch (e) { json(res, 200, { on: true, error: e.message }); }
});
// Browse and download files from a bot's home folder on its computer (~/Downloads, ~/work, …).
route('GET', '/api/bots/:id/files', (req, res, p, url) => computerRoute(res, () => agent(`/computers/${Number(p.id)}/files?dir=${encodeURIComponent(url.searchParams.get('dir') || '')}`)));
route('GET', '/api/bots/:id/file', async (req, res, p, url) => {
  if (!computersOn()) return json(res, 400, { error: 'Bot computers aren’t set up' });
  const rel = String(url.searchParams.get('path') || '');
  try {
    const { url: base, token } = agentConfig();
    const r = await fetch(`${base}/computers/${Number(p.id)}/file?path=${encodeURIComponent(rel)}`, { headers: { authorization: `Bearer ${token}` } });
    if (!r.ok) return json(res, r.status, { error: 'File not found' });
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff',
      ...(r.headers.get('content-length') ? { 'content-length': r.headers.get('content-length') } : {}),
      'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(rel.split('/').pop() || 'file')}` });
    for await (const chunk of r.body) res.write(chunk);
    res.end();
  } catch (e) { if (!res.headersSent) json(res, 502, { error: e.message }); else res.destroy(); }
});
// Rebuild the computer image with the latest Claude Code and Chromium, then recreate the computers
// (home folders, browser profiles and sign-ins are kept). Runs on the VM; poll GET for progress.
route('POST', '/api/computers/update', (req, res) => computerRoute(res, () => agent('/update', { method: 'POST', body: JSON.stringify({
  dockerfile: fs.readFileSync(path.join(HERE, 'deploy/computer/Dockerfile'), 'utf8'),
  hook: fs.readFileSync(path.join(HERE, 'hooks/approval-hook.js'), 'utf8') }) })));
route('GET', '/api/computers/update', (req, res) => computerRoute(res, () => agent('/update')));

// Auto-sleep: stop a computer that hasn't run a task or been watched for a while. Its next task (or
// opening its screen) starts it again; files, the browser profile and sign-ins live on its volume.
const SLEEP_AFTER_MIN = Number(process.env.NIMBUS_COMPUTER_SLEEP_MIN ?? 120);
const deskSeen = new Map(); // botId -> last time someone was watching its screen
setInterval(async () => {
  if (!SLEEP_AFTER_MIN || !computersOn()) return;
  try {
    const { computers } = await agent('/computers');
    for (const c of computers.filter((x) => x.running)) {
      const last = q("SELECT MAX(COALESCE(ended_at, started_at, unixepoch())) AS t FROM runs WHERE bot_id=?").get(c.bot).t || 0;
      const busy = q("SELECT COUNT(*) AS n FROM runs WHERE bot_id=? AND status IN ('queued','running')").get(c.bot).n;
      const idleMs = Date.now() - Math.max(last * 1000, deskSeen.get(c.bot) || 0);
      if (!busy && idleMs > SLEEP_AFTER_MIN * 60_000) {
        await agent(`/computers/${c.bot}/stop`, { method: 'POST' });
        deskCache.delete(c.bot); compCache = null;
        console.log(`Computer for bot ${c.bot} went to sleep after ${Math.round(idleMs / 60000)} min idle`);
      }
    }
  } catch {}
}, 5 * 60_000).unref();

const memHash = (t) => crypto.createHash('sha1').update(t).digest('hex');
route('GET', '/api/bots/:id/memory', (req, res, p) => { if (!q('SELECT 1 FROM bots WHERE id=?').get(Number(p.id))) return json(res, 404, { error: 'No such bot' }); const text = fs.readFileSync(path.join(botDir(p.id), 'MEMORY.md'), 'utf8'); json(res, 200, { text, hash: memHash(text) }); });
route('PUT', '/api/bots/:id/memory', async (req, res, p) => {
  if (!q('SELECT 1 FROM bots WHERE id=?').get(Number(p.id))) return json(res, 404, { error: 'No such bot' });
  const b = await body(req), f = path.join(botDir(p.id), 'MEMORY.md');
  // The bot may have added a line while you were editing: don't overwrite it with the copy you opened.
  const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '';
  if (b.hash && b.hash !== memHash(cur)) return json(res, 409, { error: 'The bot changed its memory while you were editing. Reopen it to see the new version.' });
  const tmp = f + '.tmp-' + process.pid; fs.writeFileSync(tmp, String(b.text || '')); fs.renameSync(tmp, f); // readers never see a half-written file
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});
// Where this chat's context goes (Claude Code's /context report).
route('GET', '/api/bots/:id/context', async (req, res, p, url) => {
  const bot = parseBot(q('SELECT * FROM bots WHERE id=?').get(Number(p.id)));
  if (!bot) return json(res, 404, { error: 'No such bot' });
  const env = { where: computersOn() && bot.computer ? 'Its own computer' : 'This server', folder: botDir(bot.id), effort: bot.effort, model: bot.model || '' };
  const plugins = q('SELECT plugin_id FROM bot_plugins WHERE bot_id=?').all(bot.id).map((r) => r.plugin_id).map((id) => PLUGINS.find((x) => x.id === id)).filter(Boolean).map(({ id, name, icon, color }) => ({ id, name, icon, color }));
  const connectors = connCache.list.filter((c) => !plugins.some((p) => sameName(p.name, c.name))).map(({ name, status }) => ({ name, status, ...(({ icon, color }) => ({ icon, color }))(PLUGINS.find((x) => sameName(x.name, name)) || {}) }));
  let context = null, error = '';
  try { context = await contextReport(bot.id, url.searchParams.get('thread') || 'bot:' + bot.id); } catch (e) { error = e.message; }
  json(res, 200, { env, plugins, connectors, context, error });
});
route('POST', '/api/bots/:id/reset', async (req, res, p) => {
  const thread = String((await body(req)).thread || 'bot:' + p.id);
  if (TH.threadBot(thread) !== Number(p.id)) return json(res, 400, { error: 'Not this bot’s thread' });
  q('DELETE FROM sessions WHERE bot_id=? AND thread=?').run(p.id, thread);
  addMessage(thread, 'system', 'note', 'Started a fresh conversation in this thread. Memory is kept.');
  json(res, 200, { ok: true });
});

// ---------- threads and projects (threads.js) ----------
const thOk = (res, extra = {}) => { broadcast('state_changed', {}); json(res, 200, { ok: true, ...extra }); };
const thTry = (fn) => async (req, res, p) => { try { await fn(req, res, p); } catch (e) { json(res, 400, { error: e.message }); } };
route('POST', '/api/threads', thTry(async (req, res) => {
  const b = await body(req);
  const key = TH.createThread({ botId: b.botId, title: b.title || '', projectId: b.projectId ?? null });
  try { await Code.setupThread(Number(key.slice(2)), b.ownBranch !== false); }
  catch (e) { TH.deleteThread(Number(key.slice(2))); throw new Error(`Couldn't make the branch: ${e.message}`); }
  thOk(res, { key });
}));
route('PATCH', '/api/threads/:id', thTry(async (req, res, p) => { TH.updateThread(p.id, await body(req)); thOk(res); }));
route('DELETE', '/api/threads/:id', thTry((req, res, p) => { TH.deleteThread(p.id); thOk(res); }));
route('POST', '/api/projects', thTry(async (req, res) => {
  const b = await body(req);
  const repo = b.code ? await Code.setupRepo({ name: b.name, source: b.source, url: b.url, folder: b.folder }) : null;
  thOk(res, { id: TH.createProject({ name: b.name, instructions: b.instructions, ownerBotId: b.ownerBotId ?? null, members: b.members, repo, testCmd: b.testCmd, previewCmd: b.previewCmd }) });
}));
route('PATCH', '/api/projects/:id', thTry(async (req, res, p) => { TH.updateProject(p.id, await body(req)); thOk(res); }));
route('DELETE', '/api/projects/:id', thTry((req, res, p) => { TH.deleteProject(p.id); thOk(res); }));
// ---------- Nimbus Code (code.js) ----------
route('GET', '/api/code/repos', (req, res) => json(res, 200, { root: Code.CODE_ROOT, repos: Code.listRepos() }));
const codeTry = (fn) => async (req, res, p, url) => { try { json(res, 200, await fn(decodeURIComponent(p.thread), req, url, p)); } catch (e) { json(res, e.status || 500, { error: e.message }); } };
route('GET', '/api/code/:thread', codeTry((k) => Code.info(k)));
route('GET', '/api/code/:thread/files', codeTry((k) => Code.listFiles(k)));
route('GET', '/api/code/:thread/file', codeTry((k, req, url) => Code.readFile(k, url.searchParams.get('path'))));
route('PUT', '/api/code/:thread/file', codeTry(async (k, req) => { const b = await body(req); return Code.writeFile(k, b.path, b.text, b.mtime); }));
route('GET', '/api/code/:thread/github', codeTry((k) => Code.githubAbout(k)));
route('POST', '/api/projects/:id/github', async (req, res, p) => { try { json(res, 200, await Code.connectGithub(p.id, (await body(req)).url)); } catch (e) { json(res, e.status || 500, { error: e.message }); } });
route('GET', '/api/code/:thread/diff', codeTry(async (k, req, url) => ({ diff: await Code.diff(k, url.searchParams.get('what') || 'working', url.searchParams.get('ref')) })));
route('GET', '/api/code/:thread/suggest', codeTry(async (k) => ({ message: await Code.suggestMessage(k) })));
route('POST', '/api/code/:thread/commit', codeTry(async (k, req) => Code.commit(k, (await body(req)).message)));
route('POST', '/api/code/:thread/merge', codeTry(async (k) => { const r = await Code.merge(k); const c = Code.threadCode(k); addMessage(k, 'system', 'note', `Merged ${c.t.branch} into ${c.t.base}.`); return r; }));
route('POST', '/api/code/:thread/push', codeTry(async (k) => { const r = await Code.push(k); addMessage(k, 'system', 'note', `Pushed ${r.branch}.`); return r; }));
route('POST', '/api/code/:thread/undo/:run', codeTry(async (k, req, url, p) => { const r = await Code.undoTurn(p.run); addMessage(k, 'system', 'note', `Undid that turn (${r.files} file${r.files === 1 ? '' : 's'} put back).`); return r; }));
route('POST', '/api/code/:thread/tests', codeTry(async (k) => {
  Code.runTests(k).then((r) => addMessage(k, 'system', 'note', r.ok ? `🧪 Tests passed (${r.secs}s)` : `🧪 Tests failed (${r.secs ?? 0}s). See Tests in the code panel.`));
  return { ok: true };
}));
route('POST', '/api/code/:thread/preview', codeTry(async (k, req) => ((await body(req)).stop ? (Code.stopPreview(k), { running: false }) : Code.startPreview(k))));
route('GET', '/api/code/:thread/term', (req, res, p) => {
  let t; try { t = Code.terminal(decodeURIComponent(p.thread)); } catch (e) { return json(res, e.status || 500, { error: e.message }); }
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (s) => { if (s === null) { res.write('event: end\ndata: {}\n\n'); return res.end(); } res.write(`data: ${JSON.stringify(s)}\n\n`); };
  if (t.buf) send(t.buf);
  t.listeners.add(send);
  req.on('close', () => t.listeners.delete(send));
});
route('POST', '/api/code/:thread/term', codeTry(async (k, req) => {
  const b = await body(req);
  if (b.close) Code.termClose(k); else if (b.cols) Code.termResize(k, b.cols, b.rows); else Code.termInput(k, String(b.data || '').slice(0, 65536));
  return { ok: true };
}));

// Preview proxy: a port of its own per running preview (8900-8949), login required, HTTP or HTTPS on the same port.
const PREVIEW_BASE = Number(process.env.NIMBUS_PREVIEW_PORT || 8900);
Code.setPreviewProxy(async (target) => {
  const handler = (req, res) => {
    if (!loggedIn(req)) { res.writeHead(401, { 'content-type': 'text/plain' }); return res.end('Log in to Nimbus first.'); }
    // Nimbus's probe (codeide.js) reports the page's console errors and failed requests to the code panel, and lets you pick an element.
    if (req.url === '/__nimbus_probe.js') { res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' }); return res.end(PROBE); }
    const up = http.request({ host: '127.0.0.1', port: target(), path: req.url, method: req.method, headers: { ...req.headers, host: `127.0.0.1:${target()}`, 'accept-encoding': 'identity' } }, (r) => {
      const h = { ...r.headers }; delete h['x-frame-options']; delete h['content-security-policy'];
      if (!/text\/html/.test(h['content-type'] || '') || h['content-encoding']) { res.writeHead(r.statusCode, h); return r.pipe(res); }
      const chunks = []; r.on('data', (d) => chunks.push(d));
      r.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8'); const tag = '<script src="/__nimbus_probe.js"></script>';
        html = /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + tag) : tag + html;
        delete h['content-length']; delete h['transfer-encoding']; res.writeHead(r.statusCode, h); res.end(html);
      });
    });
    up.on('error', () => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/html' }); res.end('<body style="font:15px system-ui;padding:24px;color:#888">The app isn’t answering yet. It may still be starting; this page reloads in a moment.<script>setTimeout(()=>location.reload(),2000)</script>'); } else res.end(); });
    req.pipe(up);
  };
  const upgrade = (req, sock, head) => {
    if (!loggedIn(req)) return sock.destroy();
    const up = net.connect(target(), '127.0.0.1', () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
      if (head?.length) up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on('error', () => sock.destroy()); sock.on('error', () => up.destroy());
  };
  const plain = http.createServer(handler); plain.on('upgrade', upgrade);
  let secure = null; try { secure = https.createServer(tlsFiles(), handler); secure.on('upgrade', upgrade); } catch {}
  // Peek at the first byte without consuming it: 0x16 starts a TLS handshake.
  const front = net.createServer((sock) => {
    sock.on('error', () => {});
    sock.once('readable', () => { const d = sock.read(1); if (!d) return sock.destroy(); sock.unshift(d); (d[0] === 0x16 && secure ? secure : plain).emit('connection', sock); });
  });
  for (let port = PREVIEW_BASE; port < PREVIEW_BASE + 50; port++) {
    const ok = await new Promise((resolve) => { front.once('error', () => resolve(false)); front.listen(port, HOST, () => resolve(true)); });
    if (ok) return { proxyPort: port, closeProxy: () => front.close() };
  }
  throw new Error('No free preview port');
});
process.on('exit', () => Code.stopAll());

// For bots (bin/thread.mjs): list, or make a thread or project when the user asks.
route('POST', '/api/hook/threads', thTry(async (req, res) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const b = await body(req);
  const run = q('SELECT * FROM runs WHERE id=?').get(Number(b.runId));
  if (!run || run.status !== 'running') return json(res, 400, { error: 'Run this from inside a Nimbus bot run.' });
  const me = run.bot_id, mine = (p) => p.owner_bot_id === me || TH.projectMembers(p.id).includes(me);
  const findProject = (name) => {
    if (!name) return null;
    const ps = q('SELECT * FROM projects WHERE archived=0').all().filter(mine);
    const p = ps.find((x) => String(x.id) === String(name).replace(/^#/, '')) || ps.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
    if (!p) throw new Error(`No project "${name}" of yours. Yours: ${ps.map((x) => `${x.name} (#${x.id})`).join(', ') || 'none'}`);
    return p;
  };
  if (b.action === 'list') {
    const ps = q('SELECT * FROM projects WHERE archived=0').all().filter(mine);
    const ts = q("SELECT * FROM threads WHERE bot_id=? AND archived=0 ORDER BY id").all(me);
    return json(res, 200, { projects: ps.map((p) => ({ id: p.id, name: p.name, shared: p.owner_bot_id == null, folder: TH.projectFolder(p.id) })),
      threads: [{ key: 'bot:' + me, title: 'General' }, ...ts.map((t) => ({ key: 't:' + t.id, title: t.title || 'New thread', kind: t.kind, project: t.project_id }))], current: run.thread });
  }
  if (b.action === 'project') {
    const members = b.shared ? [me, ...(b.with || []).map((n) => { const t = findBot(n); if (!t) throw new Error(`No bot "${n}"`); return t.id; })] : [];
    const id = TH.createProject({ name: b.name, instructions: b.instructions || '', ownerBotId: b.shared ? null : me, members });
    if (b.move) { const t = TH.threadRow(run.thread); if (t?.kind === 'chat') TH.updateThread(t.id, { projectId: id }); }
    return thOk(res, { id, folder: TH.projectFolder(id) });
  }
  if (b.action === 'thread') {
    const project = findProject(b.project);
    const key = TH.createThread({ botId: me, title: b.title || '', projectId: project?.id ?? null });
    if (b.note) addMessage(key, me, 'text', String(b.note).slice(0, 4000), null);
    return thOk(res, { key });
  }
  if (b.action === 'move') {
    const t = TH.threadRow(run.thread);
    if (!t || t.kind !== 'chat') throw new Error('Only threads you started with New thread can move into a project (not General, Inbox or Routines).');
    TH.updateThread(t.id, { projectId: b.project ? findProject(b.project).id : null });
    return thOk(res);
  }
  json(res, 400, { error: 'Unknown action' });
}));

// ---------- bot browser: live preview pane (see browser.js) ----------
// One browser per bot, shared by all its threads.
const userBrowser = (req, id) => String(Number(id));
const usableBot = (req, id) => q('SELECT 1 FROM bots WHERE id=?').get(Number(id));
route('GET', '/api/bots/:id/browser/stream', async (req, res, p) => {
  if (!usableBot(req, p.id)) return json(res, 404, { error: 'No such bot' });
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' });
  const send = (ev) => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  let stop = null;
  req.on('close', () => stop?.());
  try { stop = await watchBrowser(userBrowser(req, p.id), send); if (res.destroyed) stop(); }
  catch (e) { send({ type: 'error', error: e.message }); res.end(); }
});
route('POST', '/api/bots/:id/browser', async (req, res, p) => {
  if (!usableBot(req, p.id)) return json(res, 404, { error: 'No such bot' });
  try { const out = await browserInput(userBrowser(req, p.id), await body(req)); json(res, 200, { ok: true, ...(out?.text !== undefined ? { text: out.text } : {}) }); }
  catch (e) { json(res, 400, { error: e.message }); }
});
// Tabs in the bot's browser: list, or { action: 'new'|'select'|'close', id, url }.
route('GET', '/api/bots/:id/browser/tabs', async (req, res, p) => {
  if (!usableBot(req, p.id)) return json(res, 404, { error: 'No such bot' });
  json(res, 200, { tabs: await listTabs(userBrowser(req, p.id)) });
});
route('POST', '/api/bots/:id/browser/tabs', async (req, res, p) => {
  if (!usableBot(req, p.id)) return json(res, 404, { error: 'No such bot' });
  try { await tabAction(userBrowser(req, p.id), await body(req)); json(res, 200, { ok: true, tabs: await listTabs(userBrowser(req, p.id)) }); }
  catch (e) { json(res, 400, { error: e.message }); }
});
route('DELETE', '/api/bots/:id/browser', (req, res, p) => {
  if (!usableBot(req, p.id)) return json(res, 404, { error: 'No such bot' });
  closeBrowser(userBrowser(req, p.id)); json(res, 200, { ok: true });
});
// The Browser plugin's MCP server asks for the bot's browser when a run starts (bin/browser-mcp.mjs).
route('POST', '/api/hook/browser', async (req, res) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const run = q("SELECT * FROM runs WHERE id=? AND status='running'").get(Number((await body(req)).runId));
  if (!run) return json(res, 400, { error: 'That run isn’t active' });
  try { json(res, 200, { port: await ensureBrowser(String(run.bot_id)) }); }
  catch (e) { json(res, 500, { error: e.message }); }
});

// Routines
// ---------- marketplace ----------
// Connectors on the user's claude.ai account reach every bot through Claude Code's login.
// `claude mcp list` health-checks each one, so it's slow: cache it and refresh in the background.
let connCache = { at: 0, list: [], loading: null };
function loadConnectors() {
  if (connCache.loading) return connCache.loading;
  connCache.loading = new Promise((resolve) => {
    execFile(CLAUDE_BIN, ['mcp', 'list'], { timeout: 90_000, cwd: DATA_DIR, env: { ...process.env, ...claudeEnv() } }, (err, out = '') => {
      const list = [];
      for (const line of String(out).split('\n')) {
        const m = line.match(/^claude\.ai (.+?): .* - (.+)$/);
        if (m) list.push({ name: m[1].trim(), status: /connected/i.test(m[2]) && !/not|fail/i.test(m[2]) ? 'connected' : m[2].replace(/^[^A-Za-z]+/, '').trim() });
      }
      if (!err || list.length) connCache = { at: Date.now(), list, loading: null };
      else connCache.loading = null;
      resolve(connCache.list);
    });
  });
  return connCache.loading;
}
loadConnectors();
async function claudeConnectors(fresh) {
  if (fresh || !connCache.at) await loadConnectors();
  else if (Date.now() - connCache.at > 5 * 60_000) loadConnectors();
  return connCache.list;
}
const sameName = (a, b) => a.toLowerCase().replace(/[^a-z0-9]/g, '') === b.toLowerCase().replace(/[^a-z0-9]/g, '');
route('GET', '/api/marketplace', async (req, res, _p, url) => {
  const installed = new Set(q('SELECT id FROM plugins').all().map((r) => r.id));
  const added = new Set(q("SELECT template FROM bots WHERE template != ''").all().map((r) => r.template));
  const connectors = await claudeConnectors(url.searchParams.get('fresh') === '1');
  json(res, 200, {
    templates: TEMPLATES.map((t) => ({ ...t, added: added.has(t.id) })),
    plugins: PLUGINS.map((p) => {
      const c = p.kind === 'claude' && connectors.find((x) => sameName(x.name, p.name));
      return { ...publicPlugin(p), installed: p.kind === 'claude' ? c?.status === 'connected' : installed.has(p.id), connector: c || null };
    }),
    connectors
  });
});
// Claude Code plugins & skills, installed for every bot (ccplugins.js).
route('GET', '/api/cc-plugins', async (req, res, _p, url) => json(res, 200, { ...(await pluginCatalog(url.searchParams.get('fresh') === '1')), canInstall: true }));
route('POST', '/api/cc-plugins/:action', async (req, res, p) => {
  if (!['install', 'uninstall'].includes(p.action)) return json(res, 404, { error: 'not found' });
  const { id } = await body(req);
  try { json(res, 200, await setPlugin(id, p.action === 'install')); } catch (err) { json(res, 400, { error: err.message }); }
});
route('POST', '/api/templates/:id/add', (req, res, p) => {
  const t = TEMPLATES.find((x) => x.id === p.id);
  if (!t) return json(res, 404, { error: 'not found' });
  const r = q('INSERT INTO bots (name, role, instructions, color, effort, shape, template, approval_rules) VALUES (?,?,?,?,?,?,?,?)')
    .run(t.name, t.role, t.instructions, t.color, t.effort, t.shape, t.id, JSON.stringify(t.approval_rules));
  const id = Number(r.lastInsertRowid);
  for (const rt of t.routines || []) q('INSERT INTO routines (bot_id, cron, prompt) VALUES (?,?,?)').run(id, rt.cron, rt.prompt);
  const installed = new Set(q('SELECT id FROM plugins').all().map((x) => x.id));
  for (const pid of t.plugins || []) {
    const pl = PLUGINS.find((x) => x.id === pid);
    if (pl && (pl.kind === 'claude' || installed.has(pid))) q('INSERT OR IGNORE INTO bot_plugins VALUES (?,?)').run(id, pid);
  }
  json(res, 200, saveBot(id, {}));
});
route('POST', '/api/plugins/:id', async (req, res, p) => {
  const pl = PLUGINS.find((x) => x.id === p.id);
  if (!pl || pl.kind !== 'mcp') return json(res, 404, { error: 'not found' });
  const { secrets = {} } = await body(req);
  const clean = {};
  for (const f of pl.fields || []) {
    const v = String(secrets[f.key] || '').trim();
    if (!v) return json(res, 400, { error: `${f.label} is required` });
    clean[f.key] = v;
  }
  q('INSERT INTO plugins (id, secrets) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET secrets=excluded.secrets').run(pl.id, JSON.stringify(clean));
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});
route('DELETE', '/api/plugins/:id', (req, res, p) => {
  q('DELETE FROM plugins WHERE id=?').run(p.id);
  q('DELETE FROM bot_plugins WHERE plugin_id=?').run(p.id);
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});
route('PUT', '/api/bots/:id/plugins', async (req, res, p) => {
  const ids = ((await body(req)).plugins || []).map(String).filter((id) => PLUGINS.some((x) => x.id === id));
  q('DELETE FROM bot_plugins WHERE bot_id=?').run(p.id);
  for (const id of ids) q('INSERT OR IGNORE INTO bot_plugins VALUES (?,?)').run(p.id, id);
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});

route('POST', '/api/routines', async (req, res) => {
  const r = await body(req);
  if (!isValidCron(r.cron)) return json(res, 400, { error: 'Schedule must be a 5-part cron like "0 9 * * 1-5"' });
  q('INSERT INTO routines (bot_id, cron, prompt, quiet) VALUES (?,?,?,?)').run(r.bot_id, r.cron.trim(), r.prompt || '', r.quiet ? 1 : 0);
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});
route('PATCH', '/api/routines/:id', async (req, res, p) => {
  const r = await body(req);
  if (r.cron !== undefined && !isValidCron(r.cron)) return json(res, 400, { error: 'Invalid schedule' });
  const cur = q('SELECT * FROM routines WHERE id=?').get(p.id);
  q('UPDATE routines SET cron=?, prompt=?, enabled=?, quiet=? WHERE id=?').run(r.cron ?? cur.cron, r.prompt ?? cur.prompt, r.enabled ?? cur.enabled, r.quiet === undefined ? cur.quiet : r.quiet ? 1 : 0, p.id);
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});
route('DELETE', '/api/routines/:id', (req, res, p) => { q('DELETE FROM routines WHERE id=?').run(p.id); broadcast('state_changed', {}); json(res, 200, { ok: true }); });
route('POST', '/api/routines/:id/run', (req, res, p) => {
  const r = q('SELECT * FROM routines WHERE id=?').get(p.id);
  runBot({ botId: r.bot_id, thread: TH.builtIn(r.bot_id, 'routines'), prompt: r.prompt, source: 'schedule', quiet: !!r.quiet });
  json(res, 200, { ok: true });
});

// Rooms (group chats)
function saveRoom(id, r) {
  const cur = q('SELECT * FROM rooms WHERE id=?').get(id);
  q('UPDATE rooms SET name=?, goal=?, lead_bot_id=?, bots_can_talk=? WHERE id=?').run(
    (r.name ?? cur.name).replace(/^#\s*/, ''), r.goal ?? cur.goal, r.lead_bot_id ?? cur.lead_bot_id, r.bots_can_talk === undefined ? cur.bots_can_talk : r.bots_can_talk ? 1 : 0, id);
  if (r.project_id !== undefined) q('UPDATE rooms SET project_id=? WHERE id=?').run(r.project_id == null ? null : Number(r.project_id), id);
  if (Array.isArray(r.members)) {
    q('DELETE FROM room_members WHERE room_id=?').run(id);
    for (const b of r.members) q('INSERT OR IGNORE INTO room_members (room_id, bot_id) VALUES (?,?)').run(id, b);
  }
  broadcast('state_changed', {});
  return q('SELECT * FROM rooms WHERE id=?').get(id);
}
route('POST', '/api/rooms', async (req, res) => {
  const r = await body(req);
  if (!r.name?.trim()) return json(res, 400, { error: 'name required' });
  const ins = q('INSERT INTO rooms (name) VALUES (?)').run(r.name.trim());
  json(res, 200, saveRoom(ins.lastInsertRowid, r));
});
route('PATCH', '/api/rooms/:id', async (req, res, p) => json(res, 200, saveRoom(Number(p.id), await body(req))));
route('DELETE', '/api/rooms/:id', (req, res, p) => {
  q('DELETE FROM rooms WHERE id=?').run(p.id); q('DELETE FROM room_members WHERE room_id=?').run(p.id);
  broadcast('state_changed', {}); json(res, 200, { ok: true });
});

// Runs
route('POST', '/api/runs/:id/stop', (req, res, p) => { stopRun(p.id); json(res, 200, { ok: true }); });

// Approvals (user side)
route('POST', '/api/approvals/:id', async (req, res, p) => {
  const { decision, note, remember } = await body(req);
  const a = q('SELECT * FROM approvals WHERE id=?').get(p.id);
  if (!a || a.status !== 'pending') return json(res, 409, { error: 'Already decided' });
  const status = decision === 'approve' ? 'approved' : 'rejected';
  q('UPDATE approvals SET status=?, note=?, decided_at=unixepoch() WHERE id=?').run(status, note || null, a.id);
  if (remember && status === 'approved') {
    const bot = parseBot(q('SELECT * FROM bots WHERE id=?').get(a.bot_id));
    const input = JSON.parse(a.input || '{}');
    const rule = rememberRule(a.tool, input, remember);
    if (!bot.allow_rules.includes(rule)) saveBot(bot.id, { allow_rules: JSON.stringify([...bot.allow_rules, rule]) });
  }
  const msg = q("SELECT * FROM messages WHERE kind='approval' AND run_id=? AND body LIKE ?").get(a.run_id, `%"approvalId":${a.id},%`);
  if (msg) updateMessage(msg.id, { ...JSON.parse(msg.body), status, note: note || null });
  markTraceWaiting(a.run_id, a.tool, false);
  notifyApproval(a.id);
  broadcast('approvals_changed', {});
  json(res, 200, { ok: true });
});

// Delete a file you sent (one, or all of a message's): removed from the chat, from data/uploads, and from
// the copies bots got in their chat folders. A message left with no text and no files is deleted too.
route('DELETE', '/api/messages/:id/files/:fid', (req, res, p) => {
  const m = q('SELECT * FROM messages WHERE id=?').get(Number(p.id));
  if (!m) return json(res, 404, { error: 'not found' });
  if (m.author !== 'user') return json(res, 403, { error: 'You can only delete files you sent' });
  if (m.queued) return json(res, 409, { error: 'The bot hasn’t started on this message yet. Take the message back first, or wait until it starts.' });
  let files = []; try { files = JSON.parse(m.files || '[]'); } catch {}
  const gone = files.filter((f) => p.fid === 'all' || f.id === p.fid);
  if (!gone.length) return json(res, 404, { error: 'No such file in this message' });
  deleteUploads(gone.map((f) => f.id), TH.threadBot);
  const left = files.filter((f) => !gone.includes(f));
  if (!left.length && !String(m.body || '').trim()) { q('DELETE FROM messages WHERE id=?').run(m.id); broadcast('message_delete', { id: m.id, thread: m.thread }); }
  else { q('UPDATE messages SET files=? WHERE id=?').run(JSON.stringify(left), m.id); broadcast('message_update', q('SELECT * FROM messages WHERE id=?').get(m.id)); }
  json(res, 200, { ok: true, deleted: gone.length });
});
// Redact a message, or just a selected part of it. The text is replaced with [REDACTED] in the chat,
// and the same text is scrubbed from saved prompts, approval requests, other messages and the bots'
// Claude Code transcripts (~/.claude/projects), so it isn't kept anywhere on this server.
route('POST', '/api/messages/:id/redact', async (req, res, p) => {
  const m = q('SELECT * FROM messages WHERE id=?').get(Number(p.id));
  if (!m) return json(res, 404, { error: 'not found' });
  const { text } = await body(req);
  const secret = String(text || '').trim() || (['text', 'note', 'quiet', 'error'].includes(m.kind) ? m.body.trim() : '');
  if (secret.length < 3) return json(res, 400, { error: ['text', 'note', 'quiet', 'error'].includes(m.kind) ? 'Select at least 3 characters' : 'Select the text to redact in this card first' });
  if (!m.body.includes(secret)) return json(res, 400, { error: 'That text isn’t in this message (formatting can differ: select plain text)' });
  const MASK = '[REDACTED]';
  const like = '%' + secret.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  let changed = 0;
  for (const row of q(`SELECT id, body FROM messages WHERE body LIKE ? ESCAPE '\\'`).all(like)) {
    const esc = JSON.stringify(secret).slice(1, -1); // as it appears inside JSON bodies (traces, approvals)
    const nb = row.body.split(secret).join(MASK).split(esc).join(MASK);
    if (nb !== row.body) { q('UPDATE messages SET body=? WHERE id=?').run(nb, row.id); broadcast('message_update', q('SELECT * FROM messages WHERE id=?').get(row.id)); changed++; }
  }
  for (const [table, col] of [['runs', 'prompt'], ['approvals', 'input']]) {
    for (const row of q(`SELECT id, ${col} AS v FROM ${table} WHERE ${col} LIKE ? ESCAPE '\\'`).all(like)) {
      const esc = JSON.stringify(secret).slice(1, -1);
      q(`UPDATE ${table} SET ${col}=? WHERE id=?`).run(row.v.split(secret).join(MASK).split(esc).join(MASK), row.id);
    }
  }
  let files = 0;
  const projects = path.join(os.homedir(), '.claude', 'projects');
  const forms = [secret, JSON.stringify(secret).slice(1, -1)];
  try {
    for (const dir of fs.readdirSync(projects).filter((d) => d.includes('nimbus-data-bots-'))) {
      for (const f of fs.readdirSync(path.join(projects, dir)).filter((f) => f.endsWith('.jsonl'))) {
        const fp = path.join(projects, dir, f), t = fs.readFileSync(fp, 'utf8');
        if (!forms.some((x) => t.includes(x))) continue;
        let nt = t; for (const x of forms) nt = nt.split(x).join(MASK);
        fs.writeFileSync(fp, nt); files++;
      }
    }
  } catch {}
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // don't leave the old text in the write-ahead log
  json(res, 200, { ok: true, messages: changed, transcripts: files });
});

// Sidebar groups (folders of chats), shared by all the user's devices.
route('PUT', '/api/side-groups', async (req, res) => {
  const { groups } = await body(req);
  const seen = new Set();
  const clean = (Array.isArray(groups) ? groups : []).slice(0, 50).map((g) => ({
    id: String(g.id || '').replace(/[^\w-]/g, '').slice(0, 20) || Math.random().toString(36).slice(2, 10),
    name: String(g.name || 'Group').trim().slice(0, 60) || 'Group',
    collapsed: !!g.collapsed,
    keys: (Array.isArray(g.keys) ? g.keys : []).filter((k) => /^(bot|room):\d+$/.test(k) && !seen.has(k) && seen.add(k)).slice(0, 500)
  }));
  setSetting('side_groups', JSON.stringify(clean));
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});

// Sidebar order the user arranged by dragging (shared by all their devices). null = sort by recent activity.
route('PUT', '/api/side-order', async (req, res) => {
  const { order } = await body(req);
  setSetting('side_order', Array.isArray(order) ? JSON.stringify(order.filter((k) => /^(bot|room):\d+$/.test(k)).slice(0, 500)) : '');
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});

// ---------- the Claude account the bots use ----------
// The token is write-only: the app only learns whether one is saved.
route('PUT', '/api/claude-account', async (req, res) => {
  const token = String((await body(req)).token || '').trim();
  if (!TOKEN_RE.test(token)) return json(res, 400, { error: 'That doesn’t look like a Claude token. Run `claude setup-token` and paste the line that starts with sk-ant-oat.' });
  setClaudeToken(token);
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});
route('DELETE', '/api/claude-account', (req, res) => {
  setClaudeToken('');
  broadcast('state_changed', {});
  json(res, 200, { ok: true });
});

// ---------- server settings (bot computers) ----------
// Secrets are write-only: the app sees whether one is saved, never its value.
const SETTINGS = [
  { key: 'agent_url', env: 'NIMBUS_AGENT_URL' }, { key: 'agent_token', env: 'NIMBUS_AGENT_TOKEN', secret: true }, { key: 'callback_url', env: 'NIMBUS_CALLBACK_URL' },
  { key: 'auto_compact_pct', env: 'NIMBUS_AUTO_COMPACT_PCT' },
  { key: 'thread_limit' }, { key: 'usage_guard_pct' }, { key: 'memory_cap' }, { key: 'memory_min_days' },
  { key: 'trusted_proxies', env: 'NIMBUS_TRUSTED_PROXIES' }, { key: 'trusted_bots', env: 'NIMBUS_TRUSTED_BOTS' }, { key: 'sandbox', env: 'NIMBUS_SANDBOX' }
];
route('GET', '/api/settings', (req, res) => {
  const out = {};
  for (const s of SETTINGS) { const v = getSetting(s.key, s.env); out[s.key] = s.secret ? (v ? '__saved__' : '') : v; }
  json(res, 200, out);
});
route('PUT', '/api/settings', async (req, res) => {
  const b = await body(req), toSave = [];
  for (const s of SETTINGS) {
    if (b[s.key] === undefined || (s.secret && b[s.key] === '__saved__')) continue;
    const v = String(b[s.key]).trim();
    if (s.key === 'auto_compact_pct' && v && !(Number(v) >= 0 && Number(v) <= 95)) return json(res, 400, { error: 'Auto-compact must be 0 (off) to 95' });
    if (s.key === 'thread_limit' && v && !/^[123]$/.test(v)) return json(res, 400, { error: 'Threads at once per bot: 1, 2 or 3' });
    if (s.key === 'usage_guard_pct' && v && !(Number(v) >= 0 && Number(v) <= 90)) return json(res, 400, { error: 'Usage guard: 0 to 90 (% of the 5-hour limit left)' });
    if (s.key === 'memory_cap' && v && !(Number(v) >= 5 && Number(v) <= 200)) return json(res, 400, { error: 'Short-term memory: 5 to 200 lines' });
    if (s.key === 'memory_min_days' && v && !(Number(v) >= 0 && Number(v) <= 365)) return json(res, 400, { error: 'Memory minimum age: 0 to 365 days' });
    if (s.key === 'trusted_proxies' && v && !/^[\d.:a-f]+([\s,]+[\d.:a-f]+)*$/i.test(v)) return json(res, 400, { error: 'Trusted proxies: IP addresses separated by commas, e.g. 192.168.1.2' });
    if (s.key === 'trusted_bots' && v && !/^\d+([\s,]+\d+)*$/.test(v)) return json(res, 400, { error: 'Trusted bots: bot numbers separated by commas, e.g. 3' });
    if (s.key === 'sandbox' && v && !/^(off|all|-?\d+)([\s,]+-?\d+)*$/i.test(v.replace(/^all\b/i, 'all'))) return json(res, 400, { error: 'Sandbox: off, all, bot numbers (e.g. 5,9), or all,-3 for every bot but #3' });
    if (/_url$/.test(s.key) && v && !/^https?:\/\/[^\s]+$/.test(v)) return json(res, 400, { error: `${s.key.replace('_', ' ')} must start with http:// or https://` });
    toSave.push([s.key, v]);
  }
  db.exec('BEGIN'); try { for (const [k, v] of toSave) setSetting(k, v); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  broadcast('state_changed', {});
  json(res, 200, { ok: true, computers: computersOn() });
});
route('POST', '/api/settings/test-agent', (req, res) => computerRoute(res, () => agent('/health')));

// ---------- Claude plan usage (planusage.js) ----------
route('GET', '/api/plan-usage', async (req, res) => json(res, 200, await getPlanUsage()));

// ---------- read aloud, dictation, translation: speech.js ----------
// ---------- search, activity log, usage by bot ----------
// Full-text index of readable messages (not run traces), kept current by triggers; built once from what's there.
const FTS_KINDS = "('text','quiet','note')";
if (!q("SELECT 1 FROM sqlite_master WHERE name='messages_fts'").get()) {
  db.exec(`CREATE VIRTUAL TABLE messages_fts USING fts5(body, content='messages', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
    INSERT INTO messages_fts(rowid, body) SELECT id, body FROM messages WHERE kind IN ${FTS_KINDS};`);
}
db.exec(`CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages WHEN new.kind IN ${FTS_KINDS} BEGIN
    INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages WHEN old.kind IN ${FTS_KINDS} BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_au_old AFTER UPDATE OF body, kind ON messages WHEN old.kind IN ${FTS_KINDS} BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, body) VALUES ('delete', old.id, old.body); END;
  CREATE TRIGGER IF NOT EXISTS messages_fts_au_new AFTER UPDATE OF body, kind ON messages WHEN new.kind IN ${FTS_KINDS} BEGIN
    INSERT INTO messages_fts(rowid, body) VALUES (new.id, new.body); END;`);
// Every word must appear (the last one may be the start of a word, as you type); quotes keep FTS syntax out.
const ftsQuery = (term) => term.split(/\s+/).map((w) => w.replace(/"/g, '')).filter(Boolean).map((w, i, a) => `"${w}"${i === a.length - 1 ? '*' : ''}`).join(' ');
route('GET', '/api/search', (req, res, _p, url) => {
  const term = String(url.searchParams.get('q') || '').trim();
  if (term.length < 2) return json(res, 200, { results: [] });
  const like = '%' + term.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const fq = ftsQuery(term);
  let rows = [];
  try { rows = fq ? q(`SELECT m.id, m.thread, m.author, m.body, m.created_at FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
    WHERE messages_fts MATCH ? ORDER BY m.id DESC LIMIT 40`).all(fq) : []; } catch { rows = []; }
  // Nothing as whole words: fall back to matching inside words (e.g. part of a ticket number).
  if (!rows.length) rows = q(`SELECT id, thread, author, body, created_at FROM messages WHERE kind IN ${FTS_KINDS} AND body LIKE ? ESCAPE '\\'
    ORDER BY id DESC LIMIT 40`).all(like);
  const words = term.toLowerCase().split(/\s+/).filter(Boolean);
  json(res, 200, { results: rows.map((m) => {
    const lowBody = m.body.toLowerCase(), hit = [term.toLowerCase(), ...words].map((w) => lowBody.indexOf(w)).find((i) => i >= 0) ?? 0;
    const start = Math.max(0, hit - 50);
    return { id: m.id, thread: m.thread, author: m.author, at: m.created_at,
      snippet: (start ? '…' : '') + m.body.slice(start, start + 160).replace(/\s+/g, ' ') + (start + 160 < m.body.length ? '…' : '') };
  }) });
});
route('GET', '/api/activity', (req, res, _p, url) => {
  const days = Math.min(90, Number(url.searchParams.get('days') || 7));
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const runs = q(`SELECT id, bot_id, thread, status, started_at, ended_at, cost_usd, effort, parent_run, substr(prompt, 1, 160) AS prompt
    FROM runs WHERE started_at >= ? ORDER BY id DESC LIMIT 400`).all(since);
  const approvals = q(`SELECT id, run_id, bot_id, tool, status, note, created_at, decided_at, substr(input, 1, 300) AS input
    FROM approvals WHERE created_at >= ? ORDER BY id DESC LIMIT 400`).all(since);
  json(res, 200, { runs, approvals });
});

// Approvals (hook side: localhost, or the computer VM)
// Bots run here (localhost) or in a container on the computer VM, whose hook calls come from the VM's address.
function hookAuth(req) {
  const t = String(req.headers['x-nimbus-hook'] || '');
  if (t.length !== HOOK_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(HOOK_TOKEN))) return false;
  const from = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  if (['127.0.0.1', '::1'].includes(from)) return true;
  try { return computersOn() && from === new URL(agentConfig().url).hostname; } catch { return false; }
}
const NIMBUS_DIR = path.resolve(HERE);
const gate = createGate({
  nimbusDir: NIMBUS_DIR, ownDir: botDir, allowedEmails: ALLOWED_EMAILS,
  trusted: (botId) => String(getSetting('trusted_bots', 'NIMBUS_TRUSTED_BOTS') || '').split(/[\s,]+/).includes(String(botId)),
  journal: journalBefore, planAllows, autoApprove,
  runStatus: (id) => q('SELECT status FROM runs WHERE id=?').get(id)?.status,
  ask({ bot, run, tool, input, why, pattern }) {
    const ins = q('INSERT INTO approvals (run_id, bot_id, thread, tool, input) VALUES (?,?,?,?,?)').run(run.id, bot.id, run.thread, tool, redact(JSON.stringify(input || {})));
    const approvalId = Number(ins.lastInsertRowid);
    addMessage(run.thread, bot.id, 'approval', { approvalId, tool, input, status: 'pending', pattern, ...(why ? { why } : {}) }, run.id);
    markTraceWaiting(run.id, tool, true);
    broadcast('approvals_changed', {});
    return approvalId;
  },
});
route('POST', '/api/hook/pretool', async (req, res) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const { runId, tool, input } = await body(req);
  const run = q('SELECT * FROM runs WHERE id=?').get(runId);
  if (!run) return json(res, 200, { decision: 'allow' });
  json(res, 200, await gate.decide(parseBot(q('SELECT * FROM bots WHERE id=?').get(run.bot_id)), run, tool, input));
});
// Bot-to-bot messages (bin/ask-bot.mjs). The asking bot's run id gives who is asking and the
// chain of bots already waiting, so a bot can't message one that is waiting on it (that would deadlock).
// Answers wait at most 4 minutes: Node's fetch gives up on a response with no headers after 5, so
// longer jobs return a run id to collect with --result.
const MAX_ASK_DEPTH = 4;
function askChain(runId) {
  const bots = [];
  for (let id = runId, n = 0; id && n < 20; n++) {
    const r = q('SELECT bot_id, parent_run FROM runs WHERE id=?').get(id);
    if (!r) break;
    bots.push(r.bot_id); id = r.parent_run;
  }
  return bots;
}
function findBot(ref) {
  const all = q('SELECT * FROM bots').all();
  const s = String(ref || '').trim().replace(/^@/, '');
  const byId = s.match(/^#?(\d+)$/);
  if (byId) return all.find((b) => b.id === Number(byId[1]));
  const low = s.toLowerCase();
  const exact = all.filter((b) => b.name.toLowerCase() === low);
  if (exact.length === 1) return exact[0];
  const part = all.filter((b) => b.name.toLowerCase().includes(low));
  return part.length === 1 ? part[0] : null;
}
async function askResult(runId, waitMs) {
  const until = Date.now() + waitMs;
  while (Date.now() < until) {
    const r = q('SELECT status FROM runs WHERE id=?').get(runId);
    if (!r) return { error: 'No such run' };
    if (!['queued', 'running'].includes(r.status)) {
      const m = q("SELECT body, kind FROM messages WHERE run_id=? AND kind IN ('text','error') ORDER BY id DESC LIMIT 1").get(runId);
      return { status: r.status, reply: m?.body || '(no reply)', error: m?.kind === 'error' || undefined };
    }
    await new Promise((res) => setTimeout(res, 1500));
  }
  return { status: 'running', runId, note: `Still working. Fetch the answer later with --result ${runId}.` };
}
route('POST', '/api/hook/ask', async (req, res) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const { fromRun, to, text, wait = true } = await body(req);
  const from = q('SELECT b.* FROM runs r JOIN bots b ON b.id = r.bot_id WHERE r.id=?').get(Number(fromRun));
  if (!from) return json(res, 400, { error: 'Unknown asking run' });
  const target = findBot(to);
  if (!target) return json(res, 404, { error: `No single bot matches "${to}". Bots: ${q('SELECT id, name FROM bots ORDER BY id').all().map((b) => `${b.name} (#${b.id})`).join(', ')}` });
  if (target.id === from.id) return json(res, 400, { error: 'That is you.' });
  if (!String(text || '').trim()) return json(res, 400, { error: 'Empty message' });
  const chain = askChain(Number(fromRun));
  if (chain.includes(target.id)) return json(res, 409, { error: `${target.name} is waiting on your answer, so it can't take a message now. Put what you want to tell it in your reply.` });
  if (chain.length > MAX_ASK_DEPTH) return json(res, 429, { error: 'Too many bots are already waiting on each other. Answer with what you have.' });
  const thread = TH.builtIn(target.id, 'inbox');
  addMessage(thread, 'system', 'note', `📨 ${from.name}: ${String(text).trim()}`);
  broadcast('handoff', { from: from.id, to: target.id });
  const runId = runBot({ botId: target.id, thread, source: from.name, parentRun: Number(fromRun), depth: chain.length,
    prompt: `Message from ${from.name}, another Nimbus bot (not the user):\n\n${String(text).trim()}\n\n${wait ? `Your reply is sent back to ${from.name}, so answer what it needs.` : `${from.name} isn't waiting for a reply; act on this if it's in your area.`}` });
  if (!wait) return json(res, 200, { queued: true, runId, to: target.name });
  json(res, 200, { to: target.name, ...(await askResult(runId, 4 * 60_000)) });
});
route('GET', '/api/hook/ask/:runId', async (req, res, p) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  json(res, 200, await askResult(Number(p.runId), 4 * 60_000));
});
route('GET', '/api/hook/approval/:id', (req, res, p) => {
  if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
  const id = Number(p.id);
  const reply = () => { const a = q('SELECT status, note FROM approvals WHERE id=?').get(id); json(res, 200, a || { status: 'expired' }); };
  const a = q('SELECT status FROM approvals WHERE id=?').get(id);
  if (!a || a.status !== 'pending') return reply();
  const timer = setTimeout(done, 50000);
  function done() { clearTimeout(timer); waiters.get(id)?.delete(done); if (!res.writableEnded) reply(); }
  if (!waiters.has(id)) waiters.set(id, new Set());
  waiters.get(id).add(done);
  req.on('close', () => waiters.get(id)?.delete(done));
});

// ---------- server ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.mjs': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2' };

// ---------- login ----------
// The app is meant to be reachable from the internet, so some login method is required:
// email + password accounts (limited to NIMBUS_ALLOWED_EMAILS), or a single shared NIMBUS_PASSWORD.
const ACCOUNTS = ALLOWED_EMAILS.length > 0;
const AUTH_ON = !!(PASSWORD || ACCOUNTS);
if (!AUTH_ON && process.env.NIMBUS_ALLOW_NO_PASSWORD !== '1') {
  console.error('Set up a login before starting Nimbus (anyone who can reach this server could otherwise control your bots): NIMBUS_ALLOWED_EMAILS (for email sign-up), or NIMBUS_PASSWORD. See README.');
  process.exit(1);
}
db.exec('CREATE TABLE IF NOT EXISTS auth_sessions (token TEXT PRIMARY KEY, created_at INTEGER DEFAULT (unixepoch()))');
if (!q('PRAGMA table_info(auth_sessions)').all().some((c) => c.name === 'email')) db.exec("ALTER TABLE auth_sessions ADD COLUMN email TEXT DEFAULT ''");
db.exec('CREATE TABLE IF NOT EXISTS users (email TEXT PRIMARY KEY, salt TEXT NOT NULL, pw_hash TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()))');
const SESSION_DAYS = 90;
// Expired sign-ins are removed (otherwise only signing out deletes one).
const pruneSessions = () => { try { q('DELETE FROM auth_sessions WHERE created_at <= unixepoch() - ?').run(SESSION_DAYS * 86400); } catch (e) { console.error('session cleanup', e.message); } };
pruneSessions(); setInterval(pruneSessions, 6 * 3600_000).unref();
const hashPassword = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const failures = new Map(); // ip -> { n, until }
// The address a request really came from. Behind a reverse proxy (Nginx Proxy Manager) every device would look like
// the proxy, so one person's wrong passwords would lock everyone out: for this host and the trusted_proxies setting,
// the last address the proxy added to X-Forwarded-For is used (earlier ones can be made up by the client).
function clientIp(req) {
  const bare = (a) => String(a || '').trim().replace(/^::ffff:/, '');
  const direct = bare(req.socket.remoteAddress);
  const trusted = new Set(['127.0.0.1', '::1', ...String(getSetting('trusted_proxies', 'NIMBUS_TRUSTED_PROXIES') || '').split(/[\s,]+/).filter(Boolean)]);
  if (!trusted.has(direct) || !req.headers['x-forwarded-for']) return direct;
  const hops = String(req.headers['x-forwarded-for']).split(',').map(bare).filter(Boolean);
  while (hops.length > 1 && trusted.has(hops[hops.length - 1])) hops.pop();
  return hops[hops.length - 1] || direct;
}
function cookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return m ? m[1] : null;
}
function cookieToken(req) {
  const t = cookie(req, 'nimbus_session');
  return t && /^[a-f0-9]{64}$/.test(t) ? t : null;
}
function loggedIn(req) {
  if (!AUTH_ON) return true;
  const t = cookieToken(req);
  const row = t && q('SELECT email FROM auth_sessions WHERE token=? AND created_at > unixepoch() - ?').get(t, SESSION_DAYS * 86400);
  if (row) req.user = { email: row.email };
  return !!row;
}
function isHttps(req) {
  return !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' || process.env.NIMBUS_SECURE_COOKIE === '1';
}
function newSessionCookie(req, email = '') {
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO auth_sessions (token, email) VALUES (?,?)').run(token, email);
  return `nimbus_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${isHttps(req) ? '; Secure' : ''}`;
}
// The app's pages may run only Nimbus's own script files: injected <script> tags, onclick="…" and eval are refused,
// so a slip in escaping can't become code. Bot web pages load from ?sandbox URLs with their own rules (see /api/files).
const APP_CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self' data:",
  "img-src 'self' data: blob: https:", "media-src 'self' data: blob:", "connect-src 'self' ws: wss:", "frame-src 'self' blob: data: http: https:", "worker-src 'self' blob:",
  "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"].join('; ');
const LOGIN_PAGE = fs.readFileSync(path.join(PUBLIC, 'login.html'));
// The login page's one inline script is allowed by its hash only; everything else on it is locked down.
const LOGIN_SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(String(LOGIN_PAGE))?.[1] || '';
const LOGIN_CSP = ["default-src 'self'", `script-src 'sha256-${crypto.createHash('sha256').update(LOGIN_SCRIPT).digest('base64')}'`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data:", "connect-src 'self'", "form-action 'self'", "frame-ancestors 'none'", "base-uri 'none'", "object-src 'none'"].join('; ');

route('POST', '/api/login', async (req, res) => {
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.n >= 8 && f.until > Date.now()) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
  const { email: rawEmail, password } = await body(req);
  const email = String(rawEmail || '').trim().toLowerCase();
  let ok = false;
  if (email) {
    const u = q('SELECT * FROM users WHERE email=?').get(email);
    // Hash even for unknown emails so response time doesn't reveal which accounts exist.
    const got = Buffer.from(hashPassword(password || '', u?.salt || 'x'), 'hex');
    ok = !!u && ALLOWED_EMAILS.includes(email) && crypto.timingSafeEqual(got, Buffer.from(u.pw_hash, 'hex'));
  } else if (PASSWORD && password) {
    ok = crypto.timingSafeEqual(hash(password), hash(PASSWORD));
  }
  if (!ok) {
    const cur = f && f.until > Date.now() ? f : { n: 0 };
    failures.set(ip, { n: cur.n + 1, until: Date.now() + 15 * 60_000 });
    await new Promise((r) => setTimeout(r, 600));
    return json(res, 401, { error: email ? 'Wrong email or password' : 'Wrong password' });
  }
  failures.delete(ip);
  const acct = email && q('SELECT totp_enabled FROM users WHERE email=?').get(email);
  if (acct?.totp_enabled) {
    // Password was right; the session is only issued after the authenticator code.
    const ticket = crypto.randomBytes(24).toString('hex');
    mfaTickets.set(ticket, { email, until: Date.now() + 5 * 60_000, tries: 0 });
    return json(res, 200, { mfa: true, ticket });
  }
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': newSessionCookie(req, email) });
  res.end('{"ok":true}');
});
route('GET', '/api/auth-methods', (req, res) => json(res, 200, { password: !!PASSWORD, accounts: ACCOUNTS }));
route('GET', '/api/https-port', (req, res) => json(res, 200, { port: HTTPS_PORT }));

// Email sign-up. Nimbus can't send email to verify an address, so only emails on the
// NIMBUS_ALLOWED_EMAILS list can make an account, and each email can sign up once.
route('POST', '/api/signup', async (req, res) => {
  if (!ACCOUNTS) return json(res, 404, { error: 'Sign-up is not enabled' });
  const ip = clientIp(req);
  const f = failures.get(ip);
  if (f && f.n >= 8 && f.until > Date.now()) return json(res, 429, { error: 'Too many tries. Wait 15 minutes.' });
  const { email: rawEmail, password } = await body(req);
  const email = String(rawEmail || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(res, 400, { error: 'Enter a valid email' });
  if (String(password || '').length < 8) return json(res, 400, { error: 'Password must be at least 8 characters' });
  if (!ALLOWED_EMAILS.includes(email)) {
    const cur = f && f.until > Date.now() ? f : { n: 0 };
    failures.set(ip, { n: cur.n + 1, until: Date.now() + 15 * 60_000 });
    return json(res, 403, { error: "This email isn't allowed to use this Nimbus. Ask the owner to add it to NIMBUS_ALLOWED_EMAILS." });
  }
  if (q('SELECT 1 FROM users WHERE email=?').get(email)) return json(res, 409, { error: 'That email already has an account. Sign in instead.' });
  const salt = crypto.randomBytes(16).toString('hex');
  q('INSERT INTO users (email, salt, pw_hash) VALUES (?,?,?)').run(email, salt, hashPassword(password, salt));
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': newSessionCookie(req, email) });
  res.end('{"ok":true}');
});

// ---------- two-factor (authenticator app codes, RFC 6238 TOTP) ----------
for (const [col, def] of [['totp_secret', "''"], ['totp_enabled', '0'], ['recovery', "'[]'"]]) {
  if (!q('PRAGMA table_info(users)').all().some((c) => c.name === col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def === '0' ? 'INTEGER' : 'TEXT'} DEFAULT ${def}`);
}
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(buf) {
  let bits = '', out = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}
function unbase32(str) {
  let bits = '';
  for (const ch of str.replace(/=+$/, '').toUpperCase()) bits += B32.indexOf(ch).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
function totp(secret, step) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac('sha1', unbase32(secret)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}
// Accepts the current 30-second code or its neighbours, to allow for clock drift.
function checkTotp(secret, code) {
  code = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return false;
  const now = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((d) => crypto.timingSafeEqual(Buffer.from(totp(secret, now + d)), Buffer.from(code)));
}
// A one-time recovery code is consumed when used.
function useRecoveryCode(user, code) {
  const h = hash(String(code || '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')).toString('hex');
  const list = JSON.parse(user.recovery || '[]');
  if (!list.includes(h)) return false;
  q('UPDATE users SET recovery=? WHERE email=?').run(JSON.stringify(list.filter((x) => x !== h)), user.email);
  return true;
}
const mfaTickets = new Map(); // ticket -> { email, until, tries }
function currentUser(req) { return req.user?.email ? q('SELECT * FROM users WHERE email=?').get(req.user.email) : null; }

route('POST', '/api/login/mfa', async (req, res) => {
  const { ticket, code } = await body(req);
  const t = mfaTickets.get(String(ticket || ''));
  if (!t || t.until < Date.now()) { mfaTickets.delete(ticket); return json(res, 401, { error: 'Sign-in expired. Start again.', restart: true }); }
  const user = q('SELECT * FROM users WHERE email=?').get(t.email);
  const ok = user && (checkTotp(user.totp_secret, code) || useRecoveryCode(user, code));
  if (!ok) {
    if (++t.tries >= 5) { mfaTickets.delete(ticket); return json(res, 401, { error: 'Too many wrong codes. Start again.', restart: true }); }
    await new Promise((r) => setTimeout(r, 600));
    return json(res, 401, { error: 'Wrong code' });
  }
  mfaTickets.delete(ticket);
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': newSessionCookie(req, t.email) });
  res.end('{"ok":true}');
});
route('GET', '/api/mfa', (req, res) => {
  const u = currentUser(req);
  json(res, 200, { available: !!u, enabled: !!u?.totp_enabled, recoveryLeft: u ? JSON.parse(u.recovery || '[]').length : 0 });
});
route('POST', '/api/mfa/setup', (req, res) => {
  const u = currentUser(req);
  if (!u) return json(res, 400, { error: 'Two-factor is for email + password accounts.' });
  if (u.totp_enabled) return json(res, 400, { error: 'Two-factor is already on' });
  const secret = base32(crypto.randomBytes(20));
  q('UPDATE users SET totp_secret=? WHERE email=?').run(secret, u.email);
  const uri = `otpauth://totp/Nimbus:${encodeURIComponent(u.email)}?secret=${secret}&issuer=Nimbus&algorithm=SHA1&digits=6&period=30`;
  json(res, 200, { secret, uri });
});
route('POST', '/api/mfa/enable', async (req, res) => {
  const u = currentUser(req);
  if (!u?.totp_secret) return json(res, 400, { error: 'Start setup first' });
  if (!checkTotp(u.totp_secret, (await body(req)).code)) return json(res, 400, { error: 'That code didn’t match. Check your phone’s time is correct and try the newest code.' });
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'));
  q('UPDATE users SET totp_enabled=1, recovery=? WHERE email=?').run(JSON.stringify(codes.map((c) => hash(c).toString('hex'))), u.email);
  json(res, 200, { recovery: codes.map((c) => c.slice(0, 5) + '-' + c.slice(5)) });
});
route('POST', '/api/mfa/disable', async (req, res) => {
  const u = currentUser(req);
  if (!u?.totp_enabled) return json(res, 400, { error: 'Two-factor is not on' });
  const { password, code } = await body(req);
  const pwOk = crypto.timingSafeEqual(Buffer.from(hashPassword(password || '', u.salt), 'hex'), Buffer.from(u.pw_hash, 'hex'));
  if (!pwOk || !(checkTotp(u.totp_secret, code) || useRecoveryCode(u, code))) return json(res, 400, { error: 'Wrong password or code' });
  q("UPDATE users SET totp_enabled=0, totp_secret='', recovery='[]' WHERE email=?").run(u.email);
  json(res, 200, { ok: true });
});
route('POST', '/api/logout', (req, res) => {
  const t = cookieToken(req);
  if (t) q('DELETE FROM auth_sessions WHERE token=?').run(t);
  res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'nimbus_session=; Path=/; Max-Age=0' });
  res.end('{"ok":true}');
});

// Local admin access for scripts and bots on this server (bin/nimbus.mjs). The token file is
// readable only by the Nimbus user, and the header is honoured only from localhost.
const ADMIN_TOKEN_FILE = path.join(DATA_DIR, 'admin.token');
if (!fs.existsSync(ADMIN_TOKEN_FILE)) fs.writeFileSync(ADMIN_TOKEN_FILE, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const ADMIN_TOKEN = fs.readFileSync(ADMIN_TOKEN_FILE, 'utf8').trim();
function adminAuth(req) {
  const t = String(req.headers['x-nimbus-admin'] || '');
  return t.length === ADMIN_TOKEN.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(ADMIN_TOKEN))
    && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && !req.headers['x-forwarded-for'];
}

const OPEN_PATHS = new Set(['/nimbus.webp', '/login', '/api/login', '/api/login/mfa', '/api/signup', '/api/auth-methods', '/icon.svg', '/status', '/icon-32.png', '/icon-180.png', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest', '/styles.css', '/design.css', '/fonts/InterVariable.woff2', '/fonts/JetBrainsMono-Regular.woff2', '/fonts/JetBrainsMono-Medium.woff2']);
function checkAuth(req, res, url) {
  if (url.pathname.startsWith('/api/hook/') || OPEN_PATHS.has(url.pathname) || adminAuth(req) || loggedIn(req)) {
    // Mutating API calls must be JSON: blocks form-based cross-site requests.
    if (req.method !== 'GET' && url.pathname.startsWith('/api/') && !String(req.headers['content-type']).includes('application/json')) {
      json(res, 415, { error: 'JSON required' }); return false;
    }
    return true;
  }
  if (url.pathname.startsWith('/api/')) { json(res, 401, { error: 'login required' }); return false; }
  res.writeHead(302, { location: '/login' }); res.end();
  return false;
}

// ---------- bot desktop proxy ----------
// The desktop on the computer VM uses HTTP basic auth, which browsers won't prompt for inside a
// cross-origin iframe. Nimbus serves it at /computer/<botId>/ instead and adds the credentials itself,
// so only someone logged in to Nimbus can see a bot's screen. WebSockets (the live screen) go through too.
const deskCache = new Map(); // botId -> { at, info }
async function deskInfo(id) {
  const c = deskCache.get(id);
  if (c && Date.now() - c.at < 60_000) return c.info;
  let info = await agent(`/computers/${id}`);
  if (info.exists && !info.running) info = await agent(`/computers/${id}`, { method: 'POST' }); // asleep: wake it
  if (!info.exists || !info.port) throw new Error('This bot’s computer isn’t running');
  const r = { host: new URL(agentConfig().url).hostname, port: info.port, auth: 'Basic ' + Buffer.from(`${info.user}:${info.password}`).toString('base64') };
  deskCache.set(id, { at: Date.now(), info: r });
  return r;
}
const DESK_RE = /^\/computer\/(\d+)(\/.*)?$/;
const HOP = new Set(['connection', 'keep-alive', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'cookie', 'authorization']);
async function proxyDesktop(req, res, m, url) {
  deskSeen.set(Number(m[1]), Date.now());
  if (!m[2]) { res.writeHead(302, { location: `/computer/${m[1]}/` }); return res.end(); }
  let d;
  try { d = await deskInfo(Number(m[1])); } catch (e) { res.writeHead(502, { 'content-type': 'text/plain' }); return res.end(e.message); }
  const headers = Object.fromEntries(Object.entries(req.headers).filter(([k]) => !HOP.has(k)));
  const up = http.request({ host: d.host, port: d.port, method: req.method, path: m[2] + url.search, headers: { ...headers, host: `${d.host}:${d.port}`, authorization: d.auth } }, (r) => {
    const h = { ...r.headers }; delete h['x-frame-options']; delete h['www-authenticate'];
    if (r.statusCode === 401) deskCache.delete(Number(m[1])); // password changed, e.g. computer recreated
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  up.on('error', (e) => { if (!res.headersSent) { res.writeHead(502, { 'content-type': 'text/plain' }); res.end('Couldn’t reach the bot’s computer: ' + e.message); } else res.destroy(); });
  req.pipe(up);
}
async function proxyDesktopUpgrade(req, socket, head) {
  const url = new URL(req.url, 'http://x');
  const m = url.pathname.match(DESK_RE);
  if (!m || !loggedIn(req)) { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
  deskSeen.set(Number(m[1]), Date.now());
  let d;
  try { d = await deskInfo(Number(m[1])); } catch { socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); return; }
  const up = net.connect(d.port, d.host, () => {
    const lines = [`${req.method} ${(m[2] || '/') + url.search} HTTP/1.1`, `Host: ${d.host}:${d.port}`, `Authorization: ${d.auth}`];
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      const k = req.rawHeaders[i];
      if (!['host', 'cookie', 'authorization', 'origin'].includes(k.toLowerCase())) lines.push(`${k}: ${req.rawHeaders[i + 1]}`);
    }
    lines.push(`Origin: http://${d.host}:${d.port}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head?.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  const watching = setInterval(() => deskSeen.set(Number(m[1]), Date.now()), 60_000); // screen open = not idle
  const close = () => { clearInterval(watching); up.destroy(); socket.destroy(); };
  up.on('error', close); socket.on('error', close); socket.on('close', close);
}

const zipped = new Map(); // static file -> { etag, buf }
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (!checkAuth(req, res, url)) return;
    const desk = url.pathname.match(DESK_RE);
    if (desk) return await proxyDesktop(req, res, desk, url);
    if (url.pathname === '/login') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': LOGIN_CSP, 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin' }); return res.end(LOGIN_PAGE); }
    for (const r of routes) {
      const m = r.method === req.method && url.pathname.match(r.re);
      if (m) return await r.fn(req, res, m.groups || {}, url);
    }
    if (req.method !== 'GET' || url.pathname.startsWith('/api/')) return json(res, 404, { error: 'not found' });
    let file = path.join(PUBLIC, path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    // The browser still checks every time (no-cache) but gets a tiny "not changed" answer, and text goes out compressed.
    const st = fs.statSync(file), etag = `"${st.size.toString(36)}-${Math.round(st.mtimeMs).toString(36)}"`;
    const head = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'x-frame-options': 'SAMEORIGIN', 'content-security-policy': APP_CSP, 'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin', 'cache-control': 'no-cache', etag, vary: 'accept-encoding' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, head); return res.end(); }
    if (/\.(html|js|css|svg|json|webmanifest)$/.test(file) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      let z = zipped.get(file);
      if (!z || z.etag !== etag) zipped.set(file, z = { etag, buf: zlib.gzipSync(fs.readFileSync(file), { level: 6 }) });
      res.writeHead(200, { ...head, 'content-encoding': 'gzip', 'content-length': z.buf.length });
      return res.end(z.buf);
    }
    res.writeHead(200, { ...head, 'content-length': st.size });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    // Errors meant for you (thrown with a status) are shown as they are; anything unexpected gets a plain
    // message, and the details go to the log instead of the screen.
    if (res.headersSent) return;
    if (e.status) return json(res, e.status, { error: e.message });
    if (e instanceof SyntaxError) return json(res, 400, { error: 'That request wasn’t valid JSON' });
    if (e.message === 'too large') return json(res, 413, { error: 'That’s too large to send' });
    console.error(req.method, String(req.url).split('?')[0], e.stack || e);
    json(res, 500, { error: 'Something went wrong on the server. The details are in the Nimbus log.' });
  }
}
const onUpgrade = (req, socket, head) => { proxyDesktopUpgrade(req, socket, head).catch(() => socket.destroy()); };
// A background job that fails (a timer, a hook, a lost connection) is logged instead of taking the server down
// with every bot's run in it; systemd still restarts it after real crashes.
process.on('unhandledRejection', (e) => console.error('unhandled rejection:', e?.stack || e));
const server = http.createServer(handle);
server.on('upgrade', onUpgrade);

// HTTPS on a second port with a self-signed certificate made on first start (data/tls). Browsers only
// allow some features on secure pages: bot desktops (video decoding) and phone notifications need it.
// The certificate covers this server's IPs and hostname, and is remade when they change.
const HTTPS_PORT = Number(process.env.NIMBUS_HTTPS_PORT ?? 8443);
function tlsFiles() {
  const dir = path.join(DATA_DIR, 'tls'); fs.mkdirSync(dir, { recursive: true });
  const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem'), names = path.join(dir, 'names.txt');
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && !i.internal && i.family === 'IPv4').map((i) => i.address);
  const san = ['DNS:localhost', `DNS:${os.hostname()}`, 'IP:127.0.0.1', ...ips.map((ip) => `IP:${ip}`)].join(',');
  if (!fs.existsSync(cert) || !fs.existsSync(names) || fs.readFileSync(names, 'utf8') !== san) {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '3650', '-keyout', key, '-out', cert,
      '-subj', '/CN=Nimbus', '-addext', `subjectAltName=${san}`], { stdio: 'ignore' });
    fs.chmodSync(key, 0o600); fs.writeFileSync(names, san);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(cert) };
}
if (HTTPS_PORT) {
  try {
    const secure = https.createServer(tlsFiles(), handle);
    secure.on('upgrade', onUpgrade);
    secure.on('error', (e) => console.error(`HTTPS not started: ${e.message}`));
    secure.listen(HTTPS_PORT, HOST, () => console.log(`Nimbus HTTPS at https://<this server>:${HTTPS_PORT} (self-signed certificate)`));
  } catch (e) { console.error(`HTTPS not started: ${e.message}`); }
}
server.listen(PORT, HOST, () => {
  const shown = ['0.0.0.0', '::'].includes(HOST) ? 'localhost' : HOST;
  console.log(`Nimbus running at http://${shown}:${PORT}${shown !== HOST ? ` (listening on all interfaces, ${HOST})` : ''}`);
});

process.on('SIGTERM', () => { db.close(); process.exit(0); });
