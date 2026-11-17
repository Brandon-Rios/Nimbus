// The "finished app" layer: settings page, usage page, system status, what's new, notification filters,
// message search, first-run tour, connection bar with an outbox, shortcut hints, phone tab bar and gestures.
// Everything runs in the browser or on the Nimbus server: no Claude calls.
let X = {};
export function initPro(ctx) { X = ctx; whatsNewDot(); maybeTour(); tabBar(); }
const $ = (s, r = document) => r.querySelector(s);
const fmtB = (n) => (n > 1e12 ? (n / 1e12).toFixed(1) + ' TB' : n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : (n / 1e6).toFixed(0) + ' MB');
const dur = (s) => { s = Math.max(0, Math.round(s)); const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`; };

// ---------- friendly errors ----------
export function friendly(err) {
  const m = String(err?.message || err || '');
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return "Can't reach Nimbus right now. Check your connection; it retries on its own.";
  if (/timeout/i.test(m)) return 'That took too long. Try again in a moment.';
  if (/Request failed/.test(m)) return 'Something went wrong on the server. Try again, or check System status in Settings.';
  return m;
}

// ---------- connection bar + outbox ----------
let online = true, downSince = 0;
const OUT = () => { try { return JSON.parse(localStorage.outbox || '[]'); } catch { return []; } };
export function setConnected(up) {
  if (up === online) return;
  online = up;
  let bar = $('#conn-bar');
  if (!bar) { bar = document.createElement('div'); bar.id = 'conn-bar'; bar.setAttribute('role', 'status'); document.body.append(bar); }
  if (!up) { downSince = Date.now(); bar.className = 'down'; bar.textContent = 'Reconnecting to Nimbus… messages you send are saved and go out when it’s back.'; return; }
  bar.className = 'up'; bar.textContent = 'Back online' + (OUT().length ? ' · sending saved messages…' : '');
  setTimeout(() => { if (online) bar.className = 'gone'; }, 2200);
  flushOutbox();
}
export function queueSend(thread, text, files) { const o = OUT(); o.push({ thread, text, files, at: Date.now() }); localStorage.outbox = JSON.stringify(o); X.toast('Saved. It sends when Nimbus is reachable again.', { type: 'info' }); }
async function flushOutbox() {
  const o = OUT(); if (!o.length) return;
  const left = [];
  for (const m of o) { try { await X.api(`/api/threads/${encodeURIComponent(m.thread)}/messages`, { method: 'POST', body: { text: m.text, files: m.files } }); } catch { left.push(m); } }
  localStorage.outbox = JSON.stringify(left);
  if (o.length > left.length) X.toast(`Sent ${o.length - left.length} saved message${o.length - left.length === 1 ? '' : 's'}`, { type: 'ok' });
}
addEventListener('online', () => flushOutbox());
setTimeout(flushOutbox, 3000);

// ---------- usage page ----------
export async function usagePage(days = 14) {
  const el = X.modal(`<div class="modal-head"><h2>Usage history</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="pu-body"><p class="muted">Loading…</p></div>`, { wide: true, cls: 'pu-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); const d = e.target.closest('[data-pu-days]'); if (d) usagePage(Number(d.dataset.puDays)); });
  let d; try { d = await X.api(`/api/pro/usage?days=${days}`); } catch (e) { el.querySelector('.pu-body').innerHTML = `<p class="muted">${X.esc(friendly(e))}</p>`; return; }
  const dayList = []; for (let i = days - 1; i >= 0; i--) { const t = new Date(Date.now() - i * 86400000); dayList.push(t.toLocaleDateString('en-CA')); }
  const byDay = Object.fromEntries(dayList.map((k) => [k, []])); d.rows.forEach((r) => byDay[r.day]?.push(r));
  const metric = d.rows.some((r) => r.cost > 0) ? 'cost' : 'runs';
  const max = Math.max(1e-9, ...dayList.map((k) => byDay[k].reduce((s, r) => s + r[metric], 0)));
  const W = 640, H = 180, bw = W / days;
  const bars = dayList.map((k, i) => { let y = H; return byDay[k].map((r) => { const h = (r[metric] / max) * (H - 10); y -= h; const b = X.bot(r.bot_id);
    return `<rect x="${(i * bw + 2).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(2, bw - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${X.esc(b?.color || '#888')}"><title>${X.esc(b?.name || 'Deleted bot')} · ${k}: ${r.runs} runs${r.cost ? ` · $${r.cost.toFixed(2)}` : ''}</title></rect>`; }).join(''); }).join('');
  const tot = {}; d.rows.forEach((r) => { const t = (tot[r.bot_id] ||= { runs: 0, cost: 0, errors: 0, secs: 0 }); t.runs += r.runs; t.cost += r.cost || 0; t.errors += r.errors; t.secs += r.secs || 0; });
  const rows = Object.entries(tot).sort((a, b) => b[1][metric] - a[1][metric]);
  const all = rows.reduce((s, [, t]) => s + t.runs, 0);
  el.querySelector('.pu-body').innerHTML = `<div class="seg pu-seg">${[7, 14, 30, 90].map((n) => `<button data-pu-days="${n}" class="${n === days ? 'on' : ''}">${n} days</button>`).join('')}</div>
    <p class="muted">${all} runs in the last ${days} days${metric === 'cost' ? ` · $${rows.reduce((s, [, t]) => s + t.cost, 0).toFixed(2)} at API prices (your plan covers it)` : ''}. Hover a bar for details.</p>
    <svg class="pu-chart" viewBox="0 0 ${W} ${H + 18}" role="img" aria-label="Runs per day by bot">${bars}${dayList.map((k, i) => (i % Math.ceil(days / 7) === 0 ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H + 14}" text-anchor="middle">${k.slice(5)}</text>` : '')).join('')}</svg>
    <table class="pu-table"><thead><tr><th>Bot</th><th>Runs</th><th>Errors</th><th>Time working</th>${metric === 'cost' ? '<th>Cost</th>' : ''}</tr></thead><tbody>
    ${rows.map(([id, t]) => { const b = X.bot(Number(id)); return `<tr><td>${X.avatar(b, 20)} ${X.esc(b?.name || 'Deleted bot')}</td><td>${t.runs}</td><td>${t.errors || '–'}</td><td>${dur(t.secs)}</td>${metric === 'cost' ? `<td>$${t.cost.toFixed(2)}</td>` : ''}</tr>`; }).join('') || '<tr><td colspan="5" class="muted">No runs yet.</td></tr>'}</tbody></table>`;
}

// ---------- system status ----------
export async function statusPage() {
  const el = X.modal(`<div class="modal-head"><h2>System status</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="st-body"><p class="muted">Checking…</p></div>`, { wide: true });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); if (e.target.closest('[data-st-again]')) statusPage(); });
  let s; try { s = await X.api('/api/pro/status'); } catch (e) { el.querySelector('.st-body').innerHTML = `<p class="muted">${X.esc(friendly(e))}</p>`; return; }
  const pct = (a, b) => Math.round((a / b) * 100);
  const meter = (label, used, total) => `<div class="st-meter"><div><b>${label}</b><span class="muted">${fmtB(used)} of ${fmtB(total)}</span></div><i style="--p:${pct(used, total)}%" class="${pct(used, total) > 85 ? 'hot' : ''}"></i></div>`;
  el.querySelector('.st-body').innerHTML = `<div class="st-grid">
    ${s.services.map((v, i) => `<div class="st-svc"><span class="st-dot ${v.up ? 'up' : i ? 'idle' : 'down'}"></span><b>${v.name}</b><span class="muted">${v.up ? 'Running' : i ? 'Idle, starts when used' : 'Down'}</span></div>`).join('')}</div>
    ${s.disk ? meter('Disk', s.disk.total - s.disk.free, s.disk.total) : ''}${meter('Memory', s.mem.total - s.mem.free, s.mem.total)}
    <div class="st-facts">
      <div><small>Up for</small><b>${dur(Date.now() / 1000 - s.started)}</b></div><div><small>Last restart</small><b>${new Date(s.started * 1000).toLocaleString()}</b></div>
      <div><small>Bots working now</small><b>${s.busy}</b></div><div><small>Failed runs, 24 h</small><b class="${s.errs24 ? 'bad' : ''}">${s.errs24}</b></div>
      <div><small>Database</small><b>${fmtB(s.dbSize)}</b></div><div><small>CPU load</small><b>${s.load.toFixed(2)} / ${s.cpus} cores</b></div>
      <div><small>Server</small><b>${X.esc(s.host)} · Node ${X.esc(s.node)}</b></div><div><small>Nimbus server memory</small><b>${fmtB(s.mem.rss)}</b></div>
    </div><div class="row"><button class="btn" data-st-again>Check again</button></div>`;
}

// ---------- what's new ----------
async function whatsNewDot() {
  try { const d = await X.api('/api/pro/changelog'); X.S.version = d.version;
    if (!localStorage.seenVer) localStorage.seenVer = d.version; // first visit: nothing is "new"
    document.body.classList.toggle('has-new', d.version && localStorage.seenVer !== d.version); } catch {}
}
export async function whatsNew() {
  const el = X.modal(`<div class="modal-head"><h2>What’s new</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="wn-body"><p class="muted">Loading…</p></div>`, { wide: true });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  const d = await X.api('/api/pro/changelog').catch(() => ({ items: [] }));
  const seen = localStorage.seenVer; let isNew = seen !== d.version;
  const groups = {}; d.items.forEach((c) => { (groups[new Date(c.at * 1000).toDateString()] ||= []).push(c); });
  el.querySelector('.wn-body').innerHTML = Object.entries(groups).map(([day, list]) => `<h4>${new Date(day).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h4>
    <ul class="wn-list">${list.map((c) => { if (c.id === seen) isNew = false; return `<li class="${isNew ? 'new' : ''}">${isNew ? '<span class="wn-tag">New</span>' : ''}${X.esc(c.text)}</li>`; }).join('')}</ul>`).join('') || '<p class="muted">No change history on this install.</p>';
  localStorage.seenVer = d.version; document.body.classList.remove('has-new');
}

// ---------- message search ----------
export function searchPage(q0 = '') {
  const bots = X.S.data.bots;
  const el = X.modal(`<div class="modal-head"><h2>Search messages</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="sr-bar"><input id="sr-q" placeholder="Search every chat…" value="${X.esc(q0)}" autocomplete="off">
      <select id="sr-bot"><option value="">All bots</option>${bots.map((b) => `<option value="${b.id}">${X.esc(b.name)}</option>`).join('')}</select>
      <select id="sr-when"><option value="0">Any time</option><option value="1">Today</option><option value="7">Past week</option><option value="30">Past month</option></select>
      <select id="sr-who"><option value="">Anyone</option><option value="user">From you</option><option value="bot">From bots</option></select></div>
    <div class="sr-list"><p class="muted">Type at least 2 letters.</p></div>`, { wide: true, cls: 'sr-modal' });
  let last = [], t;
  const draw = () => {
    const bf = $('#sr-bot', el).value, w = Number($('#sr-when', el).value), who = $('#sr-who', el).value, q = $('#sr-q', el).value.trim();
    const since = w ? Date.now() / 1000 - w * 86400 : 0;
    const rows = last.filter((r) => (!bf || X.botOfThread(r.thread) === Number(bf)) && (r.at || 0) >= since && (!who || (who === 'user') === (r.author === 'user')));
    const words = q.split(/\s+/).filter((x) => x.length > 1).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const hl = (s) => { let h = X.esc(s); if (words.length) h = h.replace(new RegExp(`(${words.join('|')})`, 'gi'), '<mark>$1</mark>'); return h; };
    const snip = (b) => { const i = Math.max(0, b.toLowerCase().indexOf((words[0] || '').toLowerCase().replace(/\\/g, '')) - 50); return (i ? '…' : '') + b.slice(i, i + 220); };
    $('.sr-list', el).innerHTML = q.length < 2 ? '<p class="muted">Type at least 2 letters.</p>' : rows.length ? rows.map((r) => { const b = X.bot(X.botOfThread(r.thread));
      return `<button class="sr-item" data-sr-open="${X.esc(r.thread)}">${r.author === 'user' ? '<span class="initial">Y</span>' : X.avatar(b, 24)}<span><small>${r.author === 'user' ? 'You' : X.esc(b?.name || 'Bot')} · ${X.esc(X.threadName(r.thread))} · ${X.stamp(r.at)}</small><span class="sr-snip">${hl(r.snippet || "")}</span></span></button>`; }).join('')
      : `<div class="empty-state small">${EMPTY_ART}<b>No matches</b><span class="muted">Try fewer words, or widen the filters.</span></div>`;
  };
  const run = async () => { const q = $('#sr-q', el).value.trim(); if (q.length < 2) { last = []; return draw(); }
    try { last = (await X.api('/api/search?q=' + encodeURIComponent(q))).results || []; } catch (e) { $('.sr-list', el).innerHTML = `<p class="muted">${X.esc(friendly(e))}</p>`; return; } draw(); };
  el.addEventListener('input', (e) => { if (e.target.id === 'sr-q') { clearTimeout(t); t = setTimeout(run, 220); } });
  el.addEventListener('change', draw);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); const o = e.target.closest('[data-sr-open]'); if (o) { X.closeModal(); X.openThread(o.dataset.srOpen); } });
  if (q0) run();
}

// ---------- empty states ----------
export const EMPTY_ART = '<svg class="empty-art" width="64" height="48" viewBox="0 0 64 48" fill="none" aria-hidden="true"><path d="M14 38a10 10 0 0 1 1-20 14 14 0 0 1 27-3 11 11 0 1 1 7 23z" fill="currentColor" opacity=".12" stroke="currentColor" stroke-opacity=".35" stroke-width="2"/><circle cx="26" cy="27" r="2" fill="currentColor" opacity=".5"/><circle cx="38" cy="27" r="2" fill="currentColor" opacity=".5"/><path d="M29 33q3 2 6 0" stroke="currentColor" stroke-opacity=".5" stroke-width="2" stroke-linecap="round"/></svg>';
export const emptyState = (title, sub, btn = '') => `<div class="empty-state">${EMPTY_ART}<b>${title}</b><span class="muted">${sub}</span>${btn}</div>`;

// ---------- first-run tour ----------
const TOUR = [
  ['[data-act="home"]', 'Home', 'Your overview: what needs you, what’s running, unread chats and today’s routines.'],
  ['.side-list, #side', 'Your bots', 'Each bot has its own chats. They breathe when idle, bounce while working, and wave when they need you.'],
  ['#msg, .home-ask input', 'Ask anything', 'Type here. @ a bot to hand it work, / for commands, or drop in files.'],
  ['[data-act="panel"]', 'Approvals and activity', 'Risky actions wait here for your OK. You also get a notification.'],
  ['[data-act="user-menu"]', 'Settings and help', 'Settings, usage, system status, shortcuts and what’s new. Press ? anytime for shortcuts.'],
];
function maybeTour() { if (!localStorage.tourDone && !window.NimbusPane) setTimeout(() => { if (!localStorage.tourDone && X.S.data?.bots?.length) tour(); }, 1500); }
export function tour(i = 0) {
  document.querySelectorAll('.tour-spot, .tour-tip').forEach((x) => x.remove());
  const step = TOUR[i];
  if (!step) { localStorage.tourDone = '1'; return; }
  const target = step[0].split(', ').map((s) => [...document.querySelectorAll(s)].find((x) => x.offsetParent)).find(Boolean);
  if (!target) return tour(i + 1);
  const r = target.getBoundingClientRect(), pad = 6;
  const spot = document.createElement('div'); spot.className = 'tour-spot';
  Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: Math.min(r.height, innerHeight - 40) + pad * 2 + 'px' });
  const tip = document.createElement('div'); tip.className = 'tour-tip'; tip.setAttribute('role', 'dialog');
  tip.innerHTML = `<small>${i + 1} of ${TOUR.length}</small><b>${step[1]}</b><p>${step[2]}</p><div class="row"><button class="btn small" data-tour="skip">Skip tour</button><button class="btn primary small" data-tour="next">${i === TOUR.length - 1 ? 'Done' : 'Next'}</button></div>`;
  document.body.append(spot, tip);
  const tw = 300, below = r.bottom + 14 + 170 < innerHeight;
  let left = Math.min(Math.max(12, r.left), innerWidth - tw - 12), top = below ? r.bottom + 14 : r.top - 14 - tip.offsetHeight;
  if (r.width > innerWidth * 0.5 || r.height > innerHeight * 0.6) { left = Math.min(r.right + 14, innerWidth - tw - 12); top = Math.max(12, r.top + 40); }
  Object.assign(tip.style, { left: left + 'px', top: Math.max(12, top) + 'px', width: tw + 'px' });
  tip.addEventListener('click', (e) => { const b = e.target.closest('[data-tour]'); if (!b) return; if (b.dataset.tour === 'skip') { localStorage.tourDone = '1'; spot.remove(); tip.remove(); } else tour(i + 1); });
}

// ---------- shortcut hints in tooltips ----------
const HINT = { 'new-thread': 'new-thread', palette: 'palette', panel: 'panel', 'user-menu': 'settings', menu: 'sidebar' };
export function hintTitles(root = document) {
  root.querySelectorAll('[data-act][title]').forEach((b) => {
    const k = HINT[b.dataset.act]; if (!k || b.dataset.kbHint) return;
    const c = X.kbHint(k); if (!c) return;
    b.dataset.kbHint = '1'; b.title = `${b.title} (${c})`;
  });
}
new MutationObserver(() => { clearTimeout(hintTitles.t); hintTitles.t = setTimeout(() => X.kbHint && hintTitles(), 120); }).observe(document.documentElement, { childList: true, subtree: true });

// ---------- phone: bottom tab bar, edge swipe, pull to refresh ----------
function tabBar() {
  if (window.NimbusPane || $('#tabbar')) return;
  const ic = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const nav = document.createElement('nav'); nav.id = 'tabbar'; nav.setAttribute('aria-label', 'Main');
  nav.innerHTML = [['home', 'Home', '<path d="M3 11 12 4l9 7v9H3z"/><path d="M9 20v-6h6v6"/>'], ['menu', 'Chats', '<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4a8 8 0 1 1 16-4z"/>'],
    ['pro-search', 'Search', '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'], ['panel', 'Activity', '<path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21h4"/>'],
    ['pro-settings', 'Settings', '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>']]
    .map(([a, l, d]) => `<button data-act="${a}" aria-label="${l}">${ic(d)}<span>${l}</span></button>`).join('');
  document.body.append(nav);
}
let tx = null;
addEventListener('touchstart', (e) => { const t = e.touches[0]; tx = { x: t.clientX, y: t.clientY, th: e.target.closest('#thread'), top: e.target.closest('#thread')?.scrollTop === 0 }; }, { passive: true });
addEventListener('touchend', (e) => {
  if (!tx || innerWidth > 760) return; const t = e.changedTouches[0], dx = t.clientX - tx.x, dy = t.clientY - tx.y;
  if (tx.x < 24 && dx > 70 && Math.abs(dy) < 50) $('#side')?.classList.add('open');            // swipe in from the left edge: chats
  else if ($('#side.open') && dx < -70 && Math.abs(dy) < 50) $('#side').classList.remove('open'); // swipe back: close
  else if (tx.th && tx.top && dy > 90 && Math.abs(dx) < 40) { X.refreshState(); X.toast('Refreshed', { type: 'ok', ms: 1200 }); } // pull down at the top
  tx = null;
}, { passive: true });
