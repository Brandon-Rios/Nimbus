// Pages for a fuller app: usage history, what's new (from git), system status. All local, no Claude calls.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STARTED = Date.now();
const portUp = (port) => new Promise((ok) => { const s = net.connect(port, '127.0.0.1'); const done = (v) => { s.destroy(); ok(v); }; s.once('connect', () => done(true)); s.once('error', () => done(false)); s.setTimeout(600, () => done(false)); });

export function registerPages(route, { json, q, DATA_DIR }) {
  // Runs and cost per bot per day, last N days.
  route('GET', '/api/pro/usage', (req, res, _p, url) => {
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 14));
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const rows = q(`SELECT bot_id, date(started_at, 'unixepoch', 'localtime') AS day, COUNT(*) AS runs, ROUND(SUM(cost_usd), 4) AS cost,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors, SUM(COALESCE(ended_at, started_at) - started_at) AS secs
      FROM runs WHERE started_at >= ? GROUP BY bot_id, day ORDER BY day`).all(since);
    json(res, 200, { days, rows });
  });
  // What's new: recent commit subjects of this install.
  let cl = null;
  route('GET', '/api/pro/changelog', (req, res) => {
    if (cl && Date.now() - cl.at < 60000) return json(res, 200, cl.data);
    execFile('git', ['-C', ROOT, 'log', '-40', '--format=%h%x09%ct%x09%s'], (err, out) => {
      const items = err ? [] : out.trim().split('\n').filter(Boolean).map((l) => { const [id, at, ...s] = l.split('\t'); return { id, at: Number(at), text: s.join('\t').replace(/\s*Co-Authored-By:.*$/i, '') }; });
      cl = { at: Date.now(), data: { version: items[0]?.id || '', items } };
      json(res, 200, cl.data);
    });
  });
  // System status: helper services, disk, memory, uptime.
  route('GET', '/api/pro/status', async (req, res) => {
    let disk = null;
    try { const s = fs.statfsSync(DATA_DIR); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch {}
    const [voice, tts, translate] = await Promise.all([8178, 8179, 8180].map(portUp));
    const dbSize = (() => { try { return fs.statSync(path.join(DATA_DIR, 'nimbus.db')).size; } catch { return 0; } })();
    const busy = q("SELECT COUNT(*) AS n FROM runs WHERE status IN ('running','queued')").get().n;
    const last = q("SELECT status, ended_at FROM runs WHERE ended_at IS NOT NULL ORDER BY id DESC LIMIT 1").get();
    const errs24 = q("SELECT COUNT(*) AS n FROM runs WHERE status = 'error' AND started_at > unixepoch() - 86400").get().n;
    json(res, 200, {
      started: Math.floor(STARTED / 1000), node: process.version, host: os.hostname(), load: os.loadavg()[0], cpus: os.cpus().length,
      mem: { total: os.totalmem(), free: os.freemem(), rss: process.memoryUsage().rss }, disk, dbSize, busy, last, errs24,
      services: [['Nimbus server', true], ['Voice dictation (whisper)', voice], ['Natural voices (Kokoro)', tts], ['Translation', translate]].map(([name, up]) => ({ name, up })),
    });
  });
}
