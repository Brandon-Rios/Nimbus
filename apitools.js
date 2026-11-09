// API tools: quick commands a bot defines for the services it can reach (Proxmox, OPNsense, UniFi...).
// The bot writes them once into api-tools.json in its folder (/api-tools scan asks it to); after that
// Nimbus runs them directly as slash commands: no Claude call, no plan usage, answers in a second.
// Only the user can run them. A tool runs only after the user has seen and approved its exact script;
// tools marked "changes" ask again every time. Output is capped and secrets are blanked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { botDir, getSetting, setSetting } from './db.js';

const FILE = 'api-tools.json', MAX_OUT = 30_000, TIMEOUT = 60_000;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const approvals = () => JSON.parse(getSetting('api_tools_ok') || '{}');

export function loadTools(botId) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(path.join(botDir(Number(botId)), FILE), 'utf8')); } catch { return []; }
  const ok = approvals()[botId] || {}, seen = new Set();
  return (Array.isArray(raw?.tools) ? raw.tools : []).filter((t) => t && /^[a-z][\w-]{0,30}$/.test(t.name) && typeof t.run === 'string' && t.run.length < 4000 && !seen.has(t.name) && seen.add(t.name))
    .slice(0, 40).map((t) => ({ name: t.name, args: String(t.args || '').slice(0, 60), desc: String(t.desc || '').slice(0, 160), run: t.run, changes: !!t.changes, approved: ok[t.name] === hash(t.run) }));
}

export function approveTool(botId, name) {
  const t = loadTools(botId).find((x) => x.name === name); if (!t) return false;
  const all = approvals(); (all[botId] ||= {})[name] = hash(t.run);
  setSetting('api_tools_ok', JSON.stringify(all));
  return true;
}

// Runs a tool's script in the bot's folder; words after the command are $1, $2... and $ARGS.
export function runTool(botId, name, args, redact) {
  const t = loadTools(botId).find((x) => x.name === name);
  if (!t) return Promise.reject(Object.assign(new Error(`No API tool /${name}`), { status: 404 }));
  if (!t.approved) return Promise.reject(Object.assign(new Error('Approve this tool first'), { status: 409 }));
  const words = String(args || '').trim().split(/\s+/).filter(Boolean).slice(0, 20);
  return new Promise((resolve) => {
    const p = spawn('bash', ['-c', t.run, name, ...words], { cwd: botDir(Number(botId)), env: { ...process.env, ARGS: words.join(' ') }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', killed = false;
    const add = (c) => { if (out.length < MAX_OUT) out += c; };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => { killed = true; p.kill('SIGKILL'); }, TIMEOUT);
    p.on('close', (code) => {
      clearTimeout(timer);
      out = redact(out.length >= MAX_OUT ? out.slice(0, MAX_OUT) + '\n… (cut off)' : out).trim();
      resolve({ code, out: killed ? out + '\n(stopped after 60 seconds)' : out, ok: code === 0 && !killed });
    });
    p.on('error', (e) => resolve({ code: -1, out: e.message, ok: false }));
  });
}

// What /api-tools scan sends to the bot (one normal Claude run).
export const SCAN_PROMPT = `Set up your API tools for Nimbus. Look at what services and APIs you can reach (tokens, config and scripts in your folder, your instructions and memory). Then write ${FILE} in your folder (overwrite it) with quick read-mostly commands the user will run often, like this:
{"tools": [
  {"name": "guests", "desc": "List VMs and containers with status", "run": "curl -sk -H \\"Authorization: PVEAPIToken=$(cat .pve-token)\\" https://host:8006/api2/json/cluster/resources | jq -r '.data[] | ...'"},
  {"name": "start", "args": "<vmid>", "desc": "Start a VM", "run": "...$1...", "changes": true}
]}
Rules: 3 to 10 tools. name is lowercase letters, digits, - or _. "run" is a bash command run in your folder; words the user types after the command are $1, $2 (all of them: $ARGS). Read secrets from files in your folder; never put a secret in the JSON itself. Format output for a human (short tables or lines, use jq or python3), and keep it under a screenful. Mark anything that changes something (start, stop, reboot, block, delete) with "changes": true. Test each read-only command once before saving. Reply with the list of tools you made (name and one line each).`;
