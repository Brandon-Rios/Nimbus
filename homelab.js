// More homelab tools, all local (no Claude unless you press a button that asks a bot):
// backup guardian, IP/DHCP map, change journal with undo, plan-first approvals, firewall log search,
// homelab map data, phone widget summary, and hand-off events for the bot office.
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import { spawn, execFile } from 'node:child_process';
import { db, q, getSetting, setSetting, DATA_DIR, Capped } from './db.js';
import { addMessage } from './runner.js';
import { broadcast } from './events.js';

db.exec(`
CREATE TABLE IF NOT EXISTS journal (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, run_id INTEGER, thread TEXT, tool TEXT, path TEXT NOT NULL,
  existed INTEGER, size INTEGER, at INTEGER DEFAULT (unixepoch()), restored_at INTEGER);
CREATE TABLE IF NOT EXISTS ip_seen (mac TEXT NOT NULL, ip TEXT NOT NULL, first_seen INTEGER, last_seen INTEGER, PRIMARY KEY (mac, ip));
CREATE TABLE IF NOT EXISTS ip_names (mac TEXT PRIMARY KEY, name TEXT NOT NULL);
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

// ---------- IP map ----------
const homelab = () => { try { return fs.readFileSync(path.join(DATA_DIR, 'shared', 'HOMELAB.md'), 'utf8'); } catch { return ''; } };
function factsGuests() { // | 103 | immich | CT | 192.168.1.50 (DHCP) | Purpose |
  const out = [];
  for (const l of homelab().split('\n')) {
    const m = /^\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|\s*(CT|VM)\s*\|\s*([\d.]+)?[^|]*?(\((DHCP|static)\))?[^|]*\|\s*([^|]*)\|/.exec(l);
    if (m) out.push({ vmid: Number(m[1]), name: m[2], type: m[3], ip: m[4] || null, dhcp: m[6] === 'DHCP', purpose: m[7].trim() });
  }
  const node = /Node `([\w-]+)`:\s*([\d.]+)/.exec(homelab()); // the Proxmox host itself
  if (node) out.push({ vmid: 0, name: `Proxmox (${node[1]})`, type: 'Host', ip: node[2], dhcp: false, purpose: 'Proxmox host' });
  return out;
}
const subnet = () => (getSetting('lan_prefix') || '192.168.1').replace(/\.$/, '');
async function arpScan() {
  // A UDP packet to every address makes the kernel resolve its MAC; no root or ping needed.
  const s = dgram.createSocket('udp4'); const pre = subnet();
  await new Promise((ok) => { let n = 0; for (let i = 1; i < 255; i++) s.send(Buffer.from([0]), 9, `${pre}.${i}`, () => { if (++n === 254) ok(); }); setTimeout(ok, 3000); });
  s.close();
  await new Promise((r) => setTimeout(r, 2500));
  const rows = fs.readFileSync('/proc/net/arp', 'utf8').split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[0]?.startsWith(pre + '.') && c[2] !== '0x0' && c[3] && c[3] !== '00:00:00:00:00:00');
  const t = now();
  for (const [ip, , , mac] of rows) q('INSERT INTO ip_seen (mac, ip, first_seen, last_seen) VALUES (?,?,?,?) ON CONFLICT(mac, ip) DO UPDATE SET last_seen=excluded.last_seen').run(mac.toLowerCase(), ip, t, t);
  return rows.length;
}
let pveRef = null; // { pveGet, pveConfig }
async function pveGuests() {
  const cfg = pveRef?.pveConfig(); if (!cfg) return { on: false, guests: [] };
  const list = await pveRef.pveGet(cfg, '/cluster/resources?type=vm');
  const guests = await Promise.all(list.map(async (g) => {
    let macs = [];
    try { const c = await pveRef.pveGet(cfg, `/nodes/${g.node}/${g.type}/${g.vmid}/config`);
      for (const [k, v] of Object.entries(c)) if (/^net\d+$/.test(k)) { const m = /([0-9A-F]{2}(:[0-9A-F]{2}){5})/i.exec(String(v)); if (m) macs.push(m[1].toLowerCase()); } } catch {}
    return { vmid: g.vmid, name: g.name, type: g.type === 'lxc' ? 'CT' : 'VM', status: g.status, node: g.node, cpu: g.cpu, mem: g.mem, maxmem: g.maxmem, uptime: g.uptime, macs };
  }));
  return { on: true, guests };
}
let pveGuestCache = { at: 0, data: null };
async function guestsCached() {
  if (Date.now() - pveGuestCache.at < 60000 && pveGuestCache.data) return pveGuestCache.data;
  try { pveGuestCache = { at: Date.now(), data: await pveGuests() }; } catch (e) { pveGuestCache = { at: Date.now(), data: { on: true, error: e.message, guests: [] } }; }
  return pveGuestCache.data;
}
export async function ipMap() {
  const pve = await guestsCached(), facts = factsGuests(), names = Object.fromEntries(q('SELECT mac, name FROM ip_names').all().map((r) => [r.mac, r.name]));
  const byMac = {}; for (const g of pve.guests) for (const m of g.macs) byMac[m] = g;
  const recent = now() - 7 * 86400;
  const seen = q('SELECT * FROM ip_seen WHERE last_seen >= ? ORDER BY last_seen DESC').all(recent);
  const latest = {}; for (const r of seen) if (!latest[r.mac] || r.last_seen > latest[r.mac].last_seen) latest[r.mac] = r;
  const ipMacs = {}; for (const r of seen) if (r.last_seen >= now() - 86400) (ipMacs[r.ip] ||= new Set()).add(r.mac);
  const rows = Object.values(latest).map((r) => {
    const g = byMac[r.mac], f = facts.find((x) => (g && x.vmid === g.vmid) || x.ip === r.ip);
    const ips = [...new Set(seen.filter((s) => s.mac === r.mac).map((s) => s.ip))];
    const flags = [];
    if (ips.length > 1) flags.push('changed');
    if ((ipMacs[r.ip]?.size || 0) > 1) flags.push('conflict');
    if (!g && !f && !names[r.mac]) flags.push('unknown');
    if (f?.dhcp) flags.push('reserve');
    return { mac: r.mac, ip: r.ip, ips, name: names[r.mac] || g?.name || f?.name || '', guest: g ? `${g.type} ${g.vmid}` : f ? `${f.type} ${f.vmid}` : '', fixed: f && !f.dhcp ? 1 : 0,
      online: r.last_seen >= now() - 1800, last_seen: r.last_seen, first_seen: r.first_seen, flags };
  }).sort((a, b) => a.ip.split('.').map(Number)[3] - b.ip.split('.').map(Number)[3]);
  return { rows, scanned: q('SELECT MAX(last_seen) AS t FROM ip_seen').get().t, subnet: subnet() };
}

// ---------- backups ----------
export async function backups() {
  const cfg = pveRef?.pveConfig(); if (!cfg) return { on: false };
  const get = (p) => pveRef.pveGet(cfg, p);
  const [jobs, res] = await Promise.all([get('/cluster/backup').catch(() => []), get('/cluster/resources?type=vm')]);
  const nodes = [...new Set(res.map((g) => g.node))];
  const files = [], stores = [];
  for (const n of nodes) {
    const st = await get(`/nodes/${n}/storage`).catch(() => []);
    for (const s of st) {
      stores.push({ node: n, storage: s.storage, content: s.content, avail: s.avail, total: s.total, active: s.active });
      if (!String(s.content || '').includes('backup')) continue;
      const c = await get(`/nodes/${n}/storage/${s.storage}/content?content=backup`).catch(() => []);
      for (const f of c) files.push({ vmid: f.vmid, ctime: f.ctime, size: f.size, storage: s.storage });
    }
  }
  const covered = (vmid) => jobs.filter((j) => j.enabled !== 0 && (j.all ? !String(j.exclude || '').split(',').includes(String(vmid)) : String(j.vmid || '').split(',').includes(String(vmid))));
  const guests = res.map((g) => {
    const mine = files.filter((f) => f.vmid === g.vmid).sort((a, b) => b.ctime - a.ctime);
    const last = mine[0]?.ctime || null, js = covered(g.vmid);
    const state = last && last >= now() - 26 * 3600 ? 'ok' : last ? 'stale' : 'none';
    return { vmid: g.vmid, name: g.name, type: g.type === 'lxc' ? 'CT' : 'VM', status: g.status, last, count: mine.length, size: mine[0]?.size || 0, jobs: js.map((j) => j.id || j.schedule), state, maxdisk: g.maxdisk };
  }).sort((a, b) => a.vmid - b.vmid);
  return { on: true, jobs: jobs.map((j) => ({ id: j.id, schedule: j.schedule, storage: j.storage, all: j.all, vmid: j.vmid, enabled: j.enabled !== 0, mode: j.mode, keep: j['prune-backups'] })), guests,
    stores: stores.filter((s) => String(s.content || '').includes('backup')).sort((a, b) => (b.avail || 0) - (a.avail || 0)) };
}
let backupNoted = '';
async function backupDaily() { // once a day, a plain note to the Proxmox bot when guests have no fresh backup (no Claude)
  const d = new Date(); const key = d.toDateString();
  if (d.getHours() !== 8 || backupNoted === key) return;
  backupNoted = key;
  try {
    const b = await backups(); if (!b.on) return;
    const bad = b.guests.filter((g) => g.state !== 'ok');
    const pve = q("SELECT id FROM bots WHERE name LIKE '%proxmox%' LIMIT 1").get()?.id;
    if (bad.length && pve) addMessage('bot:' + pve, 'system', 'note', `🛟 Backup check: ${bad.length} of ${b.guests.length} guests have no backup from the last day (${bad.map((g) => g.name).slice(0, 8).join(', ')}${bad.length > 8 ? '…' : ''}). See Settings → Backups.`);
  } catch {}
}

// ---------- logs ----------
const logDir = () => getSetting('log_dir') || path.join(DATA_DIR, 'bots', '7', 'logs');
function logFiles(days) {
  const out = []; const d = new Date();
  for (let i = 0; i < days; i++) { const t = new Date(d - i * 86400000); const f = path.join(logDir(), `firewall-${t.toLocaleDateString('en-CA')}.log`); if (fs.existsSync(f)) out.push(f); }
  return out;
}
function searchLogs({ text = '', and = '', days = 1, limit = 300 }) {
  const files = logFiles(Math.min(14, Math.max(1, days)));
  if (!files.length) return Promise.resolve({ lines: [], files: 0 });
  return new Promise((ok) => {
    const args = ['-h', '-i', '-F', '--', text || ' ', ...files];
    const g = spawn('grep', args); let buf = '', lines = [], total = 0;
    g.stdout.on('data', (d) => { buf += d; const parts = buf.split('\n'); buf = parts.pop();
      for (const l of parts) { if (and && !l.toLowerCase().includes(and.toLowerCase())) continue; total++; lines.push(l.slice(0, 600)); if (lines.length > limit) lines.shift(); } });
    const kill = setTimeout(() => g.kill('SIGKILL'), 15000);
    g.on('close', () => { clearTimeout(kill); ok({ lines: lines.reverse(), total, files: files.length }); });
  });
}

// ---------- routes ----------
export function registerHomelab(route, { json, body, postToThread, pveGet, pveConfig }) {
  pveRef = { pveGet, pveConfig };
  route('GET', '/api/extras/backups', async (req, res) => { try { json(res, 200, await backups()); } catch (e) { json(res, 502, { error: e.message }); } });
  route('GET', '/api/extras/ipmap', async (req, res) => { try { json(res, 200, await ipMap()); } catch (e) { json(res, 500, { error: e.message }); } });
  route('POST', '/api/extras/ipmap/scan', async (req, res) => { try { const n = await arpScan(); json(res, 200, { found: n, ...(await ipMap()) }); } catch (e) { json(res, 500, { error: e.message }); } });
  route('PUT', '/api/extras/ipmap/name', async (req, res) => {
    const b = await body(req), mac = String(b.mac || '').toLowerCase(), name = String(b.name || '').trim().slice(0, 60);
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(mac)) return json(res, 400, { error: 'bad MAC' });
    if (name) q('INSERT INTO ip_names (mac, name) VALUES (?,?) ON CONFLICT(mac) DO UPDATE SET name=excluded.name').run(mac, name); else q('DELETE FROM ip_names WHERE mac=?').run(mac);
    json(res, 200, { ok: true });
  });
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
  route('GET', '/api/extras/logs', async (req, res, _p, url) => {
    const s = url.searchParams;
    json(res, 200, await searchLogs({ text: s.get('q') || '', and: s.get('and') || '', days: Number(s.get('days')) || 1, limit: Math.min(1000, Number(s.get('limit')) || 300) }));
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
  route('GET', '/api/extras/map', async (req, res) => {
    const pve = await guestsCached();
    const watches = q('SELECT id, name, kind, target, bot_id, state FROM watches WHERE enabled=1').all();
    const facts = factsGuests();
    json(res, 200, { ...pve, facts, watches, ipmap: (await ipMap()).rows });
  });
}

export function startHomelab() {
  setTimeout(() => arpScan().catch(() => {}), 30000);
  setInterval(() => arpScan().catch(() => {}), 15 * 60000).unref();
  setInterval(() => { backupDaily(); pruneJournal(); }, 10 * 60000).unref();
}
