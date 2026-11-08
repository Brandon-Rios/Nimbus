// Slash commands a bot can run in Claude Code: its own and your custom commands (.claude/commands/*.md),
// skills (.claude/skills/<name>/SKILL.md, plus ones synced from claude.ai) and installed plugins' commands
// and skills (/plugin:name). Read from disk only (no Claude call); cached briefly. Nimbus passes these
// through to Claude Code unchanged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { botDir } from './db.js';
import { pluginCatalog } from './ccplugins.js';

const HOME_CLAUDE = path.join(os.homedir(), '.claude');
const ls = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
function describe(file) {
  try {
    const head = fs.readFileSync(file, 'utf8').slice(0, 4000);
    const fm = head.match(/^---\n([\s\S]*?)\n---/);
    const d = fm?.[1].match(/^description:\s*(.+)$/m)?.[1] || head.replace(/^---[\s\S]*?---/, '').split('\n').find((l) => l.trim() && !l.startsWith('#')) || '';
    return d.replace(/^["']|["']$/g, '').trim().slice(0, 160);
  } catch { return ''; }
}
function scan(dir, prefix, source, out) {
  for (const f of ls(path.join(dir, 'commands'))) if (f.isFile() && f.name.endsWith('.md')) out.push({ cmd: '/' + prefix + f.name.slice(0, -3), desc: describe(path.join(dir, 'commands', f.name)), source });
  for (const s of ls(path.join(dir, 'skills'))) {
    if (!s.isDirectory() || s.name === 'synced') continue;
    const md = path.join(dir, 'skills', s.name, 'SKILL.md');
    if (fs.existsSync(md)) out.push({ cmd: '/' + prefix + s.name, desc: describe(md), source });
  }
}
let cached = { at: 0, list: [] };
async function shared() {
  if (Date.now() - cached.at < 60_000) return cached.list;
  const out = [];
  scan(HOME_CLAUDE, '', 'yours', out);
  for (const acct of ls(path.join(HOME_CLAUDE, 'skills', 'synced'))) for (const s of ls(path.join(HOME_CLAUDE, 'skills', 'synced', acct.name))) {
    const md = path.join(HOME_CLAUDE, 'skills', 'synced', acct.name, s.name, 'SKILL.md');
    if (s.isDirectory() && fs.existsSync(md)) out.push({ cmd: '/anthropic-skills:' + s.name, desc: describe(md), source: 'claude.ai' });
  }
  try {
    const { installed } = await pluginCatalog();
    for (const p of installed.filter((x) => x.enabled)) {
      const [name, mkt] = p.id.split('@');
      const dirs = [path.join(HOME_CLAUDE, 'plugins', 'marketplaces', mkt || '', 'plugins', name), ...ls(path.join(HOME_CLAUDE, 'plugins', 'cache', mkt || '', name)).map((v) => path.join(HOME_CLAUDE, 'plugins', 'cache', mkt, name, v.name))];
      const d = dirs.find((x) => fs.existsSync(x));
      if (d) scan(d, name + ':', 'plugin ' + name, out);
    }
  } catch {}
  cached = { at: Date.now(), list: out };
  return out;
}
export async function botCommands(botId) {
  const out = [];
  scan(path.join(botDir(Number(botId)), '.claude'), '', 'this bot', out);
  const seen = new Set();
  return [...out, ...(await shared())].filter((c) => !seen.has(c.cmd) && seen.add(c.cmd)).sort((a, b) => a.cmd.localeCompare(b.cmd));
}
