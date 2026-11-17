// Nimbus Code, the rest of the IDE: pull requests with checks and review comments, GitHub issues as tasks,
// search in files, history (commit diff, revert, blame), merge-conflict helper, problems (lint/type errors),
// setup command and secrets per project, tests after every turn, best-of-2 attempts.
// All local git / GitHub API work: no Claude usage, except the buttons that send work to the bot.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { q, getSetting, setSetting, Capped } from './db.js';
import { addMessage } from './runner.js';
import { broadcast } from './events.js';
import { redact } from './redact.js';
import * as TH from './threads.js';
import * as Code from './code.js';

const err = (msg, status = 400) => Object.assign(new Error(msg), { status });
const need = (key) => { const c = Code.threadCode(key); if (!c) throw err('Not a code thread', 404); return c; };
const git = (cwd, args, o) => Code.git(cwd, args, o);
const tryGit = (cwd, args, o) => Code.git(cwd, args, o).catch(() => '');
const clip = (s, n) => (s.length > n ? s.slice(-n) : s);
function sh(cmd, cwd, env, timeout = 180_000) {
  return new Promise((ok) => {
    const p = spawn('bash', ['-lc', cmd], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; const add = (d) => { out = clip(out + d, 400_000); };
    p.stdout.on('data', add); p.stderr.on('data', add);
    const t = setTimeout(() => p.kill('SIGKILL'), timeout);
    p.on('close', (code) => { clearTimeout(t); ok({ code, out: redact(out.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '')) }); });
    p.on('error', (e) => { clearTimeout(t); ok({ code: -1, out: e.message }); });
  });
}

// ---------- project settings: setup command, secrets, tests after every turn, lint ----------
function getSettings(pid) {
  const s = Code.codeSettings(pid); let env = {}; try { env = JSON.parse(s.env || '{}'); } catch (e) { console.error('code env of project', pid, e.message); }
  return { setup_cmd: s.setup_cmd || '', auto_test: !!s.auto_test, lint_cmd: s.lint_cmd || '', env: Object.keys(env) }; // values never go back to the browser
}
function putSettings(pid, b) {
  const cur = Code.codeSettings(pid); let env = {}; try { env = JSON.parse(cur.env || '{}'); } catch (e) { console.error('code env of project', pid, e.message); }
  // env: { NAME: "value" } sets, { NAME: null } removes, a missing name is left as it was.
  for (const [k, v] of Object.entries(b.env || {})) { if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw err(`Bad variable name: ${k}`); if (v === null) delete env[k]; else env[k] = String(v); }
  q(`INSERT INTO code_settings (project_id, setup_cmd, env, auto_test, lint_cmd) VALUES (?,?,?,?,?)
     ON CONFLICT(project_id) DO UPDATE SET setup_cmd=excluded.setup_cmd, env=excluded.env, auto_test=excluded.auto_test, lint_cmd=excluded.lint_cmd`)
    .run(pid, String(b.setup_cmd ?? cur.setup_cmd ?? '').trim(), JSON.stringify(env), b.auto_test === undefined ? cur.auto_test : b.auto_test ? 1 : 0, String(b.lint_cmd ?? cur.lint_cmd ?? '').trim());
  return getSettings(pid);
}
// A new branch folder has no installed packages: run the project's setup command there (or a sensible default).
const setups = new Capped(300); // thread -> { running, ok, cmd, out, at }
function defaultSetup(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) return has('pnpm-lock.yaml') ? 'pnpm install --frozen-lockfile' : has('yarn.lock') ? 'yarn install --frozen-lockfile' : has('package-lock.json') ? 'npm ci --no-audit --no-fund' : 'npm install --no-audit --no-fund';
  if (has('requirements.txt')) return 'python3 -m venv .venv && .venv/bin/pip install -q -r requirements.txt';
  if (has('pyproject.toml')) return 'python3 -m venv .venv && .venv/bin/pip install -q -e .';
  return '';
}
async function runSetup(key, dir, p) {
  const cmd = Code.codeSettings(p.id).setup_cmd || defaultSetup(dir);
  if (!cmd || setups.get(key)?.running) return setups.get(key) || null;
  const st = { running: true, cmd, out: '', at: Date.now() }; setups.set(key, st); broadcast('code_changed', { thread: key });
  const r = await sh(cmd, dir, Code.codeEnv(p.id, { CI: '1' }), 15 * 60_000);
  Object.assign(st, { running: false, ok: r.code === 0, out: clip(r.out, 30_000), secs: Math.round((Date.now() - st.at) / 1000) });
  broadcast('code_changed', { thread: key });
  if (!st.ok) addMessage(key, 'system', 'note', `⚠ Setup for this branch failed (\`${cmd}\`, exit ${r.code}). Tests and preview may not work until it's fixed. See Code panel → Overview.`);
  return st;
}
Code.hooks.threadReady.push((key, dir, p) => { runSetup(key, dir, p).catch(() => {}); });

// Tests after every turn that changed files (project setting). Free: runs locally.
Code.hooks.turnDone.push((runId) => {
  const cp = q('SELECT thread FROM checkpoints WHERE run_id=?').get(runId); if (!cp) return;
  const c = Code.threadCode(cp.thread); if (!c || !Code.codeSettings(c.p.id).auto_test || !Code.testCommand(c.cwd, c.p)) return;
  setTimeout(() => Code.runTests(cp.thread).then((r) => {
    const tail = r.out.split('\n').slice(-40).join('\n');
    addMessage(cp.thread, 'system', 'testrun', { ok: r.ok, code: r.code, secs: r.secs, cmd: r.cmd, out: r.ok ? '' : clip(tail, 6000), runId });
  }).catch(() => {}), 500);
});

// ---------- search ----------
async function search(key, text, { regex = false, cased = false } = {}) {
  const { cwd } = need(key);
  text = String(text || ''); if (text.length < 2) return { hits: [] };
  const out = await tryGit(cwd, ['grep', '-n', '-I', '--no-color', '--untracked', '--exclude-standard', ...(regex ? ['-E'] : ['-F']), ...(cased ? [] : ['-i']), '-e', text, '--', '.', ':!node_modules', ':!*.min.js', ':!package-lock.json'], { max: 4 << 20, timeout: 20_000 });
  const hits = [];
  for (const l of out.split('\n')) { const m = /^(.+?):(\d+):(.*)$/.exec(l); if (m) hits.push({ file: m[1], line: Number(m[2]), text: m[3].slice(0, 300) }); if (hits.length >= 500) break; }
  return { hits, more: hits.length >= 500 };
}

// ---------- history ----------
async function log(key, file) {
  const { cwd } = need(key);
  const out = await tryGit(cwd, ['log', '-n', '200', '--format=%H%x1f%h%x1f%an%x1f%at%x1f%s%x1f%P', ...(file ? ['--follow', '--', file] : [])]);
  return { commits: out.trim().split('\n').filter(Boolean).map((l) => { const [sha, short, author, at, subject, parents] = l.split('\x1f'); return { sha, short, author, at: Number(at), subject, merge: parents.split(' ').length > 1 }; }) };
}
async function revert(key, sha) {
  const { cwd } = need(key);
  if (!/^[0-9a-f]{7,40}$/.test(String(sha))) throw err('Bad commit');
  if ((await git(cwd, ['status', '--porcelain', '--untracked-files=no'])).trim()) throw err('Commit or undo your current changes first', 409);
  const merge = (await git(cwd, ['rev-list', '--parents', '-n', '1', sha])).trim().split(' ').length > 2;
  try { await git(cwd, ['revert', '--no-edit', ...(merge ? ['-m', '1'] : []), sha], { env: await Code.authorEnv(cwd) }); }
  catch { await tryGit(cwd, ['revert', '--abort']); throw err('That commit can’t be reverted cleanly (later changes touch the same lines). Ask the bot to revert it.', 409); }
  Code.changedNow(key); return { ok: true };
}
async function blame(key, file) {
  const { cwd } = need(key);
  const out = await git(cwd, ['blame', '--line-porcelain', '--', String(file)], { max: 16 << 20 }).catch(() => { throw err('No history for that file yet'); });
  const lines = [], info = {}; let cur = null;
  for (const l of out.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)/.exec(l);
    if (h) { cur = info[h[1]] ||= { sha: h[1].slice(0, 7) }; cur.n = Number(h[2]); continue; }
    if (!cur) continue;
    if (l.startsWith('author ')) cur.author = l.slice(7); else if (l.startsWith('author-time ')) cur.at = Number(l.slice(12)); else if (l.startsWith('summary ')) cur.summary = l.slice(8);
    else if (l.startsWith('\t')) lines.push({ sha: cur.sha, author: cur.author, at: cur.at, summary: cur.summary, text: l.slice(1) });
  }
  return { file, lines: lines.slice(0, 20000) };
}

// ---------- merge conflicts ----------
// Bring the base branch into this branch's folder; conflicts stay there for you (or the bot) to pick per section.
async function syncBase(key) {
  const c = need(key); if (!c.t.branch) throw err('This chat works on the main branch');
  if ((await git(c.cwd, ['status', '--porcelain', '--untracked-files=no'])).trim()) throw err('Commit your changes on this branch first', 409);
  try { await git(c.cwd, ['merge', '--no-ff', '-m', `Merge ${c.t.base} into ${c.t.branch}`, c.t.base], { env: await Code.authorEnv(c.cwd) }); Code.changedNow(key); return { ok: true, conflicts: [] }; }
  catch { const files = await conflictFiles(c.cwd); if (!files.length) { await tryGit(c.cwd, ['merge', '--abort']); throw err('The merge failed for another reason'); } Code.changedNow(key); return { ok: false, conflicts: files }; }
}
const conflictFiles = async (cwd) => (await tryGit(cwd, ['diff', '--name-only', '--diff-filter=U'])).trim().split('\n').filter(Boolean);
function parseConflicts(text) {
  const parts = []; let buf = [], mode = null, ours = [], theirs = [], labels = {};
  for (const line of text.split('\n')) {
    if (mode === null && line.startsWith('<<<<<<< ')) { parts.push({ t: 'text', s: buf.join('\n'), lines: buf }); buf = []; mode = 'ours'; ours = []; theirs = []; labels = { ours: line.slice(8) }; continue; }
    if (mode === 'ours' && line.startsWith('||||||| ')) { mode = 'base'; continue; }
    if ((mode === 'ours' || mode === 'base') && line.startsWith('=======')) { mode = 'theirs'; continue; }
    if (mode === 'theirs' && line.startsWith('>>>>>>> ')) { labels.theirs = line.slice(8); parts.push({ t: 'conflict', ours: ours.join('\n'), theirs: theirs.join('\n'), o: ours, th: theirs, labels }); mode = null; continue; }
    if (mode === 'ours') ours.push(line); else if (mode === 'theirs') theirs.push(line); else if (mode === null) buf.push(line);
  }
  parts.push({ t: 'text', s: buf.join('\n'), lines: buf });
  return parts;
}
async function conflicts(key) {
  const c = need(key), files = await conflictFiles(c.cwd);
  const merging = fs.existsSync(path.join((await tryGit(c.cwd, ['rev-parse', '--git-dir'])).trim().replace(/^(?!\/)/, c.cwd + '/'), 'MERGE_HEAD'));
  return { merging, base: c.t.base, branch: c.t.branch, files: files.map((f) => { let t = ''; try { t = fs.readFileSync(path.join(c.cwd, f), 'utf8'); } catch {} return { file: f, parts: parseConflicts(t).map(({ lines, o, th, ...x }) => x) }; }) };
}
async function resolve(key, file, picks) {
  const c = need(key); const full = path.join(c.cwd, file);
  if (!(await conflictFiles(c.cwd)).includes(file)) throw err('That file has no conflicts');
  const parts = parseConflicts(fs.readFileSync(full, 'utf8')); let i = 0;
  const text = parts.flatMap((p) => { if (p.t === 'text') return p.lines; const k = picks[i++]; return k === 'theirs' ? p.th : k === 'both' ? [...p.o, ...p.th] : p.o; }).join('\n');
  fs.writeFileSync(full, text); await git(c.cwd, ['add', '--', file]); Code.changedNow(key, file);
  return { ok: true, left: (await conflictFiles(c.cwd)).length };
}
async function finishMerge(key) {
  const c = need(key); if ((await conflictFiles(c.cwd)).length) throw err('Some files still have conflicts', 409);
  await git(c.cwd, ['commit', '--no-edit'], { env: await Code.authorEnv(c.cwd) }); Code.changedNow(key); return { ok: true };
}

// ---------- problems (lint / type errors) ----------
async function has(cmd) { return (await sh(`command -v ${cmd}`, '/', process.env, 5000)).code === 0; }
async function lintCommand(cwd, p) {
  const own = Code.codeSettings(p.id).lint_cmd; if (own) return own;
  const f = (x) => fs.existsSync(path.join(cwd, x));
  let pk = {}; try { pk = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')); } catch {}
  const cmds = [];
  if (f('tsconfig.json') && fs.existsSync(path.join(cwd, 'node_modules/.bin/tsc'))) cmds.push('node_modules/.bin/tsc --noEmit --pretty false -p .');
  if (fs.existsSync(path.join(cwd, 'node_modules/.bin/eslint'))) cmds.push('node_modules/.bin/eslint -f unix .');
  else if (pk.scripts?.lint) cmds.push('npm run -s lint');
  if (f('pyproject.toml') || f('requirements.txt') || f('setup.py')) { if (await has('ruff')) cmds.push('ruff check --output-format concise .'); else if ((await sh('python3 -m pyflakes --version', '/', process.env, 5000)).code === 0) cmds.push('python3 -m pyflakes .'); }
  if (f('go.mod') && await has('go')) cmds.push('go vet ./...');
  return cmds.join(' ; ');
}
async function problems(key) {
  const c = need(key), cmd = await lintCommand(c.cwd, c.p);
  if (!cmd) return { cmd: '', problems: [], note: 'No linter or type checker found. Set a lint command in the project settings (e.g. npx eslint -f unix .).' };
  const r = await sh(cmd, c.cwd, Code.codeEnv(c.p.id, { CI: '1', FORCE_COLOR: '0' }), 5 * 60_000);
  const list = [];
  for (const l of r.out.split('\n')) {
    let m = /^(?:\.\/)?([^\s:(][^:(]*?)\((\d+),(\d+)\):\s*(.+)$/.exec(l) || /^(?:\.\/)?([^\s:][^:]*?):(\d+):(?:(\d+):)?\s*(.+)$/.exec(l);
    if (!m) continue;
    const file = m[1].startsWith(c.cwd) ? path.relative(c.cwd, m[1]) : m[1];
    if (!fs.existsSync(path.join(c.cwd, file))) continue;
    list.push({ file, line: Number(m[2]), col: Number(m[3] || 0), msg: m[4].slice(0, 400), level: /warn/i.test(m[4]) ? 'warning' : 'error' });
    if (list.length >= 1000) break;
  }
  return { cmd, ok: r.code === 0, problems: list, out: list.length ? '' : clip(r.out, 6000) };
}

// ---------- GitHub: pull request, checks, reviews, issues ----------
async function slugOf(c) { const s = Code.ghSlug((await tryGit(c.repo, ['remote', 'get-url', 'origin'])).trim()); if (!s) throw err('Link this project to GitHub first (project settings)'); return s; }
async function ghSend(method, pathname, body) {
  const tok = await Code.ghToken(); if (!tok) throw err('No GitHub login on this server. Ask Github Manager to set up git credentials.');
  const r = await fetch('https://api.github.com' + pathname, { method, headers: { accept: 'application/vnd.github+json', 'user-agent': 'Nimbus', authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw err(`GitHub said ${r.status}: ${d.message || ''}${d.errors?.[0]?.message ? ' — ' + d.errors[0].message : ''}`, r.status);
  return d;
}
const gh = async (p) => Code.ghGet(p, await Code.ghToken());
async function prInfo(key) {
  const c = need(key), slug = await slugOf(c), branch = c.t.branch || (await git(c.cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
  const owner = slug.split('/')[0];
  const prs = await gh(`/repos/${slug}/pulls?state=all&head=${encodeURIComponent(owner + ':' + branch)}&per_page=1`);
  const pr = prs[0]; if (!pr) return { slug, branch, base: c.t.base, pr: null };
  const [runs, status, rc, ic, reviews] = await Promise.all([
    gh(`/repos/${slug}/commits/${pr.head.sha}/check-runs?per_page=50`).catch(() => ({ check_runs: [] })),
    gh(`/repos/${slug}/commits/${pr.head.sha}/status`).catch(() => ({ statuses: [] })),
    gh(`/repos/${slug}/pulls/${pr.number}/comments?per_page=100`).catch(() => []),
    gh(`/repos/${slug}/issues/${pr.number}/comments?per_page=100`).catch(() => []),
    gh(`/repos/${slug}/pulls/${pr.number}/reviews?per_page=50`).catch(() => [])]);
  const checks = [...(runs.check_runs || []).map((r) => ({ name: r.name, state: r.status !== 'completed' ? 'pending' : r.conclusion, url: r.html_url, summary: (r.output?.title || '') + (r.output?.summary ? '\n' + r.output.summary : '') })),
    ...(status.statuses || []).map((s) => ({ name: s.context, state: s.state === 'pending' ? 'pending' : s.state === 'success' ? 'success' : 'failure', url: s.target_url, summary: s.description || '' }))];
  const comments = [...rc.map((x) => ({ who: x.user?.login, body: x.body, file: x.path, line: x.line || x.original_line, at: x.created_at, url: x.html_url })),
    ...ic.map((x) => ({ who: x.user?.login, body: x.body, at: x.created_at, url: x.html_url })),
    ...reviews.filter((r) => r.body).map((r) => ({ who: r.user?.login, body: r.body, state: r.state, at: r.submitted_at, url: r.html_url }))].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  return { slug, branch, base: c.t.base, pr: { number: pr.number, title: pr.title, url: pr.html_url, state: pr.merged_at ? 'merged' : pr.state, draft: pr.draft, mergeable: pr.mergeable_state }, checks, comments };
}
async function openPr(key, { title, body, draft }) {
  const c = need(key); if (!c.t.branch) throw err('Pull requests need a chat with its own branch');
  const slug = await slugOf(c);
  if ((await git(c.cwd, ['status', '--porcelain', '--untracked-files=no'])).trim()) throw err('Commit your changes first', 409);
  await Code.push(key);
  const base = c.t.base;
  const pr = await ghSend('POST', `/repos/${slug}/pulls`, { title: String(title || c.t.title || c.t.branch).slice(0, 200), body: String(body || ''), head: c.t.branch, base, draft: !!draft });
  return { number: pr.number, url: pr.html_url };
}
function fixMessage(info, which) {
  const bad = info.checks.filter((x) => ['failure', 'timed_out', 'cancelled', 'action_required', 'error'].includes(x.state));
  const parts = [`Pull request #${info.pr.number} (${info.pr.url}) needs work.`];
  if (which !== 'comments' && bad.length) parts.push('Failing checks:\n' + bad.map((x) => `- ${x.name}: ${x.summary.slice(0, 1500) || '(no summary)'}${x.url ? ` (${x.url})` : ''}`).join('\n'));
  if (which !== 'checks' && info.comments.length) parts.push('Review comments:\n' + info.comments.slice(-20).map((x) => `- ${x.who}${x.file ? ` on ${x.file}${x.line ? ':' + x.line : ''}` : ''}: ${x.body.slice(0, 1200)}`).join('\n'));
  parts.push('Fix them on this branch and run the tests. Reply with what you changed for each item. Don’t push; I’ll push from Nimbus.');
  return parts.join('\n\n');
}
async function issues(key) {
  const c = need(key), slug = await slugOf(c);
  const list = await gh(`/repos/${slug}/issues?state=open&per_page=50&sort=updated`);
  return { slug, issues: list.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, labels: i.labels.map((l) => l.name), who: i.user?.login, at: i.updated_at, url: i.html_url, comments: i.comments })) };
}

// ---------- start a task: from an issue, or a second attempt at the same task ----------
async function newTask(c, botId, title, text, postToThread) {
  const key = TH.createThread({ botId, title, projectId: c.p.id });
  try { await Code.setupThread(Number(key.slice(2)), true); } catch (e) { TH.deleteThread(Number(key.slice(2))); throw err(`Couldn't make the branch: ${e.message}`); }
  broadcast('state_changed', {});
  postToThread(key, text);
  return key;
}
async function issueTask(key, number, botId, postToThread) {
  const c = need(key), slug = await slugOf(c);
  const i = await gh(`/repos/${slug}/issues/${Number(number)}`);
  const cm = i.comments ? await gh(`/repos/${slug}/issues/${i.number}/comments?per_page=30`).catch(() => []) : [];
  const text = `Work on GitHub issue #${i.number}: ${i.title}\n${i.html_url}\n\n${(i.body || '(no description)').slice(0, 12000)}${cm.length ? '\n\nComments:\n' + cm.map((x) => `- ${x.user?.login}: ${x.body.slice(0, 1500)}`).join('\n') : ''}\n\nFix it on this branch, add or update tests, and reply with what you changed. When I open the pull request from Nimbus I'll mention "Fixes #${i.number}".`;
  return { key: await newTask(c, botId || c.t.bot_id, `#${i.number} ${i.title}`.slice(0, 80), text, postToThread) };
}
async function another(key, botId, postToThread) {
  const c = need(key);
  const first = q("SELECT body FROM messages WHERE thread=? AND author='user' ORDER BY id LIMIT 1").get(key);
  if (!first?.body) throw err('This chat has no task to try again');
  const nk = await newTask(c, botId || c.t.bot_id, `${(c.t.title || 'task').replace(/ \(try \d\)$/, '')} (try 2)`.slice(0, 80), first.body, postToThread);
  setSetting('code_pair:' + nk, key); setSetting('code_pair:' + key, nk);
  return { key: nk };
}
async function branchSummary(key) {
  const c = Code.threadCode(key); if (!c) return null;
  const range = c.t.base ? `${c.t.base}...HEAD` : 'HEAD';
  const [committed, working] = await Promise.all([tryGit(c.cwd, ['diff', '--numstat', range]), tryGit(c.cwd, ['diff', '--numstat', 'HEAD'])]);
  const files = new Map();
  for (const l of (committed + '\n' + working).split('\n').filter(Boolean)) { const [a, d, ...f] = l.split('\t'); const k = f.join('\t'), o = files.get(k) || { file: k, add: 0, del: 0 }; o.add += Number(a) || 0; o.del += Number(d) || 0; files.set(k, o); }
  const t = q('SELECT title, bot_id FROM threads WHERE id=?').get(c.t.id);
  const run = q("SELECT status, cost_usd FROM runs WHERE thread=? ORDER BY id DESC LIMIT 1").get(key);
  const cost = q('SELECT SUM(cost_usd) AS c FROM runs WHERE thread=?').get(key).c || 0;
  return { key, title: t.title, bot: t.bot_id, branch: c.t.branch, files: [...files.values()], add: [...files.values()].reduce((s, f) => s + f.add, 0), del: [...files.values()].reduce((s, f) => s + f.del, 0), busy: ['queued', 'running'].includes(run?.status), cost: Math.round(cost * 100) / 100 };
}

// ---------- routes ----------
export function registerCode2(route, { json, body, postToThread }) {
  const T = (fn) => async (req, res, p, url) => { try { json(res, 200, await fn(decodeURIComponent(p.thread || ''), req, url, p)); } catch (e) { json(res, e.status || 500, { error: e.message }); } };
  route('GET', '/api/code2/project/:id/settings', (req, res, p) => json(res, 200, getSettings(Number(p.id))));
  route('PUT', '/api/code2/project/:id/settings', async (req, res, p) => { try { json(res, 200, putSettings(Number(p.id), await body(req))); } catch (e) { json(res, e.status || 500, { error: e.message }); } });
  route('GET', '/api/code2/:thread/status', T(async (k) => { const c = need(k); return { conflicts: (await conflictFiles(c.cwd)).length, setup: setups.get(k) || null, setupCmd: Code.codeSettings(c.p.id).setup_cmd || defaultSetup(c.cwd), settings: getSettings(c.p.id), pair: getSetting('code_pair:' + k) || null }; }));
  route('POST', '/api/code2/:thread/setup', T(async (k) => { const c = need(k); runSetup(k, c.cwd, c.p); return { ok: true }; }));
  route('GET', '/api/code2/:thread/search', T((k, req, url) => search(k, url.searchParams.get('q'), { regex: url.searchParams.get('regex') === '1', cased: url.searchParams.get('case') === '1' })));
  route('GET', '/api/code2/:thread/log', T((k, req, url) => log(k, url.searchParams.get('file') || '')));
  route('POST', '/api/code2/:thread/revert', T(async (k, req) => revert(k, (await body(req)).sha)));
  route('GET', '/api/code2/:thread/blame', T((k, req, url) => blame(k, url.searchParams.get('path'))));
  route('POST', '/api/code2/:thread/sync-base', T((k) => syncBase(k)));
  route('GET', '/api/code2/:thread/conflicts', T((k) => conflicts(k)));
  route('POST', '/api/code2/:thread/conflicts/resolve', T(async (k, req) => { const b = await body(req); return resolve(k, String(b.file), b.picks || []); }));
  route('POST', '/api/code2/:thread/conflicts/finish', T((k) => finishMerge(k)));
  route('POST', '/api/code2/:thread/conflicts/abort', T(async (k) => { await git(need(k).cwd, ['merge', '--abort']); Code.changedNow(k); return { ok: true }; }));
  route('GET', '/api/code2/:thread/problems', T((k) => problems(k)));
  route('GET', '/api/code2/:thread/pr', T((k) => prInfo(k)));
  route('POST', '/api/code2/:thread/pr', T(async (k, req) => openPr(k, await body(req))));
  route('POST', '/api/code2/:thread/pr/fix', T(async (k, req) => { const info = await prInfo(k); if (!info.pr) throw err('No pull request yet'); postToThread(k, fixMessage(info, (await body(req)).which)); return { ok: true }; }));
  route('GET', '/api/code2/:thread/issues', T((k) => issues(k)));
  route('POST', '/api/code2/:thread/issue-task', T(async (k, req) => { const b = await body(req); return issueTask(k, b.number, b.botId, postToThread); }));
  route('POST', '/api/code2/:thread/another', T(async (k, req) => another(k, (await body(req)).botId, postToThread)));
  route('GET', '/api/code2/:thread/compare', T(async (k) => { const o = getSetting('code_pair:' + k); return { a: await branchSummary(k), b: o ? await branchSummary(o) : null }; }));
  route('POST', '/api/code2/:thread/keep', T(async (k) => {
    const o = getSetting('code_pair:' + k); if (!o) throw err('No other attempt');
    TH.updateThread(Number(o.slice(2)), { archived: true }); setSetting('code_pair:' + k, ''); setSetting('code_pair:' + o, '');
    addMessage(k, 'system', 'note', 'Kept this attempt; the other one was archived (its branch is still there).'); broadcast('state_changed', {}); return { ok: true };
  }));
}

// Injected into the app preview (server.js proxy). Reports console errors, uncaught errors and failed requests to
// the Nimbus code panel, and when asked, lets you click an element to describe it to the bot.
export const PROBE = `(()=>{if(window.parent===window||window.__nimbusProbe)return;window.__nimbusProbe=1;
const send=(d)=>{try{parent.postMessage(Object.assign({nimbusProbe:1,page:location.pathname},d),'*')}catch{}};
const fmt=(a)=>a.map((x)=>{try{return x instanceof Error?(x.stack||x.message):typeof x==='object'?JSON.stringify(x).slice(0,600):String(x)}catch{return String(x)}}).join(' ').slice(0,2000);
for(const lv of ['error','warn']){const o=console[lv];console[lv]=function(...a){send({kind:'console',level:lv,text:fmt(a)});return o.apply(this,a)}}
addEventListener('error',(e)=>{const t=e.target;if(t&&t!==window&&(t.src||t.href))send({kind:'network',level:'error',text:'Failed to load '+(t.src||t.href)});else send({kind:'error',level:'error',text:(e.message||'Error')+(e.filename?' ('+e.filename.replace(location.origin,'')+':'+e.lineno+')':'')+(e.error&&e.error.stack?'\\n'+e.error.stack:'')})},true);
addEventListener('unhandledrejection',(e)=>send({kind:'error',level:'error',text:'Unhandled promise rejection: '+fmt([e.reason])}));
if(window.fetch){const f=window.fetch;window.fetch=async function(...a){const u=String(a[0]&&a[0].url||a[0]);try{const r=await f.apply(this,a);if(r.status>=400)send({kind:'network',level:'error',text:r.status+' '+((a[1]&&a[1].method)||'GET')+' '+u});return r}catch(err){send({kind:'network',level:'error',text:'Failed '+u+': '+err.message});throw err}}}
const xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){this.addEventListener('loadend',()=>{if(this.status>=400||this.status===0)send({kind:'network',level:'error',text:(this.status||'Failed')+' '+m+' '+u})});return xo.apply(this,arguments)};
let pick=false,box=null;const off=()=>{pick=false;document.documentElement.style.cursor='';if(box){box.remove();box=null}};
addEventListener('message',(e)=>{if(e.data&&'nimbusPick' in e.data){if(e.data.nimbusPick){pick=true;document.documentElement.style.cursor='crosshair'}else off()}});
const sel=(el)=>{const p=[];for(let n=el;n&&n.nodeType===1&&p.length<5;n=n.parentElement){let s=n.tagName.toLowerCase();if(n.id){p.unshift(s+'#'+n.id);break}const c=[...n.classList].filter((x)=>!/^(css|sc|jsx)-/.test(x)).slice(0,2);if(c.length)s+='.'+c.join('.');p.unshift(s)}return p.join(' > ')};
addEventListener('mousemove',(e)=>{if(!pick)return;const r=e.target.getBoundingClientRect();if(!box){box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;border:2px solid #3b82f6;background:rgba(59,130,246,.15);z-index:2147483647;border-radius:3px'}if(!box.isConnected)document.body.append(box);Object.assign(box.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'})},true);
addEventListener('click',(e)=>{if(!pick)return;e.preventDefault();e.stopPropagation();const el=e.target;send({kind:'pick',selector:sel(el),html:el.outerHTML.slice(0,1500),text:(el.innerText||'').trim().slice(0,300)});off()},true);
addEventListener('keydown',(e)=>{if(pick&&e.key==='Escape')off()},true);
send({kind:'load'});})();`;
