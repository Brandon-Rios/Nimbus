// Screens for homelab.js: Change journal, Model routing (Settings), the Bot office (full window),
// and the Plan first toggle. All local; buttons that ask a bot say so.
let X;
export function initHomelab(ctx) { X = ctx; }
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const fail = (e) => X.toast(e.message || String(e), { type: 'error' });
function page(title, intro, wide = true) {
  const el = X.modal(`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="ex-body"><p class="muted ex-intro">${intro}</p><div class="ex-main"><p class="muted">Loading…</p></div></div>`, { wide, cls: 'ex-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  return el;
}
const top = (el) => requestAnimationFrame(() => { if (el.contains(document.activeElement)) document.activeElement.blur(); (el.closest('.set-body') || el).scrollTop = 0; });

// ---------- Change journal ----------
export async function journalPage() {
  const el = page('Change journal', 'Before a bot edits or writes a file on the Nimbus server, Nimbus keeps a copy. Undo puts the copy back (or removes a file the bot created). Changes bots make over ssh or with shell commands on other machines aren’t captured. Kept 30 days.');
  let d; try { d = await X.api('/api/extras/journal'); } catch (e) { return fail(e); }
  const name = (id) => X.esc(X.bot(id)?.name || 'Bot');
  el.querySelector('.ex-main').innerHTML = `<div class="ex-list">${d.items.map((j) => `<div class="ex-row ${j.restored_at ? 'off' : ''}">
      <span class="ex-grow"><b class="mono jr-path">${X.esc(j.path)}</b><small>${name(j.bot_id)} · ${X.esc(j.tool)} · ${ago(j.at)} · ${j.existed ? 'changed' : 'created'}${j.restored_at ? ' · undone ' + ago(j.restored_at) : ''}</small>
      <pre class="jr-diff" id="jr-${j.id}" hidden></pre></span>
      <button class="btn small" data-jr-diff="${j.id}">Diff</button>${j.restored_at ? '' : `<button class="btn small" data-jr-undo="${j.id}" ${j.existed && !j.snap ? 'disabled title="Too big to keep a copy"' : ''}>Undo</button>`}</div>`).join('') || '<p class="muted">No changes yet. They appear here as bots edit files.</p>'}</div>`;
  top(el);
  el.addEventListener('click', async (e) => {
    const df = e.target.closest('[data-jr-diff]'), un = e.target.closest('[data-jr-undo]');
    if (df) { const box = el.querySelector('#jr-' + df.dataset.jrDiff); if (!box.hidden) { box.hidden = true; return; }
      const r = await X.api(`/api/extras/journal/${df.dataset.jrDiff}/diff`).catch(fail); if (!r) return;
      box.innerHTML = r.diff ? r.diff.split('\n').map((l) => `<span class="${l.startsWith('+') ? 'add' : l.startsWith('-') ? 'del' : l.startsWith('@@') ? 'hunk' : ''}">${X.esc(l)}</span>`).join('\n') : 'No difference: the file is the same as before.';
      box.hidden = false; }
    if (un) { if (!confirm('Undo this change? The file goes back to how it was before the bot touched it (later edits to it are lost).')) return;
      try { await X.api(`/api/extras/journal/${un.dataset.jrUndo}/undo`, { method: 'POST' }); X.toast('Undone', { type: 'success' }); journalPage(); } catch (err) { fail(err); } }
  });
}

// ---------- Model routing ----------
export async function routingPage() {
  const el = page('Model routing', 'Send work that doesn’t need the strongest model to a lighter one, so your plan lasts longer. A bot’s own model setting is used when routing doesn’t apply.', false);
  let d; try { d = await X.api('/api/extras/routing'); } catch (e) { return fail(e); }
  const opts = (v) => [['', 'Off (bot’s own model)'], ['haiku', 'Haiku (fastest, lightest)'], ['sonnet', 'Sonnet (balanced)'], ['opus', 'Opus']].map(([k, l]) => `<option value="${k}" ${v === k ? 'selected' : ''}>${l}</option>`).join('');
  el.querySelector('.ex-main').innerHTML = `<form class="ex-form" id="rt-form">
    <label>Routines, watchdog wake-ups, hand-offs and requests between bots<select name="auto">${opts(d.auto)}</select></label>
    <label>Short, simple questions from you (one line, no code, not “fix / install / build…”)<select name="short">${opts(d.short)}</select></label>
    <p class="muted small">Recommended: Sonnet for both. Anything longer or technical still uses the bot’s own model. The model used shows on each task’s steps.</p>
    <div class="ex-btns"><button class="btn primary">Save</button></div></form>`;
  el.querySelector('#rt-form').addEventListener('submit', async (e) => { e.preventDefault(); try { await X.api('/api/extras/routing', { method: 'PUT', body: Object.fromEntries(new FormData(e.target)) }); X.toast('Saved', { type: 'success' }); } catch (err) { fail(err); } });
}

// ---------- Bot office ----------
let officeEl = null, officeTimer = null;
const DESKS_PER_ROW = 4;
export function officePage(back) {
  const el = X.modal(`<div class="modal-head">${back ? `<button class="icon-btn" data-back aria-label="Back to Settings" title="Back to Settings">${X.ICON.back}</button>` : ''}<h2>Bot office</h2><span class="muted small">Live: working bots type, waiting ones raise a hand, worried ones sweat, idle ones nap</span><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="office"><div class="office-floor"></div></div>`, { wide: true, cls: 'office-modal' });
  officeEl = el;
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { X.closeModal(true); return setTimeout(back, 50); }
    if (e.target.closest('[data-close]')) return X.closeModal(true);
    const d = e.target.closest('[data-desk]'); if (d) { X.closeModal(true); X.openThread('bot:' + d.dataset.desk); }
  });
  const floor = el.querySelector('.office-floor');
  floor.innerHTML = X.S.data.bots.map((b, i) => `<button class="desk" data-desk="${b.id}" style="--row:${Math.floor(i / DESKS_PER_ROW)};--col:${i % DESKS_PER_ROW}">
    <span class="desk-bubble"></span><span class="desk-bot">${X.avatar(b, 52)}</span><span class="desk-table"><i class="desk-screen"></i><i class="desk-mug"></i></span><span class="desk-name">${X.esc(b.name)}</span></button>`).join('');
  const tick = () => {
    if (!officeEl?.isConnected) { clearInterval(officeTimer); officeTimer = null; return; }
    for (const b of X.S.data.bots) {
      const d = floor.querySelector(`[data-desk="${b.id}"]`); if (!d) continue;
      const last = X.S.data.last?.['bot:' + b.id]?.at || 0, st = b.status?.state || 'idle';
      const mood = X.S.data.moods?.[b.id];
      const s = st === 'working' || st === 'queued' ? 'working' : st === 'waiting' ? 'waiting' : mood ? 'worried' : Date.now() / 1000 - last > 900 ? 'napping' : 'idle';
      if (d.dataset.state !== s) { d.dataset.state = s; d.querySelector('.desk-bubble').textContent = { working: '⌨', waiting: '!', worried: '💦', napping: 'z z z', idle: '' }[s]; d.title = `${b.name}: ${{ working: b.status?.label || 'working', waiting: 'needs you', worried: 'something it watches is down', napping: 'napping', idle: 'idle' }[s]}`; }
    }
  };
  tick(); clearInterval(officeTimer); officeTimer = setInterval(tick, 1500);
}
// A paper plane flies from one desk to the other when a bot hands work over.
export function officeHandoff({ from, to }) {
  if (!officeEl?.isConnected) return;
  const a = officeEl.querySelector(`[data-desk="${from}"]`), b = officeEl.querySelector(`[data-desk="${to}"]`); if (!a || !b) return;
  const fl = officeEl.querySelector('.office-floor'), fr = fl.getBoundingClientRect(), ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
  const p = document.createElement('span'); p.className = 'office-plane'; p.textContent = '✉';
  p.style.left = (ra.left - fr.left + ra.width / 2) + 'px'; p.style.top = (ra.top - fr.top + 20) + 'px';
  fl.append(p);
  p.animate([{ transform: 'translate(0,0) scale(.6)', opacity: 0 }, { opacity: 1, offset: .15 }, { transform: `translate(${(rb.left - ra.left) / 2}px, ${(rb.top - ra.top) / 2 - 60}px) scale(1.2)`, offset: .5 }, { transform: `translate(${rb.left - ra.left}px, ${rb.top - ra.top}px) scale(.6)`, opacity: 0 }], { duration: 1600, easing: 'ease-in-out' }).onfinish = () => p.remove();
  b.classList.add('got'); setTimeout(() => b.classList.remove('got'), 1800);
}

// ---------- Plan first ----------
export const PLAN_TAG = '[Plan first] ';
export function planButton(m) { // under a bot reply that ends with PLAN_READY
  return /\n?PLAN_READY\s*$/.test(m.body || '') ? `<div class="plan-ok"><button class="btn primary small" data-plan-ok="${m.id}">✓ Approve plan and run it</button><span class="muted small">Its commands won’t ask again in this chat for an hour</span></div>` : '';
}
export async function approvePlan(id, thread) {
  try { const r = await X.api('/api/extras/plan-approve', { method: 'POST', body: { msgId: id, thread } }); X.toast(`Plan approved${r.commands ? ` · ${r.commands} command${r.commands === 1 ? '' : 's'} pre-approved` : ''}`, { type: 'success' }); }
  catch (e) { fail(e); }
}
