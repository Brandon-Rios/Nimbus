// Screens for extras3.js: Auto-approve, Self-review, Skills, Connectors (Settings → AI tools), Rewind and
// Add-to-memory buttons in chats, Voice mode (talk back and forth, hands-free) and the camera.
let X;
export function initExtras3(ctx) { X = ctx; }
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const fail = (e) => X.toast(e.message || String(e), { type: 'error' });
function page(title, intro, wide = true) {
  const el = X.modal(`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="ex-body"><p class="muted ex-intro">${intro}</p><div class="ex-main"><p class="muted">Loading…</p></div></div>`, { wide, cls: 'ex-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  return el;
}

// ---------- Auto-approve ----------
export async function autoApprovePage() {
  const el = page('Auto-approve', 'Fewer interruptions: commands that clearly can’t hurt anything run without asking you. Pushes, sends, payments, deletes outside /tmp, restarts and stops always ask.');
  const draw = async () => {
    let d; try { d = await X.api('/api/extras/auto-approve'); } catch (e) { return fail(e); }
    const wk = (by, v) => d.week.find((r) => r.by === by && r.verdict === v)?.n || 0;
    const opt = (k, t, s) => `<label class="aa-opt ${d.mode === k ? 'on' : ''}"><input type="radio" name="aa" value="${k}" ${d.mode === k ? 'checked' : ''}><span><b>${t}</b><small>${s}</small></span></label>`;
    el.querySelector('.ex-main').innerHTML = `<div class="aa-opts">
      ${opt('off', 'Off', 'Every gated command asks you, like before.')}
      ${opt('rules', 'Rules only (free)', 'Read-only commands (status, logs, ls, cat, GET requests) and clearing scratch folders in /tmp run on their own. No Claude used.')}
      ${opt('smart', 'Smart', 'Rules first; anything they can’t decide gets a quick Haiku check (a few cents a week). Haiku can only say “safe” or “ask you”, and when it asks, it says why.')}</div>
      <p class="small muted">This week: ${wk('rules', 'allow')} approved by rules${d.mode === 'smart' || wk('haiku', 'allow') + wk('haiku', 'ask') ? ` · ${wk('haiku', 'allow')} approved by Haiku · ${wk('haiku', 'ask')} sent to you by Haiku` : ''}.</p>
      <h3 class="ex-h">Recent decisions</h3>
      <div class="ex-list">${d.log.map((a) => `<div class="ex-row"><span class="ex-dot ${a.verdict === 'allow' ? 'up' : 'down'}"></span><span class="ex-grow"><b>${X.esc(a.bot || '')} <span class="muted">· ${a.verdict === 'allow' ? 'ran without asking' : 'asked you'} · ${a.by === 'haiku' ? 'Haiku' : 'rule'} · ${ago(a.at)}</span></b><code class="aa-cmd">${X.esc(a.input.slice(0, 300))}</code>${a.why ? `<small>${X.esc(a.why)}</small>` : ''}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}</div>`;
  };
  el.addEventListener('change', async (e) => {
    if (e.target.name !== 'aa') return;
    try { await X.api('/api/extras/auto-approve', { method: 'PUT', body: { mode: e.target.value } }); X.toast('Saved', { type: 'success' }); draw(); } catch (err) { fail(err); }
  });
  draw();
}

// ---------- Self-review ("dreaming") ----------
export async function dreamPage() {
  const el = page('Self-review', 'Once a week (Sunday after 3 AM) each bot that had a rough week — approvals you rejected, errors, times you corrected it — looks back and suggests lines for its memory. Nothing changes until you press Add to memory in its Routines chat. One short run per bot that needs it.');
  const draw = async () => {
    let d; try { d = await X.api('/api/extras/dream'); } catch (e) { return fail(e); }
    el.querySelector('.ex-main').innerHTML = `<label class="ex-check"><input type="checkbox" class="switch" id="dr-on" ${d.on ? 'checked' : ''}> Weekly self-review</label>
      <div class="ex-list">${d.bots.map((b) => `<div class="ex-row">${X.avatar(X.bot(b.id) || b, 28)}<span class="ex-grow"><b>${X.esc(b.name)}</b><small>${b.spots ? `${b.spots} rough spot${b.spots === 1 ? '' : 's'} this week` : 'Smooth week'} · last review ${ago(b.last)}</small></span>
        <button class="btn small" data-dr="${b.id}">Review now</button></div>`).join('')}</div>
      <p class="small muted">A bot with fewer than 2 rough spots is skipped on Sundays. Review now always runs (uses Claude).</p>`;
  };
  el.addEventListener('change', async (e) => { if (e.target.id === 'dr-on') try { await X.api('/api/extras/dream', { method: 'PUT', body: { on: e.target.checked } }); X.toast('Saved', { type: 'success' }); } catch (err) { fail(err); } });
  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-dr]'); if (!b) return;
    try { await X.api(`/api/extras/dream/${b.dataset.dr}`, { method: 'POST' }); X.toast('Started: the suggestions land in its Routines chat', { type: 'success' }); b.disabled = true; } catch (err) { fail(err); }
  });
  draw();
}
const memLines = (t) => (String(t || '').match(/```memory\n([\s\S]*?)```/)?.[1] || '').split('\n').map((l) => l.trim()).filter((l) => /^-\s+\S/.test(l)).slice(0, 8);
export function memoryButton(m) {
  const lines = memLines(m.body); if (!lines.length) return '';
  return `<div class="mem-ok" data-mem="${m.id}">${lines.map((l, i) => `<label><input type="checkbox" value="${i}" checked> ${X.esc(l.replace(/^-\s+/, ''))}</label>`).join('')}
    <button class="btn primary small" data-mem-add="${m.id}">Add to memory</button></div>`;
}

// ---------- Skills ----------
export async function skillsPage() {
  const el = page('Skills', 'Step-by-step how-tos every bot loads (Claude Code skills). A bot uses one when its description fits the job. Bots can save new ones after they solve something; you can edit or remove any.');
  const draw = async () => {
    let d; try { d = await X.api('/api/extras/skills'); } catch (e) { return fail(e); }
    el.querySelector('.ex-main').innerHTML = `<div class="ex-btns"><button class="btn primary small" data-sk-new>New skill</button></div>
      <div class="ex-list">${d.items.map((s) => `<div class="ex-row"><span class="ex-grow"><b>${X.esc(s.name)} <span class="muted">· by ${X.esc(s.byName)} · ${ago(s.updated)}</span>${s.pending ? ' <span class="aa-why">Waiting for your OK · only its author has it</span>' : ''}</b><small>${X.esc(s.description)}</small></span>
        ${s.pending ? `<button class="btn small primary" data-sk-ok="${X.esc(s.name)}">Share with all bots</button>` : ''}<button class="btn small" data-sk-edit="${X.esc(s.name)}">${s.pending ? 'Review' : 'Edit'}</button><button class="btn small ghost" data-sk-del="${X.esc(s.name)}">Remove</button></div>`).join('') || '<p class="muted">No skills yet.</p>'}</div>
      <div id="sk-form"></div>`;
    el._items = d.items;
  };
  const form = (s = {}) => {
    const box = el.querySelector('#sk-form');
    box.innerHTML = `<form class="ex-form" id="sk-f"><h3 class="ex-h">${s.name ? 'Edit ' + X.esc(s.name) : 'New skill'}</h3>
      <label>Name<input name="name" value="${X.esc(s.name || '')}" placeholder="restart-immich" pattern="[a-z0-9][a-z0-9-]{1,48}" ${s.name ? 'readonly' : ''} required></label>
      <label>When to use it (bots read this to decide)<input name="description" value="${X.esc(s.description || '')}" placeholder="Use when Immich photos won’t load or the Immich container is down" required></label>
      <label>Steps (Markdown)<textarea name="body" rows="12" required>${X.esc(s.body || '')}</textarea></label>
      <div class="ex-btns"><button class="btn primary">Save</button><button type="button" class="btn ghost" data-sk-cancel>Cancel</button></div></form>`;
    box.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-sk-new]')) return form();
    if (e.target.closest('[data-sk-cancel]')) return (el.querySelector('#sk-form').innerHTML = '');
    const ed = e.target.closest('[data-sk-edit]'); if (ed) return form(el._items.find((s) => s.name === ed.dataset.skEdit));
    const del = e.target.closest('[data-sk-del]');
    const ok = e.target.closest('[data-sk-ok]');
    if (ok) { try { await X.api(`/api/extras/skills/${ok.dataset.skOk}/approve`, { method: 'POST', body: {} }); X.toast('Shared: every bot has it from its next task', { type: 'success' }); draw(); } catch (err) { fail(err); } return; }
    if (del && confirm(`Remove the skill ${del.dataset.skDel}? Bots stop using it from their next task (a copy is kept in data/shared/skills/.trash).`)) {
      try { await X.api(`/api/extras/skills/${del.dataset.skDel}`, { method: 'DELETE' }); draw(); } catch (err) { fail(err); }
    }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    try { await X.api(`/api/extras/skills/${encodeURIComponent(f.name)}`, { method: 'PUT', body: f }); X.toast('Saved: every bot has it from its next task', { type: 'success' }); draw(); } catch (err) { fail(err); }
  });
  draw();
}

// ---------- Connectors ----------
export async function connectorsPage() {
  const el = page('Custom connectors', 'Give bots new tools by adding any MCP server: a URL (Home Assistant, Grafana, a remote MCP service) or a command Nimbus starts. Ready-made ones (GitHub, Notion, Slack…) are in the Marketplace.');
  const draw = async () => {
    let d; try { d = await X.api('/api/extras/connectors'); } catch (e) { return fail(e); }
    const botBoxes = (sel = []) => `<div class="cn-bots">${d.bots.map((b) => `<label><input type="checkbox" value="${b.id}" ${sel.includes(b.id) ? 'checked' : ''}> ${X.esc(b.name)}</label>`).join('')}</div>`;
    el.querySelector('.ex-main').innerHTML = `<div class="ex-list">${d.items.map((c) => `<div class="ex-row cn-row" data-cn="${c.id}"><span class="ex-grow"><b>${X.esc(c.name)} <span class="muted">· ${c.kind === 'url' ? 'URL' : 'command'}</span></b><small><code>${X.esc(c.where)}</code></small>
        ${botBoxes(c.bots.map((b) => b.id))}</span><button class="btn small ghost" data-cn-del="${c.id}">Remove</button></div>`).join('') || '<p class="muted">No custom connectors yet.</p>'}</div>
      <form class="ex-form" id="cn-f"><h3 class="ex-h">Add a connector</h3>
        <label>Name<input name="name" placeholder="Home Assistant" required></label>
        <div class="cn-kind"><label><input type="radio" name="kind" value="url" checked> URL</label><label><input type="radio" name="kind" value="command"> Command</label></div>
        <div data-k="url"><label>Server URL<input name="url" placeholder="http://192.168.1.50:8123/api/mcp"></label>
          <label>Headers, one per line (kept on the server, never shown to bots)<textarea name="headers" rows="2" placeholder="Authorization: Bearer <long-lived token>"></textarea></label>
          <label class="ex-check"><input type="checkbox" name="sse"> Old-style SSE server</label></div>
        <div data-k="command" hidden><label>Command<input name="command" placeholder="npx -y @modelcontextprotocol/server-memory"></label>
          <label>Environment, one NAME=value per line<textarea name="env" rows="2"></textarea></label></div>
        <label>Bots that get it</label>${botBoxes()}
        <p class="small muted">Example: Home Assistant → Settings → Devices &amp; services → add “Model Context Protocol Server”, make a long-lived token in your profile, then use URL <code>http://&lt;home-assistant&gt;:8123/api/mcp</code>.</p>
        <div class="ex-btns"><button class="btn primary">Add</button></div></form>`;
  };
  el.addEventListener('change', async (e) => {
    if (e.target.name === 'kind') el.querySelectorAll('[data-k]').forEach((d) => (d.hidden = d.dataset.k !== e.target.value));
    const row = e.target.closest('.cn-row');
    if (row) try { await X.api(`/api/extras/connectors/${row.dataset.cn}/bots`, { method: 'PUT', body: { bots: [...row.querySelectorAll('.cn-bots input:checked')].map((i) => Number(i.value)) } }); X.toast('Saved: applies from each bot’s next task', { type: 'success' }); } catch (err) { fail(err); }
  });
  el.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-cn-del]');
    if (del && confirm('Remove this connector from every bot?')) try { await X.api(`/api/extras/connectors/${del.dataset.cnDel}`, { method: 'DELETE' }); draw(); } catch (err) { fail(err); }
  });
  el.addEventListener('submit', async (e) => {
    e.preventDefault(); const f = e.target, b = Object.fromEntries(new FormData(f));
    b.sse = !!b.sse; b.bots = [...f.querySelectorAll('.cn-bots input:checked')].map((i) => Number(i.value));
    try { await X.api('/api/extras/connectors', { method: 'POST', body: b }); X.toast('Added', { type: 'success' }); draw(); } catch (err) { fail(err); }
  });
  draw();
}

// ---------- chat buttons: Rewind, Add to memory ----------
document.addEventListener('click', async (e) => {
  const rw = e.target.closest('[data-rewind]');
  if (rw) {
    if (!confirm('Rewind to before this message?\n\nThe bot’s file changes since then are undone, later messages are put aside, and the bot forgets this part of the chat. Your message goes back in the box to edit.')) return;
    try {
      const r = await X.api('/api/extras/rewind', { method: 'POST', body: { msgId: Number(rw.dataset.rewind) } });
      await X.openThread(X.threadKey());
      const ta = document.querySelector('#msg'); if (ta && r.text) { ta.value = r.text; ta.dispatchEvent(new Event('input')); ta.focus(); }
      X.toast(`Rewound${r.undone ? ` · ${r.undone} file change${r.undone === 1 ? '' : 's'} undone` : ''}${r.failed.length ? ` · ${r.failed.length} couldn’t be undone` : ''}`, { type: r.failed.length ? 'error' : 'success' });
    } catch (err) { fail(err); }
    return;
  }
  const ma = e.target.closest('[data-mem-add]');
  if (ma) {
    const box = ma.closest('.mem-ok'), lines = [...box.querySelectorAll('input:checked')].map((i) => Number(i.value));
    if (!lines.length) return X.toast('Tick at least one line');
    try { const r = await X.api('/api/extras/dream-apply', { method: 'POST', body: { msgId: Number(box.dataset.mem), lines } }); X.toast(`Added ${r.added} to memory`, { type: 'success' }); ma.disabled = true; ma.textContent = '✓ Added'; } catch (err) { fail(err); }
  }
});

// ---------- camera ----------
// Live preview; Snap attaches a photo to your message (or, in voice mode, to what you say next).
async function openCamera(facing = 'environment') {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser can’t use the camera');
  if (!window.isSecureContext) throw new Error('The camera needs the HTTPS address (port 8443)');
  return navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
}
function snap(video) {
  const c = document.createElement('canvas'), w = video.videoWidth, h = video.videoHeight, k = Math.min(1, 1280 / Math.max(w, h));
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
  return new Promise((ok) => c.toBlob((b) => ok(new File([b], `camera-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.85));
}
export async function cameraModal() {
  let facing = 'environment', stream;
  try { stream = await openCamera(facing); } catch (e) { return fail(e.name === 'NotAllowedError' ? new Error('Camera access was blocked. Allow it in the browser or app settings.') : e); }
  const el = X.modal(`<div class="modal-head"><h2>Camera</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="cam"><video autoplay playsinline muted></video><div class="cam-bar"><button class="btn ghost" data-cam-flip>⟲ Flip</button><button class="btn primary cam-snap" data-cam-snap>Snap</button></div>
    <p class="muted small">The photo is attached to your message. Add a question, like “what is this light telling me?”</p></div>`, { cls: 'cam-modal' });
  const v = el.querySelector('video'); v.srcObject = stream;
  const stop = () => stream?.getTracks().forEach((t) => t.stop());
  new MutationObserver((_, o) => { if (!el.isConnected) { stop(); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) { stop(); return X.closeModal(); }
    if (e.target.closest('[data-cam-flip]')) { stop(); facing = facing === 'environment' ? 'user' : 'environment'; try { stream = await openCamera(facing); v.srcObject = stream; } catch (err) { fail(err); } }
    if (e.target.closest('[data-cam-snap]')) { const f = await snap(v); stop(); X.closeModal(); X.addFiles([f]); document.querySelector('#msg')?.focus(); }
  });
}

// ---------- Voice mode ----------
// Talk, pause, hear the answer, talk again. Listens with the server's whisper (dictation.js), replies are read
// out with the bot's voice. With the camera on, a photo of what it sees goes with each thing you say.
export async function voiceMode() {
  const key = X.threadKey(), b = X.S.current?.type === 'bot' ? X.bot(X.S.current.id) : null;
  if (!key || !b) return X.toast('Voice mode works in a bot’s chat');
  if (!window.isSecureContext) return X.toast('Voice mode needs the HTTPS address (port 8443)');
  const D = await import('./dictation.js');
  let on = true, state = '', cam = null, audio = null, level = 0;
  const el = X.modal(`<div class="vm"><div class="vm-top"><b>${X.esc(b.name)}</b><span class="muted small">Voice mode</span><button class="icon-btn" data-vm-end aria-label="End">${X.ICON.close}</button></div>
    <div class="vm-stage"><video class="vm-cam" autoplay playsinline muted hidden></video><button class="vm-orb" data-vm-orb aria-label="Tap to stop listening or interrupt">${X.avatar(b, 96)}</button></div>
    <div class="vm-state" aria-live="polite">Starting…</div><div class="vm-said muted"></div>
    <div class="vm-bar"><button class="btn ghost" data-vm-cam>📷 Camera off</button><button class="btn" data-vm-end>End</button></div></div>`, { cls: 'vm-modal' });
  const orb = el.querySelector('.vm-orb'), st = el.querySelector('.vm-state'), said = el.querySelector('.vm-said'), video = el.querySelector('.vm-cam');
  const set = (s, t) => { state = s; el.querySelector('.vm').dataset.state = s; st.textContent = t; };
  let stopNow = null;
  const end = () => { on = false; stopNow?.(); D.cancelRecording(); audio?.pause(); cam?.getTracks().forEach((t) => t.stop()); X.closeModal(); };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-vm-end]')) return end();
    if (e.target.closest('[data-vm-orb]')) { if (state === 'listening') stopNow?.(); else if (state === 'speaking') { audio?.pause(); audio?.onended?.(); } return; }
    const c = e.target.closest('[data-vm-cam]');
    if (c) {
      if (cam) { cam.getTracks().forEach((t) => t.stop()); cam = null; video.hidden = true; c.textContent = '📷 Camera off'; return; }
      try { cam = await openCamera(); video.srcObject = cam; video.hidden = false; c.textContent = '📷 Camera on'; } catch (err) { fail(err); }
    }
  });
  new MutationObserver((_, o) => { if (!el.isConnected) { if (on) end(); o.disconnect(); } }).observe(document.body, { childList: true, subtree: true });

  // One turn of listening: stops ~1.3 s after you stop talking (or when you tap the orb).
  const listen = () => new Promise((ok, bad) => {
    let heard = false, quietSince = 0, done = false;
    const finish = () => { if (done) return; done = true; stopNow = null; ok(heard); };
    stopNow = finish;
    D.startRecording({
      onLevel: (p) => {
        level = p; orb.style.setProperty('--lv', Math.min(1, p * 4).toFixed(2));
        if (p > 0.06) { heard = true; quietSince = 0; } else if (heard) { quietSince ||= Date.now(); if (Date.now() - quietSince > 1300) finish(); }
      },
      onLimit: finish
    }).catch(bad);
  });
  const lastId = async () => { const rows = await X.api(`/api/threads/${encodeURIComponent(key)}/messages`); return rows.length ? rows[rows.length - 1].id : 0; };
  const waitReply = async (after) => {
    for (let i = 0; on && i < 400; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const rows = await X.api(`/api/threads/${encodeURIComponent(key)}/messages`).catch(() => []);
      const r = rows.find((m) => m.id > after && m.author !== 'user' && (m.kind === 'text' || m.kind === 'error'));
      if (r) return r;
      if (rows.some((m) => m.id > after && m.kind === 'approval' && /"pending"/.test(m.body))) set('thinking', 'Waiting for your approval in the chat…');
    }
    return null;
  };
  const speak = (m) => new Promise(async (ok) => {
    try {
      const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: m.id }) });
      if (!r.ok) throw new Error('voice');
      audio = new Audio(URL.createObjectURL(await r.blob()));
      audio.onended = () => { audio.onended = null; ok(); };
      await audio.play();
    } catch { ok(); }
  });

  while (on) {
    set('listening', 'Listening… (tap the face when you’re done)');
    let heard;
    try { heard = await listen(); } catch (err) { fail(err.name === 'NotAllowedError' ? new Error('Microphone access was blocked') : err); return end(); }
    if (!on) break;
    set('thinking', 'Got it…');
    let text = '';
    try { text = heard ? (await D.stopRecording(X.api)).trim() : (D.cancelRecording(), ''); } catch (err) { fail(err); }
    if (!on) break;
    if (!text) continue;
    said.textContent = `You: ${text}`;
    try {
      const files = [];
      if (cam) { const f = await snap(video); const data = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); }); files.push((await X.api('/api/uploads', { method: 'POST', body: { name: f.name, type: f.type, data } })).id); }
      const after = await lastId();
      await X.api(`/api/threads/${encodeURIComponent(key)}/messages`, { method: 'POST', body: { text, files, voice: 'fast' } });
      set('thinking', 'Thinking…');
      const r = await waitReply(after);
      if (!on) break;
      if (!r) { set('thinking', 'No reply yet. It’ll show in the chat.'); await new Promise((x) => setTimeout(x, 2000)); continue; }
      said.textContent = (r.body || '').replace(/```[\s\S]*?```/g, ' (code in the chat) ').slice(0, 300);
      set('speaking', 'Speaking… (tap to interrupt)');
      await speak(r);
    } catch (err) { fail(err); await new Promise((x) => setTimeout(x, 1500)); }
  }
}
