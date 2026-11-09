// Nimbus Code screens: the code panel (branch, changes, commits, languages, tests, preview, terminal), the diff
// viewer, the per-turn Changes card, code steps in the live trace, and the code project / thread dialogs.
// Everything here talks to /api/code/* (code.js on the server): local git, no Claude usage.
let X; // helpers from app.js
export function initCode(ctx) { X = ctx; }

const CP = { key: null, info: null, tab: 'changes', loading: false, term: null, es: null, timer: null };
const enc = encodeURIComponent;
const isWide = () => matchMedia('(min-width: 1100px)').matches;

// ---------- which threads are code threads ----------
export function codeProject(key) {
  const t = X.threadOf(key);
  const p = t?.project_id ? X.S.data.projects.find((x) => x.id === t.project_id) : null;
  return p?.kind === 'code' ? { t, p } : null;
}
export const codeProjects = () => X.S.data.projects.filter((p) => p.kind === 'code' && !p.archived);

// ---------- sidebar ----------
// Normal Nimbus sidebar: one row that opens Nimbus Code mode.
export function codeSidebar() {
  const busy = new Set(X.S.data.busyThreads || []);
  const ts = codeThreads();
  return `<div class="side-section code-sec"><button class="code-sec-open" data-code-mode title="Open Nimbus Code">${CODE_ICON}Nimbus Code</button><button class="side-sec-add" data-code-new title="New code project" aria-label="New code project">${X.ICON.plus}</button></div>` + (codeProjects().length ? codeProjects().map((p) => {
    const mine = ts.filter((x) => x.p.id === p.id);
    const open = X.sideOpen['p' + p.id] !== false;
    return `<div class="side-proj top"><button class="side-sub-item proj ${open ? 'open' : ''}" data-proj-toggle="${p.id}">${X.TI.chev}<i class="cm-badge">${X.esc(initials(p.name))}</i><span class="lbl">${X.esc(p.name)}</span>${mine.some((x) => busy.has(x.k)) ? '<i class="code-dot working" title="Working"></i>' : ''}</button><button class="side-more" data-code-menu="${p.id}" aria-label="Project options">${X.TI.dots}</button></div>`
      + (open ? `<div class="side-sub shared">${mine.map((x) => `<button class="side-sub-item code-th" data-open="${x.k}">${X.bot(x.t.bot_id) ? X.avatar(X.bot(x.t.bot_id), 16) : ''}<span class="lbl"><span>${X.esc(x.t.title || 'New thread')}</span><small>${BRANCH_ICON}${X.esc(x.t.branch || x.t.base || 'main')}</small></span>${busy.has(x.k) ? '<i class="code-dot working" title="Working"></i>' : ''}</button>`).join('')}
        <div class="side-sub-add"><button data-cm-new="${p.id}">${X.ICON.plus}<span>New thread</span></button></div></div>` : '');
  }).join('') : `<div class="side-sub-add code-empty"><button data-code-new>${X.ICON.plus}<span>New code project</span></button></div>`);
}
// Nimbus Code mode: every code chat across projects, newest first (like T3 Code).
export const CM = { on: false, draft: null, q: '', settled: true };
const ago = (sec) => { const d = Date.now() / 1000 - sec; return d < 60 ? 'now' : d < 3600 ? Math.floor(d / 60) + 'm' : d < 86400 ? Math.floor(d / 3600) + 'h' : Math.floor(d / 86400) + 'd'; };
const initials = (n) => (n.match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function codeThreads() {
  const ps = new Map(codeProjects().map((p) => [p.id, p]));
  return X.S.data.threads.filter((t) => ps.has(t.project_id) && !t.archived && t.kind === 'chat')
    .map((t) => ({ t, p: ps.get(t.project_id), k: 't:' + t.id, at: X.S.data.last['t:' + t.id]?.at || t.created_at || 0 })).sort((a, b) => b.at - a.at);
}
export function setCodeMode(on) { CM.on = !!on; if (!on) CM.draft = null; document.body.classList.toggle('code-mode', CM.on); }
export function codeModeSide(key) {
  const busy = new Set(X.S.data.busyThreads || []);
  const q = CM.q.toLowerCase();
  const all = codeThreads().filter((x) => !q || (x.t.title || '').toLowerCase().includes(q) || x.p.name.toLowerCase().includes(q));
  const row = (x) => { const b = X.bot(x.t.bot_id); const w = busy.has(x.k); return `<button class="cm-row ${key === x.k ? 'active' : ''}" data-open="${x.k}">
      <span class="cm-top"><span class="cm-proj"><i class="cm-badge">${X.esc(initials(x.p.name))}</i>${X.esc(x.p.name)}</span>${w ? '<span class="cm-st"><i class="code-dot working"></i>Working</span>' : `<span class="cm-time">${ago(x.at)}</span>`}</span>
      <span class="cm-title">${X.esc(x.t.title || 'New thread')}</span>
      <span class="cm-sub"><span class="mono">${BRANCH_ICON}${X.esc(x.t.branch || x.t.base || 'main')}</span>${b ? X.avatar(b, 14) : ''}</span></button>`; };
  const working = all.filter((x) => busy.has(x.k));
  const ps = codeProjects().filter((p) => !q || p.name.toLowerCase().includes(q) || all.some((x) => x.p.id === p.id));
  return `<div class="cm-side">
    <div class="cm-head"><button class="icon-btn" data-code-exit title="Back to Nimbus" aria-label="Back to Nimbus">${X.ICON.chevron}</button>${CODE_ICON}<b>Nimbus Code</b>
      <button class="icon-btn" data-code-new title="New project" aria-label="New project">${X.ICON.folder || X.ICON.plus}</button><button class="icon-btn" data-cm-new title="New thread" aria-label="New thread">${X.ICON.compose}</button></div>
    <label class="cm-search">${X.ICON.search || ''}<input id="cm-q" placeholder="Search" value="${X.esc(CM.q)}"></label>
    <div class="cm-list">
      ${codeProjects().length ? '' : `<div class="cm-empty"><p>Start by adding a project: a new repo, a GitHub clone or a folder in ~/code.</p><button class="btn primary" data-code-new>${X.ICON.plus} New project</button></div>`}
      ${working.length ? `<div class="cm-sec">Working <i>${working.length}</i></div>${working.map(row).join('')}` : ''}
      ${ps.map((p) => { const mine = all.filter((x) => x.p.id === p.id && !busy.has(x.k)); const open = X.sideOpen['cm' + p.id] !== false;
        return `<div class="cm-pgroup"><div class="cm-prow"><button data-cm-fold="${p.id}" class="${open ? 'open' : ''}">${X.TI.chev}<i class="cm-badge">${X.esc(initials(p.name))}</i><span>${X.esc(p.name)}</span></button><button class="icon-btn" data-cm-new="${p.id}" title="New thread in ${X.esc(p.name)}" aria-label="New thread">${X.ICON.plus}</button><button class="icon-btn" data-code-menu="${p.id}" aria-label="Project options">${X.TI.dots}</button></div>
          ${open ? (mine.length ? mine.map(row).join('') : '<div class="cm-none">No threads yet</div>') : ''}</div>`; }).join('')}
    </div>
  </div>`;
}
export async function deleteCodeProject(p) {
  if (!p || !confirm(`Delete the code project "${p.name}"?\n\nIts threads are archived. The repo folder (${p.repo || ''}) and its branches stay on disk.`)) return false;
  await X.api(`/api/projects/${p.id}`, { method: 'DELETE' });
  const onIt = codeProject(X.threadKey())?.p.id === p.id || CM.draft?.project === p.id;
  await X.refreshState();
  if (onIt) { const x = codeThreads()[0]; if (x) X.openThread(x.k); else if (codeProjects().length) newCodeThread(); else { CM.draft = null; X.S.current = null; X.renderSide(); X.renderMain(); } }
  X.toast(`Deleted ${p.name}`); return true;
}
// New thread: an empty chat. Pick the project and bot in the message box; the first message starts it.
export function newCodeThread(projectId) {
  const ps = codeProjects(); if (!ps.length) return codeProjectModal();
  const p = ps.find((x) => x.id === projectId) || ps.find((x) => x.id === CM.draft?.project) || ps.find((x) => x.id === codeProject(X.threadKey())?.p.id) || ps[0];
  closeCodePane(); setCodeMode(true);
  CM.draft = { project: p.id, bot: p.members[0], own: true };
  X.S.current = null; history.replaceState(null, '', '#code');
  X.renderSide(); X.renderMain();
  document.getElementById('msg')?.focus();
}
export function codeDraftMain() {
  const d = CM.draft, ps = codeProjects(), p = ps.find((x) => x.id === d.project) || ps[0];
  const bots = p.members.map(X.bot).filter(Boolean);
  if (!bots.some((b) => b.id === d.bot)) d.bot = bots[0]?.id;
  return `<header class="head"><button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${X.ICON.menu}</button><span class="cm-crumb"><i class="cm-badge">${X.esc(initials(p.name))}</i>${X.esc(p.name)} <span class="muted">/</span> <b>New thread</b></span></header>
    <div class="thread"><div class="cm-hello"><h2>What should we build?</h2><p class="muted">${X.esc(p.name)} · ${bots.length ? X.esc(bots.map((b) => b.name).join(', ')) : 'no bots yet'}</p></div></div>
    <div class="composer cm-composer"><form id="composer">
      <label for="msg" class="sr">Message</label>
      <textarea id="msg" rows="2" placeholder="Ask anything${bots.length > 1 ? ' · @ a bot to hand it work' : ''}"></textarea>
      <div class="cm-bar">
        <select id="cm-proj" title="Project">${ps.map((x) => `<option value="${x.id}" ${x.id === p.id ? 'selected' : ''}>${X.esc(x.name)}</option>`).join('')}</select>
        <select id="cm-bot" title="Bot">${bots.map((b) => `<option value="${b.id}" ${b.id === d.bot ? 'selected' : ''}>${X.esc(b.name)}</option>`).join('')}</select>
        <label class="cm-own" title="A separate branch and folder for this thread, merged when you're happy"><input type="checkbox" id="cm-own" ${d.own ? 'checked' : ''}>${BRANCH_ICON} Own branch</label>
        <button class="send" aria-label="Send">${X.ICON.send}</button>
      </div></form></div>`;
}
export async function codeDraftSend() {
  const ta = document.getElementById('msg'), text = ta.value.trim(), d = CM.draft;
  if (!text || !d?.bot) return X.toast(d?.bot ? 'Type a message' : 'Add a bot to the project first');
  const btn = document.querySelector('.cm-composer .send'); btn.disabled = true;
  try {
    const { key } = await X.api('/api/threads', { method: 'POST', body: { botId: d.bot, projectId: d.project, title: text.replace(/\s+/g, ' ').slice(0, 60), ownBranch: d.own } });
    await X.api(`/api/threads/${enc(key)}/messages`, { method: 'POST', body: { text } });
    CM.draft = null; await X.refreshState(); X.openThread(key);
  } catch (err) { X.toast(err.message); btn.disabled = false; }
}
document.addEventListener('change', (e) => {
  if (!CM.draft) return;
  if (e.target.id === 'cm-proj') { CM.draft.project = Number(e.target.value); const v = document.getElementById('msg').value; X.renderMain(); document.getElementById('msg').value = v; }
  if (e.target.id === 'cm-bot') CM.draft.bot = Number(e.target.value);
  if (e.target.id === 'cm-own') CM.draft.own = e.target.checked;
});
document.addEventListener('input', (e) => { if (e.target.id === 'cm-q') { CM.q = e.target.value; const pos = e.target.selectionStart; X.renderSide(); const i = document.getElementById('cm-q'); i.focus(); i.setSelectionRange(pos, pos); } });
const CODE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/></svg>';
const BRANCH_ICON = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7v10M18 10c0 4-6 3-12 7"/></svg>';
export { CODE_ICON };

// ---------- project and thread dialogs ----------
export async function codeProjectModal(p) {
  const isNew = !p;
  p = p || { name: '', instructions: '', members: [], test_cmd: '', preview_cmd: '' };
  const members = new Set(p.members);
  let repos = { root: '~/code', repos: [] };
  if (isNew) try { repos = await X.api('/api/code/repos'); } catch {}
  const el = X.modal(`
    <div class="modal-head"><h2>${isNew ? 'New Nimbus Code project' : 'Code project settings'}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <label class="field">Name<input id="cp-name" value="${X.esc(p.name)}" placeholder="My web app"></label>
    ${isNew ? `<div class="field">Code<div class="seg" id="cp-src">
        <button type="button" data-src="new" class="on">New empty repo</button><button type="button" data-src="clone">Clone from GitHub</button>${repos.repos.length ? '<button type="button" data-src="existing">Folder already here</button>' : ''}</div>
      <input id="cp-url" placeholder="https://github.com/owner/repo" hidden>
      <select id="cp-folder" hidden>${repos.repos.map((r) => `<option>${X.esc(r)}</option>`).join('')}</select>
      <span class="hint" id="cp-where">Made in ${X.esc(repos.root)}/<b id="cp-slug">…</b></span></div>` : `<div class="field">Repo<div class="muted mono">${X.esc(p.repo)}</div></div>
      <div class="field">GitHub repo<div class="cp-newbot"><input id="cp-gh" placeholder="https://github.com/owner/repo"><button type="button" class="btn" id="cp-ghgo">Link</button></div>
      <span class="hint">An empty project takes the code from GitHub. One with work keeps it and just gets GitHub as its remote.</span></div>`}
    <div class="field">Bots in this project<div id="cp-picks" class="picks"></div>
      <div class="cp-newbot"><input id="cp-bn" placeholder="New bot name, e.g. Coder"><button type="button" class="btn" id="cp-bot">${X.ICON.plus} Make bot</button></div></div>
    <label class="field">Instructions (optional)<textarea id="cp-ins" rows="3" placeholder="Stack, rules, how to run it. Every bot here reads this.">${X.esc(p.instructions)}</textarea></label>
    <details class="field cp-adv"><summary>Tests and preview (found automatically)</summary>
      <label class="field">Test command<input id="cp-test" value="${X.esc(p.test_cmd || '')}" placeholder="npm test, pytest… (blank = detect)"></label>
      <label class="field">Preview command<input id="cp-prev" value="${X.esc(p.preview_cmd || '')}" placeholder="npm run dev (uses $PORT; blank = detect)"></label></details>
    <div class="modal-foot">
      ${isNew ? '' : '<button class="btn danger left" id="cp-del">Delete project</button>'}
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="cp-save">${isNew ? 'Create project' : 'Save'}</button>
    </div>`);
  let src = 'new';
  const slug = () => { const s = $('#cp-slug'); if (s) s.textContent = $('#cp-name').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project'; };
  const $ = (s) => el.querySelector(s);
  const draw = () => { $('#cp-picks').innerHTML = X.S.data.bots.map((b) => `<label class="pick ${members.has(b.id) ? 'on' : ''}"><input type="checkbox" data-cpm="${b.id}" ${members.has(b.id) ? 'checked' : ''}>${X.avatar(b, 28)}<span>${X.esc(b.name)}</span></label>`).join(''); };
  draw(); slug();
  $('#cp-name').addEventListener('input', slug);
  el.addEventListener('change', (e) => { if (e.target.dataset.cpm) { const id = Number(e.target.dataset.cpm); e.target.checked ? members.add(id) : members.delete(id); draw(); } });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal();
    const s = e.target.closest('[data-src]');
    if (s) {
      src = s.dataset.src; el.querySelectorAll('[data-src]').forEach((b) => b.classList.toggle('on', b === s));
      $('#cp-url').hidden = src !== 'clone'; $('#cp-folder').hidden = src !== 'existing'; $('#cp-where').hidden = src !== 'new';
      return;
    }
    try {
      if (e.target.closest('#cp-bot')) {
        const name = $('#cp-bn').value.trim(); if (!name) return X.toast('Type a name for the new bot');
        const b = await X.api('/api/bots', { method: 'POST', body: { name, role: 'Writes and fixes code', instructions: 'You are a careful software engineer. Read the code before changing it, keep changes small and focused, match the existing style, and run the tests.', effort: 'high', color: X.BOT_COLORS[X.S.data.bots.length % X.BOT_COLORS.length], shape: 'none/specs', approval_rules: ['Bash(git push*)', 'Bash(rm -rf*)', 'Bash(*gh pr merge*)'] } });
        await X.refreshState(); members.add(b.id); $('#cp-bn').value = ''; draw(); return X.toast(`${name} is ready`);
      }
      if (e.target.id === 'cp-ghgo') {
        const btn = e.target; btn.disabled = true; btn.textContent = 'Linking…';
        try { const r = await X.api(`/api/projects/${p.id}/github`, { method: 'POST', body: { url: $('#cp-gh').value } }); X.toast(r.replaced ? `Linked. The project now has the code from GitHub (${r.branch}).` : `Linked to GitHub (${r.branch}).`); CP.gh = null; }
        finally { btn.disabled = false; btn.textContent = 'Link'; }
        return;
      }
      if (e.target.id === 'cp-del') { if (await deleteCodeProject(p)) X.closeModal(); return; }
      if (e.target.id === 'cp-save') {
        const body = { name: $('#cp-name').value.trim(), instructions: $('#cp-ins').value, members: [...members], testCmd: $('#cp-test').value.trim(), previewCmd: $('#cp-prev').value.trim() };
        if (!body.name) return X.toast('Give the project a name');
        if (!body.members.length) return X.toast('Pick at least one bot (or make one)');
        const btn = e.target; btn.disabled = true; btn.textContent = src === 'clone' ? 'Cloning…' : 'Creating…';
        try {
          if (isNew) {
            const r = await X.api('/api/projects', { method: 'POST', body: { ...body, code: true, source: src, url: $('#cp-url').value.trim(), folder: $('#cp-folder').value } });
            X.closeModal(); await X.refreshState(); newCodeThread(r.id);
          } else { await X.api(`/api/projects/${p.id}`, { method: 'PATCH', body }); X.closeModal(); X.refreshState(); }
        } finally { btn.disabled = false; btn.textContent = isNew ? 'Create project' : 'Save'; }
      }
    } catch (err) { X.toast(err.message); }
  });
}

// ---------- the code panel ----------
const pane = () => document.getElementById('codepane');
export function codePaneOpen() { return pane()?.classList.contains('open'); }
// Called whenever the open chat changes.
export function codeThreadOpened(key) {
  const c = codeProject(key);
  if (!c) { if (CP.key) closeCodePane(); return; }
  if (CP.key !== key) { stopTerm(); FV.reset(); CP.key = key; CP.info = null; CP.tab = null; }
  if (isWide() && localStorage.codePane !== 'closed') openCodePane(); else if (codePaneOpen()) loadCode();
}
export function openCodePane() {
  if (!CP.key) return;
  pane().classList.add('open'); document.body.classList.add('code-open');
  if (isWide()) delete localStorage.codePane;
  renderPane(); loadCode();
}
export function closeCodePane(user = false) {
  stopTerm(); pane()?.classList.remove('open'); document.body.classList.remove('code-open');
  if (user && isWide()) localStorage.codePane = 'closed';
  if (!user) CP.key = null;
}
export function toggleCodePane() { codePaneOpen() ? closeCodePane(true) : openCodePane(); }
async function startPreviewNow() {
  const k = CP.key; if (!k) return;
  try { await X.api(`/api/code/${enc(k)}/preview`, { method: 'POST', body: {} }); setTimeout(() => { const f = pane()?.querySelector('.cp-frame'); if (f) f.src = f.src; }, 1500); } catch (e) { X.toast(e.message); }
  loadCode();
}
export function onCodeChanged(thread, file) {
  if (thread !== CP.key || !codePaneOpen()) return;
  // Live reload: the preview refreshes after the bot (or you) change a file. Dev servers with hot reload handle it themselves.
  if (file && CP.tab === 'preview' && CP.info?.preview.running && !/\b(vite|next|dev|nuxt|astro|--reload|--debug)\b/.test(CP.info.preview.cmd)) { clearTimeout(CP.pvT); CP.pvT = setTimeout(() => { const f = pane()?.querySelector('.cp-frame'); if (f) f.src = f.src; }, 700); }
  if (CP.tab === 'files') FV.changed(file);
  clearTimeout(CP.timer); CP.timer = setTimeout(loadCode, 300);
}
async function loadCode() {
  const key = CP.key; if (!key) return;
  if (!CP.gh || CP.gh.key !== key) { CP.gh = { key }; X.api(`/api/code/${enc(key)}/github`).then((g) => { if (CP.key === key) { CP.gh = { key, ...g }; renderPane(); } }).catch((e) => { if (CP.key === key) { CP.gh = { key, error: e.message }; renderPane(); } }); }
  try { const i = await X.api(`/api/code/${enc(key)}`); if (key === CP.key) { CP.info = i; renderPane(); } }
  catch (e) { if (key === CP.key) { CP.info = { error: e.message }; renderPane(); } }
}

function renderPane() {
  const el = pane(); if (!el) return;
  const i = CP.info;
  if (!i) { el.innerHTML = `<div class="cp-head"><b>Loading…</b><button class="icon-btn" data-cp="close" aria-label="Close">${X.ICON.close}</button></div>`; return; }
  if (i.error) { el.innerHTML = `<div class="cp-head"><b>Code</b><button class="icon-btn" data-cp="close" aria-label="Close">${X.ICON.close}</button></div><p class="muted">${X.esc(i.error)}</p>`; return; }
  const filesNode = CP.tab === 'files' ? el.querySelector('.cp-files-view') : null;
  const keepTerm = CP.tab === 'terminal' && CP.term && el.querySelector('.cp-term');
  const termNode = keepTerm ? el.querySelector('.cp-term') : null;
  const adds = i.changes.reduce((s, c) => s + c.add, 0), dels = i.changes.reduce((s, c) => s + c.del, 0);
  if (!CP.tab) CP.tab = i.changes.length ? 'changes' : 'about';
  const tabs = [['about', 'About'], ['files', 'Code'], ['changes', `Changes${i.changes.length ? ` <i>${i.changes.length}</i>` : ''}`], ['commits', 'Commits'], ['tests', `Tests${i.test.last && !i.test.last.running ? (i.test.last.ok ? ' <i class="ok">✓</i>' : ' <i class="bad">✗</i>') : ''}`], ['preview', `Preview${i.preview.running ? ' <i class="ok">●</i>' : ''}`], ['terminal', 'Terminal']];
  el.innerHTML = `
    <div class="cp-head"><button class="icon-btn cp-back" data-cp="close" aria-label="Back to chat">${X.ICON.chevron}</button>${CODE_ICON}<b title="${X.esc(i.project.path)}">${X.esc(i.project.name)}</b>
      ${i.webUrl ? `<a class="cp-link" href="${X.esc(i.webUrl)}" target="_blank" rel="noopener" title="Open on GitHub">GitHub ↗</a>` : ''}
      <button class="icon-btn" data-cp="refresh" title="Refresh" aria-label="Refresh">↻</button><button class="icon-btn cp-x" data-cp="close" aria-label="Close">${X.ICON.close}</button></div>
    <div class="cp-branch">${BRANCH_ICON}<b class="mono">${X.esc(i.branch)}</b>${i.ownBranch ? `<span class="muted">from ${X.esc(i.base)}${i.aheadOfBase ? ` · ${i.aheadOfBase} commit${i.aheadOfBase === 1 ? '' : 's'} ahead` : ''}</span>` : ''}
      ${i.ahead || i.behind ? `<span class="muted">↑${i.ahead} ↓${i.behind}</span>` : ''}</div>
    ${i.agents.length ? `<div class="cp-agents">${i.agents.map((a) => { const b = X.bot(a.bot_id); return `<span class="cp-agent">${b ? X.avatar(b, 16) : ''}${X.esc(b?.name || 'Bot')}<small>${a.status === 'queued' ? 'queued' : X.esc(threadName(a.thread))} · <span data-since="${a.started_at || ''}">${a.started_at ? since(a.started_at) : ''}</span></small></span>`; }).join('')}</div>` : ''}
    <div class="cp-actions">
      <button class="btn small" data-cp="diff-working" ${i.changes.length ? '' : 'disabled'}>View changes${i.changes.length ? ` <span class="add">+${adds}</span> <span class="del">−${dels}</span>` : ''}</button>
      ${i.ownBranch ? `<button class="btn small" data-cp="diff-branch">Whole branch</button><button class="btn small" data-cp="merge" ${i.changes.length || !i.aheadOfBase ? 'disabled' : ''} title="${i.changes.length ? 'Commit first' : i.aheadOfBase ? `Merge into ${X.esc(i.base)}` : 'Nothing to merge yet'}">Merge into ${X.esc(i.base)}</button>` : ''}
      ${i.remote ? `<button class="btn small" data-cp="push">Push</button>` : ''}
      ${i.webUrl && i.ownBranch ? `<a class="btn small" href="${X.esc(i.webUrl)}/compare/${enc(i.base)}...${enc(i.branch)}?expand=1" target="_blank" rel="noopener">Open PR ↗</a>` : ''}
    </div>
    <div class="cp-tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" class="${CP.tab === k ? 'on' : ''}" data-cptab="${k}">${l}</button>`).join('')}</div>
    <div class="cp-body">${tabBody(i)}</div>`;
  if (CP.tab === 'files') { if (filesNode) el.querySelector('.cp-files-view').replaceWith(filesNode); else FV.mount(el.querySelector('.cp-files-view')); }
  if (CP.tab === 'terminal') { if (termNode) el.querySelector('.cp-term').replaceWith(termNode); else startTerm(); }
}
// About box, like the right side of a GitHub repo page. GitHub numbers when the repo is linked, local ones otherwise.
const num = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n ?? 0));
const ICO = {
  star: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8-6.2-3.2-6.2 3.2L7 14.2 2 9.3l6.9-1z"/></svg>',
  eye: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  fork: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="4" r="2"/><circle cx="18" cy="4" r="2"/><circle cx="12" cy="20" r="2"/><path d="M6 6v2a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4V6M12 12v6"/></svg>',
  issue: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  pulse: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>' };
function langsHtml(list, src) {
  if (!list?.length) return '<p class="muted small">No code yet</p>';
  return `<div class="cp-langbar" title="${X.esc(src)}">${list.map((l) => `<span style="width:${l.pct}%;background:${l.color}"></span>`).join('')}</div>
    <div class="cp-langlist">${list.slice(0, 8).map((l) => `<span><i style="background:${l.color}"></i><b>${X.esc(l.name)}</b> ${l.pct}%</span>`).join('')}</div>`;
}
function aboutHtml(i) {
  const g = CP.gh || {};
  const a = (u, t) => `<a href="${X.esc(u)}" target="_blank" rel="noopener">${t}</a>`;
  if (!g.linked) return `<div class="cp-about">
      <div class="cp-sec"><h4>About</h4>${!('linked' in g) && !g.error ? '<p class="muted small">Loading…</p>' : g.error ? `<p class="muted small">${X.esc(g.error)}</p>` : `<p class="muted small">Not linked to GitHub.</p><button class="btn small" data-cp="link-gh">Link a GitHub repo</button>`}</div>
      <div class="cp-sec"><h4>Languages</h4>${langsHtml(i.languages, 'From the files here')}</div></div>`;
  return `<div class="cp-about">
    <div class="cp-sec"><h4>About ${g.private ? '<span class="cp-pill">Private</span>' : ''}</h4>
      ${g.description ? `<p class="cp-desc">${X.esc(g.description)}</p>` : '<p class="muted small">No description</p>'}
      ${g.homepage ? `<p class="small">${a(g.homepage, X.esc(g.homepage.replace(/^https?:\/\//, '')))}</p>` : ''}
      ${g.topics.length ? `<div class="cp-topics">${g.topics.map((t) => `<span>${X.esc(t)}</span>`).join('')}</div>` : ''}
      <div class="cp-stats">${a(g.url + '/pulse', ICO.pulse + ' Activity')}${a(g.url + '/stargazers', `${ICO.star} <b>${num(g.stars)}</b> stars`)}${a(g.url + '/watchers', `${ICO.eye} <b>${num(g.watching)}</b> watching`)}${a(g.url + '/forks', `${ICO.fork} <b>${num(g.forks)}</b> forks`)}${a(g.url + '/issues', `${ICO.issue} <b>${num(g.issues)}</b> open issues`)}</div></div>
    <div class="cp-sec"><h4>Releases</h4>${g.release ? `<p class="small">${a(g.release.url, `<b>${X.esc(g.release.name)}</b>`)} <span class="muted">${X.esc(g.release.tag)} · ${new Date(g.release.at).toLocaleDateString()}</span></p>` : `<p class="muted small">No releases published</p>`}</div>
    <div class="cp-sec"><h4>Contributors <i class="cp-count">${g.contributors.length}</i></h4><div class="cp-people">${g.contributors.map((c) => a(c.url, `<img src="${X.esc(c.avatar)}&s=48" alt="" width="24" height="24" loading="lazy"><b>${X.esc(c.login)}</b><span class="muted">${c.commits}</span>`)).join('') || '<p class="muted small">None yet</p>'}</div></div>
    <div class="cp-sec"><h4>Languages</h4>${langsHtml(g.languages.length ? g.languages : i.languages, g.languages.length ? 'From GitHub (' + g.defaultBranch + ')' : 'From the files here')}</div></div>`;
}
async function linkGithub() {
  const url = prompt('GitHub repo for this project (https://github.com/owner/repo or owner/repo):', CP.gh?.url || '');
  if (!url) return;
  const r = await X.api(`/api/projects/${CP.info.project.id}/github`, { method: 'POST', body: { url } });
  X.toast(r.replaced ? `Linked. The project now has the code from GitHub (${r.branch}).` : `Linked to GitHub (${r.branch}). Your local work is kept.`);
  CP.gh = null; loadCode();
}
function threadName(key) { const t = X.threadOf(key); return t ? (t.title || 'New task') : ''; }
function since(at) { const s = Math.max(0, Math.round(Date.now() / 1000 - at)); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`; }
setInterval(() => document.querySelectorAll('#codepane [data-since]').forEach((n) => { if (n.dataset.since) n.textContent = since(Number(n.dataset.since)); }), 1000);

function tabBody(i) {
  if (CP.tab === 'about') return aboutHtml(i);
  if (CP.tab === 'files') return '<div class="cp-files-view"></div>';
  if (CP.tab === 'changes') {
    if (!i.changes.length) return '<p class="muted cp-empty">No uncommitted changes.</p>';
    return `<div class="cp-files">${i.changes.map((c) => `<button class="cp-file" data-cp-file="${X.esc(c.file)}"><span class="st ${c.state}">${{ new: 'A', deleted: 'D', renamed: 'R', changed: 'M' }[c.state]}</span><span class="fn mono">${X.esc(c.file)}</span><span class="add">+${c.add}</span><span class="del">−${c.del}</span></button>`).join('')}</div>
      <div class="cp-commit"><input id="cp-msg" placeholder="Commit message (blank = suggested)"><button class="btn primary small" data-cp="commit">Commit</button></div>`;
  }
  if (CP.tab === 'commits') {
    if (!i.commits.length) return '<p class="muted cp-empty">No commits yet.</p>';
    return `<div class="cp-commits">${i.commits.map((c) => `<button class="cp-cm" data-cp-commit="${c.sha}"><span class="mono sha">${c.short}</span><span class="subj">${X.esc(c.subject)}</span><small>${X.esc(c.author)} · ${X.stamp(c.at)}</small></button>`).join('')}</div>`;
  }
  if (CP.tab === 'tests') {
    const l = i.test.last;
    if (!i.test.cmd) return '<p class="muted cp-empty">No tests found. Set a test command in the project settings (⋯ next to the project).</p>';
    return `<div class="cp-row"><code class="mono">${X.esc(i.test.cmd)}</code><button class="btn primary small" data-cp="tests" ${l?.running ? 'disabled' : ''}>${l?.running ? 'Running…' : 'Run tests'}</button></div>
      ${l && !l.running ? `<div class="cp-result ${l.ok ? 'ok' : 'bad'}">${l.ok ? '✓ Passed' : `✗ Failed (exit ${l.code})`} · ${l.secs ?? 0}s · ${X.stamp(Math.round(l.at / 1000))}
        ${l.ok ? '' : '<button class="btn small" data-cp="send-fail">Ask the bot to fix it</button>'}</div><pre class="cp-out">${X.esc(l.out.slice(-20000))}</pre>` : ''}
      <p class="hint">Runs here on the server, no Claude usage.</p>`;
  }
  if (CP.tab === 'preview') {
    const pv = i.preview;
    if (!pv.running) {
      if (!pv.cmd) return `<p class="muted">Couldn’t tell how to run this project. Set a preview command in project settings, or let the bot set it up.</p><div class="cp-row"><button class="btn small" data-cp="preview-ask">Ask the bot to set up a preview</button><button class="btn small" data-cp="preview-settings">Project settings</button></div>`;
      // Opening the tab starts it: no button needed.
      if (CP.autoPv !== CP.key) { CP.autoPv = CP.key; setTimeout(() => startPreviewNow(), 0); }
      return `<p class="muted"><span class="shimmer">Starting ${X.esc(pv.why)}…</span></p><code class="mono small">${X.esc(pv.dir ? `cd ${pv.dir} && ` : '')}${X.esc(pv.cmd)}</code><div class="cp-row"><button class="btn primary small" data-cp="preview-start">Start preview</button></div>`;
    }
    const url = `${location.protocol}//${location.hostname}:${pv.proxyPort}/`;
    return `<p class="muted small cp-why">Running ${X.esc(pv.why || 'the app')} · reloads when files change</p><div class="cp-row"><code class="mono" title="${X.esc(pv.cmd)}">${X.esc(pv.cmd)}</code><button class="btn small" data-cp="preview-reload">Reload</button><a class="btn small" href="${url}" target="_blank" rel="noopener">Open ↗</a><button class="btn small" data-cp="preview-stop">Stop</button></div>
      <iframe class="cp-frame" src="${url}" title="App preview"></iframe><details class="cp-log"><summary>Output</summary><pre class="cp-out">${X.esc(pv.out)}</pre></details>`;
  }
  if (CP.tab === 'terminal') return '<div class="cp-term"></div><p class="hint">A shell in this task’s folder, running as the Nimbus user.</p>';
  return '';
}

// ---------- terminal ----------
async function startTerm() {
  const box = pane().querySelector('.cp-term'); if (!box) return;
  stopTerm();
  if (!document.getElementById('xterm-css')) document.head.insertAdjacentHTML('beforeend', '<link id="xterm-css" rel="stylesheet" href="/vendor/xterm/xterm.css">');
  const [{ Terminal }, { FitAddon }] = await Promise.all([import('/vendor/xterm/xterm.mjs'), import('/vendor/xterm/addon-fit.mjs')]);
  const key = CP.key;
  const css = getComputedStyle(document.body);
  const term = new Terminal({ fontFamily: 'JetBrains Mono, ui-monospace, monospace', fontSize: 13, cursorBlink: true, theme: { background: '#0d1117', foreground: '#e6edf3' }, scrollback: 5000 });
  const fit = new FitAddon(); term.loadAddon(fit); term.open(box);
  const send = (b) => X.api(`/api/code/${enc(key)}/term`, { method: 'POST', body: b }).catch(() => {});
  let queued = '', t = null;
  term.onData((d) => { queued += d; clearTimeout(t); t = setTimeout(() => { const q = queued; queued = ''; send({ data: q }); }, 8); });
  const es = new EventSource(`/api/code/${enc(key)}/term`);
  es.onmessage = (e) => term.write(JSON.parse(e.data));
  es.addEventListener('end', () => { term.write('\r\n[shell closed — switch tabs to start a new one]\r\n'); es.close(); });
  const doFit = () => { try { fit.fit(); send({ cols: term.cols, rows: term.rows }); } catch {} };
  const ro = new ResizeObserver(() => doFit()); ro.observe(box);
  setTimeout(doFit, 50); term.focus();
  CP.term = { term, es, ro }; void css;
}
function stopTerm() { if (!CP.term) return; CP.term.es.close(); CP.term.ro.disconnect(); CP.term.term.dispose(); CP.term = null; }

// ---------- diff viewer ----------
export async function diffModal(title, url, onlyFile = null) {
  const el = X.modal(`<div class="modal-head"><h2>${X.esc(title)}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="dv"><p class="muted">Loading…</p></div>`, { wide: true, cls: 'diff-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); const f = e.target.closest('[data-dvf]'); if (f) el.querySelector(`#dvf-${f.dataset.dvf}`)?.scrollIntoView({ block: 'start' }); });
  try {
    const { diff } = await X.api(url);
    const files = parseDiff(diff);
    if (!files.length) { el.querySelector('.dv').innerHTML = '<p class="muted">No changes.</p>'; return; }
    el.querySelector('.dv').innerHTML = `<nav class="dv-files">${files.map((f, n) => `<button data-dvf="${n}"><span class="fn mono">${X.esc(f.name)}</span><span class="add">+${f.add}</span><span class="del">−${f.del}</span></button>`).join('')}</nav>
      <div class="dv-body">${files.map((f, n) => `<section id="dvf-${n}"><h4 class="mono">${X.esc(f.name)} <span class="add">+${f.add}</span> <span class="del">−${f.del}</span></h4>${f.binary ? '<p class="muted">Binary file</p>' : `<table class="dv-t">${f.lines.map(lineRow).join('')}</table>`}</section>`).join('')}</div>`;
    if (onlyFile) { const n = files.findIndex((f) => f.name === onlyFile); if (n >= 0) el.querySelector(`#dvf-${n}`)?.scrollIntoView({ block: 'start' }); }
  } catch (err) { el.querySelector('.dv').innerHTML = `<p class="muted">${X.esc(err.message)}</p>`; }
}
function lineRow(l) {
  if (l.t === 'h') return `<tr class="h"><td colspan="3">${X.esc(l.s)}</td></tr>`;
  return `<tr class="${l.t}"><td class="ln">${l.o ?? ''}</td><td class="ln">${l.n ?? ''}</td><td class="code"><span class="sg">${l.t === 'a' ? '+' : l.t === 'd' ? '−' : ' '}</span>${X.esc(l.s)}</td></tr>`;
}
function parseDiff(text) {
  const files = []; let f = null, o = 0, n = 0;
  for (const line of String(text).split('\n')) {
    if (line.startsWith('diff --git ')) { f = { name: line.replace(/^diff --git a\/(.*) b\/.*$/, '$1'), add: 0, del: 0, lines: [], binary: false }; files.push(f); continue; }
    if (!f) continue;
    if (line.startsWith('+++ ')) { const nm = line.slice(4).replace(/^b\//, ''); if (nm !== '/dev/null') f.name = nm; continue; }
    if (line.startsWith('--- ') || line.startsWith('index ') || /^(new|deleted) file mode|^similarity|^rename /.test(line)) continue;
    if (line.startsWith('Binary files')) { f.binary = true; continue; }
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/.exec(line);
    if (h) { o = Number(h[1]); n = Number(h[2]); f.lines.push({ t: 'h', s: line }); continue; }
    if (f.lines.length > 4000) continue;
    if (line.startsWith('+')) { f.add++; f.lines.push({ t: 'a', n: n++, s: line.slice(1) }); }
    else if (line.startsWith('-')) { f.del++; f.lines.push({ t: 'd', o: o++, s: line.slice(1) }); }
    else if (line.startsWith(' ')) f.lines.push({ t: 'c', o: o++, n: n++, s: line.slice(1) });
  }
  return files;
}

// ---------- in the chat ----------
// The card after each turn that changed files.
export function renderChanges(m) {
  let c; try { c = JSON.parse(m.body); } catch { return ''; }
  const b = X.bot(m.author);
  return `<div class="msg bot" data-mid="${m.id}"><div class="changes-card">
    <div class="cc-head">${CODE_ICON}<b>${b ? X.esc(b.name) + ' changed' : 'Changed'} ${c.files.length} file${c.files.length === 1 ? '' : 's'}</b><span class="add">+${c.add}</span><span class="del">−${c.del}</span></div>
    <div class="cc-files">${c.files.slice(0, 8).map((f) => `<span class="mono">${X.esc(f.file)} <span class="add">+${f.add}</span> <span class="del">−${f.del}</span></span>`).join('')}${c.files.length > 8 ? `<span class="muted">and ${c.files.length - 8} more</span>` : ''}</div>
    <div class="row"><button class="btn small" data-cc-diff="${c.runId}">View diff</button><button class="btn small" data-cc-undo="${c.runId}">Undo this turn</button><button class="btn small" data-cc-commit>Commit…</button><button class="btn small" data-cc-tests>Run tests</button></div>
  </div></div>`;
}
// Extra detail for a code step in the live trace: the edit as a mini diff, or the command and its output.
// Edits show their diff open as they happen; ones you fold stay folded.
const shut = new Set();
document.addEventListener('toggle', (e) => { const d = e.target; if (d.classList?.contains('live-diff') && d.dataset.sid) d.open ? shut.delete(d.dataset.sid) : shut.add(d.dataset.sid); }, true);
export function codeStepHtml(s, mark) {
  if (s.diff?.length) {
    const lines = s.diff.flatMap((d) => [...(d.old ? d.old.split('\n').map((l) => `<div class="d">−${X.esc(l)}</div>`) : []), ...d.new.split('\n').slice(0, 80).map((l) => `<div class="a">+${X.esc(l)}</div>`), '<div class="sep"></div>']);
    const add = s.diff.reduce((n, d) => n + (d.new ? d.new.split('\n').length : 0), 0), del = s.diff.reduce((n, d) => n + (d.old ? d.old.split('\n').length : 0), 0);
    return `<details class="step cstep live-diff" data-sid="${X.esc(s.id || '')}" ${shut.has(s.id) ? '' : 'open'}><summary><span class="mark ${s.state}">${mark}</span><span>${X.esc(s.text)}</span><span class="add">+${add}</span>${del ? `<span class="del">−${del}</span>` : ''}</summary><div class="mini-diff mono">${lines.join('')}</div></details>`;
  }
  if (s.cmd) return `<details class="step cstep"><summary><span class="mark ${s.state}">${mark}</span><span>${X.esc(s.text)}</span></summary><pre class="mini-out mono">$ ${X.esc(s.cmd)}${s.out ? '\n' + X.esc(s.out) : ''}</pre></details>`;
  return null;
}

// ---------- built-in code viewer and editor (CodeMirror, loaded on first use) ----------
// The file list, and an editor that follows the bot: when it edits a file, that file opens and the changed lines flash.
const FV = {
  el: null, files: [], file: null, mtime: 0, ed: null, dirty: false, follow: localStorage.codeFollow !== '0', q: '', open: new Set(), cm: null,
  reset() { this.ed?.destroy(); this.ed = null; this.file = null; this.dirty = false; this.el = null; this.files = []; },
  async mount(el) {
    this.el = el; if (!el) return;
    this.draw();
    try { const r = await X.api(`/api/code/${enc(CP.key)}/files`); this.files = r.files; } catch (e) { this.files = []; X.toast(e.message); }
    if (this.file) await this.load(this.file, true); else this.draw();
  },
  tree() {
    const q = this.q.toLowerCase();
    if (q) return this.files.filter((f) => f.toLowerCase().includes(q)).slice(0, 300).map((f) => `<button class="fv-f" data-fv-open="${X.esc(f)}" style="--d:0"><span>${X.esc(f)}</span></button>`).join('');
    const root = {}; for (const f of this.files) { let n = root; const parts = f.split('/'); parts.forEach((p, i) => { if (i === parts.length - 1) (n['\u0000'] ||= []).push(p); else n = n[p] ||= {}; }); }
    const out = [], walk = (n, pre, d) => {
      for (const k of Object.keys(n).filter((k) => k !== '\u0000').sort()) { const p = pre + k + '/', o = this.open.has(p); out.push(`<button class="fv-d ${o ? 'open' : ''}" data-fv-dir="${X.esc(p)}" style="--d:${d}">${X.TI.chev}<span>${X.esc(k)}</span></button>`); if (o) walk(n[k], p, d + 1); }
      for (const f of (n['\u0000'] || []).sort()) out.push(`<button class="fv-f ${this.file === pre + f ? 'on' : ''}" data-fv-open="${X.esc(pre + f)}" style="--d:${d}"><span>${X.esc(f)}</span></button>`);
    };
    walk(root, '', 0); return out.join('') || '<p class="muted small">No files</p>';
  },
  draw() {
    if (!this.el) return;
    if (!this.file) {
      this.el.innerHTML = `<div class="fv-bar"><input class="fv-q" placeholder="Find a file" value="${X.esc(this.q)}"><label class="fv-follow" title="Open each file the bot edits"><input type="checkbox" data-fv-follow ${this.follow ? 'checked' : ''}> Follow bot</label><button class="btn small" data-fv-new>New file</button></div><div class="fv-tree">${this.files.length ? this.tree() : '<p class="muted small">Loading…</p>'}</div>`;
      return;
    }
    if (!this.el.querySelector('.fv-ed')) this.el.innerHTML = `<div class="fv-bar"><button class="icon-btn fv-back" data-fv-back title="All files" aria-label="All files">${X.ICON.chevron}</button><b class="fv-name mono"></b><i class="fv-dot" hidden title="Unsaved"></i>
      <label class="fv-follow" title="Open each file the bot edits"><input type="checkbox" data-fv-follow ${this.follow ? 'checked' : ''}> Follow</label><button class="btn small primary" data-fv-save disabled>Save</button></div>
      <div class="fv-note" hidden></div><div class="fv-ed"></div>`;
    this.el.querySelector('.fv-name').textContent = this.file; this.el.querySelector('.fv-name').title = this.file;
    this.mark();
  },
  mark() { if (!this.el) return; const d = this.el.querySelector('.fv-dot'), b = this.el.querySelector('[data-fv-save]'); if (d) d.hidden = !this.dirty; if (b) b.disabled = !this.dirty; },
  note(html) { const n = this.el?.querySelector('.fv-note'); if (n) { n.hidden = !html; n.innerHTML = html || ''; } },
  async load(file, keep) {
    if (this.dirty && file !== this.file && !confirm(`Leave your unsaved changes in ${this.file}?`)) return;
    let r; try { r = await X.api(`/api/code/${enc(CP.key)}/file?path=${enc(file)}`); } catch (e) { return X.toast(e.message); }
    if (r.text === undefined) { X.toast(r.binary ? 'That file isn’t text' : 'That file is too big to open here'); return; }
    const same = this.file === file && this.ed;
    this.file = file; this.mtime = r.mtime; this.dirty = false;
    for (let p = file.indexOf('/'); p > 0; p = file.indexOf('/', p + 1)) this.open.add(file.slice(0, p + 1));
    if (same) { this.ed.setText(r.text); this.draw(); this.note(''); return; }
    this.ed?.destroy(); this.ed = null; this.draw();
    this.cm ||= await import('/vendor/codemirror/cm.js');
    if (this.file !== file || !this.el) return;
    this.ed = this.cm.createEditor(this.el.querySelector('.fv-ed'), { text: r.text, file, dark: document.documentElement.dataset.theme !== 'light', onChange: () => { if (!this.dirty) { this.dirty = true; this.mark(); } }, onSave: () => this.save() });
    if (keep) this.note('');
  },
  async save() {
    if (!this.ed || !this.dirty) return;
    try { const r = await X.api(`/api/code/${enc(CP.key)}/file`, { method: 'PUT', body: { path: this.file, text: this.ed.text, mtime: this.mtime } }); this.mtime = r.mtime; this.dirty = false; this.mark(); this.note(''); X.toast('Saved'); }
    catch (e) { if (/changed since/.test(e.message)) this.note(`The bot changed this file after you opened it. <button class="btn small" data-fv-reload>Load its version</button> <button class="btn small" data-fv-force>Keep mine</button>`); else X.toast(e.message); }
  },
  // Something in the thread's folder changed (the bot, a commit, an undo).
  async changed(file) {
    if (!this.el) return;
    if (file && !this.files.includes(file)) X.api(`/api/code/${enc(CP.key)}/files`).then((r) => { this.files = r.files; if (!this.file) this.draw(); }).catch(() => {});
    if (this.follow && file && file !== this.file && !this.dirty) return this.load(file);
    if (this.file && (!file || file === this.file)) {
      if (this.dirty) return this.note(`The bot changed this file while you were editing. <button class="btn small" data-fv-reload>Load its version</button>`);
      return this.load(this.file);
    }
  }
};
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-fv-open], [data-fv-dir], [data-fv-back], [data-fv-save], [data-fv-reload], [data-fv-force], [data-fv-new]'); if (!t) return;
  if (t.dataset.fvOpen) return FV.load(t.dataset.fvOpen);
  if (t.dataset.fvDir) { FV.open.has(t.dataset.fvDir) ? FV.open.delete(t.dataset.fvDir) : FV.open.add(t.dataset.fvDir); return FV.draw(); }
  if (t.dataset.fvBack !== undefined) { if (FV.dirty && !confirm(`Leave your unsaved changes in ${FV.file}?`)) return; FV.ed?.destroy(); FV.ed = null; FV.file = null; FV.dirty = false; return FV.draw(); }
  if (t.dataset.fvSave !== undefined) return FV.save();
  if (t.dataset.fvReload !== undefined) { FV.dirty = false; return FV.load(FV.file); }
  if (t.dataset.fvForce !== undefined) { FV.mtime = 0; return FV.save(); }
  if (t.dataset.fvNew !== undefined) {
    const p = prompt('New file path (e.g. src/util.js):'); if (!p) return;
    try { await X.api(`/api/code/${enc(CP.key)}/file`, { method: 'PUT', body: { path: p.trim(), text: '' } }); FV.files = [...FV.files, p.trim()].sort(); FV.load(p.trim()); } catch (err) { X.toast(err.message); }
  }
});
document.addEventListener('change', (e) => { if (e.target.matches?.('[data-fv-follow]')) { FV.follow = e.target.checked; localStorage.codeFollow = FV.follow ? '1' : '0'; } });
document.addEventListener('input', (e) => { if (e.target.classList?.contains('fv-q')) { FV.q = e.target.value; const tr = FV.el?.querySelector('.fv-tree'); if (tr) tr.innerHTML = FV.tree(); } });
// Drag the panel's left edge to make it narrower or wider (remembered per device; double-click resets).
const setCodeW = (w) => { if (w) document.body.style.setProperty('--code-w', w + 'px'); else document.body.style.removeProperty('--code-w'); FV.ed?.view.requestMeasure(); };
setCodeW(Number(localStorage.codeW) || 0);
document.addEventListener('pointerdown', (e) => {
  if (e.target.id !== 'code-resize') return;
  e.preventDefault(); document.body.classList.add('code-dragging');
  const move = (ev) => { const w = Math.round(Math.max(320, Math.min(window.innerWidth - 420, window.innerWidth - ev.clientX))); setCodeW(w); localStorage.codeW = w; };
  const up = () => { document.body.classList.remove('code-dragging'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', (e) => { if (e.target.id === 'code-resize') { delete localStorage.codeW; setCodeW(0); } });

// ---------- clicks ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-cp], [data-cptab], [data-cp-file], [data-cp-commit], [data-cc-diff], [data-cc-undo], [data-cc-commit], [data-cc-tests], [data-code-new], [data-code-thread], [data-code-menu], [data-code-mode], [data-code-exit], [data-cm-new], [data-cm-fold]');
  if (!t) return;
  const key = X.threadKey();
  const k = CP.key || key;
  try {
    if (t.dataset.codeNew !== undefined) { e.stopPropagation(); return codeProjectModal(); }
    if (t.dataset.codeThread) { e.stopPropagation(); return newCodeThread(Number(t.dataset.codeThread)); }
    if (t.dataset.cmNew !== undefined) { e.stopPropagation(); return newCodeThread(Number(t.dataset.cmNew) || null); }
    if (t.dataset.cmFold) { const k = 'cm' + t.dataset.cmFold; X.sideOpen[k] = X.sideOpen[k] === false; return X.renderSide(); }
    if (t.dataset.codeMode !== undefined) { e.stopPropagation(); const x = codeThreads()[0]; if (x) { setCodeMode(true); return X.openThread(x.k); } return newCodeThread(); }
    if (t.dataset.codeExit !== undefined) { e.stopPropagation(); setCodeMode(false); closeCodePane(); const k = X.S.lastPlain; return k ? X.openThread(k) : X.S.data.bots[0] ? X.openThread('bot:' + X.S.data.bots[0].id) : (X.renderSide(), X.renderMain()); }
    if (t.dataset.codeMenu) {
      e.stopImmediatePropagation(); const p = X.S.data.projects.find((x) => x.id === Number(t.dataset.codeMenu));
      return X.popover(t, [['code-task:' + p.id, 'New thread', X.ICON.plus], ['code-edit:' + p.id, 'Project settings', X.ICON.gear], ['code-del:' + p.id, 'Delete project', X.ICON.trash || X.ICON.close]]);
    }
    if (t.dataset.cptab) { if (CP.tab === 'files' && t.dataset.cptab !== 'files' && FV.dirty && !confirm('You have unsaved changes in ' + FV.file + '. Leave them?')) return; if (CP.tab === 'files' && t.dataset.cptab !== 'files') FV.reset(); if (CP.tab === 'terminal' && t.dataset.cptab !== 'terminal') stopTerm(); CP.tab = t.dataset.cptab; return renderPane(); }
    if (t.dataset.cpFile) return diffModal('Uncommitted changes', `/api/code/${enc(k)}/diff?what=working`, t.dataset.cpFile);
    if (t.dataset.cpCommit) return diffModal(`Commit ${t.dataset.cpCommit.slice(0, 7)}`, `/api/code/${enc(k)}/diff?what=commit&ref=${t.dataset.cpCommit}`);
    if (t.dataset.ccDiff) return diffModal('What this turn changed', `/api/code/${enc(key)}/diff?what=turn&ref=${t.dataset.ccDiff}`);
    if (t.dataset.ccUndo) {
      if (!confirm('Put back the files this turn changed, as they were before it? Changes to other files stay.')) return;
      await X.api(`/api/code/${enc(key)}/undo/${t.dataset.ccUndo}`, { method: 'POST', body: {} }); return X.toast('Turn undone');
    }
    if (t.dataset.ccCommit !== undefined) { CP.tab = 'changes'; if (!codePaneOpen()) openCodePane(); else renderPane(); setTimeout(() => document.getElementById('cp-msg')?.focus(), 400); return; }
    if (t.dataset.ccTests !== undefined) { CP.tab = 'tests'; if (!codePaneOpen()) openCodePane(); await X.api(`/api/code/${enc(key)}/tests`, { method: 'POST', body: {} }); return loadCode(); }
    const a = t.dataset.cp;
    if (a === 'close') return closeCodePane(true);
    if (a === 'refresh') { CP.gh = null; return loadCode(); }
    if (a === 'link-gh') return linkGithub();
    if (a === 'diff-working') return diffModal('Uncommitted changes', `/api/code/${enc(k)}/diff?what=working`);
    if (a === 'diff-branch') return diffModal(`Everything on ${CP.info.branch} vs ${CP.info.base}`, `/api/code/${enc(k)}/diff?what=branch`);
    if (a === 'commit') {
      const msg = document.getElementById('cp-msg')?.value.trim();
      const r = await X.api(`/api/code/${enc(k)}/commit`, { method: 'POST', body: { message: msg } }); X.toast(`Committed: ${r.message}`); return loadCode();
    }
    if (a === 'merge') {
      if (!confirm(`Merge ${CP.info.branch} into ${CP.info.base}?`)) return;
      await X.api(`/api/code/${enc(k)}/merge`, { method: 'POST', body: {} }); X.toast(`Merged into ${CP.info.base}`); return loadCode();
    }
    if (a === 'push') {
      if (!confirm(`Push ${CP.info.branch} to ${CP.info.remote}?`)) return;
      t.disabled = true; await X.api(`/api/code/${enc(k)}/push`, { method: 'POST', body: {} }); X.toast('Pushed'); return loadCode();
    }
    if (a === 'tests') { await X.api(`/api/code/${enc(k)}/tests`, { method: 'POST', body: {} }); return loadCode(); }
    if (a === 'send-fail') {
      const l = CP.info.test.last;
      await X.api(`/api/threads/${enc(k)}/messages`, { method: 'POST', body: { text: `The tests failed (\`${l.cmd}\`, exit ${l.code}). Please fix them. Output:\n\n\`\`\`\n${l.out.slice(-6000)}\n\`\`\`` } });
      if (!isWide()) closeCodePane(true);
      return;
    }
    if (a === 'preview-start') { t.disabled = true; t.textContent = 'Starting…'; return startPreviewNow(); }
    if (a === 'preview-settings') return codeProjectModal(X.S.data.projects.find((x) => x.id === CP.info.project.id));
    if (a === 'preview-ask') { await X.api(`/api/threads/${enc(k)}/messages`, { method: 'POST', body: { text: 'Work out how to run this project locally for a preview (install what it needs inside the project only). The app must listen on 127.0.0.1 and the port in $PORT. Then tell me the exact command, from the repo root, so I can put it in the project\'s Preview command.' } }); return X.toast('Asked the bot'); }
    if (a === 'preview-stop') { await X.api(`/api/code/${enc(k)}/preview`, { method: 'POST', body: { stop: true } }); return loadCode(); }
    if (a === 'preview-reload') { const f = pane().querySelector('.cp-frame'); if (f) f.src = f.src; return; }
  } catch (err) { X.toast(err.message); loadCode(); }
});
