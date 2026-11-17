// Screens for extras.js on the server: Watchdog, Playbooks, Hand-offs, Team memory, Budgets (all in Settings),
// the "Since yesterday" card on Home, Send later, Save as playbook and Post-mortem. No Claude calls here.
let X;
export function initExtras(ctx) { X = ctx; }
const $ = (s, r = document) => r.querySelector(s);
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const when = (t) => new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
const botOpts = (sel, none = 'Nobody') => `<option value="">${none}</option>` + X.S.data.bots.map((b) => `<option value="${b.id}" ${Number(sel) === b.id ? 'selected' : ''}>${X.esc(b.name)}</option>`).join('');
const botTag = (id) => { const b = X.bot(id); return b ? `<span class="ex-bot">${X.avatar(b, 18)}${X.esc(b.name)}</span>` : '<span class="muted">—</span>'; };
function page(title, intro, cls = '') {
  const el = X.modal(`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="ex-body ${cls}"><p class="muted ex-intro">${intro}</p><div class="ex-main"><p class="muted">Loading…</p></div></div>`, { wide: true, cls: 'ex-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  return el;
}
const top = (el) => requestAnimationFrame(() => { if (el.contains(document.activeElement)) document.activeElement.blur(); (el.closest('.set-body') || el).scrollTop = 0; });
const fail = (e) => X.toast(e.message || String(e), { type: 'error' });
const form = (el) => Object.fromEntries([...el.querySelectorAll('[name]')].map((i) => [i.name, i.type === 'checkbox' ? i.checked : i.value]));

// ---------- Watchdog ----------
const KINDS = { tcp: ['Port', 'host:port, e.g. 192.168.1.10:8006'], http: ['Web page', 'URL, e.g. http://192.168.1.50:2283'], ping: ['Ping', 'host, e.g. 192.168.1.1'], disk: ['Disk on Nimbus', 'path:percent, e.g. /:90'] };
export async function watchdogPage(edit = null) {
  const el = page('Watchdog', 'Nimbus checks these every 2 minutes on its own (no Claude). When one goes down twice in a row, the bot that owns it gets a note, and can run a playbook or be woken up to fix it.');
  let w, pb, log, sp;
  try { [w, pb, log, sp] = await Promise.all([X.api('/api/extras/watches'), X.api('/api/extras/playbooks'), X.api('/api/extras/watch-log'), X.api('/api/extras/status-page')]); } catch (e) { return fail(e); }
  const cur = w.items.find((x) => x.id === edit) || {};
  const pbOpts = (sel) => '<option value="">No playbook</option>' + pb.items.map((p) => `<option value="${p.id}" ${Number(sel) === p.id ? 'selected' : ''}>${X.esc(p.name)}</option>`).join('');
  el.querySelector('.ex-main').innerHTML = `
    <div class="ex-list">${w.items.map((x) => `<div class="ex-row ${x.enabled ? '' : 'off'}">
      <span class="ex-dot ${x.enabled ? x.state : 'off'}" title="${x.enabled ? x.state : 'paused'}"></span>
      <span class="ex-grow"><b>${X.esc(x.name)}</b><small>${KINDS[x.kind]?.[0] || x.kind} · <code>${X.esc(x.target)}</code> · ${X.esc(x.detail || 'not checked yet')}${x.since ? ` · since ${ago(x.since)}` : ''}</small>
        <small>${botTag(x.bot_id)}${x.playbook_id ? ` · runs “${X.esc(pb.items.find((p) => p.id === x.playbook_id)?.name || '?')}”` : ''}${x.wake ? ' · wakes the bot (uses Claude)' : ''}</small></span>
      <button class="btn small" data-w-check="${x.id}">Check</button><button class="btn small" data-w-edit="${x.id}">Edit</button>
      <button class="icon-btn" data-w-del="${x.id}" aria-label="Delete">${X.ICON.close}</button></div>`).join('') || '<p class="muted">Nothing watched yet.</p>'}</div>
    <form class="ex-form" id="w-form"><h3>${cur.id ? 'Edit check' : 'Add a check'}</h3>
      <div class="ex-grid"><label>Name<input name="name" value="${X.esc(cur.name || '')}" placeholder="Proxmox"></label>
        <label>Kind<select name="kind">${Object.entries(KINDS).map(([k, [l]]) => `<option value="${k}" ${cur.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="wide">Target<input name="target" value="${X.esc(cur.target || '')}" placeholder="${KINDS[cur.kind || 'tcp'][1]}"></label>
        <label>Owner bot<select name="bot_id">${botOpts(cur.bot_id)}</select></label>
        <label>When down, run<select name="playbook_id">${pbOpts(cur.playbook_id)}</select></label></div>
      <label class="ex-check"><input type="checkbox" name="wake" ${cur.wake ? 'checked' : ''}> When down (and no playbook), wake the owner bot to investigate. This uses Claude.</label>
      <label class="ex-check"><input type="checkbox" name="enabled" ${cur.enabled ?? 1 ? 'checked' : ''}> On</label>
      <div class="ex-btns">${cur.id ? '<button type="button" class="btn" data-w-cancel>Cancel</button>' : ''}<button class="btn primary">${cur.id ? 'Save' : 'Add'}</button></div></form>
    <div class="ex-form"><h3>Status page</h3><label class="ex-check"><input type="checkbox" id="sp-on" ${sp.on ? 'checked' : ''}> Share a read-only page at <a href="/status" target="_blank">${location.origin}/status</a></label>
      <p class="muted small">No login needed: it shows only names and up/down, no addresses. Anyone who can reach Nimbus (your network, Twingate) can open it.</p></div>
    ${log.items.length ? `<div class="ex-form"><h3>Recent changes</h3>${log.items.slice(0, 12).map((l) => `<div class="ex-log"><span class="ex-dot ${l.state}"></span>${X.esc(l.name)} went ${l.state} <span class="muted">· ${X.esc(l.detail)} · ${ago(l.at)}</span></div>`).join('')}</div>` : ''}`;
  top(el);
  el.querySelector('[name=kind]').addEventListener('change', (e) => { el.querySelector('[name=target]').placeholder = KINDS[e.target.value][1]; });
  el.querySelector('#sp-on').addEventListener('change', (e) => X.api('/api/extras/status-page', { method: 'PUT', body: { on: e.target.checked } }).catch(fail));
  el.querySelector('#w-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await X.api(cur.id ? `/api/extras/watches/${cur.id}` : '/api/extras/watches', { method: cur.id ? 'PATCH' : 'POST', body: form(e.target) }); X.toast(cur.id ? 'Saved' : 'Added; first check within 2 minutes', { type: 'success' }); watchdogPage(); }
    catch (err) { fail(err); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-w-check],[data-w-edit],[data-w-del],[data-w-cancel]'); if (!t) return;
    if (t.dataset.wCancel != null) return watchdogPage();
    if (t.dataset.wEdit) return watchdogPage(Number(t.dataset.wEdit));
    if (t.dataset.wDel) { if (!confirm('Stop watching this?')) return; await X.api(`/api/extras/watches/${t.dataset.wDel}`, { method: 'DELETE' }).catch(fail); return watchdogPage(); }
    t.disabled = true; t.textContent = '…';
    try { const r = await X.api(`/api/extras/watches/${t.dataset.wCheck}/check`, { method: 'POST' }); X.toast(`${r.up ? 'Up' : 'Down'}: ${r.detail}${r.ms ? ` (${r.ms} ms)` : ''}`, { type: r.up ? 'success' : 'error' }); }
    catch (err) { fail(err); } finally { t.disabled = false; t.textContent = 'Check'; }
  });
}

// ---------- Playbooks ----------
export async function playbooksPage(edit = null, prefill = null) {
  const el = page('Playbooks', 'Saved fixes: commands that run straight on the Nimbus server as the Nimbus user, one after another, stopping at the first failure. No Claude, no plan usage. The watchdog can run one when something goes down.');
  let d; try { d = await X.api('/api/extras/playbooks'); } catch (e) { return fail(e); }
  const cur = prefill || d.items.find((x) => x.id === edit) || {};
  const cmds = (x) => { try { return JSON.parse(x.commands || '[]'); } catch { return []; } };
  el.querySelector('.ex-main').innerHTML = `
    <div class="ex-list">${d.items.map((p) => `<div class="ex-row">
      <span class="ex-dot ${p.last_run ? (p.last_ok ? 'up' : 'down') : 'unknown'}"></span>
      <span class="ex-grow"><b>${X.esc(p.name)}</b><small>${botTag(p.bot_id)} · ${cmds(p).length} command${cmds(p).length === 1 ? '' : 's'} · ${p.last_run ? `last run ${ago(p.last_run)}, ${p.last_ok ? 'worked' : 'failed'}` : 'never run'}</small>
        <code class="ex-cmds">${X.esc(cmds(p).join('\n'))}</code>${p.last_out ? `<details><summary class="muted small">Last output</summary><pre class="ex-out">${X.esc(p.last_out)}</pre></details>` : ''}</span>
      <button class="btn small primary" data-p-run="${p.id}">Run</button><button class="btn small" data-p-edit="${p.id}">Edit</button>
      <button class="icon-btn" data-p-del="${p.id}" aria-label="Delete">${X.ICON.close}</button></div>`).join('') || '<p class="muted">No playbooks yet. Make one below, or open a finished task’s steps and pick “Save as playbook”.</p>'}</div>
    <form class="ex-form" id="p-form"><h3>${cur.id ? 'Edit playbook' : 'New playbook'}</h3>
      <div class="ex-grid"><label class="wide">Name<input name="name" value="${X.esc(cur.name || '')}" placeholder="Restart Immich"></label>
        <label>Bot<select name="bot_id">${botOpts(cur.bot_id, 'None (runs in your home folder)')}</select></label></div>
      <label>Commands, one per line<textarea name="commands" rows="6" class="mono" placeholder="ssh root@192.168.1.10 pct restart 103">${X.esc(cmds(cur).join('\n'))}</textarea></label>
      <p class="muted small">Check the commands before saving: they run without asking. Each one may take up to 2 minutes.</p>
      <div class="ex-btns">${cur.id || prefill ? '<button type="button" class="btn" data-p-cancel>Cancel</button>' : ''}<button class="btn primary">${cur.id ? 'Save' : 'Create'}</button></div></form>`;
  top(el);
  el.querySelector('#p-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await X.api(cur.id ? `/api/extras/playbooks/${cur.id}` : '/api/extras/playbooks', { method: cur.id ? 'PATCH' : 'POST', body: form(e.target) }); X.toast('Saved', { type: 'success' }); playbooksPage(); }
    catch (err) { fail(err); }
  });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-p-run],[data-p-edit],[data-p-del],[data-p-cancel]'); if (!t) return;
    if (t.dataset.pCancel != null) return playbooksPage();
    if (t.dataset.pEdit) return playbooksPage(Number(t.dataset.pEdit));
    if (t.dataset.pDel) { if (!confirm('Delete this playbook?')) return; await X.api(`/api/extras/playbooks/${t.dataset.pDel}`, { method: 'DELETE' }).catch(fail); return playbooksPage(); }
    t.disabled = true; t.textContent = 'Running…';
    try { const r = await X.api(`/api/extras/playbooks/${t.dataset.pRun}/run`, { method: 'POST' }); X.toast(r.ok ? 'Playbook worked' : 'Playbook failed: see Last output', { type: r.ok ? 'success' : 'error' }); playbooksPage(); }
    catch (err) { fail(err); t.disabled = false; t.textContent = 'Run'; }
  });
}
// From a finished task's steps: the commands it ran become a playbook draft.
export function saveAsPlaybook(trace, botId) {
  const cmds = (trace.steps || []).filter((s) => s.tool === 'Bash' && s.cmd && s.state === 'done').map((s) => s.cmd.trim());
  if (!cmds.length) return X.toast('This task ran no commands to save');
  X.openSettings('playbooks', () => playbooksPage(null, { name: '', bot_id: botId, commands: JSON.stringify(cmds) }));
}

// ---------- Hand-offs ----------
export async function chainsPage() {
  const el = page('Hand-offs', 'When a bot finishes a reply, Nimbus can pass it to another bot automatically. That bot gets it in its Inbox and works on it (this uses Claude). Chains stop after two hops.');
  let d; try { d = await X.api('/api/extras/chains'); } catch (e) { return fail(e); }
  el.querySelector('.ex-main').innerHTML = `
    <div class="ex-list">${d.items.map((c) => `<div class="ex-row ${c.enabled ? '' : 'off'}"><span class="ex-grow"><span class="ex-rule">When ${botTag(c.from_bot)} replies${c.match ? ` with <code>${X.esc(c.match)}</code>` : ''} → hand to ${botTag(c.to_bot)}</span>${c.note ? `<small>${X.esc(c.note)}</small>` : ''}</span>
      <input type="checkbox" class="switch" title="On/off" data-c-on="${c.id}" ${c.enabled ? 'checked' : ''}>
      <button class="icon-btn" data-c-del="${c.id}" aria-label="Delete">${X.ICON.close}</button></div>`).join('') || '<p class="muted">No hand-offs yet.</p>'}</div>
    <form class="ex-form" id="c-form"><h3>New hand-off</h3>
      <div class="ex-grid"><label>When this bot replies<select name="from_bot">${botOpts('', 'Pick a bot')}</select></label>
        <label>and the reply contains<input name="match" placeholder="new device (or /regex/, blank = any reply)"></label>
        <label>hand it to<select name="to_bot">${botOpts('', 'Pick a bot')}</select></label>
        <label>with this note<input name="note" placeholder="Add it to the UniFi device list"></label></div>
      <div class="ex-btns"><button class="btn primary">Add</button></div></form>`;
  top(el);
  el.querySelector('#c-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await X.api('/api/extras/chains', { method: 'POST', body: form(e.target) }); chainsPage(); } catch (err) { fail(err); } });
  el.addEventListener('change', (e) => { const t = e.target.closest('[data-c-on]'); if (t) X.api(`/api/extras/chains/${t.dataset.cOn}`, { method: 'PATCH', body: { enabled: t.checked } }).catch(fail); });
  el.addEventListener('click', async (e) => { const t = e.target.closest('[data-c-del]'); if (t && confirm('Delete this hand-off?')) { await X.api(`/api/extras/chains/${t.dataset.cDel}`, { method: 'DELETE' }).catch(fail); chainsPage(); } });
}

// ---------- Team memory ----------
export async function factsPage(query = '') {
  const el = page('Team memory', 'Facts every bot can search (node bin/facts.mjs search …) before asking a teammate or checking again. Bots add to it as they learn; you can too.');
  let d; try { d = await X.api(query ? `/api/extras/facts/search?q=${encodeURIComponent(query)}` : '/api/extras/facts'); } catch (e) { return fail(e); }
  const items = query ? d.items : d.items.slice().reverse();
  el.querySelector('.ex-main').innerHTML = `
    <form class="ex-search" id="f-search"><input name="q" value="${X.esc(query)}" placeholder="Search team memory"><button class="btn">Search</button></form>
    <div class="ex-list">${items.map((f) => `<div class="ex-row"><span class="ex-grow"><span>${X.esc(f.text)}</span><small>${f.topic ? `<i class="ex-topic">${X.esc(f.topic)}</i> · ` : ''}${f.bot_id ? botTag(f.bot_id) : 'You'} · ${ago(f.updated_at)}</small></span>
      <button class="icon-btn" data-f-del="${f.id}" aria-label="Delete">${X.ICON.close}</button></div>`).join('') || `<p class="muted">${query ? 'Nothing matches.' : 'Empty so far.'}</p>`}</div>
    <form class="ex-form" id="f-form"><h3>Add a fact</h3><div class="ex-grid"><label class="wide">Fact<input name="text" placeholder="Immich runs in CT 103 at 192.168.1.50:2283"></label><label>Topic<input name="topic" placeholder="immich"></label></div>
      <div class="ex-btns"><button class="btn primary">Add</button></div></form>`;
  top(el);
  el.querySelector('#f-search').addEventListener('submit', (e) => { e.preventDefault(); factsPage(form(e.target).q.trim()); });
  el.querySelector('#f-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await X.api('/api/extras/facts', { method: 'POST', body: form(e.target) }); factsPage(query); } catch (err) { fail(err); } });
  el.addEventListener('click', async (e) => { const t = e.target.closest('[data-f-del]'); if (t) { await X.api(`/api/extras/facts/${t.dataset.fDel}`, { method: 'DELETE' }).catch(fail); factsPage(query); } });
}

// ---------- Budgets ----------
export async function budgetsPage() {
  const el = page('Budgets', 'A weekly cap per bot (last 7 days, in plan-equivalent dollars as Claude reports them). Over its cap, a bot’s routines, watchdog wake-ups, hand-offs and requests from other bots are skipped. Your own messages always go through.');
  let d; try { d = await X.api('/api/extras/budgets'); } catch (e) { return fail(e); }
  el.querySelector('.ex-main').innerHTML = `<form id="b-form"><div class="ex-list">${X.S.data.bots.map((b) => { const used = d.week[b.id] || 0, cap = d.budgets[b.id];
    return `<div class="ex-row"><span class="ex-grow">${botTag(b.id)}<span class="ex-meter"><i style="width:${cap ? Math.min(100, used / cap * 100) : 0}%" class="${cap && used >= cap ? 'over' : ''}"></i></span>
      <small>$${used.toFixed(2)} this week${cap ? ` of $${Number(cap).toFixed(2)}` : ' · no cap'}</small></span>
      <label class="ex-money">$<input type="number" min="0" step="0.5" name="${b.id}" value="${cap || ''}" placeholder="No cap"></label></div>`; }).join('')}</div>
    <div class="ex-btns"><button class="btn primary">Save</button></div></form>`;
  top(el);
  el.querySelector('#b-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await X.api('/api/extras/budgets', { method: 'PUT', body: { budgets: form(e.target) } }); X.toast('Budgets saved', { type: 'success' }); budgetsPage(); } catch (err) { fail(err); } });
}

// ---------- Send later ----------
export async function laterModal(thread, text = '') {
  const pad = (n) => String(n).padStart(2, '0'), t = new Date(Date.now() + 3600e3); t.setMinutes(0);
  const local = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:00`;
  const el = X.modal(`<div class="modal-head"><h2>Send later</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <form id="l-form" class="ex-form flat"><label>Message<textarea name="text" rows="4">${X.esc(text)}</textarea></label>
      <div class="ex-grid"><label>When<input type="datetime-local" name="at" value="${local}"></label>
      <div class="ex-quick">${[['In 1 hour', 1], ['Tonight 8 PM', 'e'], ['Tomorrow 9 AM', 'm']].map(([l, v]) => `<button type="button" class="btn small" data-l-q="${v}">${l}</button>`).join('')}</div></div>
      <div class="ex-btns"><button type="button" class="btn" data-close>Cancel</button><button class="btn primary">Schedule</button></div></form>
    <div id="l-list"></div>`, { cls: 'ex-modal' });
  const draw = async () => { const d = await X.api(`/api/extras/scheduled?thread=${encodeURIComponent(thread)}`).catch(() => ({ items: [] }));
    el.querySelector('#l-list').innerHTML = d.items.length ? `<h3 class="ex-h">Waiting to send here</h3>` + d.items.map((m) => `<div class="ex-row"><span class="ex-grow"><span>${X.esc(m.text.slice(0, 140))}</span><small>${when(m.at)}</small></span><button class="btn small" data-l-del="${m.id}">Cancel</button></div>`).join('') : ''; };
  draw();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return X.closeModal(true);
    const q = e.target.closest('[data-l-q]'), del = e.target.closest('[data-l-del]');
    if (del) { await X.api(`/api/extras/scheduled/${del.dataset.lDel}`, { method: 'DELETE' }).catch(fail); return draw(); }
    if (!q) return;
    const d = new Date(), v = q.dataset.lQ;
    if (v === '1') d.setHours(d.getHours() + 1); else if (v === 'e') { d.setHours(20, 0, 0, 0); if (d < new Date()) d.setDate(d.getDate() + 1); } else { d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); }
    el.querySelector('[name=at]').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  el.querySelector('#l-form').addEventListener('submit', async (e) => {
    e.preventDefault(); const f = form(e.target);
    try { await X.api('/api/extras/scheduled', { method: 'POST', body: { thread, text: f.text, at: Math.floor(new Date(f.at).getTime() / 1000) } });
      X.toast(`Scheduled for ${when(new Date(f.at).getTime() / 1000)}`, { type: 'success' });
      const ta = $('#msg'); if (ta && ta.value.trim() === f.text.trim()) { ta.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); }
      X.closeModal(true); }
    catch (err) { fail(err); }
  });
}

// ---------- Post-mortem ----------
export function postMortemPrompt() {
  return 'Write a short post-mortem of the problem we just fixed, as a live doc titled "Post-mortem: <what broke>" (doc.mjs create). Sections: What broke, Why, How it was fixed (exact commands), How to spot it early, Prevent it next time. Also add the key fact to team memory (facts.mjs add). Keep it tight.';
}

// ---------- Home: since yesterday ----------
export async function digestCard() {
  const box = $('#home-digest'); if (!box) return;
  let d; try { d = await X.api('/api/extras/digest'); } catch { return box.remove(); }
  const name = (id) => X.esc(X.bot(id)?.name || 'Bot');
  const lines = [];
  for (const w of d.down) lines.push(`<li class="bad"><span class="ex-dot down"></span><b>${X.esc(w.name)}</b> is down <span class="muted">· ${ago(w.since)}${w.bot_id ? ` · ${name(w.bot_id)}` : ''}</span></li>`);
  for (const c of d.changes.filter((c) => c.state === 'up').slice(0, 4)) lines.push(`<li><span class="ex-dot up"></span>${X.esc(c.name)} came back <span class="muted">· ${ago(c.at)}</span></li>`);
  for (const p of d.plays) lines.push(`<li><span class="ex-dot ${p.last_ok ? 'up' : 'down'}"></span>Playbook “${X.esc(p.name)}” ${p.last_ok ? 'worked' : 'failed'} <span class="muted">· ${ago(p.last_run)}</span></li>`);
  if (d.failed.length) lines.push(`<li><span class="ex-dot down"></span>${d.failed.length} task${d.failed.length === 1 ? '' : 's'} failed <span class="muted">· ${[...new Set(d.failed.map((f) => name(f.bot_id)))].join(', ')}</span></li>`);
  for (const m of d.later) lines.push(`<li><span class="ex-dot unknown"></span>Sends ${when(m.at)}: <span class="muted">${X.esc(m.text.slice(0, 60))}</span></li>`);
  const total = d.runs.reduce((s, r) => s + r.n, 0);
  box.innerHTML = `<h3>Since yesterday</h3>
    <div class="dg-top"><span class="dg-big ${d.down.length ? 'bad' : 'ok'}">${d.watched.n ? `${d.watched.up || 0}/${d.watched.n}` : '—'}</span><span>${d.watched.n ? (d.down.length ? 'services up' : 'services up · all good') : 'Nothing watched yet'}</span>
      <span class="dg-big">${total}</span><span>tasks run${d.runs[0] ? ` · busiest ${name(d.runs[0].bot_id)}` : ''}</span></div>
    ${lines.length ? `<ul class="dg-list">${lines.join('')}</ul>` : '<div class="muted">A quiet day: nothing broke, nothing waiting.</div>'}
    <div class="dg-links"><button class="linkish" data-ex-open="watchdog">Watchdog</button> · <button class="linkish" data-ex-open="playbooks">Playbooks</button> · <button class="linkish" data-ex-open="backups">Backups</button> · <button class="linkish" data-act="map">Homelab map</button> · <button class="linkish" data-act="office">Bot office</button> · <a href="/status" target="_blank">Status page</a></div>`;
}
