// Ideas from the AI labs, done the Nimbus way:
// smart auto-approve (local rules, optional Haiku check), rewind a chat to a message (files + conversation),
// weekly self-review ("dreaming": bots suggest memory lines from their own failures), a shared skills library,
// and custom MCP connectors. Voice mode and the camera are client-side (public/aitools.js).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { db, q, getSetting, setSetting, DATA_DIR } from './db.js';
import { addMessage, runBot, CLAUDE_BIN, HOOK_TOKEN } from './runner.js';
import { claudeEnv } from './claudeauth.js';
import { broadcast } from './events.js';
import { builtIn } from './threads.js';
import { PLUGINS } from './catalog.js';
import { undoJournal } from './homelab.js';

db.exec(`
CREATE TABLE IF NOT EXISTS auto_approvals (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER, thread TEXT, tool TEXT, input TEXT,
  verdict TEXT, why TEXT, by TEXT, at INTEGER DEFAULT (unixepoch()));
CREATE TABLE IF NOT EXISTS custom_mcp (id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()));
`);
const now = () => Math.floor(Date.now() / 1000);
const botName = (id) => q('SELECT name FROM bots WHERE id=?').get(id)?.name || `Bot ${id}`;

// ---------- 1. smart auto-approve ----------
// setting auto_approve: 'off' | 'rules' (free, local rules only) | 'smart' (rules, then a quick Haiku check
// for Bash commands the rules can't decide). Only Bash is ever auto-approved: sends, payments, deletes and
// pushes through MCP or git always come to you.
export const autoMode = () => getSetting('auto_approve') || 'rules';
const NEVER = /\bgit\s+push\b|\bgh\s+(pr\s+merge|repo\s+delete|release)\b|\bmkfs\b|\bdd\s+if=|\b(qm|pct)\s+(destroy|stop|shutdown|reboot|restore|rollback)\b|\bshutdown\b|\breboot\b|\bsystemctl\s+(stop|disable|mask|restart|reboot|poweroff)\b|\bcurl\b[^|;&]*\s(-X\s*(POST|PUT|PATCH|DELETE)|--request\s+(POST|PUT|PATCH|DELETE)|-d\b|--data|-F\b|--form|-T\b|--upload-file)/i;
const TMP_RM = /^rm\s+-(rf|fr|r)\s+(\/tmp\/[\w.@-][\w./@-]*\s*)+$/; // scratch dirs under /tmp, never /tmp itself
const READ_ONLY = /^(cat|jq|sort|uniq|cut|tr|column|nl|sed(?![^|;]*\s-i)|head|tail|less|ls|ll|stat|file|wc|du|df|free|uptime|whoami|id|hostname|date|ps|pgrep|top -bn1|grep|egrep|rg|find|which|echo|printf|uname|lsblk|ip (a|addr|r|route|link)|ss|netstat|ping -c|dig|nslookup|host|journalctl|systemctl (status|is-active|list-units|show)|docker (ps|logs|inspect|images|stats --no-stream)|pct (list|status|config)|qm (list|status|config)|pvesh get|pvesm status|zpool (status|list)|git (status|log|diff|show|branch))\b/;
const MUTATE = /\s(set|add|del|flush|change|replace)\s|--vacuum|--rotate|\s-delete\b|\s-exec|\s-ok\b|\bbranch\s+-[dDmM]\b/;
const splitCmd = (cmd) => cmd.split(/&&|\|\||;|\n|\|/).map((s) => s.trim()).filter(Boolean);
const safePart = (p) => (READ_ONLY.test(p) || /^(source|\.)\s+[\w./-]+\.env$/.test(p) || /^set [+-]a$/.test(p) || /^\w+=("[^"]*"|'[^']*'|[^\s"']*)$/.test(p) || /^cd\s/.test(p) || TMP_RM.test(p) || /^curl\s/.test(p) && !/\s(-o|-O|--output|-K|--config)\b/.test(p)) && !MUTATE.test(p);
// 'allow' (free, by rule) | 'ask' (always asks you) | null (unclear: Haiku decides in smart mode)
export function ruleVerdict(tool, input) {
  if (tool !== 'Bash') return 'ask';
  const cmd = String(input?.command || '').trim();
  if (!cmd || NEVER.test(cmd)) return 'ask';
  if (splitCmd(cmd).some((p) => /^rm\s+-\w*[rR]/.test(p) && !TMP_RM.test(p))) return 'ask'; // recursive deletes outside /tmp/<dir>
  const bare = cmd.replace(/\d?>\s*\/dev\/null|2>&1/g, '');
  if (/[<>`]|\$\(|\bsudo\b/.test(bare)) return null;
  return splitCmd(bare).every(safePart) ? 'allow' : null;
}
function askHaiku(bot, cmd) {
  return new Promise((ok) => {
    const prompt = `You review one shell command a homelab assistant bot wants to run, and decide if it can run without asking its owner.
Bot: ${bot.name} (${bot.role || 'assistant'}).
Answer SAFE only if it is read-only, or only touches scratch/temp files, and cannot change services, configs, firewalls, VMs, accounts, data or anything outside this machine.
Loading the bot's own credentials (source x.env, set -a; . ./x.env) and setting shell variables are normal and fine; judge what the command then does.
Anything that changes, deletes, restarts, sends, pays, pushes, installs, or that you are unsure about: ASK.
Reply with one line of JSON only: {"verdict":"SAFE"|"ASK","why":"<max 15 words, plain English, for the owner>"}

Command:
${cmd.slice(0, 4000)}`;
    let out = '', done = false;
    const child = spawn(CLAUDE_BIN, ['-p', prompt, '--model', 'haiku', '--tools', '', '--no-session-persistence', '--output-format', 'json', '--strict-mcp-config'],
      { cwd: os.tmpdir(), env: { PATH: process.env.PATH, HOME: os.homedir(), LANG: process.env.LANG || 'C.UTF-8', ...claudeEnv() }, stdio: ['ignore', 'pipe', 'ignore'] });
    const finish = (v) => { if (done) return; done = true; try { child.kill(); } catch {} ok(v); };
    const t = setTimeout(() => finish(null), 25000);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => finish(null));
    child.on('close', () => {
      clearTimeout(t);
      try { const r = JSON.parse(out); const m = String(r.result || '').match(/\{[^{}]*\}/); const v = JSON.parse(m[0]); finish({ verdict: /safe/i.test(v.verdict) ? 'allow' : 'ask', why: String(v.why || '').slice(0, 200), cost: r.total_cost_usd || 0 }); }
      catch { finish(null); }
    });
  });
}
// Called from the pre-tool hook for a gated tool. Returns { allow, why }.
export async function autoApprove(bot, run, tool, input) {
  const mode = autoMode(); if (mode === 'off') return { allow: false };
  const log = (verdict, why, by) => q('INSERT INTO auto_approvals (bot_id, thread, tool, input, verdict, why, by) VALUES (?,?,?,?,?,?,?)')
    .run(bot.id, run.thread, tool, String(input?.command || JSON.stringify(input || {})).slice(0, 2000), verdict, why, by);
  const r = ruleVerdict(tool, input);
  if (r === 'allow') { log('allow', 'Read-only or temp files only', 'rules'); return { allow: true }; }
  if (r === 'ask' || mode !== 'smart' || tool !== 'Bash') return { allow: false };
  const h = await askHaiku(bot, String(input.command));
  if (!h) return { allow: false };
  log(h.verdict, h.why, 'haiku');
  return { allow: h.verdict === 'allow', why: h.verdict === 'ask' ? h.why : '' };
}

// ---------- 2. rewind ----------
// Rewind a 1:1 chat to just before one of your messages: undo the bot's file edits since then (change journal),
// move the later messages out of the chat (kept, not deleted), and continue the bot's conversation from a copy
// of its Claude Code transcript cut at that point.
function sessionFile(sid) {
  const root = path.join(os.homedir(), '.claude', 'projects');
  try { for (const d of fs.readdirSync(root)) { const f = path.join(root, d, sid + '.jsonl'); if (fs.existsSync(f)) return f; } } catch {}
  return null;
}
const promptText = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x?.type === 'text').map((x) => x.text).join('\n') : '';
function forkSessionBefore(sid, text) {
  const f = sessionFile(sid); if (!f) return null;
  const lines = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean);
  const head = text.trim().slice(0, 80);
  let cut = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    try { const d = JSON.parse(lines[i]); if (d.type === 'user' && !d.isMeta && promptText(d.message?.content).includes(head)) { cut = i; break; } } catch {}
  }
  if (cut < 0) return null;
  while (cut > 0) { try { if (JSON.parse(lines[cut - 1]).type !== 'queue-operation') break; } catch { break; } cut--; } // its queue entry goes too
  if (cut === 0) return ''; // the very first message: start fresh
  const id = randomUUID();
  const kept = lines.slice(0, cut).map((l) => { try { const d = JSON.parse(l); if (d.sessionId) d.sessionId = id; return JSON.stringify(d); } catch { return l; } });
  fs.writeFileSync(path.join(path.dirname(f), id + '.jsonl'), kept.join('\n') + '\n', { mode: 0o600 });
  return id;
}
function rewind(msgId) {
  const m = q('SELECT * FROM messages WHERE id=?').get(Number(msgId));
  if (!m || m.author !== 'user') throw Object.assign(new Error('Pick one of your messages to rewind to'), { status: 400 });
  const thread = m.thread;
  if (q("SELECT COUNT(*) AS n FROM runs WHERE thread=? AND status IN ('queued','running')").get(thread).n) throw Object.assign(new Error('Stop the bot’s current task first'), { status: 409 });
  // files
  const undone = [], failed = [];
  for (const j of q('SELECT * FROM journal WHERE thread=? AND at>=? AND restored_at IS NULL ORDER BY id DESC').all(thread, m.created_at)) {
    try { undoJournal(j, false); undone.push(j.path); } catch (e) { failed.push(`${j.path} (${e.message})`); }
  }
  // conversation
  let convo = 'not changed';
  for (const s of q('SELECT * FROM sessions WHERE thread=?').all(thread)) {
    let id = null; try { id = forkSessionBefore(s.session_id, m.body || ''); } catch (e) { console.error('rewind fork', s.session_id, e.message); }
    if (id === '' || id === null) { q('DELETE FROM sessions WHERE bot_id=? AND thread=?').run(s.bot_id, thread); convo = id === '' ? 'starts fresh' : 'starts fresh (couldn’t find the spot in the bot’s transcript)'; }
    else { q('UPDATE sessions SET session_id=? WHERE bot_id=? AND thread=?').run(id, s.bot_id, thread); convo = 'continues from just before this message'; }
  }
  // messages: moved aside, not deleted
  const aside = `rewound:${thread}:${now()}`;
  const n = q('UPDATE messages SET thread=? WHERE thread=? AND id>=?').run(aside, thread, m.id).changes;
  addMessage(thread, 'system', 'note', `↶ Rewound to before “${(m.body || '').slice(0, 60)}${(m.body || '').length > 60 ? '…' : ''}”: ${n} message${n === 1 ? '' : 's'} put aside${undone.length ? `, ${undone.length} file change${undone.length === 1 ? '' : 's'} undone` : ''}; the bot ${convo}.${failed.length ? ` Couldn’t undo: ${failed.join(', ')}.` : ''}`);
  broadcast('thread_reload', { thread });
  return { ok: true, text: m.body || '', moved: n, undone: undone.length, failed, convo };
}

// ---------- 4. dreaming (weekly self-review) ----------
// Sunday after 3 AM, each bot with at least 2 rough spots this week (rejected approvals, errors, you correcting it)
// reviews them once and suggests memory lines. Nothing changes until you press Add to memory.
const CORRECT = /^(no\b|nope|wrong|that'?s not|not what|don'?t|stop\b|why did you|you (forgot|missed|broke))/i;
function roughSpots(botId, since) {
  const rej = q("SELECT tool, input, note FROM approvals WHERE bot_id=? AND status='rejected' AND created_at>=?").all(botId, since)
    .map((a) => `Rejected ${a.tool}: ${String(a.input).slice(0, 200)}${a.note ? ` — your note: ${a.note}` : ''}`);
  const err = q("SELECT body FROM messages WHERE author=? AND kind='error' AND created_at>=? ORDER BY id DESC LIMIT 8").all(String(botId), since).map((r) => `Error: ${String(r.body).slice(0, 200)}`);
  const threads = q("SELECT DISTINCT thread FROM runs WHERE bot_id=? AND started_at>=?").all(botId, since).map((r) => r.thread);
  const fix = threads.length ? q(`SELECT body FROM messages WHERE author='user' AND created_at>=? AND thread IN (${threads.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 200`).all(since, ...threads)
    .filter((r) => CORRECT.test(String(r.body).trim())).slice(0, 8).map((r) => `You corrected it: ${String(r.body).slice(0, 200)}`) : [];
  return [...rej, ...err, ...fix];
}
export function dream(botId, force = false) {
  const since = now() - 7 * 86400, spots = roughSpots(botId, since);
  if (!force && spots.length < 2) return { skipped: true, spots: spots.length };
  setSetting('dream_last:' + botId, String(now()));
  const prompt = `[Weekly self-review] Look back at your week and learn from it. Rough spots Nimbus found:
${spots.length ? spots.map((s) => '- ' + s).join('\n') : '- (none found automatically; look at your recent work and MEMORY.md)'}

Read your MEMORY.md and CLAUDE.md. Work out the lessons: rules the user keeps having to repeat, commands that failed and what works instead, things to check first.
Do NOT edit any files. Reply with a short summary (2-4 bullets), then the memory lines you suggest, each one line, in a block like:
\`\`\`memory
- <lesson, written as an instruction to yourself>
\`\`\`
At most 5 lines. Skip anything already in MEMORY.md. If there's nothing worth keeping, say so and leave the block out.`;
  runBot({ botId, thread: builtIn(botId, 'routines'), prompt, source: 'review' });
  return { started: true, spots: spots.length };
}
function dreamSweep() {
  const d = new Date();
  if (getSetting('dream_on') === '0' || d.getDay() !== 0 || d.getHours() < 3) return;
  for (const b of q('SELECT id FROM bots').all()) {
    if (now() - Number(getSetting('dream_last:' + b.id) || 0) < 6 * 86400) continue;
    setSetting('dream_last:' + b.id, String(now())); // checked this week, even when skipped
    try { dream(b.id); } catch (e) { console.error('dream', e.message); }
  }
}
export const memoryBlock = (text) => (String(text || '').match(/```memory\n([\s\S]*?)```/)?.[1] || '').split('\n').map((l) => l.trim()).filter((l) => /^-\s+\S/.test(l)).slice(0, 8);

// ---------- 8. skills library ----------
// data/shared/skills/<name>/SKILL.md, copied into every bot's .claude/skills so Claude Code loads them.
const SKILLS = path.join(DATA_DIR, 'shared', 'skills');
const MARK = '.nimbus-shared';
const okName = (n) => /^[a-z0-9][a-z0-9-]{1,48}$/.test(n);
function skillDoc(name, description, body) {
  return `---\nname: ${name}\ndescription: ${String(description).replace(/\n/g, ' ').trim()}\n---\n\n${String(body).trim()}\n`;
}
function readSkill(name) {
  const f = path.join(SKILLS, name, 'SKILL.md'); if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8'), fm = text.match(/^---\n([\s\S]*?)\n---\n?/);
  const description = fm?.[1].match(/^description:\s*(.*)$/m)?.[1] || '';
  const meta = JSON.parse(fs.existsSync(path.join(SKILLS, name, '.meta.json')) ? fs.readFileSync(path.join(SKILLS, name, '.meta.json'), 'utf8') : '{}');
  return { name, description, body: fm ? text.slice(fm[0].length).trim() : text, ...meta, updated: Math.floor(fs.statSync(f).mtimeMs / 1000) };
}
const listSkills = () => { try { return fs.readdirSync(SKILLS).filter(okName).map(readSkill).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name)); } catch { return []; } };
function saveSkill(name, description, body, meta = {}) {
  if (!okName(name)) throw Object.assign(new Error('Name: lowercase letters, numbers and dashes'), { status: 400 });
  if (!String(description).trim() || !String(body).trim()) throw Object.assign(new Error('Needs a description and steps'), { status: 400 });
  fs.mkdirSync(path.join(SKILLS, name), { recursive: true });
  fs.writeFileSync(path.join(SKILLS, name, 'SKILL.md'), skillDoc(name, description, body).slice(0, 60000));
  const old = readSkill(name) || {};
  // A skill a bot writes (new or changed) is shared only after the user OKs it: until then only its author has it,
  // so one bot that read a poisoned page can't hand instructions to every other bot.
  fs.writeFileSync(path.join(SKILLS, name, '.meta.json'), JSON.stringify({ by: old.by ?? meta.by ?? null, uses: old.uses || 0, pending: meta.by != null }));
  syncSkills(); broadcast('extras', { what: 'skills' });
}
function syncSkills() {
  const all = listSkills();
  for (const b of q('SELECT id FROM bots').all()) {
    const lib = all.filter((s) => !s.pending || s.by === b.id).map((s) => s.name);
    const dir = path.join(DATA_DIR, 'bots', String(b.id), '.claude', 'skills');
    try {
      fs.mkdirSync(dir, { recursive: true });
      for (const d of fs.readdirSync(dir)) if (fs.existsSync(path.join(dir, d, MARK)) && !lib.includes(d)) fs.rmSync(path.join(dir, d), { recursive: true, force: true });
      for (const n of lib) {
        const to = path.join(dir, n);
        if (fs.existsSync(to) && !fs.existsSync(path.join(to, MARK))) continue; // the bot's own skill with that name wins
        fs.mkdirSync(to, { recursive: true });
        fs.copyFileSync(path.join(SKILLS, n, 'SKILL.md'), path.join(to, 'SKILL.md'));
        fs.writeFileSync(path.join(to, MARK), 'Copied from data/shared/skills by Nimbus. Edit it in Settings → Skills.\n');
      }
    } catch (e) { console.error('skills sync', b.id, e.message); }
  }
}
function seedSkills() {
  if (getSetting('skills_seeded')) return;
  setSetting('skills_seeded', '1');
  if (fs.existsSync(path.join(SKILLS, 'safe-change'))) return;
  saveSkill('safe-change', 'Use before changing any config, service or device in the homelab (firewall rules, Proxmox guests, Docker, network): back up, change, verify, roll back on failure.', `# Safe change
1. Say what you will change and why, in one line.
2. Back up first: copy the config file to <file>.bak-$(date +%F-%H%M), or export the device/VM config. Note where the backup is.
3. Make the smallest change that does the job. One thing at a time.
4. Verify: check the service is up (status, a curl to its port, the GUI) and that nothing else broke (ping the gateway, check DNS).
5. If verification fails, restore the backup straight away and say what happened.
6. Record what changed in team memory: node /home/nimbus/nimbus/bin/facts.mjs add "<what changed, where, backup path>" --topic change`, { by: null });
}

// ---------- 9. custom connectors ----------
// Your own MCP servers (a URL, or a command Nimbus starts), added to the plugin list; switch them on per bot.
function customPlugin(r) {
  const cfg = JSON.parse(r.config);
  return { id: r.id, name: r.name, category: 'Custom', kind: 'mcp', icon: r.name.slice(0, 2).toUpperCase(), color: '#64748b', custom: true,
    desc: cfg.url ? `Remote MCP server at ${cfg.url.replace(/^https?:\/\//, '').split('/')[0]}` : `Local MCP server: ${cfg.command} ${(cfg.args || []).join(' ').slice(0, 60)}`,
    fields: [], server: () => JSON.parse(q('SELECT config FROM custom_mcp WHERE id=?').get(r.id)?.config || '{}') };
}
function loadCustom() {
  for (let i = PLUGINS.length - 1; i >= 0; i--) if (PLUGINS[i].custom) PLUGINS.splice(i, 1);
  for (const r of q('SELECT * FROM custom_mcp ORDER BY created_at').all()) PLUGINS.push(customPlugin(r));
}
function mcpConfig(b) {
  if (b.kind === 'url') {
    const url = String(b.url || '').trim(); if (!/^https?:\/\/\S+$/.test(url)) throw Object.assign(new Error('Enter the server’s http(s) URL'), { status: 400 });
    const headers = {}; for (const l of String(b.headers || '').split('\n')) { const m = l.match(/^\s*([\w-]+)\s*:\s*(.+?)\s*$/); if (m) headers[m[1]] = m[2]; }
    return { type: b.sse ? 'sse' : 'http', url, ...(Object.keys(headers).length ? { headers } : {}) };
  }
  const parts = String(b.command || '').trim().match(/"[^"]*"|'[^']*'|\S+/g)?.map((s) => s.replace(/^["']|["']$/g, '')) || [];
  if (!parts.length) throw Object.assign(new Error('Enter the command that starts the server'), { status: 400 });
  const env = {}; for (const l of String(b.env || '').split('\n')) { const m = l.match(/^\s*([A-Za-z_][\w]*)\s*=\s*(.*?)\s*$/); if (m) env[m[1]] = m[2]; }
  return { command: parts[0], args: parts.slice(1), ...(Object.keys(env).length ? { env } : {}) };
}

// ---------- routes ----------
export function registerAiTools(route, { json, body }) {
  const fail = (res, e) => json(res, e.status || 500, { error: e.message });
  route('GET', '/api/extras/auto-approve', (req, res) => json(res, 200, { mode: autoMode(),
    log: q('SELECT a.*, b.name AS bot FROM auto_approvals a LEFT JOIN bots b ON b.id=a.bot_id ORDER BY a.id DESC LIMIT 100').all(),
    week: q("SELECT by, verdict, COUNT(*) AS n FROM auto_approvals WHERE at>=unixepoch()-7*86400 GROUP BY by, verdict").all() }));
  route('PUT', '/api/extras/auto-approve', async (req, res) => {
    const m = String((await body(req)).mode || '');
    if (!['off', 'rules', 'smart'].includes(m)) return json(res, 400, { error: 'bad mode' });
    setSetting('auto_approve', m); json(res, 200, { mode: m });
  });
  route('POST', '/api/extras/rewind', async (req, res) => { try { json(res, 200, rewind((await body(req)).msgId)); } catch (e) { fail(res, e); } });

  route('GET', '/api/extras/dream', (req, res) => {
    const since = now() - 7 * 86400;
    json(res, 200, { on: getSetting('dream_on') !== '0', bots: q('SELECT id, name FROM bots ORDER BY id').all().map((b) => ({ ...b, spots: roughSpots(b.id, since).length, last: Number(getSetting('dream_last:' + b.id) || 0) || null })) });
  });
  route('PUT', '/api/extras/dream', async (req, res) => { const b = await body(req); setSetting('dream_on', b.on ? '1' : '0'); json(res, 200, { on: !!b.on }); });
  route('POST', '/api/extras/dream/:bot', (req, res, p) => { try { json(res, 200, dream(Number(p.bot), true)); } catch (e) { fail(res, e); } });
  route('POST', '/api/extras/dream-apply', async (req, res) => {
    const b = await body(req), m = q('SELECT * FROM messages WHERE id=?').get(Number(b.msgId));
    if (!m || !/^\d+$/.test(m.author)) return json(res, 404, { error: 'Not found' });
    if (getSetting('dream_applied:' + m.id)) return json(res, 409, { error: 'Already added' });
    const all = memoryBlock(m.body), pick = Array.isArray(b.lines) ? all.filter((_, i) => b.lines.includes(i)) : all;
    if (!pick.length) return json(res, 400, { error: 'Nothing to add' });
    const f = path.join(DATA_DIR, 'bots', m.author, 'MEMORY.md');
    const cur = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '# What I have learned\n';
    fs.appendFileSync(f, (fs.existsSync(f) ? (cur.endsWith('\n') ? '' : '\n') : cur) + pick.map((l) => l.replace(/^-\s+/, '- ') + ` (self-review ${new Date().toISOString().slice(0, 10)})`).join('\n') + '\n');
    setSetting('dream_applied:' + m.id, String(now()));
    addMessage(m.thread, 'system', 'note', `✓ Added ${pick.length} line${pick.length === 1 ? '' : 's'} to ${botName(Number(m.author))}’s memory.`);
    json(res, 200, { ok: true, added: pick.length });
  });

  route('GET', '/api/extras/skills', (req, res) => json(res, 200, { items: listSkills().map((s) => ({ ...s, byName: s.by ? botName(s.by) : 'you' })) }));
  route('POST', '/api/extras/skills/:name/approve', (req, res, p) => {
    const s = readSkill(p.name); if (!s) return json(res, 404, { error: 'No such skill' });
    fs.writeFileSync(path.join(SKILLS, s.name, '.meta.json'), JSON.stringify({ by: s.by ?? null, uses: s.uses || 0, pending: false }));
    syncSkills(); broadcast('extras', { what: 'skills' }); json(res, 200, { ok: true });
  });
  route('PUT', '/api/extras/skills/:name', async (req, res, p) => { try { const b = await body(req); saveSkill(p.name, b.description, b.body); json(res, 200, { ok: true }); } catch (e) { fail(res, e); } });
  route('DELETE', '/api/extras/skills/:name', (req, res, p) => {
    if (!okName(p.name) || !fs.existsSync(path.join(SKILLS, p.name))) return json(res, 404, { error: 'not found' });
    const trash = path.join(SKILLS, '.trash'); fs.mkdirSync(trash, { recursive: true });
    fs.renameSync(path.join(SKILLS, p.name), path.join(trash, `${p.name}-${now()}`)); // kept, not deleted
    syncSkills(); json(res, 200, { ok: true });
  });
  const hookBot = (req, url) => { const t = String(req.headers['x-nimbus-hook'] || ''); if (t.length !== HOOK_TOKEN.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(HOOK_TOKEN))) return null; return q("SELECT bot_id FROM runs WHERE id=? AND status='running'").get(Number(url.searchParams.get('run')))?.bot_id ?? null; };
  route('GET', '/api/hook/skill', (req, res, _p, url) => { if (hookBot(req, url) == null) return json(res, 403, { error: 'forbidden' }); json(res, 200, { items: listSkills().map(({ name, description }) => ({ name, description })) }); });
  route('POST', '/api/hook/skill', async (req, res, _p, url) => {
    const bot = hookBot(req, url); if (bot == null) return json(res, 403, { error: 'forbidden' });
    const b = await body(req), name = String(b.name || '').toLowerCase();
    const old = readSkill(name);
    if (old && old.by !== bot) return json(res, 409, { error: `A skill called ${name} already exists (made by ${old.by ? botName(old.by) : 'the user'}). Pick another name.` });
    try { saveSkill(name, b.description, b.body, { by: bot }); json(res, 200, { ok: true, note: 'Saved. You can use it now; the other bots get it once the user OKs it in Settings → Skills.' }); } catch (e) { fail(res, e); }
  });

  route('GET', '/api/extras/connectors', (req, res) => {
    const rows = q('SELECT * FROM custom_mcp ORDER BY created_at').all();
    json(res, 200, { items: rows.map((r) => { const c = JSON.parse(r.config); return { id: r.id, name: r.name, kind: c.url ? 'url' : 'command', where: c.url || [c.command, ...(c.args || [])].join(' '),
      bots: q('SELECT b.id, b.name FROM bot_plugins bp JOIN bots b ON b.id=bp.bot_id WHERE bp.plugin_id=?').all(r.id) }; }), bots: q('SELECT id, name FROM bots ORDER BY id').all() });
  });
  route('POST', '/api/extras/connectors', async (req, res) => {
    try {
      const b = await body(req), name = String(b.name || '').trim().slice(0, 40);
      if (!name) throw Object.assign(new Error('Give it a name'), { status: 400 });
      const id = 'custom-' + (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'mcp') + '-' + Math.random().toString(36).slice(2, 6);
      q('INSERT INTO custom_mcp (id, name, config) VALUES (?,?,?)').run(id, name, JSON.stringify(mcpConfig(b)));
      q("INSERT OR IGNORE INTO plugins (id, secrets) VALUES (?, '{}')").run(id);
      for (const bid of (b.bots || []).map(Number)) q('INSERT OR IGNORE INTO bot_plugins VALUES (?,?)').run(bid, id);
      loadCustom(); broadcast('state_changed', {}); json(res, 200, { id });
    } catch (e) { fail(res, e); }
  });
  route('PUT', '/api/extras/connectors/:id/bots', async (req, res, p) => {
    if (!q('SELECT 1 FROM custom_mcp WHERE id=?').get(p.id)) return json(res, 404, { error: 'not found' });
    q('DELETE FROM bot_plugins WHERE plugin_id=?').run(p.id);
    for (const bid of ((await body(req)).bots || []).map(Number)) q('INSERT OR IGNORE INTO bot_plugins VALUES (?,?)').run(bid, p.id);
    broadcast('state_changed', {}); json(res, 200, { ok: true });
  });
  route('DELETE', '/api/extras/connectors/:id', (req, res, p) => {
    q('DELETE FROM custom_mcp WHERE id=?').run(p.id); q('DELETE FROM plugins WHERE id=?').run(p.id); q('DELETE FROM bot_plugins WHERE plugin_id=?').run(p.id);
    loadCustom(); broadcast('state_changed', {}); json(res, 200, { ok: true });
  });
}

export function startAiTools() {
  loadCustom();
  try { fs.mkdirSync(SKILLS, { recursive: true }); seedSkills(); syncSkills(); } catch (e) { console.error('skills', e.message); }
  setInterval(() => { dreamSweep(); syncSkills(); }, 10 * 60000).unref();
}
