// Nimbus Code: coding projects tied to a git repo. Repos live in ~/code/<folder>; a thread can work on its own
// branch in its own folder (a git worktree in ~/code/.branches/<folder>/<branch>), so several bots can code at
// once without touching each other's files. Before and after every turn Nimbus snapshots the files (a hidden
// git ref), so it can show exactly what that turn changed and undo it. Everything here is local git and file
// work: no Claude usage.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { db, q } from './db.js';
import { broadcast } from './events.js';
import { redact } from './redact.js';

export const CODE_ROOT = path.resolve(process.env.NIMBUS_CODE_DIR || path.join(os.homedir(), 'code'));
const BRANCHES = path.join(CODE_ROOT, '.branches');
fs.mkdirSync(CODE_ROOT, { recursive: true });

// Extra columns on threads.js's tables. threads.js calls this after making them (on a new install they don't exist yet here).
export function ensureCodeColumns() {
  for (const [table, col, type] of [['projects', 'kind', "TEXT DEFAULT 'chat'"], ['projects', 'repo', 'TEXT'], ['projects', 'test_cmd', "TEXT DEFAULT ''"],
    ['projects', 'preview_cmd', "TEXT DEFAULT ''"], ['threads', 'branch', 'TEXT'], ['threads', 'worktree', 'TEXT'], ['threads', 'base', 'TEXT']]) {
    const cols = q(`PRAGMA table_info(${table})`).all();
    if (cols.length && !cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
  }
}
ensureCodeColumns();
db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (run_id INTEGER PRIMARY KEY, thread TEXT, cwd TEXT, before TEXT, after TEXT, undone INTEGER DEFAULT 0)`);

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_AUTHOR_NAME: 'Nimbus', GIT_AUTHOR_EMAIL: 'nimbus@localhost', GIT_COMMITTER_NAME: 'Nimbus', GIT_COMMITTER_EMAIL: 'nimbus@localhost' };
export function git(cwd, args, { env = {}, max = 8 << 20, timeout = 60_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const p = execFile('git', args, { cwd, env: { ...GIT_ENV, ...env }, maxBuffer: max, timeout }, (err, out, errOut) => {
      if (err) return reject(Object.assign(new Error(String(errOut || err.message).trim().split('\n').slice(-3).join('\n')), { status: 400 }));
      resolve(out);
    });
    if (input != null) p.stdin.end(input);
  });
}
const tryGit = (cwd, args, o) => git(cwd, args, o).catch(() => '');

// ---------- projects and threads ----------
export const projectRow = (id) => q('SELECT * FROM projects WHERE id=?').get(Number(id));
export const isCode = (p) => p?.kind === 'code' && !!p.repo;
export const repoPath = (p) => path.join(CODE_ROOT, p.repo);
export function listRepos() {
  return fs.readdirSync(CODE_ROOT, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => d.name).sort();
}
// Folder for a new repo: the project name made simple, with -2, -3... if taken.
function freeFolder(name) {
  const base = slug(name) || 'project';
  let f = base, n = 2;
  while (fs.existsSync(path.join(CODE_ROOT, f))) f = `${base}-${n++}`;
  return f;
}
// source: 'new' (empty repo), 'clone' (url), 'existing' (a folder already in ~/code).
export async function setupRepo({ name, source, url, folder }) {
  if (source === 'existing') {
    if (!listRepos().includes(folder)) throw Object.assign(new Error('Pick a folder in ' + CODE_ROOT), { status: 400 });
    const dir = path.join(CODE_ROOT, folder);
    if (!fs.existsSync(path.join(dir, '.git'))) await initRepo(dir);
    return folder;
  }
  if (source === 'clone') {
    if (!/^(https:\/\/|git@)[\w.@:/~-]+$/.test(String(url || ''))) throw Object.assign(new Error('Paste a git URL like https://github.com/owner/repo'), { status: 400 });
    const f = freeFolder(String(url).replace(/\.git$/, '').split(/[/:]/).pop());
    await git(CODE_ROOT, ['clone', url, f], { timeout: 600_000 });
    return f;
  }
  const f = freeFolder(name);
  const dir = path.join(CODE_ROOT, f);
  fs.mkdirSync(dir);
  await initRepo(dir);
  return f;
}
async function initRepo(dir) {
  await git(dir, ['init', '-b', 'main']);
  if (!fs.existsSync(path.join(dir, 'README.md')) && !fs.readdirSync(dir).filter((n) => n !== '.git').length) fs.writeFileSync(path.join(dir, 'README.md'), `# ${path.basename(dir)}\n`);
  await git(dir, ['add', '-A']);
  await tryGit(dir, ['commit', '-m', 'Start']);
}

// A new thread in a code project: with ownBranch it gets a branch and folder of its own.
export async function setupThread(threadId, ownBranch) {
  const t = q('SELECT * FROM threads WHERE id=?').get(threadId);
  const p = t && projectRow(t.project_id);
  if (!isCode(p)) return;
  const repo = repoPath(p);
  const base = (await tryGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim() || 'main';
  if (!ownBranch) { q('UPDATE threads SET base=? WHERE id=?').run(base, threadId); return; }
  const branch = `nimbus/${slug(t.title) || 'task'}-${threadId}`;
  const dir = path.join(BRANCHES, p.repo, branch.replace('/', '-'));
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (!(await tryGit(repo, ['rev-parse', '--verify', 'HEAD'])).trim()) await initRepo(repo);
  await git(repo, ['worktree', 'add', '-b', branch, dir, base]);
  q('UPDATE threads SET branch=?, worktree=?, base=? WHERE id=?').run(branch, dir, base, threadId);
}
export async function removeThreadBranch(t, { deleteBranch = false } = {}) {
  const p = projectRow(t.project_id);
  if (!isCode(p) || !t.worktree) return;
  await tryGit(repoPath(p), ['worktree', 'remove', '--force', t.worktree]);
  if (deleteBranch && t.branch) await tryGit(repoPath(p), ['branch', '-D', t.branch]);
}

// Where a thread's bot works: its branch folder, the repo, or null (not a code thread).
export function threadCode(key) {
  const m = /^t:(\d+)$/.exec(String(key)); if (!m) return null;
  const t = q('SELECT * FROM threads WHERE id=?').get(Number(m[1]));
  const p = t && projectRow(t.project_id);
  if (!isCode(p)) return null;
  const cwd = t.worktree && fs.existsSync(t.worktree) ? t.worktree : repoPath(p);
  return { t, p, cwd, repo: repoPath(p) };
}

// What the bot is told when a conversation starts in a code thread.
export function codeContext(key) {
  const c = threadCode(key); if (!c) return '';
  const pv = previews.get(key);
  return `(Nimbus Code: you are working in the git repo ${c.cwd}${c.t.branch ? ` on your own branch "${c.t.branch}" (made from "${c.t.base}" for this thread)` : ''}. `
    + 'The user watches your edits and the diff live in Nimbus. Make the changes, run the tests if there are any, then reply with a short summary of what changed. '
    + "Don't commit, push or merge unless the user asks: they review, commit and merge from Nimbus. Your own folder (memory, notes, tokens) is still available."
    + (testCommand(c.cwd, c.p) ? ` Tests: \`${testCommand(c.cwd, c.p)}\`.` : '')
    + (pv ? ` The app is running for preview at http://127.0.0.1:${pv.port} (you can curl it or screenshot it).` : '') + ')\n';
}

// ---------- git info ----------
export async function info(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const { cwd } = c;
  const [branchLine, status, numstat, logOut, remote] = await Promise.all([
    tryGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), tryGit(cwd, ['status', '--porcelain=v1', '-b', '-uall']),
    tryGit(cwd, ['diff', 'HEAD', '--numstat']), tryGit(cwd, ['log', '-n', '30', '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s']),
    tryGit(cwd, ['remote', 'get-url', 'origin'])]);
  const head = status.split('\n')[0] || '';
  const ahead = Number(/ahead (\d+)/.exec(head)?.[1] || 0), behind = Number(/behind (\d+)/.exec(head)?.[1] || 0);
  const nums = new Map(numstat.trim().split('\n').filter(Boolean).map((l) => { const [a, d, ...f] = l.split('\t'); return [f.join('\t'), { add: a === '-' ? 0 : Number(a), del: d === '-' ? 0 : Number(d) }]; }));
  const changes = status.split('\n').slice(1).filter(Boolean).map((l) => {
    const code = l.slice(0, 2), file = l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, '');
    const n = nums.get(file) || { add: code === '??' ? lineCount(path.join(cwd, file)) : 0, del: 0 };
    return { file, state: code === '??' ? 'new' : /D/.test(code) ? 'deleted' : /A/.test(code) ? 'new' : /R/.test(code) ? 'renamed' : 'changed', ...n };
  });
  const commits = logOut.trim().split('\n').filter(Boolean).map((l) => { const [sha, short, author, at, subject] = l.split('\x1f'); return { sha, short, author, at: Number(at), subject }; });
  let aheadOfBase = 0;
  if (c.t.branch && c.t.base) aheadOfBase = Number((await tryGit(cwd, ['rev-list', '--count', `${c.t.base}..HEAD`])).trim() || 0);
  return {
    project: { id: c.p.id, name: c.p.name, repo: c.p.repo, path: c.repo }, cwd, branch: branchLine.trim(), base: c.t.base, ownBranch: !!c.t.branch,
    remote: redact(remote.trim()), webUrl: webUrl(remote.trim()), ahead, behind, aheadOfBase, changes, commits,
    languages: languages(cwd), test: { cmd: testCommand(cwd, c.p), last: testResults.get(key) || null },
    preview: previewState(key), agents: agents(c.p.id)
  };
}
function lineCount(f) { try { const s = fs.statSync(f); if (s.size > 2e6) return 0; const t = fs.readFileSync(f, 'utf8'); return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0; } catch { return 0; } }
function webUrl(remote) {
  const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/.exec(remote);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}
function agents(projectId) {
  return q(`SELECT r.bot_id, r.thread, r.started_at, r.status FROM runs r JOIN threads t ON r.thread = 't:' || t.id
    WHERE t.project_id=? AND r.status IN ('running','queued') ORDER BY r.id`).all(projectId);
}

// Languages the way GitHub (linguist) does it: bytes of the committed files per language, with vendored, generated
// and documentation files left out, data and prose (JSON, YAML, Markdown…) not counted, and .gitattributes
// linguist-* overrides respected. Uncommitted work is only used when there are no commits yet.
const L = (name, color, type = 'code') => ({ name, color, type });
const JS = L('JavaScript', '#f1e05a'), TS = L('TypeScript', '#3178c6'), CPP = L('C++', '#f34b7d'), SH = L('Shell', '#89e051'), HTML = L('HTML', '#e34c26');
const LANG = { js: JS, mjs: JS, cjs: JS, jsx: JS, ts: TS, tsx: TS, mts: TS, cts: TS,
  py: L('Python', '#3572A5'), pyi: L('Python', '#3572A5'), ipynb: L('Jupyter Notebook', '#DA5B0B'), rb: L('Ruby', '#701516'), go: L('Go', '#00ADD8'), rs: L('Rust', '#dea584'),
  java: L('Java', '#b07219'), kt: L('Kotlin', '#A97BFF'), kts: L('Kotlin', '#A97BFF'), scala: L('Scala', '#c22d40'), groovy: L('Groovy', '#4298b8'), gradle: L('Groovy', '#4298b8'),
  swift: L('Swift', '#F05138'), m: L('Objective-C', '#438eff'), mm: L('Objective-C++', '#6866fb'), c: L('C', '#555555'), h: L('C', '#555555'),
  cc: CPP, cpp: CPP, cxx: CPP, hpp: CPP, hh: CPP, hxx: CPP, cs: L('C#', '#178600'), fs: L('F#', '#b845fc'), vb: L('Visual Basic .NET', '#945db7'),
  php: L('PHP', '#4F5D95'), pl: L('Perl', '#0298c3'), pm: L('Perl', '#0298c3'), r: L('R', '#198CE7'), jl: L('Julia', '#a270ba'), lua: L('Lua', '#000080'),
  dart: L('Dart', '#00B4AB'), ex: L('Elixir', '#6e4a7e'), exs: L('Elixir', '#6e4a7e'), erl: L('Erlang', '#B83998'), hs: L('Haskell', '#5e5086'), clj: L('Clojure', '#db5855'),
  elm: L('Elm', '#60B5CC'), ml: L('OCaml', '#ef7a08'), zig: L('Zig', '#ec915c'), nim: L('Nim', '#ffc200'), v: L('V', '#4f87c4'), sol: L('Solidity', '#AA6746'),
  html: HTML, htm: HTML, xhtml: HTML, css: L('CSS', '#663399'), scss: L('SCSS', '#c6538c'), sass: L('Sass', '#a53b70'), less: L('Less', '#1d365d'),
  vue: L('Vue', '#41b883'), svelte: L('Svelte', '#ff3e00'), astro: L('Astro', '#ff5a03'), ejs: L('EJS', '#a91e50'), hbs: L('Handlebars', '#f7931e'), twig: L('Twig', '#c1d026'),
  sh: SH, bash: SH, zsh: SH, fish: L('Fish', '#4aae47'), ps1: L('PowerShell', '#012456'), psm1: L('PowerShell', '#012456'), bat: L('Batchfile', '#C1F12E'), cmd: L('Batchfile', '#C1F12E'),
  sql: L('SQL', '#e38c00', 'data'), tf: L('HCL', '#844FBA'), hcl: L('HCL', '#844FBA'), nix: L('Nix', '#7e7eff'), dockerfile: L('Dockerfile', '#384d54'), makefile: L('Makefile', '#427819'),
  cmake: L('CMake', '#DA3434'), proto: L('Protocol Buffer', '#ccc', 'data'), graphql: L('GraphQL', '#e10098', 'data'), tex: L('TeX', '#3D6117'), asm: L('Assembly', '#6E4C13'), s: L('Assembly', '#6E4C13'),
  md: L('Markdown', '#083fa1', 'prose'), mdx: L('MDX', '#fcb32c', 'prose'), rst: L('reStructuredText', '#141414', 'prose'), txt: L('Text', '#999', 'prose'),
  json: L('JSON', '#292929', 'data'), jsonc: L('JSON', '#292929', 'data'), yml: L('YAML', '#cb171e', 'data'), yaml: L('YAML', '#cb171e', 'data'), toml: L('TOML', '#9c4221', 'data'),
  xml: L('XML', '#0060ac', 'data'), csv: L('CSV', '#237346', 'data'), ini: L('INI', '#d1dbe0', 'data'), svg: L('SVG', '#ff9900', 'data') };
const BYNAME = { dockerfile: 'dockerfile', makefile: 'makefile', gnumakefile: 'makefile', 'cmakelists.txt': 'cmake', rakefile: 'rb', gemfile: 'rb', jenkinsfile: 'groovy' };
const SHEBANG = { node: 'js', python: 'py', python3: 'py', bash: 'sh', sh: 'sh', zsh: 'sh', ruby: 'rb', perl: 'pl', php: 'php', deno: 'ts', bun: 'ts' };
const VENDORED = /(^|\/)(node_modules|bower_components|vendor|vendors|third[-_]?party|external|deps|Pods|Carthage|\.yarn|\.pnp|dist|build|out|target|\.next|\.nuxt|\.svelte-kit|coverage|__pycache__|\.venv|venv|env|site-packages|\.gradle|\.idea|\.vscode|public\/vendor|static\/vendor|assets\/vendor)\//i;
const VENDOR_FILE = /(^|\/)(jquery|bootstrap|d3|three|lodash|underscore|moment|react(-dom)?|vue|angular|chart|xterm)([.-][\w.-]*)?\.(js|css)$|\.min\.(js|css)$|-min\.(js|css)$|\.(map|lock)$|(^|\/)(package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb|Cargo\.lock|poetry\.lock|Pipfile\.lock|composer\.lock|Gemfile\.lock|go\.sum)$/i;
const GENERATED = /\.(pb\.go|pb\.\w+|_pb2\.py|g\.dart|freezed\.dart|designer\.cs|generated\.\w+)$|(^|\/)(generated|gen|__generated__)\//i;
const DOCS = /(^|\/)(docs?|documentation|examples?|samples?|demo)\/|(^|\/)(README|CHANGELOG|CHANGES|CONTRIBUTING|LICENSE|COPYING|AUTHORS|HISTORY|NEWS)(\.\w+)?$/i;
// .gitattributes: path linguist-vendored / -generated / -documentation / -detectable / linguist-language=X
function attrRules(cwd, read) {
  let text = ''; try { text = read('.gitattributes'); } catch {}
  return text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && /linguist-/.test(l)).map((l) => {
    const [pat, ...attrs] = l.split(/\s+/);
    const re = new RegExp((pat.includes('/') ? '^' : '(^|/)') + pat.replace(/^\//, '').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '.*') + (pat.endsWith('/') ? '' : '($|/)'));
    const a = {}; for (const x of attrs) { const m = x.match(/^(-|!)?linguist-([\w-]+)(?:=(.+))?$/); if (m) a[m[2]] = m[3] ?? !m[1]; }
    return { re, a };
  });
}
const langCache = new Map();
export function languages(cwd) {
  let head = ''; try { head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, timeout: 5000 }).toString().trim(); } catch {}
  // Committed tree (like GitHub) with sizes in one call; before the first commit, the files on disk.
  let files = [];
  try {
    if (head) files = execFileSync('git', ['ls-tree', '-r', '-l', '-z', head], { cwd, maxBuffer: 64 << 20, timeout: 15_000 }).toString().split('\0').filter(Boolean)
      .map((l) => { const m = l.match(/^\d+ (\w+) [0-9a-f]+\s+(-|\d+)\t(.+)$/s); return m && m[1] === 'blob' ? { f: m[3], size: Number(m[2]) || 0 } : null; }).filter(Boolean);
    else files = String(require_ls(cwd)).split('\0').filter(Boolean).map((f) => { try { return { f, size: fs.statSync(path.join(cwd, f)).size }; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
  const key = head || 'wt' + files.length;
  const hit = langCache.get(cwd);
  if (hit && hit.key === key && (head || Date.now() - hit.at < 15_000)) return hit.list;
  const read = (f) => head ? execFileSync('git', ['show', `${head}:${f}`], { cwd, maxBuffer: 1 << 20, timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).toString() : fs.readFileSync(path.join(cwd, f), 'utf8');
  const rules = attrRules(cwd, read);
  const by = new Map();
  for (const { f, size } of files.slice(0, 50000)) {
    const a = {}; for (const r of rules) if (r.re.test(f)) Object.assign(a, r.a);
    if (a.vendored === true || a.generated === true || a.documentation === true || a.detectable === false) continue;
    if (a.vendored !== false && (VENDORED.test(f) || VENDOR_FILE.test(f))) continue;
    if (a.generated !== false && GENERATED.test(f)) continue;
    if (a.documentation !== false && DOCS.test(f)) continue;
    const base = path.basename(f).toLowerCase();
    let ext = BYNAME[base] || path.extname(base).slice(1);
    if (!ext && size && size < 2_000_000) { try { const m = read(f).slice(0, 120).match(/^#!\s*\S*?(?:\/env\s+)?([a-z]+)[\d.]*/); ext = m ? SHEBANG[m[1]] || '' : ''; } catch {} }
    let l = LANG[ext];
    if (typeof a.language === 'string') l = Object.values(LANG).find((x) => x.name.toLowerCase() === a.language.replace(/-/g, ' ').toLowerCase()) || L(a.language, '#888');
    if (!l || (l.type !== 'code' && a.detectable !== true)) { if (l) { const cur = by.get('~' + l.name) || { ...l, bytes: 0 }; cur.bytes += size; by.set('~' + l.name, cur); } continue; }
    const cur = by.get(l.name) || { name: l.name, color: l.color, bytes: 0 }; cur.bytes += size; by.set(l.name, cur);
  }
  // Data and prose only show when the repo has nothing else (GitHub would show nothing; an empty bar helps less).
  let list = [...by.entries()].filter(([k]) => !k.startsWith('~')).map(([, v]) => v);
  if (!list.length) list = [...by.values()].map(({ name, color, bytes }) => ({ name, color, bytes }));
  const total = list.reduce((s, x) => s + x.bytes, 0);
  list = list.sort((a, b) => b.bytes - a.bytes).map((x) => ({ ...x, pct: total ? Math.round(x.bytes / total * 1000) / 10 : 0 }));
  // Like GitHub: slivers under 0.1% go into Other.
  const small = list.filter((x) => x.pct < 0.1);
  if (small.length > 1) list = [...list.filter((x) => x.pct >= 0.1), { name: 'Other', color: '#ededed', bytes: small.reduce((s, x) => s + x.bytes, 0), pct: Math.round(small.reduce((s, x) => s + x.bytes, 0) / total * 1000) / 10 }];
  langCache.set(cwd, { key, at: Date.now(), list });
  return list;
}
function require_ls(cwd) { return execFileSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], { cwd, maxBuffer: 32 << 20, timeout: 10_000 }); }

// ---------- diffs ----------
// what: 'working' (uncommitted), 'commit' (sha), 'turn' (run id), 'branch' (everything vs the base branch).
export async function diff(key, what, ref) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const o = { max: 16 << 20 };
  let out = '';
  if (what === 'commit') {
    if (!/^[0-9a-f]{7,40}$/.test(String(ref))) throw Object.assign(new Error('bad commit'), { status: 400 });
    out = await git(c.cwd, ['show', '--format=%h %s%n', '--no-color', String(ref)], o);
  } else if (what === 'turn') {
    const cp = q('SELECT * FROM checkpoints WHERE run_id=?').get(Number(ref));
    if (!cp?.after) throw Object.assign(new Error('No changes saved for that turn'), { status: 404 });
    out = await git(cp.cwd, ['diff', '--no-color', cp.before, cp.after], o);
  } else if (what === 'branch') {
    if (!c.t.base) throw Object.assign(new Error('No base branch'), { status: 400 });
    const snap = await snapshot(c.cwd);
    out = await git(c.cwd, ['diff', '--no-color', `${c.t.base}...HEAD`], o) + (snap ? await git(c.cwd, ['diff', '--no-color', 'HEAD', snap], o) : '');
  } else {
    const snap = await snapshot(c.cwd);
    out = snap ? await git(c.cwd, ['diff', '--no-color', 'HEAD', snap], o) : '';
  }
  return redact(out.length > 3e6 ? out.slice(0, 3e6) + '\n… (cut off)' : out);
}

// ---------- checkpoints (per turn) ----------
// A snapshot is a commit object of every file (tracked and new, minus ignored) made with a temporary index,
// so the user's real index and branch are never touched. Kept alive by refs/nimbus/cp/<run>.
async function snapshot(cwd) {
  const idx = path.join(os.tmpdir(), `nimbus-idx-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    const env = { GIT_INDEX_FILE: idx };
    const head = (await tryGit(cwd, ['rev-parse', '--verify', 'HEAD'])).trim();
    if (head) await git(cwd, ['read-tree', 'HEAD'], { env });
    await git(cwd, ['add', '-A'], { env, timeout: 120_000 });
    const tree = (await git(cwd, ['write-tree'], { env })).trim();
    return (await git(cwd, ['commit-tree', tree, ...(head ? ['-p', head] : []), '-m', 'nimbus snapshot'])).trim();
  } catch { return null; } finally { fs.rmSync(idx, { force: true }); }
}
export async function checkpointBefore(runId, key) {
  const c = threadCode(key); if (!c) return;
  const sha = await snapshot(c.cwd); if (!sha) return;
  await tryGit(c.cwd, ['update-ref', `refs/nimbus/cp/${runId}-before`, sha]);
  q('INSERT OR REPLACE INTO checkpoints (run_id, thread, cwd, before) VALUES (?,?,?,?)').run(runId, key, c.cwd, sha);
}
// After a turn: what changed, or null when nothing did.
export async function checkpointAfter(runId) {
  const cp = q('SELECT * FROM checkpoints WHERE run_id=?').get(runId); if (!cp) return null;
  const sha = await snapshot(cp.cwd); if (!sha) return null;
  const num = (await tryGit(cp.cwd, ['diff', '--numstat', cp.before, sha])).trim();
  if (!num) { q('DELETE FROM checkpoints WHERE run_id=?').run(runId); await tryGit(cp.cwd, ['update-ref', '-d', `refs/nimbus/cp/${runId}-before`]); return null; }
  await tryGit(cp.cwd, ['update-ref', `refs/nimbus/cp/${runId}-after`, sha]);
  q('UPDATE checkpoints SET after=? WHERE run_id=?').run(sha, runId);
  const files = num.split('\n').map((l) => { const [a, d, ...f] = l.split('\t'); return { file: f.join('\t'), add: a === '-' ? 0 : Number(a), del: d === '-' ? 0 : Number(d) }; });
  return { runId, files, add: files.reduce((s, f) => s + f.add, 0), del: files.reduce((s, f) => s + f.del, 0) };
}
// Undo a turn: put back the files that turn touched, as they were before it (later edits to other files stay).
export async function undoTurn(runId) {
  const cp = q('SELECT * FROM checkpoints WHERE run_id=?').get(Number(runId));
  if (!cp?.after) throw Object.assign(new Error('Nothing to undo for that turn'), { status: 404 });
  if (cp.undone) throw Object.assign(new Error('That turn was already undone'), { status: 409 });
  const changed = (await git(cp.cwd, ['diff', '--name-status', '--no-renames', cp.before, cp.after])).trim().split('\n').filter(Boolean);
  for (const l of changed) {
    const [st, file] = l.split('\t');
    if (st === 'A') fs.rmSync(path.join(cp.cwd, file), { force: true });
    else await git(cp.cwd, ['restore', `--source=${cp.before}`, '--worktree', '--', file]);
  }
  q('UPDATE checkpoints SET undone=1 WHERE run_id=?').run(cp.run_id);
  changedNow(cp.thread);
  return { files: changed.length };
}

// ---------- commit, merge, push ----------
export async function suggestMessage(key) {
  const i = await info(key);
  if (!i.changes.length) return '';
  const names = i.changes.map((c) => path.basename(c.file));
  const verb = i.changes.every((c) => c.state === 'new') ? 'Add' : i.changes.every((c) => c.state === 'deleted') ? 'Remove' : 'Update';
  return `${verb} ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` and ${names.length - 3} more` : ''}`;
}
export async function commit(key, message) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  message = String(message || '').trim() || await suggestMessage(key);
  if (!message) throw Object.assign(new Error('Nothing to commit'), { status: 400 });
  await git(c.cwd, ['add', '-A']);
  const env = await authorEnv(c.cwd);
  await git(c.cwd, ['commit', '-m', message], { env });
  changedNow(key);
  return { ok: true, message };
}
// The repo's own git identity if it has one, else "Nimbus".
async function authorEnv(cwd) {
  const name = (await tryGit(cwd, ['config', 'user.name'])).trim(), email = (await tryGit(cwd, ['config', 'user.email'])).trim();
  return name && email ? { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email } : {};
}
// Merge a thread's branch into its base branch, in the main repo folder.
export async function merge(key) {
  const c = threadCode(key);
  if (!c?.t.branch) throw Object.assign(new Error('This thread works on the main branch, so there is nothing to merge'), { status: 400 });
  if ((await git(c.cwd, ['status', '--porcelain'])).trim()) throw Object.assign(new Error('Commit the changes on this branch first'), { status: 409 });
  const cur = (await git(c.repo, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  if (cur !== c.t.base) throw Object.assign(new Error(`The main folder is on "${cur}", not "${c.t.base}". Switch it back first.`), { status: 409 });
  if ((await git(c.repo, ['status', '--porcelain', '--untracked-files=no'])).trim()) throw Object.assign(new Error(`The main folder has uncommitted changes on "${c.t.base}". Commit or undo them first.`), { status: 409 });
  try { await git(c.repo, ['merge', '--no-ff', '-m', `Merge ${c.t.branch}: ${c.t.title || 'task'}`, c.t.branch], { env: await authorEnv(c.repo) }); }
  catch (e) {
    await tryGit(c.repo, ['merge', '--abort']);
    throw Object.assign(new Error(`The branch can't be merged cleanly (both sides changed the same lines). Ask the bot: "merge ${c.t.base} into this branch and fix the conflicts", then merge again.`), { status: 409 });
  }
  changedNow(key);
  return { ok: true };
}
export async function push(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  if (!(await tryGit(c.cwd, ['remote'])).trim()) throw Object.assign(new Error('This repo has no remote to push to'), { status: 400 });
  const branch = (await git(c.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  try { await git(c.cwd, ['push', '-u', 'origin', branch], { timeout: 180_000 }); }
  catch (e) { throw Object.assign(new Error(`Push failed: ${redact(e.message)}. If it needs a login, ask Github Manager to push it.`), { status: 400 }); }
  changedNow(key);
  return { ok: true, branch };
}

// ---------- tests ----------
const testResults = new Map(); // thread -> { ok, code, out, at, cmd }
const testRuns = new Map();
export function testCommand(cwd, p) {
  if (p?.test_cmd?.trim()) return p.test_cmd.trim();
  const has = (f) => fs.existsSync(path.join(cwd, f));
  try { const pk = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); if (pk.scripts?.test && !/no test specified/.test(pk.scripts.test)) return 'npm test'; } catch {}
  if (has('pytest.ini') || has('conftest.py') || (has('pyproject.toml') && fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8').includes('pytest')) || (has('tests') && fs.readdirSync(path.join(cwd, 'tests')).some((f) => /^test_.*\.py$/.test(f)))) return 'python3 -m pytest -q';
  if (has('go.mod')) return 'go test ./...';
  if (has('Cargo.toml')) return 'cargo test';
  try { if (/^test:/m.test(fs.readFileSync(path.join(cwd, 'Makefile'), 'utf8'))) return 'make test'; } catch {}
  return '';
}
export function runTests(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const cmd = testCommand(c.cwd, c.p);
  if (!cmd) throw Object.assign(new Error('No tests found. Set a test command in the project settings.'), { status: 400 });
  if (testRuns.has(key)) throw Object.assign(new Error('Tests are already running'), { status: 409 });
  const started = Date.now();
  testResults.set(key, { running: true, cmd, at: started });
  broadcast('code_changed', { thread: key });
  return new Promise((resolve) => {
    const p = spawn('bash', ['-lc', cmd], { cwd: path.join(c.cwd, det.dir), env: { ...process.env, CI: '1', FORCE_COLOR: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    testRuns.set(key, p);
    let out = '';
    const add = (d) => { out += d; if (out.length > 200_000) out = out.slice(-150_000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const timer = setTimeout(() => p.kill('SIGKILL'), 10 * 60_000);
    p.on('close', (code) => {
      clearTimeout(timer); testRuns.delete(key);
      const r = { ok: code === 0, code, out: redact(out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')).slice(-60_000), at: Date.now(), secs: Math.round((Date.now() - started) / 1000), cmd };
      testResults.set(key, r);
      broadcast('code_changed', { thread: key });
      resolve(r);
    });
    p.on('error', (e) => { testRuns.delete(key); const r = { ok: false, code: -1, out: e.message, at: Date.now(), cmd }; testResults.set(key, r); resolve(r); });
  });
}

// ---------- live preview ----------
// The project's dev server runs on a local port; Nimbus shows it through a port of its own (8900+) that
// needs the Nimbus login and speaks HTTP or HTTPS (whichever the page uses). Nothing is opened to the internet.
const previews = new Map(); // thread -> { proc, port, proxyPort, cmd, out, started }
// Works out how to run the app, looking at the project itself (no Claude): Node scripts, Python web apps or a
// plain website, in the root or a usual subfolder (web/, frontend/, client/, app/, site/, public/, docs/…).
const PREVIEW_DIRS = ['', 'web', 'frontend', 'client', 'app', 'site', 'www', 'ui', 'webapp', 'website', 'public', 'static', 'src', 'docs', 'dist', 'build'];
const has = (d, f) => fs.existsSync(path.join(d, f));
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').slice(0, 200_000); } catch { return ''; } };
function detectIn(cwd, dir) {
  const d = path.join(cwd, dir), where = dir ? ` in ${dir}/` : '';
  if (!fs.existsSync(d)) return null;
  if (has(d, 'package.json')) {
    let pk = {}; try { pk = JSON.parse(readText(path.join(d, 'package.json'))); } catch {}
    const sc = pk.scripts || {};
    const name = ['dev', 'start', 'serve', 'preview'].find((k) => sc[k]);
    if (name) {
      const pm = has(d, 'pnpm-lock.yaml') ? 'pnpm' : has(d, 'yarn.lock') ? 'yarn' : has(d, 'bun.lockb') ? 'bun' : 'npm';
      const s = sc[name], run = pm === 'npm' ? `npm run ${name}` : `${pm} ${name}`;
      const args = /\bvite\b|astro|svelte-kit|nuxt/.test(s) ? ' --port $PORT --host 127.0.0.1' : /\bnext\b/.test(s) ? ' -p $PORT -H 127.0.0.1' : /react-scripts|webpack|ng serve/.test(s) ? '' : '';
      const install = has(d, 'node_modules') ? '' : `${pm} install && `;
      return { dir, cmd: `${install}${run}${args ? (pm === 'npm' ? ' --' : '') + args : ''}`, why: `the "${name}" script in ${dir ? dir + '/' : ''}package.json` };
    }
  }
  if (has(d, 'manage.py')) return { dir, cmd: 'python3 manage.py runserver 127.0.0.1:$PORT', why: `a Django app${where}` };
  for (const f of ['app.py', 'main.py', 'server.py', 'wsgi.py', 'run.py']) {
    const t = has(d, f) ? readText(path.join(d, f)) : ''; if (!t) continue;
    const mod = f.replace(/\.py$/, '');
    if (/streamlit/.test(t)) return { dir, cmd: `streamlit run ${f} --server.port $PORT --server.address 127.0.0.1 --server.headless true`, why: `a Streamlit app (${dir ? dir + '/' : ''}${f})` };
    if (/FastAPI\(/.test(t)) return { dir, cmd: `python3 -m uvicorn ${mod}:${(/(\w+)\s*=\s*FastAPI\(/.exec(t) || [])[1] || 'app'} --host 127.0.0.1 --port $PORT --reload`, why: `a FastAPI app (${dir ? dir + '/' : ''}${f})` };
    if (/Flask\(/.test(t)) return { dir, cmd: `python3 -m flask --app ${mod} run --host 127.0.0.1 --port $PORT --debug`, why: `a Flask app (${dir ? dir + '/' : ''}${f})` };
  }
  if (has(d, 'Gemfile') && has(d, 'config.ru')) return { dir, cmd: 'bundle exec rackup -o 127.0.0.1 -p $PORT', why: `a Ruby app${where}` };
  if (has(d, 'artisan')) return { dir, cmd: 'php artisan serve --host 127.0.0.1 --port $PORT', why: `a Laravel app${where}` };
  if (has(d, 'hugo.toml') || has(d, 'config.toml') && has(d, 'content')) return { dir, cmd: 'hugo server --bind 127.0.0.1 --port $PORT', why: `a Hugo site${where}` };
  if (has(d, 'index.html')) return { dir, cmd: 'python3 -m http.server $PORT --bind 127.0.0.1', why: `a website (${dir ? dir + '/' : ''}index.html)` };
  if (has(d, 'index.php')) return { dir, cmd: 'php -S 127.0.0.1:$PORT', why: `a PHP site${where}` };
  return null;
}
export function detectPreview(cwd, p) {
  if (p?.preview_cmd?.trim()) return { dir: '', cmd: p.preview_cmd.trim(), why: 'the preview command in project settings' };
  for (const dir of PREVIEW_DIRS) { const r = detectIn(cwd, dir); if (r) return r; }
  // One level down for monorepos (packages/web, apps/site…).
  for (const top of ['apps', 'packages', 'services']) {
    let subs = []; try { subs = fs.readdirSync(path.join(cwd, top), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => `${top}/${x.name}`); } catch {}
    for (const dir of subs) { const r = detectIn(cwd, dir); if (r) return r; }
  }
  return null;
}
export const previewCommand = (cwd, p) => detectPreview(cwd, p)?.cmd || '';
function previewState(key) {
  const v = previews.get(key);
  if (v) return { running: true, proxyPort: v.proxyPort, port: v.port, cmd: v.cmd, why: v.why, dir: v.dir, out: v.out.slice(-4000) };
  const c = threadCode(key), d = c && detectPreview(c.cwd, c.p);
  return { running: false, ...(d ? { cmd: d.cmd, why: d.why, dir: d.dir } : {}) };
}
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
let proxyHook = null; // set by server.js: (targetPort) => proxyPort
export function setPreviewProxy(fn) { proxyHook = fn; }
export async function startPreview(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  if (previews.has(key)) return previewState(key);
  const det = detectPreview(c.cwd, c.p), cmd = det?.cmd;
  if (!cmd) throw Object.assign(new Error('No way to start this app found. Set a preview command in the project settings.'), { status: 400 });
  const port = await freePort();
  const proc = spawn('bash', ['-lc', cmd], { cwd: path.join(c.cwd, det.dir), env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', BROWSER: 'none' }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const v = { proc, port, cmd, why: det.why, dir: det.dir, out: '', started: Date.now(), proxyPort: null };
  const add = (d) => { v.out = (v.out + d).slice(-20000); };
  proc.stdout.on('data', add); proc.stderr.on('data', add);
  proc.on('close', () => { if (previews.get(key) === v) { previews.delete(key); v.closeProxy?.(); broadcast('code_changed', { thread: key }); } });
  previews.set(key, v);
  // Dev servers that ignore $PORT print their own address: follow it.
  const watchPort = (d) => { const m = /(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/.exec(String(d)); if (m && Number(m[1]) !== v.port) { v.port = Number(m[1]); v.retarget?.(v.port); } };
  proc.stdout.on('data', watchPort); proc.stderr.on('data', watchPort);
  if (proxyHook) Object.assign(v, await proxyHook(() => v.port));
  broadcast('code_changed', { thread: key });
  return previewState(key);
}
export function stopPreview(key) {
  const v = previews.get(key); if (!v) return;
  previews.delete(key);
  try { process.kill(-v.proc.pid, 'SIGTERM'); } catch {}
  v.closeProxy?.();
  broadcast('code_changed', { thread: key });
}
export function stopAll() { for (const k of [...previews.keys()]) stopPreview(k); for (const t of terms.values()) t.proc.kill(); }

// ---------- terminal ----------
// A real shell (bin/term-pty.py gives it a terminal) in the thread's folder; output is kept so you can come back to it.
const terms = new Map(); // thread -> { proc, buf, listeners:Set }
const PTY = path.join(path.dirname(new URL(import.meta.url).pathname), 'bin', 'term-pty.py');
export function terminal(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  let t = terms.get(key);
  if (t) return t;
  const proc = spawn('/usr/bin/python3', [PTY], { cwd: c.cwd, env: { ...process.env, TERM: 'xterm-256color', PS1: '\\[\\e[36m\\]\\W\\[\\e[0m\\] $ ' }, stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
  t = { proc, buf: '', listeners: new Set(), idle: null };
  const out = (d) => { const s = d.toString('utf8'); t.buf = (t.buf + s).slice(-200_000); for (const l of t.listeners) l(s); };
  proc.stdout.on('data', out); proc.stderr.on('data', out);
  proc.on('close', () => { terms.delete(key); for (const l of t.listeners) l(null); });
  terms.set(key, t);
  return t;
}
export function termInput(key, data) { const t = terms.get(key); if (t) t.proc.stdin.write(String(data)); }
export function termResize(key, cols, rows) { const t = terms.get(key); if (t) t.proc.stdio[3].write(JSON.stringify({ cols: Math.max(20, Math.min(400, cols | 0)), rows: Math.max(5, Math.min(200, rows | 0)) }) + '\n'); }
export function termClose(key) { terms.get(key)?.proc.kill(); }

// ---------- live updates ----------
const pendingChange = new Map();
export function changedNow(key, file) { broadcast('code_changed', { thread: key, ...(file ? { file } : {}) }); }
// Called as a bot's tools finish: tell the browser to refresh the panel, at most twice a second per thread.
const pendingFiles = new Map();
export function changedSoon(key, file) {
  if (file) pendingFiles.set(key, file);
  if (pendingChange.has(key)) return;
  pendingChange.set(key, setTimeout(() => { pendingChange.delete(key); const f = pendingFiles.get(key); pendingFiles.delete(key); changedNow(key, f); }, 500));
}

// ---------- GitHub: link a repo, and its About box (description, stars, releases, contributors, languages) ----------
const ghSlug = (remote) => { const m = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(remote || ''); return m ? `${m[1]}/${m[2]}` : null; };
// The token comes from git's own credential helper (the same one git push uses); it never leaves the server.
async function ghToken() {
  return new Promise((res) => {
    const p = execFile('git', ['credential', 'fill'], { timeout: 5000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, out) => res(err ? null : (/^password=(.+)$/m.exec(out) || [])[1] || null));
    p.stdin.end('protocol=https\nhost=github.com\n\n');
  });
}
async function ghGet(pathname, token) {
  const r = await fetch('https://api.github.com' + pathname, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Nimbus', ...(token ? { authorization: 'Bearer ' + token } : {}) }, signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw Object.assign(new Error(r.status === 404 ? 'Repo not found on GitHub (or no access)' : `GitHub said ${r.status}`), { status: r.status });
  return r.json();
}
export async function connectGithub(projectId, url) {
  const p = projectRow(projectId);
  if (!isCode(p)) throw Object.assign(new Error('Not a code project'), { status: 400 });
  url = String(url || '').trim().replace(/\/$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) url = 'https://github.com/' + url;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?$/.test(url)) throw Object.assign(new Error('Paste a GitHub link like https://github.com/owner/repo'), { status: 400 });
  const dir = repoPath(p);
  if ((await tryGit(dir, ['remote'])).split('\n').includes('origin')) await git(dir, ['remote', 'set-url', 'origin', url]); else await git(dir, ['remote', 'add', 'origin', url]);
  await git(dir, ['fetch', 'origin'], { timeout: 600_000 });
  const def = ((await tryGit(dir, ['ls-remote', '--symref', 'origin', 'HEAD'])).match(/refs\/heads\/(\S+)\s+HEAD/) || [])[1] || 'main';
  // A brand-new local repo (only Nimbus's Start commit, nothing changed) simply becomes the GitHub code.
  const count = Number((await tryGit(dir, ['rev-list', '--count', 'HEAD'])).trim() || 0);
  const dirty = (await tryGit(dir, ['status', '--porcelain'])).trim();
  // Thread branches made before linking sit on that Start commit too; untouched ones move along with it.
  const old = (await tryGit(dir, ['rev-parse', 'HEAD'])).trim();
  const wts = q("SELECT * FROM threads WHERE project_id=? AND archived=0 AND worktree IS NOT NULL AND worktree<>''").all(p.id);
  const fresh = [];
  for (const t of wts) { const h = (await tryGit(t.worktree, ['rev-parse', 'HEAD'])).trim(), d = (await tryGit(t.worktree, ['status', '--porcelain'])).trim(); fresh.push(h === old && !d ? t : null); }
  let took = false;
  if (count <= 1 && !dirty && fresh.every(Boolean)) {
    for (const t of fresh) await git(t.worktree, ['reset', '--hard', `origin/${def}`]);
    await git(dir, ['checkout', '-B', def, `origin/${def}`]);
    const cur = (await tryGit(dir, ['branch', '--format=%(refname:short)'])).split('\n').filter((b) => b && b !== def);
    for (const b of cur) if (!fresh.some((t) => t.branch === b)) await tryGit(dir, ['branch', '-D', b]);
    took = true;
  } else await tryGit(dir, ['branch', '--set-upstream-to', `origin/${def}`]);
  ghCache.delete(ghSlug(url));
  return { url, branch: def, replaced: took };
}
const ghCache = new Map();
export async function githubAbout(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const slug = ghSlug((await tryGit(c.repo, ['remote', 'get-url', 'origin'])).trim());
  if (!slug) return { linked: false };
  const hit = ghCache.get(slug);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  const tok = await ghToken();
  const [r, rel, contrib, langs] = await Promise.all([ghGet(`/repos/${slug}`, tok), ghGet(`/repos/${slug}/releases?per_page=1`, tok).catch(() => []),
    ghGet(`/repos/${slug}/contributors?per_page=12`, tok).catch(() => []), ghGet(`/repos/${slug}/languages`, tok).catch(() => ({}))]);
  const total = Object.values(langs).reduce((s, n) => s + n, 0);
  const color = (n) => Object.values(LANG).find((l) => l.name === n)?.color || '#8b8b8b';
  const v = { linked: true, slug, url: r.html_url, description: r.description || '', homepage: r.homepage || '', topics: r.topics || [], private: r.private,
    stars: r.stargazers_count, watching: r.subscribers_count, forks: r.forks_count, issues: r.open_issues_count, defaultBranch: r.default_branch, pushedAt: r.pushed_at,
    release: rel[0] ? { name: rel[0].name || rel[0].tag_name, tag: rel[0].tag_name, url: rel[0].html_url, at: rel[0].published_at } : null,
    contributors: (Array.isArray(contrib) ? contrib : []).map((x) => ({ login: x.login, avatar: x.avatar_url, url: x.html_url, commits: x.contributions })),
    languages: Object.entries(langs).sort((a, b) => b[1] - a[1]).map(([name, bytes]) => ({ name, bytes, color: color(name), pct: Math.round(bytes / total * 1000) / 10 })) };
  ghCache.set(slug, { at: Date.now(), v });
  return v;
}

// ---------- built-in editor: list, read and save files in the thread's folder ----------
function safePath(cwd, rel) {
  rel = String(rel || '').replace(/^\/+/, '');
  const root = fs.realpathSync(cwd), full = path.resolve(root, rel);
  if (!rel || (full !== root && !full.startsWith(root + path.sep)) || /(^|[\/\\])\.git([\/\\]|$)/.test(rel)) throw Object.assign(new Error('That path is outside the project'), { status: 400 });
  // Symlinks may not lead out of the project.
  let real = full; try { real = fs.realpathSync(full); } catch { try { real = path.join(fs.realpathSync(path.dirname(full)), path.basename(full)); } catch {} }
  if (real !== root && !real.startsWith(root + path.sep)) throw Object.assign(new Error('That path is outside the project'), { status: 400 });
  return full;
}
export function listFiles(key) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const files = String(require_ls(c.cwd)).split('\0').filter(Boolean).filter((f) => !/(^|\/)node_modules\//.test(f)).slice(0, 20000).sort();
  return { root: c.cwd, files };
}
export function readFile(key, rel) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const full = safePath(c.cwd, rel);
  const st = fs.statSync(full);
  if (!st.isFile()) throw Object.assign(new Error('Not a file'), { status: 400 });
  if (st.size > 2_000_000) return { path: rel, size: st.size, mtime: st.mtimeMs, tooBig: true };
  const buf = fs.readFileSync(full);
  if (buf.subarray(0, 8000).includes(0)) return { path: rel, size: st.size, mtime: st.mtimeMs, binary: true };
  return { path: rel, size: st.size, mtime: st.mtimeMs, text: buf.toString('utf8') };
}
export function writeFile(key, rel, text, mtime) {
  const c = threadCode(key); if (!c) throw Object.assign(new Error('Not a code thread'), { status: 404 });
  const full = safePath(c.cwd, rel);
  if (typeof text !== 'string' || text.length > 2_000_000) throw Object.assign(new Error('File too big'), { status: 400 });
  // Someone (usually the bot) saved it after you opened it: don't overwrite their work blindly.
  if (mtime && fs.existsSync(full) && Math.abs(fs.statSync(full).mtimeMs - mtime) > 1) throw Object.assign(new Error('The file changed since you opened it. Reload it first.'), { status: 409 });
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  changedNow(key, rel);
  return { path: rel, mtime: fs.statSync(full).mtimeMs };
}
