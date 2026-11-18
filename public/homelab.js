// Screens for homelab.js: Backups, IP map, Change journal, Logs, Model routing (Settings), the Homelab map
// and the Bot office (full windows), plus the Plan first toggle. All local; buttons that ask a bot say so.
let X;
export function initHomelab(ctx) { X = ctx; }
const $ = (s, r = document) => r.querySelector(s);
const ago = (t) => { if (!t) return 'never'; const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 129600 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const gb = (n) => (n >= 1e12 ? (n / 1e12).toFixed(1) + ' TB' : n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : Math.round((n || 0) / 1e6) + ' MB');
const fail = (e) => X.toast(e.message || String(e), { type: 'error' });
const botNamed = (re) => X.S.data.bots.find((b) => re.test(b.name));
function page(title, intro, wide = true) {
  const el = X.modal(`<div class="modal-head"><h2>${title}</h2><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div>
    <div class="ex-body"><p class="muted ex-intro">${intro}</p><div class="ex-main"><p class="muted">Loading…</p></div></div>`, { wide, cls: 'ex-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) X.closeModal(); });
  return el;
}
const top = (el) => requestAnimationFrame(() => { if (el.contains(document.activeElement)) document.activeElement.blur(); (el.closest('.set-body') || el).scrollTop = 0; });
// Hand a job to a bot: its General chat opens with the request sent (this uses Claude).
async function askBot(b, text) {
  if (!b) return X.toast('No bot for this yet');
  try { await X.api(`/api/threads/${encodeURIComponent('bot:' + b.id)}/messages`, { method: 'POST', body: { text } }); X.closeModal(true); X.openThread('bot:' + b.id); X.toast(`Sent to ${b.name}`, { type: 'success' }); }
  catch (e) { fail(e); }
}

// ---------- Backups ----------
export async function backupsPage() {
  const el = page('Backups', 'What Proxmox has backed up, read live with the read-only token. A guest is green with a backup from the last 26 hours. Every morning at 8 your Proxmox bot gets a note (no Claude) if anything is missing.');
  let d; try { d = await X.api('/api/extras/backups'); } catch (e) { el.querySelector('.ex-main').innerHTML = `<p class="muted">Couldn’t reach Proxmox: ${X.esc(e.message)}</p>`; return; }
  if (!d.on) { el.querySelector('.ex-main').innerHTML = '<p class="muted">Connect Proxmox first (Settings → Server settings → Proxmox).</p>'; return; }
  const ok = d.guests.filter((g) => g.state === 'ok').length, st = d.stores[0], missing = d.guests.filter((g) => !g.jobs.length);
  el.querySelector('.ex-main').innerHTML = `
    <div class="bk-sum ${ok === d.guests.length ? 'good' : 'bad'}"><b>${ok}/${d.guests.length}</b><span>guests backed up in the last day · ${d.jobs.length ? `${d.jobs.length} backup job${d.jobs.length === 1 ? '' : 's'}` : 'no backup jobs set up'}</span></div>
    ${d.jobs.length ? `<div class="ex-list">${d.jobs.map((j) => `<div class="ex-row"><span class="ex-dot ${j.enabled ? 'up' : 'off'}"></span><span class="ex-grow"><b>${X.esc(j.schedule || '?')} → ${X.esc(j.storage || '?')}</b><small>${j.all ? 'All guests' : 'Guests ' + X.esc(j.vmid || '')} · ${X.esc(j.mode || '')}${j.keep ? ' · keep ' + X.esc(typeof j.keep === 'object' ? Object.entries(j.keep).map(([k, v]) => `${v} ${k.replace('keep-', '')}`).join(', ') : j.keep) : ''}</small></span></div>`).join('')}</div>` : ''}
    <div class="ex-list">${d.guests.map((g) => `<div class="ex-row"><span class="ex-dot ${g.state === 'ok' ? 'up' : g.state === 'stale' ? 'unknown' : 'down'}"></span>
      <span class="ex-grow"><b>${X.esc(g.name)} <span class="muted">${g.type} ${g.vmid}</span></b><small>${g.last ? `Last backup ${ago(g.last)} · ${gb(g.size)} · ${g.count} kept` : 'Never backed up'}${g.jobs.length ? ' · in a job' : ' · not in any job'}${g.status !== 'running' ? ' · ' + X.esc(g.status) : ''}</small></span></div>`).join('')}</div>
    <div class="ex-form"><h3>Fix it</h3>
      <p class="small muted">Your Proxmox bot sets up a nightly job: every guest at 2:00 AM, snapshot mode, zstd, keep 7 daily and 4 weekly, on ${st ? `<b>${X.esc(st.storage)}</b> (${gb(st.avail)} free)` : 'the biggest backup storage'}. It asks for your approval before creating anything. This uses Claude.</p>
      <div class="ex-btns"><button class="btn primary" data-bk-setup>${missing.length && d.jobs.length ? `Ask your Proxmox bot to add ${missing.length === 1 ? X.esc(missing[0].name) : missing.length + ' guests'} to the backups` : 'Ask Proxmox Manager to set up nightly backups'}</button></div></div>`;
  top(el);
  el.querySelector('[data-bk-setup]').addEventListener('click', () => askBot(botNamed(/proxmox/i), `Set up nightly Proxmox backups (from Nimbus → Backups). Right now ${d.guests.length - ok} of ${d.guests.length} guests have no backup from the last day and ${d.jobs.length ? (missing.length ? `these guests are in no backup job: ${missing.map((g) => g.name + ' (' + g.vmid + ')').join(', ')}. Add them to the existing job ${X.esc(d.jobs[0].id)} (${d.jobs[0].schedule} → ${d.jobs[0].storage}) instead of making a new one` : 'the existing job hasn\'t produced backups yet: check why') : 'there are no backup jobs'}.
Plan: one vzdump job for all guests, daily at 02:00, mode snapshot, compress zstd, prune keep-daily=7 keep-weekly=4, storage ${st ? st.storage : '(pick the backup storage with the most free space)'}. Check free space against the guests' sizes first and tell me if it won't fit.
Show me the exact command or API call and wait for my approval before creating the job. Afterwards, run one backup of a small guest to prove it works, and add the job to the homelab facts.`));
}

// ---------- IP map ----------
const FLAG = { changed: ['IP changed', 'warn'], conflict: ['Conflict', 'bad'], unknown: ['Unknown', 'warn'], reserve: ['Needs reservation', 'warn'] };
export async function ipMapPage(scan = false) {
  const el = page('IP map', 'Every device answering on your LAN, from Nimbus’s own address table (refreshed every 15 minutes, no Claude), matched to Proxmox guests and the homelab facts. Flags: an IP that moved, two devices on one IP, devices nobody named, and DHCP guests that should get a reservation.');
  let d; try { d = await X.api(scan ? '/api/extras/ipmap/scan' : '/api/extras/ipmap', { method: scan ? 'POST' : 'GET' }); } catch (e) { return fail(e); }
  const flagged = d.rows.filter((r) => r.flags.length);
  el.querySelector('.ex-main').innerHTML = `
    <div class="ip-top"><span><b>${d.rows.filter((r) => r.online).length}</b> online · ${d.rows.length} seen this week · <b>${flagged.length}</b> flagged · scanned ${ago(d.scanned)}</span>
      <button class="btn small" data-ip-scan>${scan ? 'Scanned' : 'Scan now'}</button></div>
    <div class="ip-table"><div class="ip-h"><span>IP</span><span>Name</span><span>MAC</span><span>Seen</span><span></span></div>
    ${d.rows.map((r) => `<div class="ip-r ${r.online ? '' : 'off'}"><span class="mono">${r.ip}${r.fixed ? ' <i class="ip-fixed" title="Static in the homelab facts">static</i>' : ''}</span>
      <span><input class="ip-name" data-ip-mac="${r.mac}" value="${X.esc(r.name)}" placeholder="Name this device">${r.guest ? `<small class="muted">${X.esc(r.guest)}</small>` : ''}
        ${r.flags.map((f) => `<i class="ip-flag ${FLAG[f][1]}" title="${f === 'changed' ? 'Also seen at ' + X.esc(r.ips.filter((x) => x !== r.ip).join(', ')) : ''}">${FLAG[f][0]}</i>`).join('')}</span>
      <span class="mono small">${r.mac}</span><span class="small muted">${r.online ? 'online' : ago(r.last_seen)}</span>
      <span>${r.flags.includes('reserve') || r.flags.includes('changed') || r.flags.includes('conflict') ? `<button class="btn small" data-ip-res="${r.mac}" data-ip="${r.ip}" data-name="${X.esc(r.name)}">Reserve</button>` : ''}</span></div>`).join('')}</div>`;
  top(el);
  el.querySelector('[data-ip-scan]').addEventListener('click', (e) => { e.target.textContent = 'Scanning…'; e.target.disabled = true; ipMapPage(true); });
  el.querySelectorAll('.ip-name').forEach((i) => i.addEventListener('change', () => X.api('/api/extras/ipmap/name', { method: 'PUT', body: { mac: i.dataset.ipMac, name: i.value } }).then(() => X.toast('Saved', { type: 'success' })).catch(fail)));
  el.querySelectorAll('[data-ip-res]').forEach((b) => b.addEventListener('click', () => askBot(botNamed(/opnsense/i),
    `Create a DHCP static reservation in OPNsense Dnsmasq (from Nimbus → IP map): MAC ${b.dataset.ipRes} → IP ${b.dataset.ip}${b.dataset.name ? `, hostname ${b.dataset.name}` : ''}. Check that the IP isn't used by another device and is outside the dynamic range (or tell me). Show me the exact change and wait for my approval before applying it, then confirm it took effect.`)));
}

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

// ---------- Logs ----------
export async function logsPage(params = { q: '', and: '', days: 1 }) {
  const el = page('Logs', 'Search the firewall logs OPNsense sends to Nimbus (syslog UDP 5514, kept 90 days). Searching is local and free. Tick lines and ask a bot about them.');
  el.querySelector('.ex-main').innerHTML = `<form class="ex-search lg-form"><input name="q" value="${X.esc(params.q)}" placeholder="Find (e.g. block, 192.168.1.50, dhcp)"><input name="and" value="${X.esc(params.and)}" placeholder="and also contains"><select name="days">${[1, 2, 7, 14].map((n) => `<option value="${n}" ${n === Number(params.days) ? 'selected' : ''}>${n === 1 ? 'Today' : `Last ${n} days`}</option>`).join('')}</select><button class="btn primary">Search</button></form>
    <div id="lg-out">${params.q || params.and ? '<p class="muted">Searching…</p>' : '<p class="muted">Type something to search. Newest lines first, up to 300.</p>'}</div>`;
  el.querySelector('.lg-form').addEventListener('submit', (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target)); logsPage(f); });
  if (!params.q && !params.and) return;
  let d; try { d = await X.api(`/api/extras/logs?q=${encodeURIComponent(params.q)}&and=${encodeURIComponent(params.and)}&days=${params.days}`); } catch (e) { return fail(e); }
  const out = el.querySelector('#lg-out');
  out.innerHTML = `<div class="lg-bar"><span class="muted small">${d.total} match${d.total === 1 ? '' : 'es'}${d.total > d.lines.length ? `, newest ${d.lines.length} shown` : ''} in ${d.files} day${d.files === 1 ? '' : 's'}</span>
      <span class="lg-ask"><select id="lg-bot">${X.S.data.bots.map((b) => `<option value="${b.id}" ${/opnsense/i.test(b.name) ? 'selected' : ''}>${X.esc(b.name)}</option>`).join('')}</select><button class="btn small" id="lg-go" disabled>Ask about ticked lines</button></span></div>
    <div class="lg-lines">${d.lines.map((l, i) => `<label class="lg-l"><input type="checkbox" value="${i}"><code>${X.esc(l)}</code></label>`).join('') || '<p class="muted">No matches.</p>'}</div>`;
  const go = out.querySelector('#lg-go');
  out.addEventListener('change', () => { const n = out.querySelectorAll('.lg-l input:checked').length; go.disabled = !n; go.textContent = n ? `Ask about ${n} line${n === 1 ? '' : 's'}` : 'Ask about ticked lines'; });
  go.addEventListener('click', () => { const lines = [...out.querySelectorAll('.lg-l input:checked')].map((c) => d.lines[Number(c.value)]);
    askBot(X.bot(Number(out.querySelector('#lg-bot').value)), `What do these firewall log lines mean, and is anything wrong or worth doing? (from Nimbus → Logs, search "${params.q}${params.and ? ' + ' + params.and : ''}")\n\n\`\`\`\n${lines.join('\n').slice(0, 20000)}\n\`\`\``); });
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

// ---------- Homelab map ----------
export async function mapPage(back) {
  const el = X.modal(`<div class="modal-head">${back ? `<button class="icon-btn" data-back aria-label="Back to Settings" title="Back to Settings">${X.ICON.back}</button>` : ''}<h2>Homelab map</h2><span class="muted small map-legend"><i class="ex-dot up"></i> up <i class="ex-dot down"></i> down <i class="ex-dot unknown"></i> not watched</span><button class="icon-btn" data-close aria-label="Close">${X.ICON.close}</button></div><div class="map-body"><p class="muted">Loading…</p></div>`, { wide: true, cls: 'map-modal' });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { X.closeModal(true); return setTimeout(back, 50); }
    if (e.target.closest('[data-close]')) return X.closeModal(true);
    const t = e.target.closest('[data-map-bot]'); if (t) { X.closeModal(true); X.openThread('bot:' + t.dataset.mapBot); }
  });
  let d; try { d = await X.api('/api/extras/map'); } catch (e) { return fail(e); }
  const ipOf = (g) => d.facts.find((f) => f.vmid === g.vmid)?.ip || d.ipmap.find((r) => g.macs?.includes(r.mac))?.ip;
  const watchFor = (ip, name) => d.watches.find((w) => (ip && w.target.includes(ip)) || (name && w.name.toLowerCase().includes(String(name).toLowerCase().split(/[-\s]/)[0])));
  const ownerOf = (w, name) => w?.bot_id || (/opnsense/i.test(name) ? botNamed(/opnsense/i)?.id : /unifi/i.test(name) ? botNamed(/unifi/i)?.id : botNamed(/proxmox/i)?.id);
  const tile = (name, sub, state, owner, extra = '') => { const b = X.bot(owner);
    return `<button class="map-tile ${state}" ${b ? `data-map-bot="${b.id}" title="Open ${X.esc(b.name)}"` : ''}><i class="ex-dot ${state}"></i><b>${X.esc(name)}</b><small>${sub}</small>${extra}${b ? `<span class="map-own">${X.avatar(b, 18)}</span>` : ''}</button>`; };
  const fw = watchFor('192.168.1.1', 'firewall'), inet = d.watches.find((w) => /internet/i.test(w.name));
  const guests = (d.guests || []).sort((a, b) => a.vmid - b.vmid);
  const known = new Set(guests.flatMap((g) => g.macs || []));
  const others = d.ipmap.filter((r) => !known.has(r.mac) && r.online);
  const pveW = watchFor('192.168.1.10', 'proxmox');
  el.querySelector('.map-body').innerHTML = `
    <div class="map-row">${tile('Internet', 'ISP', inet?.state || 'unknown', inet?.bot_id)}<span class="map-link"></span>
      ${tile('OPNsense', '192.168.1.1 · firewall', fw?.state || 'unknown', ownerOf(fw, 'opnsense'))}<span class="map-link"></span>
      <div class="map-lan">LAN ${X.esc(d.ipmap.length ? '192.168.1.0/24' : '')}<small>${d.ipmap.filter((r) => r.online).length} devices online</small></div></div>
    <div class="map-tree">
      <div class="map-node ${pveW?.state || 'unknown'}"><div class="map-node-h" ${ownerOf(pveW, 'proxmox') ? `data-map-bot="${ownerOf(pveW, 'proxmox')}"` : ''}><i class="ex-dot ${pveW?.state || 'unknown'}"></i><b>Proxmox · pve</b><small>192.168.1.10 · ${guests.length} guests</small></div>
        <div class="map-guests">${guests.map((g) => { const ip = ipOf(g), w = watchFor(ip, g.name), st = g.status !== 'running' ? 'off' : w?.state || 'unknown';
          return tile(g.name, `${g.type} ${g.vmid}${ip ? ' · ' + ip : ''}${g.status !== 'running' ? ' · ' + g.status : ''}`, st, ownerOf(w, g.name), g.maxmem ? `<span class="map-bar"><i style="width:${Math.round((g.mem / g.maxmem) * 100)}%"></i></span>` : ''); }).join('') || `<p class="muted">${d.on ? d.error || 'No guests' : 'Connect Proxmox to see guests.'}</p>`}</div></div>
      <div class="map-node other"><div class="map-node-h"><b>Other devices</b><small>${others.length} online, not Proxmox guests</small></div>
        <div class="map-guests">${others.map((r) => tile(r.name || 'Unknown device', r.ip, r.flags.includes('unknown') ? 'unknown' : 'up', null)).join('')}</div></div>
    </div>`;
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
