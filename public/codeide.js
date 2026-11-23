// Nimbus Code, the rest of the IDE (server: codeide.js): Pull request / Issues / Search / Problems tiles, history,
// blame, merge-conflict helper, Try another way + compare, Ctrl+P and Ctrl+Shift+F, @file in the message box,
// comment on a diff line, preview console errors and element picking, test results after each turn.
import { CODE_EXT, openInEditor, editorFile, codeKey, codeInfo, showTile, reloadCode, diffModal } from './codeui.js';
let X;
export function initCodeIde(ctx) { X = ctx; }
const enc = encodeURIComponent;
const api = (k, p, o) => X.api(`/api/code2/${enc(k)}${p}`, o);
const fail = (e) => X.toast(e.message || String(e), { type: 'error' });
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - (typeof t === 'string' ? Date.parse(t) / 1000 : t)); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const send = async (k, text) => { await X.api(`/api/threads/${enc(k)}/messages`, { method: 'POST', body: { text } }); X.toast('Sent to the bot', { type: 'success' }); };
const C = { pr: {}, issues: {}, status: {}, search: {}, problems: {}, files: {} }; // caches per thread
const fresh = (o, ms) => o && Date.now() - o.at < ms;

// ---------- tiles ----------
CODE_EXT.body = (tab) => ({ pr: '<div class="c2" data-c2="pr"><p class="muted">Loading…</p></div>', issues: '<div class="c2" data-c2="issues"><p class="muted">Loading…</p></div>',
  search: '<div class="c2" data-c2="search"></div>', problems: '<div class="c2" data-c2="problems"></div>' })[tab] || '';
CODE_EXT.about = () => '<div class="c2" data-c2="about"></div>';
CODE_EXT.mount = (el) => {
  const k = codeKey(); if (!k) return;
  for (const box of el.querySelectorAll('[data-c2]')) draw[box.dataset.c2]?.(box, k);
  probeBar(el);
};
const draw = {
  async about(box, k) {
    let s = C.status[k];
    if (!fresh(s, 8000)) { try { s = C.status[k] = { at: Date.now(), ...(await api(k, '/status')) }; } catch { return; } }
    const st = s.setup, out = [];
    if (st) out.push(`<div class="c2-setup ${st.running ? '' : st.ok ? 'ok' : 'bad'}">${st.running ? '<span class="shimmer">Setting up this branch…</span>' : st.ok ? '✓ Branch set up' : '✗ Setup failed'} <code class="mono">${X.esc(st.cmd)}</code>
      ${st.running ? '' : `<button class="btn small" data-c2a="setup">Run again</button>`}${!st.running && !st.ok ? `<details><summary>Output</summary><pre class="cp-out">${X.esc(st.out)}</pre></details>` : ''}</div>`);
    else if (s.setupCmd) out.push(`<div class="c2-setup"><span class="muted">Setup:</span> <code class="mono">${X.esc(s.setupCmd)}</code> <button class="btn small" data-c2a="setup">Run setup</button></div>`);
    if (s.conflicts) out.push(`<div class="c2-setup bad">⚠ A merge is waiting on ${s.conflicts} file${s.conflicts === 1 ? '' : 's'} with conflicts. <button class="btn small primary" data-c2a="conflicts">Resolve conflicts</button></div>`);
    if (s.pair) out.push(`<div class="c2-setup">⇄ There’s a second attempt at this task. <button class="btn small" data-c2a="compare">Compare</button></div>`);
    box.innerHTML = out.join('');
  },
  async pr(box, k) {
    let d = C.pr[k];
    if (!fresh(d, 60000)) { try { d = C.pr[k] = { at: Date.now(), ...(await api(k, '/pr')) }; } catch (e) { box.innerHTML = `<p class="muted">${X.esc(e.message)}</p>`; return; } }
    if (!d.pr) {
      const t = X.S.data.threads.find((x) => 't:' + x.id === k), m = /^#(\d+)\b/.exec(t?.title || '');
      box.innerHTML = `<form class="c2-form" data-c2f="pr"><p class="muted small">No pull request for <code>${X.esc(d.branch)}</code> yet. Creating one commits nothing: commit first, then this pushes the branch and opens the PR into <b>${X.esc(d.base)}</b>.</p>
        <input name="title" value="${X.esc((t?.title || '').replace(/ \(try \d\)$/, ''))}" placeholder="Title" required>
        <textarea name="body" rows="4" placeholder="What changed and why">${m ? `Fixes #${m[1]}` : ''}</textarea>
        <label class="c2-ck"><input type="checkbox" name="draft"> Draft</label><button class="btn primary small">Push and open pull request</button></form>`;
      return;
    }
    const p = d.pr, icon = (s) => (s === 'success' || s === 'neutral' || s === 'skipped' ? '<i class="c2-ok">✓</i>' : s === 'pending' || !s ? '<i class="c2-wait">●</i>' : '<i class="c2-bad">✗</i>');
    const bad = d.checks.filter((c) => !['success', 'neutral', 'skipped', 'pending', null].includes(c.state)).length, pend = d.checks.filter((c) => c.state === 'pending').length;
    box.innerHTML = `<div class="c2-prh"><a href="${X.esc(p.url)}" target="_blank" rel="noopener"><b>#${p.number} ${X.esc(p.title)}</b> ↗</a><span class="c2-state ${p.state}">${p.draft ? 'draft' : p.state}</span><button class="icon-btn" data-c2a="pr-refresh" title="Refresh">↻</button></div>
      <h4 class="c2-h">Checks ${d.checks.length ? `<span class="muted">${bad ? `${bad} failing` : pend ? `${pend} running` : 'all passing'}</span>` : ''}</h4>
      <div class="c2-list">${d.checks.map((c) => `<a class="c2-row" href="${X.esc(c.url || p.url)}" target="_blank" rel="noopener">${icon(c.state)}<span>${X.esc(c.name)}</span></a>`).join('') || '<p class="muted small">No checks on this repo.</p>'}</div>
      ${bad ? '<button class="btn small" data-c2a="fix-checks">Ask the bot to fix the failing checks</button>' : ''}
      <h4 class="c2-h">Comments <span class="muted">${d.comments.length}</span></h4>
      <div class="c2-list">${d.comments.map((c) => `<div class="c2-cm"><b>${X.esc(c.who || '')}</b>${c.file ? ` <code class="mono">${X.esc(c.file)}${c.line ? ':' + c.line : ''}</code>` : ''}${c.state ? ` <span class="muted">${X.esc(c.state.toLowerCase())}</span>` : ''} <span class="muted">· ${ago(c.at)}</span><div>${X.esc(c.body.slice(0, 1200))}</div></div>`).join('') || '<p class="muted small">No comments yet.</p>'}</div>
      ${d.comments.length ? '<button class="btn small" data-c2a="fix-comments">Ask the bot to address the comments</button>' : ''}<p class="hint">Push new commits with Push above; checks update here.</p>`;
  },
  async issues(box, k) {
    let d = C.issues[k];
    if (!fresh(d, 300000)) { try { d = C.issues[k] = { at: Date.now(), ...(await api(k, '/issues')) }; } catch (e) { box.innerHTML = `<p class="muted">${X.esc(e.message)}</p>`; return; } }
    box.innerHTML = `<div class="c2-prh"><b>Open issues</b><span class="muted small">${X.esc(d.slug)}</span><button class="icon-btn" data-c2a="issues-refresh" title="Refresh">↻</button></div>
      <div class="c2-list">${d.issues.map((i) => `<div class="c2-row c2-issue"><span><a href="${X.esc(i.url)}" target="_blank" rel="noopener">#${i.number}</a> ${X.esc(i.title)}${i.labels.map((l) => ` <span class="c2-label">${X.esc(l)}</span>`).join('')}<small class="muted"> · ${X.esc(i.who || '')} · ${ago(i.at)}</small></span>
        <button class="btn small" data-c2-issue="${i.number}" title="New chat on its own branch, with the issue as the task (uses Claude)">Start task</button></div>`).join('') || '<p class="muted">No open issues.</p>'}</div>`;
  },
  search(box, k) {
    const s = C.search[k] ||= { q: '', regex: false, cased: false, hits: null };
    box.innerHTML = `<form class="c2-sf" data-c2f="search"><input name="q" value="${X.esc(s.q)}" placeholder="Search in files" autocomplete="off"><label class="c2-ck" title="Regular expression"><input type="checkbox" name="regex" ${s.regex ? 'checked' : ''}>.*</label><label class="c2-ck" title="Match case"><input type="checkbox" name="cased" ${s.cased ? 'checked' : ''}>Aa</label></form>
      <div class="c2-res">${s.hits ? resultsHtml(s) : '<p class="muted small">Ctrl+Shift+F jumps here. Ctrl+P opens a file by name.</p>'}</div>`;
  },
  problems(box, k) {
    const d = C.problems[k];
    box.innerHTML = `<div class="c2-prh"><button class="btn small primary" data-c2a="problems" ${d?.running ? 'disabled' : ''}>${d?.running ? 'Checking…' : d ? 'Check again' : 'Check for problems'}</button>${d?.cmd ? `<code class="mono small">${X.esc(d.cmd)}</code>` : ''}</div>
      ${!d || d.running ? '<p class="muted small">Runs the project’s linter and type checker here (free).</p>' : d.note ? `<p class="muted">${X.esc(d.note)}</p>`
      : d.problems.length ? `<p class="small">${d.problems.filter((p) => p.level === 'error').length} errors · ${d.problems.filter((p) => p.level !== 'error').length} warnings <button class="btn small" data-c2a="fix-problems">Ask the bot to fix them</button></p>
        <div class="c2-list">${d.problems.slice(0, 400).map((p, n) => `<button class="c2-row c2-hit" data-c2-open="${X.esc(p.file)}" data-line="${p.line}"><i class="${p.level === 'error' ? 'c2-bad' : 'c2-wait'}">${p.level === 'error' ? '✗' : '!'}</i><span><code class="mono">${X.esc(p.file)}:${p.line}</code> ${X.esc(p.msg)}</span></button>`).join('')}</div>`
      : `<p class="c2-ok">✓ No problems found.</p>${d.out ? `<details><summary>Output</summary><pre class="cp-out">${X.esc(d.out)}</pre></details>` : ''}`}`;
  }
};
function resultsHtml(s) {
  if (!s.hits.length) return '<p class="muted small">No matches.</p>';
  const by = new Map(); for (const h of s.hits) (by.get(h.file) || by.set(h.file, []).get(h.file)).push(h);
  const mark = (t) => { if (s.regex) return X.esc(t); const i = s.cased ? t.indexOf(s.q) : t.toLowerCase().indexOf(s.q.toLowerCase()); return i < 0 ? X.esc(t) : X.esc(t.slice(0, i)) + '<mark>' + X.esc(t.slice(i, i + s.q.length)) + '</mark>' + X.esc(t.slice(i + s.q.length)); };
  return `<p class="muted small">${s.hits.length}${s.more ? '+' : ''} matches in ${by.size} files</p>` + [...by].map(([f, hs]) => `<div class="c2-file"><b class="mono">${X.esc(f)}</b>${hs.map((h) => `<button class="c2-hit" data-c2-open="${X.esc(f)}" data-line="${h.line}"><span class="ln">${h.line}</span><code>${mark(h.text.trim())}</code></button>`).join('')}</div>`).join('');
}
const redraw = (name) => { const b = document.querySelector(`[data-c2="${name}"]`); const k = codeKey(); if (b && k) draw[name](b, k); };

document.addEventListener('submit', async (e) => {
  const f = e.target.closest('[data-c2f]'); if (!f) return; e.preventDefault();
  const k = codeKey(); if (!k) return;
  if (f.dataset.c2f === 'search') {
    const s = C.search[k], fd = new FormData(f); s.q = fd.get('q'); s.regex = !!fd.get('regex'); s.cased = !!fd.get('cased');
    try { Object.assign(s, await api(k, `/search?q=${enc(s.q)}&regex=${s.regex ? 1 : 0}&case=${s.cased ? 1 : 0}`)); } catch (err) { return fail(err); }
    f.parentElement.querySelector('.c2-res').innerHTML = resultsHtml(s);
  }
  if (f.dataset.c2f === 'pr') {
    const fd = new FormData(f), btn = f.querySelector('button'); btn.disabled = true; btn.textContent = 'Pushing…';
    try { const r = await api(k, '/pr', { method: 'POST', body: { title: fd.get('title'), body: fd.get('body'), draft: !!fd.get('draft') } }); X.toast(`Opened pull request #${r.number}`, { type: 'success' }); delete C.pr[k]; reloadCode(); }
    catch (err) { fail(err); btn.disabled = false; btn.textContent = 'Push and open pull request'; }
  }
});
document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-c2a], [data-c2-open], [data-c2-issue], [data-cp2], [data-fv-blame], [data-fv-hist]'); if (!t) return;
  const k = codeKey() || X.threadKey(); if (!k) return;
  try {
    if (t.dataset.c2Open) return openInEditor(t.dataset.c2Open, Number(t.dataset.line) || 0);
    if (t.dataset.c2Issue) { t.disabled = true; const r = await api(k, '/issue-task', { method: 'POST', body: { number: Number(t.dataset.c2Issue) } }); await X.refreshState(); X.openThread(r.key); return; }
    if (t.dataset.fvBlame !== undefined) return blameModal(k, editorFile());
    if (t.dataset.fvHist !== undefined) return historyModal(k, editorFile());
    const a = t.dataset.c2a || t.dataset.cp2;
    if (a === 'setup') { await api(k, '/setup', { method: 'POST' }); delete C.status[k]; return setTimeout(() => redraw('about'), 300); }
    if (a === 'compare') return compareModal(k);
    if (a === 'conflicts') return conflictsModal(k);
    if (a === 'pr-tile') return showTile('pr');
    if (a === 'history') return historyModal(k);
    if (a === 'another') return anotherModal(k);
    if (a === 'pr-refresh') { delete C.pr[k]; return redraw('pr'); }
    if (a === 'issues-refresh') { delete C.issues[k]; return redraw('issues'); }
    if (a === 'fix-checks' || a === 'fix-comments') { await api(k, '/pr/fix', { method: 'POST', body: { which: a === 'fix-checks' ? 'checks' : 'comments' } }); return X.toast('Sent to the bot', { type: 'success' }); }
    if (a === 'problems') {
      C.problems[k] = { running: true }; redraw('problems');
      try { C.problems[k] = await api(k, '/problems'); } catch (err) { C.problems[k] = null; fail(err); }
      return redraw('problems');
    }
    if (a === 'fix-problems') {
      const d = C.problems[k];
      return send(k, `Fix these problems from \`${d.cmd}\` (errors first; leave warnings unless the fix is obvious and safe):\n\n${d.problems.slice(0, 80).map((p) => `- ${p.file}:${p.line}${p.col ? ':' + p.col : ''} ${p.msg}`).join('\n')}${d.problems.length > 80 ? `\n…and ${d.problems.length - 80} more` : ''}\n\nRun the check again afterwards.`);
    }
  } catch (err) { fail(err); t.disabled = false; }
});

// ---------- history, blame ----------
async function historyModal(k, file = '') {
  const el = X.modal(`<div class="modal-head"><h2>History${file ? ` · <span class="mono">${X.esc(file)}</span>` : ''}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="c2-hist"><p class="muted">Loading…</p></div>`, { wide: true });
  const drawIt = async () => {
    let d; try { d = await api(k, `/log${file ? '?file=' + enc(file) : ''}`); } catch (err) { return fail(err); }
    el.querySelector('.c2-hist').innerHTML = d.commits.map((c) => `<div class="c2-row"><code class="mono">${c.short}</code><span class="c2-grow">${X.esc(c.subject)}<small class="muted"> · ${X.esc(c.author)} · ${ago(c.at)}${c.merge ? ' · merge' : ''}</small></span>
      <button class="btn small" data-h-view="${c.sha}">View</button><button class="btn small ghost" data-h-revert="${c.sha}" title="Make a new commit that undoes this one">Revert</button></div>`).join('') || '<p class="muted">No commits yet.</p>';
  };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal();
    const v = e.target.closest('[data-h-view]'); if (v) return diffModal(`Commit ${v.dataset.hView.slice(0, 7)}`, `/api/code/${enc(k)}/diff?what=commit&ref=${v.dataset.hView}`);
    const r = e.target.closest('[data-h-revert]');
    if (r && confirm('Make a new commit that undoes this one? Nothing is lost: you can revert the revert.')) { try { await api(k, '/revert', { method: 'POST', body: { sha: r.dataset.hRevert } }); X.toast('Reverted', { type: 'success' }); drawIt(); reloadCode(); } catch (err) { fail(err); } }
  });
  drawIt();
}
async function blameModal(k, file) {
  if (!file) return;
  const el = X.modal(`<div class="modal-head"><h2>Blame · <span class="mono">${X.esc(file)}</span></h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="c2-blame"><p class="muted">Loading…</p></div>`, { wide: true });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  try {
    const d = await api(k, `/blame?path=${enc(file)}`); let prev = '';
    el.querySelector('.c2-blame').innerHTML = `<table class="c2-bt">${d.lines.map((l, n) => { const same = l.sha === prev; prev = l.sha;
      return `<tr class="${same ? '' : 'top'}"><td class="who" title="${X.esc(l.summary || '')}">${same ? '' : `<code>${l.sha}</code> ${X.esc((l.author || '').split(' ')[0])} · ${l.at ? ago(l.at) : ''}`}</td><td class="ln">${n + 1}</td><td class="code">${X.esc(l.text)}</td></tr>`; }).join('')}</table>`;
  } catch (err) { el.querySelector('.c2-blame').innerHTML = `<p class="muted">${X.esc(err.message)}</p>`; }
}

// ---------- merge conflicts ----------
CODE_EXT.conflict = async (k) => {
  const i = codeInfo();
  if (!confirm(`${i.branch} and ${i.base} both changed the same lines, so it can’t merge yet.\n\nBring ${i.base} into this branch now and pick which side wins for each conflict? (Nothing is pushed; you can abort.)`)) return;
  try { const r = await api(k, '/sync-base', { method: 'POST' }); if (r.ok) { X.toast(`${i.base} merged into this branch with no conflicts. Merge again.`); return reloadCode(); } conflictsModal(k); }
  catch (err) { fail(err); }
};
async function conflictsModal(k) {
  const el = X.modal(`<div class="modal-head"><h2>Resolve conflicts</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="c2-cf"><p class="muted">Loading…</p></div>`, { wide: true, cls: 'c2-cf-modal' });
  let d;
  const drawIt = async () => {
    try { d = await api(k, '/conflicts'); } catch (err) { return fail(err); }
    const box = el.querySelector('.c2-cf');
    if (!d.files.length) {
      box.innerHTML = d.merging ? `<p>✓ All conflicts resolved.</p><div class="ex-btns"><button class="btn primary" data-cf="finish">Finish the merge (commit)</button></div>` : '<p class="muted">No merge in progress.</p>';
      return;
    }
    box.innerHTML = `<p class="muted small">For each conflict, keep <b>this branch</b> (${X.esc(d.branch)}), <b>${X.esc(d.base)}</b>, or both. Save each file, then finish.</p>
      <div class="ex-btns"><button class="btn small" data-cf="ask">Ask the bot to resolve them (uses Claude)</button><button class="btn small ghost" data-cf="abort">Abort the merge</button></div>
      ${d.files.map((f, fi) => { let n = 0; return `<section class="c2-cff" data-cff="${fi}"><h4 class="mono">${X.esc(f.file)}</h4>${f.parts.map((p) => p.t === 'text' ? (p.s.trim() ? `<pre class="c2-ctx">${X.esc(p.s.split('\n').slice(-3).join('\n'))}</pre>` : '') : (() => { const id = n++; return `<div class="c2-cfx"><label class="c2-side ours"><input type="radio" name="cf${fi}-${id}" value="ours" checked><b>This branch</b><pre>${X.esc(p.ours)}</pre></label><label class="c2-side theirs"><input type="radio" name="cf${fi}-${id}" value="theirs"><b>${X.esc(d.base)}</b><pre>${X.esc(p.theirs)}</pre></label><label class="c2-ck"><input type="radio" name="cf${fi}-${id}" value="both"> Keep both</label></div>`; })()).join('')}
        <button class="btn primary small" data-cf="save" data-fi="${fi}">Save ${X.esc(f.file.split('/').pop())}</button></section>`; }).join('')}`;
  };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal();
    const b = e.target.closest('[data-cf]'); if (!b) return;
    try {
      if (b.dataset.cf === 'save') {
        const fi = Number(b.dataset.fi), sec = el.querySelector(`[data-cff="${fi}"]`), n = sec.querySelectorAll('.c2-cfx').length;
        const picks = [...Array(n)].map((_, i) => sec.querySelector(`input[name="cf${fi}-${i}"]:checked`)?.value || 'ours');
        await api(k, '/conflicts/resolve', { method: 'POST', body: { file: d.files[fi].file, picks } }); X.toast('Saved'); return drawIt();
      }
      if (b.dataset.cf === 'finish') { await api(k, '/conflicts/finish', { method: 'POST' }); delete C.status[k]; X.closeModal(); X.toast(`Done. Now merge into ${codeInfo()?.base || 'the base'} again.`, { type: 'success' }); return reloadCode(); }
      if (b.dataset.cf === 'abort') { if (!confirm('Abort the merge? The branch goes back to how it was before.')) return; await api(k, '/conflicts/abort', { method: 'POST' }); delete C.status[k]; X.closeModal(); return reloadCode(); }
      if (b.dataset.cf === 'ask') { X.closeModal(); return send(k, `A merge of ${d.base} into this branch is in progress with conflicts in: ${d.files.map((f) => f.file).join(', ')}. Resolve every conflict keeping the intent of both sides, run the tests, then \`git add\` the files and \`git commit --no-edit\` to finish the merge. Don't push.`); }
    } catch (err) { fail(err); }
  });
  drawIt();
}

// ---------- Try another way (best-of-2) ----------
async function anotherModal(k) {
  const c = X.S.data.threads.find((t) => 't:' + t.id === k), p = X.S.data.projects.find((x) => x.id === c?.project_id);
  const el = X.modal(`<div class="modal-head"><h2>Try another way</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <p class="muted">Starts a new chat on its own branch with this chat’s first message, so you can compare two attempts and keep the better one. This doubles the Claude usage for the task.</p>
    <label class="field">Bot for the second attempt<select id="c2-ab">${X.S.data.bots.map((b) => `<option value="${b.id}" ${b.id === c?.bot_id ? 'selected' : ''}>${X.esc(b.name)}${b.model ? ` (${X.esc(b.model)})` : ''}</option>`).join('')}</select></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="c2-ago">Start second attempt</button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal();
    if (e.target.id !== 'c2-ago') return;
    e.target.disabled = true;
    try { const r = await api(k, '/another', { method: 'POST', body: { botId: Number(el.querySelector('#c2-ab').value) } }); X.closeModal(); await X.refreshState(); X.toast('Second attempt started. Compare from the Overview tile.', { type: 'success' }); delete C.status[k]; redraw('about'); void r; }
    catch (err) { fail(err); e.target.disabled = false; }
  });
}
async function compareModal(k) {
  const el = X.modal(`<div class="modal-head"><h2>Compare attempts</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="c2-cmp"><p class="muted">Loading…</p></div>`, { wide: true });
  let d; try { d = await api(k, '/compare'); } catch (err) { return fail(err); }
  const col = (s) => s ? `<div class="c2-cmpc"><h3>${X.esc(s.title)}</h3><p class="muted small">${X.esc(X.bot(s.bot)?.name || '')} · <code>${X.esc(s.branch || '')}</code> · $${s.cost}${s.busy ? ' · <b>still working</b>' : ''}</p>
      <p><span class="add">+${s.add}</span> <span class="del">−${s.del}</span> in ${s.files.length} files</p><div class="c2-list">${s.files.slice(0, 30).map((f) => `<div class="mono small">${X.esc(f.file)} <span class="add">+${f.add}</span> <span class="del">−${f.del}</span></div>`).join('')}</div>
      <div class="ex-btns"><button class="btn small" data-cmp-diff="${s.key}">View diff</button><button class="btn small" data-cmp-open="${s.key}">Open chat</button><button class="btn primary small" data-cmp-keep="${s.key}" ${s.busy ? 'disabled' : ''}>Keep this one</button></div></div>` : '<p class="muted">The other attempt is gone.</p>';
  el.querySelector('.c2-cmp').innerHTML = `<div class="c2-cmpg">${col(d.a)}${col(d.b)}</div><p class="muted small">Keep archives the other chat; its branch stays in git in case you change your mind.</p>`;
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal();
    const t = e.target.closest('[data-cmp-diff], [data-cmp-open], [data-cmp-keep]'); if (!t) return;
    if (t.dataset.cmpDiff) return diffModal('Whole branch', `/api/code/${enc(t.dataset.cmpDiff)}/diff?what=branch`);
    if (t.dataset.cmpOpen) { X.closeModal(); return X.openThread(t.dataset.cmpOpen); }
    if (t.dataset.cmpKeep && confirm('Keep this attempt and archive the other one?')) { try { await api(t.dataset.cmpKeep, '/keep', { method: 'POST' }); X.closeModal(); await X.refreshState(); X.openThread(t.dataset.cmpKeep); } catch (err) { fail(err); } }
  });
}

// ---------- Ctrl+P, Ctrl+Shift+F ----------
async function files(k) {
  const c = C.files[k]; if (fresh(c, 30000)) return c.list;
  const r = await X.api(`/api/code/${enc(k)}/files`); C.files[k] = { at: Date.now(), list: r.files }; return r.files;
}
const score = (f, q) => { // simple fuzzy: all letters in order; prefer the file name and short paths
  const lf = f.toLowerCase(), name = lf.split('/').pop(); let i = 0, s = 0;
  for (const ch of q) { const j = lf.indexOf(ch, i); if (j < 0) return null; s += j - i; i = j + 1; }
  return s + (name.includes(q) ? -50 : 0) + (name.startsWith(q) ? -50 : 0) + f.length / 20;
};
export function fileMatches(q, max = 8) {
  const k = codeKey() || (X?.threadKey && /^t:/.test(X.threadKey()) ? X.threadKey() : null);
  const c = k && C.files[k]; if (!c) { if (k) files(k).catch(() => {}); return []; }
  q = q.toLowerCase(); return c.list.map((f) => [f, q ? score(f, q) : f.length]).filter(([, s]) => s !== null).sort((a, b) => a[1] - b[1]).slice(0, max).map(([f]) => f);
}
async function quickOpen(k) {
  try { await files(k); } catch (err) { return fail(err); }
  const el = X.modal(`<div class="c2-qo"><input id="c2-qo" placeholder="Go to file…" autocomplete="off"><div class="c2-qol"></div></div>`, { cls: 'c2-qo-modal' });
  const inp = el.querySelector('#c2-qo'), list = el.querySelector('.c2-qol'); let sel = 0, items = [];
  const paint = () => { items = fileMatches(inp.value.trim(), 40); sel = Math.min(sel, Math.max(0, items.length - 1)); list.innerHTML = items.map((f, n) => `<button class="${n === sel ? 'on' : ''}" data-qo="${X.esc(f)}"><b>${X.esc(f.split('/').pop())}</b><small>${X.esc(f)}</small></button>`).join('') || '<p class="muted small">No files match.</p>'; list.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); };
  const go = (f) => { if (!f) return; X.closeModal(); openInEditor(f); };
  inp.addEventListener('input', () => { sel = 0; paint(); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); sel = (sel + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % Math.max(1, items.length); paint(); } if (e.key === 'Enter') { e.preventDefault(); go(items[sel]); } });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-qo]'); if (b) go(b.dataset.qo); });
  paint(); setTimeout(() => inp.focus(), 30);
}
document.addEventListener('keydown', (e) => {
  const k = codeKey(); if (!k || !(e.ctrlKey || e.metaKey)) return;
  if (e.key.toLowerCase() === 'p' && !e.shiftKey) { e.preventDefault(); quickOpen(k); }
  if (e.key.toLowerCase() === 'f' && e.shiftKey) { e.preventDefault(); showTile('search'); setTimeout(() => document.querySelector('[data-c2f="search"] input')?.focus(), 400); }
});

// ---------- comment on a diff line ----------
document.addEventListener('click', (e) => {
  const td = e.target.closest('.dv-t tr.a td.code, .dv-t tr.c td.code, .dv-t tr.d td.code'); if (!td || getSelection().toString()) return;
  const k = codeKey() || (/^t:/.test(X.threadKey() || '') ? X.threadKey() : null); if (!k) return;
  const tr = td.parentElement; if (tr.nextElementSibling?.classList.contains('c2-lc')) return tr.nextElementSibling.querySelector('textarea').focus();
  const file = tr.closest('section')?.querySelector('h4')?.childNodes[0]?.textContent.trim(), [o, n] = [...tr.querySelectorAll('td.ln')].map((x) => x.textContent);
  const line = n || o, code = td.textContent.slice(1);
  tr.insertAdjacentHTML('afterend', `<tr class="c2-lc"><td colspan="3"><textarea rows="2" placeholder="Comment for the bot about ${X.esc(file)}:${line}… (Enter to send)"></textarea><div class="ex-btns"><button class="btn primary small" data-lc-send>Send to bot</button><button class="btn small ghost" data-lc-x>Cancel</button></div></td></tr>`);
  const row = tr.nextElementSibling, ta = row.querySelector('textarea'); ta.focus();
  const go = async () => { const t = ta.value.trim(); if (!t) return; try { await send(k, `In \`${file}\` at line ${line}${n ? '' : ' (old version, removed line)'}:\n\`\`\`\n${code}\n\`\`\`\n${t}`); row.innerHTML = '<td colspan="3" class="muted small">✓ Sent to the bot</td>'; } catch (err) { fail(err); } };
  row.querySelector('[data-lc-send]').onclick = go; row.querySelector('[data-lc-x]').onclick = () => row.remove();
  ta.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); go(); } if (ev.key === 'Escape') row.remove(); });
});

// ---------- preview: console errors, failed requests, pick an element ----------
const PV = { key: null, items: [] };
function probeBar(root) {
  const f = root.querySelector('.cp-frame'); if (!f) return;
  if (PV.key !== codeKey()) { PV.key = codeKey(); PV.items = []; }
  let bar = f.previousElementSibling?.classList.contains('pv-bar') ? f.previousElementSibling : null;
  if (!bar) { bar = document.createElement('div'); bar.className = 'pv-bar'; f.before(bar); }
  const errs = PV.items.length;
  bar.innerHTML = `<button class="btn small" data-pv="pick" title="Click an element in the preview to tell the bot about it">⌖ Pick element</button>
    <span class="${errs ? 'c2-bad' : 'muted'} small">${errs ? `${errs} error${errs === 1 ? '' : 's'} in the page` : 'No errors in the page'}</span>
    ${errs ? '<button class="btn small" data-pv="show">Show</button><button class="btn small" data-pv="send">Send to bot</button><button class="btn small ghost" data-pv="clear">Clear</button>' : ''}<div class="pv-errs" hidden></div>`;
}
addEventListener('message', (e) => {
  const d = e.data; if (!d?.nimbusProbe) return;
  const f = [...document.querySelectorAll('.cp-frame')].find((x) => x.contentWindow === e.source); if (!f) return;
  if (d.kind === 'pick') {
    const ta = document.querySelector('#msg'); if (!ta) return;
    ta.value = `In the preview (page ${d.page}), this element:\n\`${d.selector}\`${d.text ? ` (text: “${d.text.slice(0, 120)}”)` : ''}\n\`\`\`html\n${d.html}\n\`\`\`\nChange: `;
    ta.dispatchEvent(new Event('input')); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); X.toast('Element added to your message: say what to change');
    return;
  }
  if (d.kind === 'load') return;
  if (d.level !== 'error') return;
  if (PV.items.length < 100 && !PV.items.some((x) => x.text === d.text)) PV.items.push({ ...d, at: Date.now() });
  const root = f.closest('#codepane'); if (root) probeBar(root);
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-pv]'); if (!b) return;
  const a = b.dataset.pv, f = b.closest('.cp-body, .ws-tile, #codepane')?.querySelector('.cp-frame');
  if (a === 'pick') { f?.contentWindow?.postMessage({ nimbusPick: true }, '*'); return X.toast('Click an element in the preview (Esc to cancel)'); }
  if (a === 'clear') { PV.items = []; return probeBar(document.querySelector('#codepane')); }
  if (a === 'show') { const box = b.parentElement.querySelector('.pv-errs'); box.hidden = !box.hidden; box.innerHTML = PV.items.map((x) => `<pre>${X.esc(`[${x.kind}] ${x.page} · ${x.text}`)}</pre>`).join(''); return; }
  if (a === 'send') { const k = codeKey(); if (!k) return; try { await send(k, `The app preview shows these errors (console, uncaught errors and failed requests). Find the cause and fix it:\n\n\`\`\`\n${PV.items.map((x) => `[${x.kind}] page ${x.page}: ${x.text}`).join('\n').slice(0, 8000)}\n\`\`\``); PV.items = []; probeBar(document.querySelector('#codepane')); } catch (err) { fail(err); } }
});

// ---------- test results after a turn (message kind 'testrun') ----------
export function renderTestRun(m) {
  let t = {}; try { t = JSON.parse(m.body); } catch {}
  return `<div class="note c2-tr ${t.ok ? 'ok' : 'bad'}" data-mid="${m.id}">${t.ok ? '✓ Tests passed' : `✗ Tests failed (exit ${t.code})`} after this turn · <code>${X.esc(t.cmd || '')}</code> · ${t.secs ?? 0}s
    ${t.ok ? '' : `<details><summary>Output</summary><pre class="cp-out">${X.esc(t.out || '')}</pre></details><button class="btn small" data-tr-fix="${m.id}">Ask the bot to fix it</button>`}</div>`;
}
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-tr-fix]'); if (!b) return;
  const m = X.S.messages.find((x) => x.id === Number(b.dataset.trFix)); let t = {}; try { t = JSON.parse(m.body); } catch {}
  try { await send(X.threadKey(), `The tests failed after your last change (\`${t.cmd}\`, exit ${t.code}). Fix them. Output:\n\n\`\`\`\n${t.out}\n\`\`\``); b.disabled = true; } catch (err) { fail(err); }
});
