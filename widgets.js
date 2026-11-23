// Bot widgets (see widgets-spec.js). A bot proposes a widget; you pin it in the side panel. Data comes from a
// JSON file in the bot's folder or from one of its API tools, so refreshing costs no Claude usage.
import fs from 'node:fs';
import path from 'node:path';
import { q, botDir } from './db.js';
import { cleanSpec, readData, MAX_PINNED, MAX_PROPOSED } from './widgets-spec.js';
import { loadTools, runTool } from './apitools.js';
import { redact } from './redact.js';

q(`CREATE TABLE IF NOT EXISTS widgets (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER NOT NULL, title TEXT NOT NULL, kind TEXT NOT NULL,
  spec TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'proposed', last_error TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()))`).run();

const view = (r) => ({ id: r.id, bot_id: r.bot_id, title: r.title, kind: r.kind, status: r.status, last_error: r.last_error || '', ...JSON.parse(r.spec), updated_at: r.updated_at });
const rowsOf = (bot) => q('SELECT * FROM widgets WHERE bot_id=? ORDER BY status=\'pinned\' DESC, id').all(Number(bot)).map(view);

// Reads a widget's data. A file must stay inside the bot's folder (symlinks included).
export async function widgetData(row) {
  const spec = JSON.parse(row.spec), base = botDir(row.bot_id);
  if (spec.source.type === 'file') {
    const root = fs.realpathSync(base), full = path.resolve(base, spec.source.path);
    let real; try { real = fs.realpathSync(full); } catch { throw new Error(`No file at ${spec.source.path} yet`); }
    if (!real.startsWith(root + path.sep)) throw new Error('That file is outside the bot’s folder');
    if (fs.statSync(real).size > 256 * 1024) throw new Error('That file is too big (over 256 KB)');
    return readData(row.kind, fs.readFileSync(real, 'utf8'));
  }
  const r = await runTool(row.bot_id, spec.source.name, spec.source.args, redact);
  if (!r.ok) throw new Error(r.out.split('\n').slice(-2).join(' ').slice(0, 200) || 'The tool failed');
  return readData(row.kind, r.out);
}

export function registerWidgets(route, { json, body, hookAuth }) {
  route('GET', '/api/widgets', (req, res, _p, url) => json(res, 200, { widgets: rowsOf(url.searchParams.get('bot')) }));
  route('POST', '/api/widgets/:id/pin', (req, res, p) => {
    const row = q('SELECT * FROM widgets WHERE id=?').get(Number(p.id));
    if (!row) return json(res, 404, { error: 'No such widget' });
    const pinned = q('SELECT COUNT(*) n FROM widgets WHERE bot_id=? AND status=\'pinned\'').get(row.bot_id).n;
    if (row.status !== 'pinned' && pinned >= MAX_PINNED) return json(res, 409, { error: `${MAX_PINNED} widgets are already pinned for this bot. Unpin one first.` });
    q('UPDATE widgets SET status=\'pinned\', updated_at=unixepoch() WHERE id=?').run(row.id);
    json(res, 200, { ok: true });
  });
  route('POST', '/api/widgets/:id/unpin', (req, res, p) => {
    q('UPDATE widgets SET status=\'proposed\' WHERE id=?').run(Number(p.id));
    json(res, 200, { ok: true });
  });
  route('DELETE', '/api/widgets/:id', (req, res, p) => { q('DELETE FROM widgets WHERE id=?').run(Number(p.id)); json(res, 200, { ok: true }); });
  route('GET', '/api/widgets/:id/data', async (req, res, p) => {
    const row = q('SELECT * FROM widgets WHERE id=?').get(Number(p.id));
    if (!row) return json(res, 404, { error: 'No such widget' });
    try {
      const data = await widgetData(row);
      q('UPDATE widgets SET last_error=\'\' WHERE id=?').run(row.id);
      json(res, 200, { ok: true, data, at: Math.floor(Date.now() / 1000) });
    } catch (e) {
      q('UPDATE widgets SET last_error=? WHERE id=?').run(e.message.slice(0, 200), row.id);
      json(res, 200, { ok: false, error: e.message, at: Math.floor(Date.now() / 1000) });
    }
  });
  // For bots (bin/widget.mjs): propose, list or remove their own widgets. A bot can't pin; you do that.
  route('POST', '/api/hook/widgets', async (req, res) => {
    if (!hookAuth(req)) return json(res, 403, { error: 'forbidden' });
    const b = await body(req);
    const run = q('SELECT * FROM runs WHERE id=?').get(Number(b.runId));
    if (!run || run.status !== 'running') return json(res, 400, { error: 'Run this from inside a Nimbus bot run.' });
    const me = run.bot_id;
    try {
      if (b.action === 'list') return json(res, 200, { widgets: rowsOf(me) });
      if (b.action === 'remove') { q('DELETE FROM widgets WHERE bot_id=? AND id=?').run(me, Number(b.id)); return json(res, 200, { ok: true }); }
      if (b.action !== 'propose') return json(res, 400, { error: 'action must be propose, list or remove' });
      const spec = cleanSpec(b.widget || {});
      if (spec.source.type === 'tool' && !loadTools(me).some((t) => t.name === spec.source.name && t.approved))
        return json(res, 400, { error: `API tool "${spec.source.name}" isn’t approved yet. Only approved API tools can feed a widget.` });
      const same = q('SELECT * FROM widgets WHERE bot_id=? AND title=?').get(me, spec.title);
      if (same) {
        q('UPDATE widgets SET kind=?, spec=?, last_error=\'\', updated_at=unixepoch() WHERE id=?').run(spec.kind, JSON.stringify(spec), same.id);
        return json(res, 200, { ok: true, id: same.id, status: same.status, updated: true });
      }
      const open = q('SELECT COUNT(*) n FROM widgets WHERE bot_id=? AND status=\'proposed\'').get(me).n;
      if (open >= MAX_PROPOSED) return json(res, 400, { error: `${MAX_PROPOSED} widgets are already waiting for the user. Remove one first.` });
      const r = q('INSERT INTO widgets (bot_id, title, kind, spec) VALUES (?,?,?,?)').run(me, spec.title, spec.kind, JSON.stringify(spec));
      json(res, 200, { ok: true, id: Number(r.lastInsertRowid), status: 'proposed' });
    } catch (e) { json(res, 400, { error: e.message }); }
  });
}
