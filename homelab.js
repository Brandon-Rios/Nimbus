// Local tools that need no Claude: change journal with undo, plan-first approvals, widget summary.
import fs from 'node:fs';
import path from 'node:path';
import { db, q, getSetting, setSetting, DATA_DIR, Capped } from './db.js';
import { broadcast } from './events.js';

db.exec(`
CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, run_id INTEGER, thread TEXT, tool TEXT, path TEXT NOT NULL,
  existed INTEGER, size INTEGER, at INTEGER DEFAULT (unixepoch()), restored_at INTEGER);
`);
const now = () => Math.floor(Date.now() / 1000);
const JDIR = path.join(DATA_DIR, 'journal');
fs.mkdirSync(JDIR, { recursive: true, mode: 0o700 });

// ---------- change journal ----------
// Before a bot's Edit/Write/MultiEdit/NotebookEdit runs, keep a copy of the file so it can be undone.
// (Edits a bot makes over ssh or with shell commands aren't seen here.)
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const MAX_SNAP = 2 * 1024 * 1024;
export function journalBefore(run, tool, input) {
  try {
    if (!EDIT_TOOLS.has(tool)) return;
    const file = input?.file_path || input?.notebook_path; if (!file || !path.isAbsolute(file)) return;
    let existed = 0, size = 0, buf = null;
    try { const st = fs.statSync(file); if (!st.isFile()) return; size = st.size; if (size > MAX_SNAP) return; buf = fs.readFileSync(file); existed = 1; } catch {}
    const r = q('INSERT INTO journal (bot_id, run_id, thread, tool, path, existed, size) VALUES (?,?,?,?,?,?,?)').run(run.bot_id, run.id, run.thread, tool, file, existed, size);
    const id = Number(r.lastInsertRowid);
    if (buf) fs.writeFileSync(path.join(JDIR, String(id)), buf, { mode: 0o600 });
    broadcast('extras', { what: 'journal' });
  } catch (e) { console.error('journal', e.message); }
}
// Put a journaled file back (or remove one the bot created). Throws if it can't.
export function undoJournal(j, note = true) {
  const snap = path.join(JDIR, String(j.id));
  if (j.existed) { if (!fs.existsSync(snap)) throw new Error('No saved copy'); fs.copyFileSync(snap, j.path); }
  else if (fs.existsSync(j.path)) fs.unlinkSync(j.path); // the bot created it: undo removes it
  q('UPDATE journal SET restored_at=unixepoch() WHERE id=?').run(j.id);
  if (note && j.thread) addMessage(j.thread, 'system', 'note', `↶ You undid a change to ${j.path} (${j.existed ? 'restored the earlier copy' : 'removed the file the bot created'}).`);
}
function pruneJournal() {
  for (const r of q('SELECT id FROM journal WHERE at < unixepoch() - 30*86400 OR id <= (SELECT MAX(id) FROM journal) - 3000').all()) {
    try { fs.unlinkSync(path.join(JDIR, String(r.id))); } catch {}
    q('DELETE FROM journal WHERE id=?').run(r.id);
  }
}
function diffOf(id, file) {
  return new Promise((ok) => {
    const snap = path.join(JDIR, String(id)), a = fs.existsSync(snap) ? snap : '/dev/null', b = fs.existsSync(file) ? file : '/dev/null';
    execFile('diff', ['-u', '--label', 'before', '--label', 'now', a, b], { maxBuffer: 4e6 }, (e, out) => ok(String(out || '').slice(0, 200000)));
  });
}

// ---------- plan first ----------
// You approve a bot's plan once; the commands written in it then run without asking again in that chat for an hour.
const plans = new Capped(300); // thread -> { cmds: Set, until }
const norm = (c) => String(c || '').replace(/\s+/g, ' ').trim();
export function planCommands(text) {
  const out = []; const re = /```(?:sh|bash|shell|console|zsh)?\n([\s\S]*?)```/g; let m;
  while ((m = re.exec(text))) for (const line of m[1].split('\n')) { const l = line.replace(/^\s*\$\s+/, '').trim(); if (l && !l.startsWith('#')) out.push(norm(l)); }
  return out;
}
export function planAllows(thread, tool, input) {
  const p = plans.get(thread); if (!p || p.until < Date.now() || tool !== 'Bash') return false;
  return p.cmds.has(norm(input?.command));
}

export function registerHomelab(route, { json, body, postToThread }) {
  route('GET', '/api/extras/journal', (req, res, _p, url) => {
    const bot = url.searchParams.get('bot');
    json(res, 200, { items: (bot ? q('SELECT * FROM journal WHERE bot_id=? ORDER BY id DESC LIMIT 200').all(Number(bot)) : q('SELECT * FROM journal ORDER BY id DESC LIMIT 200').all())
      .map((j) => ({ ...j, snap: fs.existsSync(path.join(JDIR, String(j.id))) })) });
  });
  route('GET', '/api/extras/journal/:id/diff', async (req, res, p) => {
    const j = q('SELECT * FROM journal WHERE id=?').get(Number(p.id)); if (!j) return json(res, 404, { error: 'not found' });
    json(res, 200, { diff: await diffOf(j.id, j.path), exists: fs.existsSync(j.path) });
  });
  route('POST', '/api/extras/journal/:id/undo', async (req, res, p) => {
    const j = q('SELECT * FROM journal WHERE id=?').get(Number(p.id)); if (!j) return json(res, 404, { error: 'not found' });
    try { undoJournal(j); broadcast('extras', { what: 'journal' }); json(res, 200, { ok: true }); }
    catch (e) { json(res, 500, { error: `Couldn’t undo: ${e.code === 'EACCES' ? 'Nimbus isn’t allowed to write that file' : e.message}` }); }
  });
  route('POST', '/api/extras/plan-approve', async (req, res) => {
    const b = await body(req), m = q('SELECT * FROM messages WHERE id=?').get(Number(b.msgId));
    if (!m || m.thread !== b.thread) return json(res, 404, { error: 'Plan not found' });
    const cmds = planCommands(m.body);
    plans.set(m.thread, { cmds: new Set(cmds), until: Date.now() + 3600e3 });
    try { postToThread(m.thread, `Plan approved. Carry it out exactly as written${cmds.length ? `; the ${cmds.length} command${cmds.length === 1 ? '' : 's'} in it won’t ask again for the next hour` : ''}. Stop and tell me if anything differs from the plan.`); }
    catch (e) { return json(res, e.status || 500, { error: e.message }); }
    json(res, 200, { ok: true, commands: cmds.length });
  });
  const MODELS = ['', 'haiku', 'sonnet', 'opus'];
  route('GET', '/api/extras/routing', (req, res) => json(res, 200, { auto: getSetting('route_auto') || '', short: getSetting('route_short') || '' }));
  route('PUT', '/api/extras/routing', async (req, res) => {
    const b = await body(req);
    if (!MODELS.includes(b.auto ?? '') || !MODELS.includes(b.short ?? '')) return json(res, 400, { error: 'Unknown model' });
    setSetting('route_auto', b.auto || ''); setSetting('route_short', b.short || ''); json(res, 200, { ok: true });
  });
  // Phone widget: one small summary.
  route('GET', '/api/extras/widget', (req, res) => {
    const w = q("SELECT COUNT(*) AS n, SUM(state='up') AS up, SUM(state='down') AS down FROM watches WHERE enabled=1").get();
    const appr = q("SELECT COUNT(*) AS n FROM approvals WHERE status='pending'").get().n;
    const busy = q("SELECT COUNT(DISTINCT bot_id) AS n FROM runs WHERE status='running'").get().n;
    const down = q("SELECT name FROM watches WHERE enabled=1 AND state='down' LIMIT 3").all().map((r) => r.name);
    json(res, 200, { up: w.up || 0, total: w.n || 0, down, approvals: appr, working: busy, at: now() });
  });
}

export function startHomelab() {
  setInterval(() => pruneJournal(), 10 * 60000).unref();
}
