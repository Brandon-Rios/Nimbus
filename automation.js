// Automation that runs on the server without Claude: playbooks (saved fixes), the homelab watchdog,
// the morning digest, shared team memory, hand-off rules between bots, scheduled messages,
// weekly budgets per bot and a read-only status page. Claude is only called when a rule says so.
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import https from 'node:https';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { botEnv } from './sandbox.js';
import { db, q, getSetting, setSetting, botDir } from './db.js';
import { runBot, addMessage, runGuards, afterRun, HOOK_TOKEN } from './runner.js';
import { broadcast } from './events.js';
import { builtIn } from './threads.js';

db.exec(`
CREATE TABLE IF NOT EXISTS playbooks (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, name TEXT NOT NULL, commands TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER DEFAULT (unixepoch()), last_run INTEGER, last_ok INTEGER, last_out TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS watches (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
  bot_id INTEGER, playbook_id INTEGER, wake INTEGER DEFAULT 0, enabled INTEGER DEFAULT 1, state TEXT DEFAULT 'unknown', fails INTEGER DEFAULT 0,
  since INTEGER, last_check INTEGER, last_ms INTEGER, detail TEXT DEFAULT '');
CREATE TABLE IF NOT EXISTS watch_log (id INTEGER PRIMARY KEY AUTOINCREMENT, watch_id INTEGER, state TEXT, detail TEXT, at INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS team_facts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, topic TEXT DEFAULT '', bot_id INTEGER, updated_at INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS chains (id INTEGER PRIMARY KEY AUTOINCREMENT, from_bot INTEGER NOT NULL, match TEXT DEFAULT '', to_bot INTEGER NOT NULL, note TEXT DEFAULT '', enabled INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS scheduled (id INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL, done INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()));
`);
const now = () => Math.floor(Date.now() / 1000);
const botName = (id) => q('SELECT name FROM bots WHERE id=?').get(Number(id))?.name || 'Bot';
const general = (id) => 'bot:' + Number(id);

// ---------- playbooks ----------
// Commands run one after another as the Nimbus user in the bot's folder; the first failure stops it.
function sh(cmd, cwd, ms = 120000) {
  return new Promise((ok) => {
    const c = spawn('bash', ['-lc', cmd], { cwd, env: botEnv({}, null, false) });
    let out = ''; const add = (d) => { out += d; if (out.length > 20000) out = out.slice(-20000); };
    c.stdout.on('data', add); c.stderr.on('data', add);
    const t = setTimeout(() => { c.kill('SIGKILL'); add('\n[stopped after ' + ms / 1000 + 's]'); }, ms);
    c.on('close', (code) => { clearTimeout(t); ok({ code, out }); });
    c.on('error', (e) => { clearTimeout(t); ok({ code: -1, out: e.message }); });
  });
}
const running = new Set();
export async function runPlaybook(id, why = 'You ran') {
  const pb = q('SELECT * FROM playbooks WHERE id=?').get(Number(id));
  if (!pb) throw Object.assign(new Error('No such playbook'), { status: 404 });
  if (running.has(pb.id)) throw Object.assign(new Error('Already running'), { status: 409 });
  running.add(pb.id);
  try {
    const cmds = JSON.parse(pb.commands || '[]'); let log = '', ok = true;
    const cwd = pb.bot_id && fs.existsSync(botDir(pb.bot_id)) ? botDir(pb.bot_id) : process.env.HOME;
    for (const c of cmds) {
      const r = await sh(c, cwd);
      log += `$ ${c}\n${r.out.trim()}\n${r.code ? `[exit ${r.code}]\n` : ''}\n`;
      if (r.code !== 0) { ok = false; break; }
    }
    log = log.slice(-12000);
    q('UPDATE playbooks SET last_run=unixepoch(), last_ok=?, last_out=? WHERE id=?').run(ok ? 1 : 0, log, pb.id);
    const last = log.trim().split('\n').filter((l) => l && !l.startsWith('$ ')).pop() || '';
    if (pb.bot_id) addMessage(general(pb.bot_id), 'system', 'note', `${ok ? '✅' : '❌'} ${why} the playbook “${pb.name}” (no Claude used): ${ok ? 'worked' : 'failed'}${last ? ` · ${last.slice(0, 160)}` : ''}. Output: Settings → Playbooks.`);
    broadcast('extras', { what: 'playbooks' });
    return { ok, log };
  } finally { running.delete(pb.id); }
}

// ---------- watchdog ----------
function tcp(host, port, ms = 4000) {
  return new Promise((ok) => { const t0 = Date.now(), s = net.connect(Number(port), host); const done = (up, d) => { s.destroy(); ok({ up, ms: Date.now() - t0, detail: d }); };
    s.once('connect', () => done(true, 'port open')); s.once('error', (e) => done(false, e.code || e.message)); s.setTimeout(ms, () => done(false, 'timeout')); });
}
function web(url, ms = 6000) {
  return new Promise((ok) => {
    const t0 = Date.now(); let u; try { u = new URL(url); } catch { return ok({ up: false, detail: 'bad URL' }); }
    const r = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', rejectUnauthorized: false, timeout: ms }, (res) => {
      res.resume(); ok({ up: res.statusCode < 500, ms: Date.now() - t0, detail: 'HTTP ' + res.statusCode }); });
    r.on('timeout', () => { r.destroy(); ok({ up: false, detail: 'timeout' }); });
    r.on('error', (e) => ok({ up: false, detail: e.code || e.message })); r.end();
  });
}
function ping(host) {
  return new Promise((ok) => { const t0 = Date.now(); const c = spawn('ping', ['-c', '1', '-W', '2', host]);
    c.on('close', (code) => ok({ up: code === 0, ms: Date.now() - t0, detail: code === 0 ? 'replies' : 'no reply' })); c.on('error', () => ok({ up: false, detail: 'ping not available' })); });
}
function disk(target) { // "/path:90" -> down when the disk is 90% full or more
  const [p, lim = '90'] = target.split(':');
  try { const s = fs.statfsSync(p || '/'); const used = Math.round((1 - s.bavail / s.blocks) * 100); return { up: used < Number(lim), ms: 0, detail: `${used}% full` }; }
  catch (e) { return { up: false, detail: e.message }; }
}
export async function check(w) {
  if (w.kind === 'tcp') { const [h, p] = w.target.split(':'); return tcp(h, p); }
  if (w.kind === 'http') return web(w.target);
  if (w.kind === 'ping') return ping(w.target);
  if (w.kind === 'disk') return disk(w.target);
  return { up: false, detail: 'unknown kind' };
}
const ICONS = { up: '🟢', down: '🔴' };
let sweeping = false;
async function sweep() {
  if (sweeping) return; // a slow sweep (many timeouts) must not overlap the next one: that doubles alerts
  sweeping = true;
  try { for (const { id } of q('SELECT id FROM watches WHERE enabled=1').all()) await sweepOne(id); } finally { sweeping = false; }
}
async function sweepOne(id) {
  const w0 = q('SELECT * FROM watches WHERE id=? AND enabled=1').get(id); if (!w0) return;
  const r = await check(w0);
  const w = q('SELECT * FROM watches WHERE id=? AND enabled=1').get(id); // edited, paused or deleted during the check
  if (!w || w.target !== w0.target || w.kind !== w0.kind) return;
  const fails = r.up ? 0 : w.fails + 1;
  // Down only after two misses in a row (one blip is ignored); back up on the first success.
  const state = r.up ? 'up' : fails >= 2 ? 'down' : w.state === 'unknown' ? 'unknown' : w.state;
  const changed = state !== w.state && state !== 'unknown';
  q('UPDATE watches SET fails=?, state=?, last_check=unixepoch(), last_ms=?, detail=?, since=? WHERE id=?')
    .run(fails, state, r.ms ?? null, r.detail || '', changed || !w.since ? now() : w.since, w.id);
  if (!changed || (w.state === 'unknown' && state === 'up')) return;
  q('INSERT INTO watch_log (watch_id, state, detail) VALUES (?,?,?)').run(w.id, state, r.detail || '');
  broadcast('extras', { what: 'watch' });
  if (!w.bot_id) return;
  const down = state === 'down';
  addMessage(general(w.bot_id), 'system', 'note', `${ICONS[state]} Watchdog: **${w.name}** is ${down ? 'down' : 'back up'} (${r.detail}).`);
  if (down && w.playbook_id) runPlaybook(w.playbook_id, 'The watchdog ran').catch(() => {});
  else if (down && w.wake) runBot({ botId: w.bot_id, thread: general(w.bot_id), source: 'watchdog',
    prompt: `Nimbus watchdog: "${w.name}" (${w.kind} ${w.target}) stopped answering: ${r.detail}. Find out why and fix it if it's safe; otherwise tell the user what you found. Reply briefly.` });
}
// First start: a couple of checks every install has; add your own services in Watchdog.
function seed() {
  if (q('SELECT COUNT(*) AS n FROM watches').get().n || getSetting('watch_seeded')) return;
  setSetting('watch_seeded', '1');
  for (const [n, k, t] of [['Internet', 'tcp', '1.1.1.1:443'], ['Nimbus disk', 'disk', '/:90']]) q('INSERT INTO watches (name, kind, target, bot_id) VALUES (?,?,?,?)').run(n, k, t, null);
}
// Bots with something of theirs down look worried in the sidebar.
export function moods() {
  const out = {};
  for (const r of q("SELECT bot_id FROM watches WHERE enabled=1 AND state='down' AND bot_id IS NOT NULL").all()) out[r.bot_id] = 'worried';
  return out;
}

// ---------- budgets ----------
// setting bot_budgets = {"<botId>": dollars per 7 days}. Over budget, routines, watchdog wake-ups,
// hand-offs and requests from other bots are skipped; your own messages still go through.
const budgets = () => { try { return JSON.parse(getSetting('bot_budgets') || '{}'); } catch { return {}; } };
const weekCost = (id) => q('SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE bot_id=? AND started_at >= unixepoch() - 7*86400').get(id).c;
runGuards.push((botId, source) => {
  const cap = Number(budgets()[botId]);
  if (!cap) return null;
  const used = weekCost(botId);
  return used >= cap ? `⏸ ${botName(botId)} hit its weekly budget ($${used.toFixed(2)} of $${cap.toFixed(2)}), so this ${source === 'schedule' ? 'routine' : source} was skipped. Raise it in Settings → Budgets.` : null;
});

// ---------- hand-off rules ----------
const MAX_CHAIN = 2;
function matches(rule, text) {
  const m = String(rule || '').trim();
  if (!m) return true;
  const re = /^\/(.+)\/([a-z]*)$/.exec(m);
  if (re) { try { return new RegExp(re[1], re[2] || 'i').test(text); } catch { return false; } }
  return text.toLowerCase().includes(m.toLowerCase());
}
afterRun.push(({ botId, thread, msg, depth, stopped }) => {
  if (stopped || msg?.kind !== 'text' || depth >= MAX_CHAIN) return;
  for (const c of q('SELECT * FROM chains WHERE enabled=1 AND from_bot=?').all(botId)) {
    if (!matches(c.match, msg.body) || c.to_bot === botId) continue;
    broadcast('handoff', { from: botId, to: c.to_bot });
    addMessage(thread, 'system', 'note', `↪ Handed to ${botName(c.to_bot)}${c.note ? ` (${c.note})` : ''}.`);
    runBot({ botId: c.to_bot, thread: builtIn(c.to_bot, 'inbox'), source: 'chain', depth: depth + 1,
      prompt: `Hand-off from ${botName(botId)}${c.note ? ` — rule: ${c.note}` : ''}. Its reply:\n\n${msg.body}\n\nDo your part. Reply briefly.` });
  }
});

// ---------- digest ----------
export function digest() {
  const since = now() - 86400;
  const changes = q('SELECT l.state, l.detail, l.at, w.name, w.bot_id FROM watch_log l JOIN watches w ON w.id=l.watch_id WHERE l.at >= ? ORDER BY l.at DESC LIMIT 20').all(since);
  const down = q("SELECT name, bot_id, since, detail FROM watches WHERE enabled=1 AND state='down'").all();
  const failed = q("SELECT r.bot_id, r.started_at, r.thread FROM runs r WHERE r.status='error' AND r.started_at >= ? ORDER BY r.id DESC LIMIT 10").all(since);
  const runs = q('SELECT bot_id, COUNT(*) AS n, ROUND(COALESCE(SUM(cost_usd),0),2) AS cost FROM runs WHERE started_at >= ? GROUP BY bot_id ORDER BY n DESC').all(since);
  const plays = q('SELECT name, last_ok, last_run FROM playbooks WHERE last_run >= ? ORDER BY last_run DESC LIMIT 8').all(since);
  const later = q('SELECT thread, text, at FROM scheduled WHERE done=0 AND at <= ? ORDER BY at LIMIT 8').all(now() + 86400);
  const watched = q('SELECT COUNT(*) AS n, SUM(state=\'up\') AS up FROM watches WHERE enabled=1').get();
  return { changes, down, failed, runs, plays, later, watched };
}

// ---------- scheduled messages ----------
let postFn = null;
function dueMessages() {
  for (const m of q('SELECT * FROM scheduled WHERE done=0 AND at <= ?').all(now())) {
    q('UPDATE scheduled SET done=1 WHERE id=?').run(m.id);
    try { postFn(m.thread, m.text); } catch (e) { addMessage(m.thread, 'system', 'note', `Couldn’t send the scheduled message: ${e.message}`); }
    broadcast('extras', { what: 'scheduled' });
  }
}

// ---------- status page ----------
const STATUS_HTML = (rows, at) => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="60"><title>Homelab status</title><link rel="icon" href="/icon-32.png"><style>
body{font:15px system-ui,sans-serif;background:#0f1a45;color:#eef2ff;margin:0;display:flex;justify-content:center}main{width:min(560px,92vw);padding:40px 0}
h1{font-size:22px;margin:0 0 4px}p{color:#9aa6d6;margin:0 0 24px}.all{padding:14px 16px;border-radius:12px;margin-bottom:18px;font-weight:600}
.ok{background:#14532d}.bad{background:#7f1d1d}ul{list-style:none;padding:0;margin:0;background:#16204a;border-radius:12px;overflow:hidden}
li{display:flex;justify-content:space-between;padding:12px 16px;border-top:1px solid #23306a}li:first-child{border:0}.s{font-size:13px}.up{color:#4ade80}.down{color:#f87171}.unknown{color:#9aa6d6}
</style></head><body><main><h1>☁️ Homelab status</h1><p>Checked every 2 minutes · updated ${at}</p>
${rows.some((r) => r.state === 'down') ? '<div class="all bad">Something is down</div>' : '<div class="all ok">Everything is running</div>'}
<ul>${rows.map((r) => `<li><span>${r.name.replace(/[<>&]/g, '')}</span><span class="s ${r.state}">${r.state === 'up' ? '● Up' : r.state === 'down' ? '● Down' : '○ Checking'}</span></li>`).join('')}</ul></main></body></html>`;

// ---------- routes ----------
export function registerAutomation(route, { json, body, postToThread }) {
  postFn = postToThread;
  const int = (v) => (v === '' || v == null ? null : Number(v));
  const crud = (name, table, fields, clean = (x) => x) => {
    route('GET', `/api/extras/${name}`, (req, res) => json(res, 200, { items: q(`SELECT * FROM ${table} ORDER BY id`).all() }));
    route('POST', `/api/extras/${name}`, async (req, res) => {
      try { const b = clean(await body(req)); const r = q(`INSERT INTO ${table} (${fields.join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map((f) => b[f] ?? null));
        broadcast('extras', { what: name }); json(res, 200, q(`SELECT * FROM ${table} WHERE id=?`).get(Number(r.lastInsertRowid))); }
      catch (e) { json(res, 400, { error: e.message }); }
    });
    route('PATCH', `/api/extras/${name}/:id`, async (req, res, p) => {
      try { const b = clean(await body(req), true); const f = fields.filter((k) => k in b);
        if (f.length) q(`UPDATE ${table} SET ${f.map((k) => k + '=?').join(',')} WHERE id=?`).run(...f.map((k) => b[k]), Number(p.id));
        broadcast('extras', { what: name }); json(res, 200, q(`SELECT * FROM ${table} WHERE id=?`).get(Number(p.id))); }
      catch (e) { json(res, 400, { error: e.message }); }
    });
    route('DELETE', `/api/extras/${name}/:id`, (req, res, p) => { q(`DELETE FROM ${table} WHERE id=?`).run(Number(p.id)); broadcast('extras', { what: name }); json(res, 200, { ok: true }); });
  };
  crud('playbooks', 'playbooks', ['bot_id', 'name', 'commands'], (b, patch) => {
    if (!patch && !String(b.name || '').trim()) throw new Error('Give it a name');
    if ('commands' in b || !patch) { const c = (Array.isArray(b.commands) ? b.commands : String(b.commands || '').split('\n')).map((x) => String(x).trim()).filter(Boolean);
      if (!c.length) throw new Error('Add at least one command'); b.commands = JSON.stringify(c.slice(0, 50)); }
    if ('bot_id' in b) b.bot_id = int(b.bot_id);
    return b;
  });
  route('POST', '/api/extras/playbooks/:id/run', async (req, res, p) => {
    try { json(res, 200, await runPlaybook(p.id)); } catch (e) { json(res, e.status || 500, { error: e.message }); }
  });
  crud('watches', 'watches', ['name', 'kind', 'target', 'bot_id', 'playbook_id', 'wake', 'enabled'], (b, patch) => {
    if (!patch && (!String(b.name || '').trim() || !String(b.target || '').trim())) throw new Error('Name and target are needed');
    if ('kind' in b && !['tcp', 'http', 'ping', 'disk'].includes(b.kind)) throw new Error('Kind must be tcp, http, ping or disk');
    for (const k of ['bot_id', 'playbook_id']) if (k in b) b[k] = int(b[k]);
    for (const k of ['wake', 'enabled']) if (k in b) b[k] = b[k] ? 1 : 0;
    if (!patch) { b.kind ??= 'tcp'; b.enabled ??= 1; b.wake ??= 0; }
    return b;
  });
  route('POST', '/api/extras/watches/:id/check', async (req, res, p) => {
    const w = q('SELECT * FROM watches WHERE id=?').get(Number(p.id)); if (!w) return json(res, 404, { error: 'not found' });
    json(res, 200, await check(w));
  });
  route('GET', '/api/extras/watch-log', (req, res) => json(res, 200, { items: q('SELECT l.*, w.name FROM watch_log l JOIN watches w ON w.id=l.watch_id ORDER BY l.id DESC LIMIT 50').all() }));
  crud('facts', 'team_facts', ['text', 'topic', 'bot_id'], (b) => { if ('text' in b && !String(b.text).trim()) throw new Error('Empty'); if ('bot_id' in b) b.bot_id = int(b.bot_id); return b; });
  route('GET', '/api/extras/facts/search', (req, res, _p, url) => {
    const words = String(url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const rows = q('SELECT * FROM team_facts ORDER BY updated_at DESC').all()
      .map((f) => ({ ...f, score: words.filter((w) => (f.text + ' ' + f.topic).toLowerCase().includes(w)).length }))
      .filter((f) => !words.length || f.score).sort((a, b) => b.score - a.score).slice(0, 20);
    json(res, 200, { items: rows });
  });
  crud('chains', 'chains', ['from_bot', 'match', 'to_bot', 'note', 'enabled'], (b, patch) => {
    for (const k of ['from_bot', 'to_bot']) if (k in b) b[k] = int(b[k]);
    if (!patch && (!b.from_bot || !b.to_bot)) throw new Error('Pick both bots');
    if (b.from_bot && b.from_bot === b.to_bot) throw new Error('Pick two different bots');
    if ('enabled' in b) b.enabled = b.enabled ? 1 : 0; else if (!patch) b.enabled = 1;
    return b;
  });
  route('GET', '/api/extras/scheduled', (req, res, _p, url) => {
    const t = url.searchParams.get('thread');
    json(res, 200, { items: t ? q('SELECT * FROM scheduled WHERE done=0 AND thread=? ORDER BY at').all(t) : q('SELECT * FROM scheduled WHERE done=0 ORDER BY at').all() });
  });
  route('POST', '/api/extras/scheduled', async (req, res) => {
    const b = await body(req), at = Number(b.at), text = String(b.text || '').trim();
    if (!text || !b.thread) return json(res, 400, { error: 'Write the message first' });
    if (!(at > now())) return json(res, 400, { error: 'Pick a time in the future' });
    const r = q('INSERT INTO scheduled (thread, text, at) VALUES (?,?,?)').run(String(b.thread), text.slice(0, 100000), Math.floor(at));
    broadcast('extras', { what: 'scheduled' }); json(res, 200, { id: Number(r.lastInsertRowid) });
  });
  route('DELETE', '/api/extras/scheduled/:id', (req, res, p) => { q('DELETE FROM scheduled WHERE id=? AND done=0').run(Number(p.id)); broadcast('extras', { what: 'scheduled' }); json(res, 200, { ok: true }); });
  // Bots (bin/facts.mjs, inside a run): search and add team memory.
  const hookBot = (req, url) => { const t = String(req.headers['x-nimbus-hook'] || ''); if (t.length !== HOOK_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(HOOK_TOKEN))) return null; return q("SELECT bot_id FROM runs WHERE id=? AND status='running'").get(Number(url.searchParams.get('run')))?.bot_id ?? null; };
  route('GET', '/api/hook/facts', (req, res, _p, url) => {
    if (hookBot(req, url) == null) return json(res, 403, { error: 'forbidden' });
    const words = String(url.searchParams.get('q') || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
    const rows = q('SELECT f.*, b.name AS bot FROM team_facts f LEFT JOIN bots b ON b.id=f.bot_id ORDER BY f.updated_at DESC').all()
      .map((f) => ({ ...f, score: words.filter((w) => (f.text + ' ' + f.topic).toLowerCase().includes(w)).length }))
      .filter((f) => !words.length || f.score).sort((a, b) => b.score - a.score).slice(0, words.length ? 15 : 40);
    json(res, 200, { items: rows });
  });
  route('POST', '/api/hook/facts', async (req, res, _p, url) => {
    const bot = hookBot(req, url); if (bot == null) return json(res, 403, { error: 'forbidden' });
    const b = await body(req), text = String(b.text || '').trim().slice(0, 2000);
    if (!text) return json(res, 400, { error: 'empty' });
    const r = q('INSERT INTO team_facts (text, topic, bot_id) VALUES (?,?,?)').run(text, String(b.topic || '').slice(0, 40), bot || null);
    broadcast('extras', { what: 'facts' }); json(res, 200, { id: Number(r.lastInsertRowid) });
  });
  route('GET', '/api/extras/budgets', (req, res) => json(res, 200, { budgets: budgets(), week: Object.fromEntries(q('SELECT id FROM bots').all().map((b) => [b.id, +weekCost(b.id).toFixed(2)])) }));
  route('PUT', '/api/extras/budgets', async (req, res) => {
    const b = await body(req), out = {};
    for (const [k, v] of Object.entries(b.budgets || {})) if (Number(v) > 0) out[Number(k)] = Math.round(Number(v) * 100) / 100;
    setSetting('bot_budgets', JSON.stringify(out)); json(res, 200, { budgets: out });
  });
  route('GET', '/api/extras/digest', (req, res) => json(res, 200, digest()));
  route('GET', '/api/extras/status-page', (req, res) => json(res, 200, { on: getSetting('status_page') !== '0' }));
  route('PUT', '/api/extras/status-page', async (req, res) => { const b = await body(req); setSetting('status_page', b.on ? '1' : '0'); json(res, 200, { on: !!b.on }); });
  // Public (no login): names and up/down only, no addresses. Turn off in Settings → Watchdog.
  route('GET', '/status', (req, res) => {
    if (getSetting('status_page') === '0') { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('Not found'); }
    const rows = q('SELECT name, state FROM watches WHERE enabled=1 ORDER BY id').all();
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(STATUS_HTML(rows, new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })));
  });
}

export function startAutomation() {
  seed();
  setTimeout(sweep, 15000);
  setInterval(() => sweep().catch((e) => console.error('watchdog', e.message)), 120000).unref();
  setInterval(dueMessages, 20000).unref();
}
