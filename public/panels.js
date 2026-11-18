// Settings windows (moved out of app.js): marketplace, plugins, Claude account, activity log, server settings, bot computers, two-factor, appearance, language, approve/reject.
import { $, SKEL, askConfirm, ICON, JUST, S, api, applyTheme, avatar, bot, buzz, clip, closeModal, connect, describeTool, download, esc, fmtSize, getPrefs, modal, openThread, refreshState, renderMain, stamp, timeAgo, toast } from './app.js';
import { THEMES } from './themes.js';
import { LANGS, LANG_NAMES, uiLang, setUiLang } from './i18n.js';

// ---------- marketplace ----------
function pluginIcon(p, size = 40) {
  return `<span class="p-icon" style="width:${size}px;height:${size}px;background:${esc(p.color)};font-size:${Math.round(size * (p.icon.length > 1 ? 0.34 : 0.46))}px">${esc(p.icon)}</span>`;
}
async function marketModal(focus = '') {
  const el = modal(`<div class="market-top">${marketTabs('conn')}
      <label class="search big">${ICON.search}<input id="mk-q" placeholder="Search plugins and bots" autocomplete="off"></label>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div><div class="market-body" id="mk-body">${SKEL}</div>`, { wide: true, cls: 'market' });
  S.market = await api('/api/marketplace');
  let query = '';
  const row = (p, kind) => {
    const isBot = kind === 'bot';
    const btn = isBot ? `<button class="btn pill" data-add-bot="${p.id}">${p.added ? 'Add again' : 'Add'}</button>`
      : p.kind === 'claude' ? `<button class="btn pill ${p.installed ? 'ghost' : ''}" data-connect="${p.id}">${p.installed ? 'Connected' : 'Connect'}</button>`
      : p.installed ? `<button class="btn pill ghost" data-manage="${p.id}">Installed</button>`
      : `<button class="btn pill" data-install="${p.id}">Add</button>`;
    return `<div class="m-row">${isBot ? avatar(p, 40) : pluginIcon(p)}
      <div class="m-text"><b>${esc(p.name)}</b><span>${esc(isBot ? p.role : p.desc)}</span></div>${btn}</div>`;
  };
  const section = (title, list, kind) => list.length ? `<section><h3>${title}</h3><div class="m-grid">${list.map((p) => row(p, kind)).join('')}</div></section>` : '';
  const draw = () => {
    const match = (p) => !query || `${p.name} ${p.role || ''} ${p.desc || ''} ${p.category}`.toLowerCase().includes(query);
    const T = S.market.templates.filter(match), P = S.market.plugins.filter(match);
    const cats = (list) => [...new Set(list.map((x) => x.category))];
    $('#mk-body', el).innerHTML = cats(T).map((c) => section(`${c} Bots`, T.filter((t) => t.category === c), 'bot')).join('')
      + section('Featured Plugins', P.filter((p) => p.category === 'Featured'), 'plugin')
      + cats(P).filter((c) => c !== 'Featured').map((c) => section(c, P.filter((p) => p.category === c), 'plugin')).join('')
      + (!T.length && !P.length ? '<div class="empty small">Nothing matches that search.</div>' : '');
    if (focus === 'plugins' && !query) { $('#mk-body', el).querySelector('section:nth-of-type(n+2) h3')?.closest('section'); const s = [...el.querySelectorAll('h3')].find((h) => h.textContent === 'Featured Plugins'); s?.scrollIntoView(); focus = ''; }
  };
  draw();
  $('#mk-q', el).addEventListener('input', (e) => { query = e.target.value.trim().toLowerCase(); draw(); });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) return closeModal();
    if (t.dataset.mtab === 'cc') return ccPluginsModal();
    try {
      if (t.dataset.addBot) {
        const saved = await api(`/api/templates/${t.dataset.addBot}/add`, { method: 'POST' });
        closeModal(); await refreshState(); await openThread('bot:' + saved.id);
        toast(`${saved.name} joined your team`);
      }
      if (t.dataset.connect) return connectModal(S.market.plugins.find((p) => p.id === t.dataset.connect));
      if (t.dataset.install) return installModal(S.market.plugins.find((p) => p.id === t.dataset.install));
      if (t.dataset.manage) return installModal(S.market.plugins.find((p) => p.id === t.dataset.manage));
    } catch (err) { toast(err.message); }
  });
}

const marketTabs = (on) => `<div class="m-tabs"><button class="${on === 'conn' ? 'on' : ''}" data-mtab="conn">Connectors</button><button class="${on === 'cc' ? 'on' : ''}" data-mtab="cc">Plugins &amp; skills</button></div>`;

// ---------- plugins & skills: Claude Code plugins from Anthropic's marketplaces, installed server-wide ----------
async function ccPluginsModal(fresh = false) {
  const el = modal(`<div class="market-top">${marketTabs('cc')}
      <label class="search big">${ICON.search}<input id="cc-q" placeholder="Search plugins and skills" autocomplete="off"></label>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button>
    </div><div class="market-body" id="cc-body"><div class="muted">Loading the plugin catalog…</div></div>`, { wide: true, cls: 'market' });
  let data;
  try { data = await api('/api/cc-plugins' + (fresh ? '?fresh=1' : '')); } catch (err) { $('#cc-body', el).innerHTML = `<div class="muted">${esc(err.message)}</div>`; return; }
  let query = '', busy = '';
  const initials = (n) => n.split(/[-_\s]+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase();
  const hue = (n) => [...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
  const icon = (n) => `<span class="p-icon" style="width:40px;height:40px;background:hsl(${hue(n)} 45% 42%);font-size:14px">${esc(initials(n))}</span>`;
  const pretty = (n) => n.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const row = (p, btn) => `<div class="m-row">${icon(p.name)}<div class="m-text"><b>${esc(pretty(p.name))}${p.version ? ` <small class="muted">${esc(p.version)}</small>` : ''}</b><span>${esc(p.description || '')}</span></div>${btn}</div>`;
  const section = (title, html, note = '') => html ? `<section><h3>${title}</h3>${note}<div class="m-grid">${html}</div></section>` : '';
  const draw = () => {
    const match = (p) => !query || `${p.name} ${p.description}`.toLowerCase().includes(query);
    const have = new Set(data.installed.map((p) => p.id));
    const btn = (p) => busy === p.id ? '<button class="btn pill" disabled>Working…</button>'
      : have.has(p.id) ? (data.canInstall ? `<button class="btn pill ghost" data-uninstall="${esc(p.id)}">Installed</button>` : '<span class="pill-ok">Installed</span>')
      : data.canInstall ? `<button class="btn pill" data-install="${esc(p.id)}">Install</button>` : '';
    const skills = data.skills.filter(match), inst = data.installed.filter(match);
    // Anthropic's own catalog first, then most-installed; cap the list so the dialog stays quick.
    const avail = data.available.filter((p) => !have.has(p.id) && match(p))
      .sort((a, b) => (a.marketplace === 'claude-plugins-official') - (b.marketplace === 'claude-plugins-official') || b.installs - a.installs);
    const shown = avail.slice(0, query ? 150 : 60);
    $('#cc-body', el).innerHTML =
      `<p class="muted">Plugins add skills, commands and tools to <b>every bot</b>. Each one uses some of every bot’s context, so add only what the team uses.<button class="link" data-refresh>Refresh</button></p>`
      + section('Synced skills', skills.map((k) => row(k, '<span class="pill-ok">On</span>')).join(''))
      + section('Installed plugins', inst.map((p) => row(p, btn(p))).join(''))
      + section(query ? `Results (${avail.length}${avail.length > shown.length ? `, showing ${shown.length}` : ''})` : `Discover (${avail.length.toLocaleString()} plugins; search to find more)`, shown.map((p) => row(p, btn(p))).join(''))
      + (!skills.length && !inst.length && !shown.length ? '<div class="empty small">Nothing matches that search.</div>' : '');
  };
  draw();
  let tmr;
  $('#cc-q', el).addEventListener('input', (e) => { clearTimeout(tmr); tmr = setTimeout(() => { query = e.target.value.trim().toLowerCase(); draw(); }, 150); });
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) return closeModal();
    if (t.dataset.mtab === 'conn') return marketModal();
    if (t.dataset.refresh !== undefined) return ccPluginsModal(true);
    const id = t.dataset.install || t.dataset.uninstall; if (!id || busy) return;
    const install = !!t.dataset.install;
    if (!install && !await askConfirm(`Remove ${id.split('@')[0]} from every bot?`, { ok: 'Remove' })) return;
    busy = id; draw();
    try {
      await api(`/api/cc-plugins/${install ? 'install' : 'uninstall'}`, { method: 'POST', body: { id } });
      data = await api('/api/cc-plugins?fresh=1');
      toast(install ? `${id.split('@')[0]} installed. Bots get it from their next task.` : `${id.split('@')[0]} removed`);
    } catch (err) { toast(err.message); }
    busy = ''; draw();
  });
}
function connectModal(p) {
  const el = modal(`<div class="modal-head"><div class="ph">${pluginIcon(p, 44)}<h2>${esc(p.name)}</h2></div><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p>${esc(p.desc)}</p>
    <p class="muted">${esc(p.name)} is a Claude connector. Connect it once in your Claude settings, signed in with the same account you use for Claude Code, and every bot can use it. Sending, deleting and creating events still wait for your approval.</p>
    <div class="modal-foot"><button class="btn" data-back>Back</button><a class="btn primary" href="${esc(p.connectUrl)}" target="_blank" rel="noopener">Open Claude connectors</a></div>`);
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); if (e.target.closest('[data-back]')) marketModal(); });
}

function installModal(p) {
  const el = modal(`<div class="modal-head"><div class="ph">${pluginIcon(p, 44)}<h2>${esc(p.name)}</h2></div><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p>${esc(p.desc)}</p>
    ${p.fields.length ? p.fields.map((f) => `<label class="field">${esc(f.label)}<input type="password" data-key="${esc(f.key)}" autocomplete="off" placeholder="${p.installed ? 'Saved · paste to replace' : ''}">${f.help ? `<span class="hint">Get one at ${esc(f.help)}</span>` : ''}</label>`).join('')
      : '<p class="muted">No setup needed.</p>'}
    <p class="muted">Stored on this computer in Nimbus’s database. After installing, switch it on for a bot from that bot’s plugin button.</p>
    <div class="modal-foot">
      ${p.installed ? '<button class="btn danger left" data-remove>Remove</button>' : ''}
      <button class="btn" data-back>Back</button>
      <button class="btn primary" data-save>${p.installed ? (p.fields.length ? 'Update' : 'Done') : 'Install'}</button>
    </div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-back]')) return marketModal();
    try {
      if (e.target.closest('[data-remove]')) {
        if (!await askConfirm(`Remove ${p.name}? Bots using it lose access.`, { ok: 'Remove' })) return;
        await api(`/api/plugins/${p.id}`, { method: 'DELETE' }); toast(`${p.name} removed`); return marketModal();
      }
      if (e.target.closest('[data-save]')) {
        if (p.installed && !p.fields.length) return marketModal();
        const secrets = {};
        el.querySelectorAll('[data-key]').forEach((i) => { secrets[i.dataset.key] = i.value; });
        await api(`/api/plugins/${p.id}`, { method: 'POST', body: { secrets } });
        toast(`${p.name} installed`);
        const cur = S.current?.type === 'bot' ? bot(S.current.id) : null;
        if (cur) { await api(`/api/bots/${cur.id}/plugins`, { method: 'PUT', body: { plugins: [...new Set([...cur.plugins, p.id])] } }); toast(`${p.name} is on for ${cur.name}`); }
        closeModal(); refreshState();
      }
    } catch (err) { toast(err.message); }
  });
}

async function botPluginsModal(b, fresh = false) {
  const market = S.market = await api('/api/marketplace' + (fresh ? '?fresh=1' : ''));
  const on = new Set(b.plugins);
  const usable = market.plugins.filter((p) => p.installed && p.kind !== 'claude');
  const known = market.plugins.filter((p) => p.kind === 'claude');
  // Everything connected on the Claude account, plus catalog connectors not connected yet.
  const conns = [...market.connectors.map((c) => ({ ...c, p: known.find((k) => k.connector?.name === c.name) })),
    ...known.filter((k) => !k.connector).map((k) => ({ name: k.name, status: 'not connected', p: k }))];
  const connIcon = (c) => c.p ? pluginIcon(c.p, 34) : `<span class="p-icon" style="width:34px;height:34px;background:#d97757">${esc(c.name[0])}</span>`;
  const el = modal(`<div class="modal-head"><h2>Connectors</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p class="muted">Tools ${esc(b.name)} can use. Risky actions (send, delete, pay) still ask you first.</p>
    <h3>Claude connectors</h3>
    <p class="muted">From your Claude account, shared by every bot. Manage them at <a href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">claude.ai/settings/connectors</a>. <button class="link" data-refresh>Refresh</button></p>
    <div class="stack-list">${conns.map((c) => `<div class="toggle-row">${connIcon(c)}<span class="m-text"><b>${esc(c.name)}</b><span>${c.status === 'connected' ? 'Connected · available to every bot' : esc(c.status[0].toUpperCase() + c.status.slice(1))}</span></span>
      ${c.status === 'connected' ? `<span class="pill-ok">${ICON.check}</span>` : '<a class="btn small" href="https://claude.ai/settings/connectors" target="_blank" rel="noopener">Connect</a>'}</div>`).join('')}</div>
    <h3>Nimbus plugins</h3>
    <div class="stack-list">${usable.length ? usable.map((p) => `<label class="toggle-row">${pluginIcon(p, 34)}<span class="m-text"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></span>
      <input type="checkbox" class="switch" data-plugin="${p.id}" ${on.has(p.id) ? 'checked' : ''}></label>`).join('') : '<p class="muted">None installed yet. Browse plugins to add GitHub, Browser, Notion and more.</p>'}</div>
    <div class="modal-foot"><button class="btn left" data-browse>${ICON.grid} Browse plugins</button><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`, { wide: true });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-refresh]')) { toast('Checking your Claude connectors…'); return botPluginsModal(b, true); }
    if (e.target.closest('[data-browse]')) return marketModal('plugins');
    if (e.target.closest('[data-save]')) {
      const plugins = [...el.querySelectorAll('[data-plugin]')].filter((i) => i.checked).map((i) => i.dataset.plugin);
      await api(`/api/bots/${b.id}/plugins`, { method: 'PUT', body: { plugins } });
      closeModal(); await refreshState(); renderMain(); toast('Plugins saved. They apply from the next task.');
    }
  });
}

// Language: the app's screens (this device), what dictation listens for and what bots reply in (whole server).
async function languageModal() {
  const cur = await api('/api/language').catch(() => ({ speech: '', reply: '' }));
  const ui = uiLang();
  const opts = (sel, first) => first + LANGS.filter(([c]) => c).map(([c, n]) => `<option value="${c}" ${sel === c ? 'selected' : ''}>${esc(n)} (${LANG_NAMES[c]})</option>`).join('');
  const el = modal(`
    <div class="modal-head"><h2>Language</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">App language (this device)<select id="lg-ui">${LANGS.map(([c, n]) => `<option value="${c}" ${ui === c ? 'selected' : ''}>${esc(n)}${c ? ` (${LANG_NAMES[c]})` : ''}</option>`).join('')}</select>
      <span class="hint">Menus, buttons and settings. Translated on your server, so the first look at each screen may show English for a moment.</span></label>
    <label class="field">Bots reply in<select id="lg-reply">${opts(Object.entries(LANG_NAMES).find(([, n]) => n === cur.reply)?.[0] || '', '<option value="">The language you write in</option>')}</select>
      <span class="hint">Applies to every bot.</span></label>
    <label class="field">Dictation and voice chat listen for<select id="lg-speech"><option value="">English only (fastest)</option><option value="auto" ${cur.speech === 'auto' ? 'selected' : ''}>Any language (detects it)</option>${LANGS.filter(([c]) => c).map(([c, n]) => `<option value="${c}" ${cur.speech === c ? 'selected' : ''}>${esc(n)} (${LANG_NAMES[c]})</option>`).join('')}</select>
      <span class="hint">${cur.multilingual ? 'Picking one language is more accurate than “Any language”.' : 'Other languages need the multilingual speech model on the server (ggml-small.bin).'} For a bot's spoken voice, pick a voice in that language in its settings.</span></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="lg-save">Save</button></div>`);
  $('#lg-save', el).onclick = async () => {
    const code = $('#lg-reply', el).value;
    try { await api('/api/language', { method: 'PUT', body: { speech: $('#lg-speech', el).value, reply: code ? LANG_NAMES[code] : '' } }); } catch (err) { return toast(err.message); }
    const next = $('#lg-ui', el).value;
    if (next !== ui) return setUiLang(next);
    closeModal(); toast('Saved');
  };
}
function appearanceModal() {
  const p = getPrefs();
  const ACCENTS = ['#3b82f6', '#7c5cf5', '#e84fa0', '#e2475f', '#f08a3c', '#f5c542', '#1f9d6b', '#3fb6a8', '#22d3ee'];
  const save = () => { const { mode, ...rest } = p; try { localStorage.setItem('nimbus.appearance', JSON.stringify(rest)); } catch {} applyTheme(); draw(); };
  const el = modal('<div id="ap"></div>', { wide: true });
  // A theme card is a tiny mock of the app in that theme's colors.
  const card = (id, th, attr) => { const v = th.vars || {}; const bg = v.bg || (th.scheme === 'dark' ? '#0e0e0f' : '#ffffff'), side = v.side || (th.scheme === 'dark' ? '#161617' : '#f6f6f7'),
      bub = v.bubble || (th.scheme === 'dark' ? '#232326' : '#f0f0f2'), user = v.user || (th.scheme === 'dark' ? '#e9e9ec' : '#151517'), text = v.text || (th.scheme === 'dark' ? '#ececee' : '#151517');
    return `<button class="theme-card" ${attr}="${id}" aria-pressed="${(attr === 'data-theme-pick' ? p.theme : attr === 'data-dark-pick' ? (p.darkTheme || 'dark') : (p.lightTheme || 'light')) === id}">
      <span class="tc-mock" style="background:${bg}"><i style="background:${side}"></i><b style="background:${bub}"></b><b style="background:${user};margin-left:auto"></b><u style="background:${th.accent}"></u></span>
      <span class="tc-name" style="color:inherit">${esc(th.name)}</span></button>`; };
  const list = (filter, attr) => Object.entries(THEMES).filter(([, th]) => !filter || th.scheme === filter).map(([id, th]) => card(id, th, attr)).join('');
  const draw = () => {
    $('#ap', el).innerHTML = `<div class="stack-list" style="gap:18px">
      <div class="modal-head"><h2>Appearance</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
      <label class="toggle-row"><span class="m-text"><b>Match my device</b><span>Switch between a dark and a light theme with your device’s setting.</span></span>
        <input type="checkbox" class="switch" id="ap-system" ${p.theme === 'system' ? 'checked' : ''}></label>
      ${p.theme === 'system'
        ? `<div class="field">Dark theme<div class="theme-grid">${list('dark', 'data-dark-pick')}</div></div>
           <div class="field">Light theme<div class="theme-grid">${list('light', 'data-light-pick')}</div></div>`
        : `<div class="field">Theme<div class="theme-grid">${list(null, 'data-theme-pick')}</div></div>`}
      <div class="field">Accent<div class="swatches">
        <button class="btn small ${p.accent ? '' : 'primary'}" data-accent="">Theme’s own</button>
        ${ACCENTS.map((c) => `<button class="swatch" data-accent="${c}" style="background:${c}" aria-pressed="${p.accent === c}" aria-label="Accent ${c}"></button>`).join('')}
        <label class="swatch custom" title="Any color" aria-pressed="${!!p.accent && !ACCENTS.includes(p.accent)}"><input type="color" id="ap-accent" value="${esc(p.accent || '#3b82f6')}" aria-label="Custom accent"></label></div></div>
      <div class="modal-foot"><button class="btn primary" data-close>Done</button></div></div>`;
  };
  draw();
  el.addEventListener('change', (e) => {
    if (e.target.id === 'ap-system') { p.theme = e.target.checked ? 'system' : (resolveThemeId(p) || 'dark'); save(); }
  });
  el.addEventListener('input', (e) => { if (e.target.id === 'ap-accent') { p.accent = e.target.value; const { mode, ...rest } = p; try { localStorage.setItem('nimbus.appearance', JSON.stringify(rest)); } catch {} applyTheme(); } });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) return closeModal();
    if (t.dataset.themePick) p.theme = t.dataset.themePick;
    else if (t.dataset.darkPick) p.darkTheme = t.dataset.darkPick;
    else if (t.dataset.lightPick) p.lightTheme = t.dataset.lightPick;
    else if (t.dataset.accent !== undefined) p.accent = t.dataset.accent || null;
    else return;
    save();
  });
  // Turning "match my device" off keeps whichever theme is showing right now.
  function resolveThemeId(pr) {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    return dark ? (pr.darkTheme || 'dark') : (pr.lightTheme || 'light');
  }
}

// ---------- the Claude account the bots use ----------
// Either the server's own Claude Code login, or a token from `claude setup-token` pasted here (stored
// encrypted; it takes priority). Handy for switching accounts without a terminal on the server.
function claudeModal() {
  const c = S.data.claude || { mode: 'none' };
  const status = c.mode === 'token' ? `✅ Connected with a Claude token${c.at ? ` since ${new Date(c.at * 1000).toLocaleDateString()}` : ''}. All bots use this account.`
    : c.mode === 'login' ? '✅ Using the server’s own Claude Code login. Paste a token below to use a different account instead.'
    : '⚠ No Claude account yet. Bots can’t run until you connect one.';
  const el = modal(`<div class="modal-head"><h2>Claude account</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p>${status}</p>
    <ol class="steps-list">
      <li>On any computer with Claude Code, open a terminal and run <code>claude setup-token</code>. No Claude Code? <code>npm install -g @anthropic-ai/claude-code</code></li>
      <li>Sign in with your Claude account (Pro or Max) in the browser window that opens.</li>
      <li>Copy the line that starts with <code>sk-ant-oat</code> and paste it here.</li>
    </ol>
    <label class="field">${c.mode === 'token' ? 'Replace token' : 'Token'}<input id="cl-token" type="password" autocomplete="off" placeholder="sk-ant-oat01-…"></label>
    <p class="muted small">Stored encrypted on your Nimbus server and never shown again. The token lasts about a year.</p>
    <div class="modal-foot">${c.mode === 'token' ? '<button class="btn danger left" data-disconnect>Remove token</button>' : ''}<button class="btn" data-close>Cancel</button><button class="btn primary" data-save>${c.mode === 'token' ? 'Replace' : 'Connect'}</button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    try {
      if (e.target.closest('[data-disconnect]')) {
        if (!await askConfirm('Remove the Claude token? Bots fall back to the server’s own Claude login, if it has one.', { ok: 'Remove' })) return;
        await api('/api/claude-account', { method: 'DELETE' }); closeModal(); await refreshState(); renderMain(); return toast('Token removed');
      }
      if (e.target.closest('[data-save]')) {
        await api('/api/claude-account', { method: 'PUT', body: { token: $('#cl-token', el).value } });
        closeModal(); await refreshState(); renderMain(); buzz(10); toast('Claude account connected');
      }
    } catch (err) { toast(err.message); }
  });
}

// ---------- activity log ----------
// Everything bots did lately: each run (who asked, how long, outcome) and each approval decision.
async function activityLogModal() {
  const el = modal(`<div class="modal-head"><h2>Activity log</h2>
      <div class="seg"><button data-days="1" aria-pressed="false">Today</button><button data-days="7" aria-pressed="true">7 days</button><button data-days="30" aria-pressed="false">30 days</button></div>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div><div id="log-body" class="muted">Loading…</div>`, { wide: true });
  const load = async (days) => {
    const { runs, approvals } = await api('/api/activity?days=' + days);
    const byRun = {};
    for (const a of approvals) (byRun[a.run_id] ||= []).push(a);
    const src = (r) => r.parent_run ? 'from another bot' : r.thread.startsWith('room:') ? 'group chat' : /^\(Scheduled/.test(r.prompt) ? 'routine' : 'you';
    const icon = { done: '✓', error: '✗', stopped: '■', interrupted: '⚠', running: '…', queued: '…', merged: '↪' };
    $('#log-body', el).innerHTML = runs.length ? `<div class="log">${runs.map((r) => {
      const b = bot(r.bot_id), secs = r.ended_at && r.started_at ? r.ended_at - r.started_at : null;
      return `<div class="log-row ${r.status}"><span class="li">${icon[r.status] || '·'}</span>${avatar(b, 22)}
        <div class="lt"><div><b>${esc(b?.name || 'Deleted bot')}</b> <span class="muted">${esc(src(r))} · ${stamp(r.started_at)}${secs != null ? ` · ${secs >= 60 ? Math.round(secs / 60) + ' min' : secs + 's'}` : ''} · ${esc(r.status)}</span></div>
        <div class="lp">${esc(r.prompt.replace(/^\(Scheduled[^)]*\)\s*/, ''))}</div>
        ${(byRun[r.id] || []).map((a) => `<div class="la ${a.status}">${ICON.lock} ${esc(describeTool(a.tool, (() => { try { return JSON.parse(a.input); } catch { return {}; } })()))} — <b>${esc(a.status)}</b>${a.note ? ` · “${esc(a.note)}”` : ''}</div>`).join('')}</div>
        <button class="btn small" data-open="${esc(r.thread)}">Open</button></div>`; }).join('')}</div>` : '<p class="muted">Nothing in this period.</p>';
  };
  load(7).catch((e) => { $('#log-body', el).textContent = e.message; });
  el.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) return closeModal();
    if (t.dataset.days) { el.querySelectorAll('[data-days]').forEach((x) => x.setAttribute('aria-pressed', x === t)); load(Number(t.dataset.days)); }
    if (t.dataset.open) { closeModal(); openThread(t.dataset.open); }
  });
}

// ---------- server settings ----------
async function serverModal() {
  let v;
  try { v = await api('/api/settings'); } catch (err) { return toast(err.message); }
  const secret = (k) => `type="password" autocomplete="off" placeholder="${v[k] ? 'Saved · paste to replace' : ''}"`;
  const el = modal(`<div class="modal-head"><h2>Server settings</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <h3>Bot computers</h3>
    <p class="muted">The VM that runs each bot’s own desktop. See deploy/computer/README.md to set it up.</p>
    <label class="field">Agent URL<input id="s-agent_url" value="${esc(v.agent_url)}" placeholder="http://<computer-vm-ip>:8788"></label>
    <label class="field">Agent token<input id="s-agent_token" ${secret('agent_token')}></label>
    <label class="field">Callback URL<input id="s-callback_url" value="${esc(v.callback_url)}" placeholder="http://<this-server-ip>:8787"><span class="hint">How the VM reaches this Nimbus for approvals.</span></label>
    <h3>Proxmox</h3>
    <p class="muted">Shows host load and guest status in the Activity panel. A read-only (PVEAuditor) API token is enough.</p>
    <label class="field">Host<input id="s-pve_host" value="${esc(v.pve_host)}" placeholder="<proxmox-host-ip>"></label>
    <label class="field">Token ID<input id="s-pve_token_id" value="${esc(v.pve_token_id)}" placeholder="user@pve!tokenname"></label>
    <label class="field">Token secret<input id="s-pve_token_secret" ${secret('pve_token_secret')}></label>
    <div class="update-box"><button class="btn small" data-update>Update computers</button><span class="muted" id="upd-status">Rebuilds them with the latest Claude Code and Chromium. Files, browsers and sign-ins are kept; computers restart.</span></div>
    <h3>Chats</h3>
    <label class="field">Trusted proxies<input id="s-trusted_proxies" value="${esc(v.trusted_proxies || '')}" placeholder="192.168.1.2"><span class="hint">Reverse proxies in front of Nimbus (e.g. Nginx Proxy Manager). Their requests are counted by the real device’s address, so wrong passwords from one device don’t lock out everyone.</span></label>
    <label class="field">Trusted bots<input id="s-trusted_bots" value="${esc(v.trusted_bots || '')}" placeholder="3"><span class="hint">Bot numbers allowed to read Nimbus’s private data and change its code (e.g. Nimbus Manager). Other bots can’t touch data/, .env or Nimbus’s files; their own folder, uploads and data/shared stay open.</span></label>
    <label class="field">Bot sandbox<input id="s-sandbox" value="${esc(v.sandbox || '')}" placeholder="off"><span class="hint"><code>off</code>, <code>all</code>, bot numbers like <code>5,9</code>, or <code>all,-3</code> for every bot except #3. Sandboxed bots only see their own folder and Nimbus’s tools; the rest of the home folder (keys, ~/.ssh, other bots) is hidden. Needs bubblewrap: <code>apt install bubblewrap</code>. Bots on bot computers aren’t affected.</span></label>
    <label class="field">Threads at once per bot<select id="s-thread_limit">${['1', '2', '3'].map((n) => `<option value="${n}" ${String(v.thread_limit || '2') === n ? 'selected' : ''}>${n}${n === '1' ? ' (threads take turns)' : n === '2' ? ' (default)' : ''}</option>`).join('')}</select><span class="hint">Only your own messages use the extra slots. Routines and requests from other bots always take turns.</span></label>
    <label class="field">Usage guard (% of the 5-hour limit left)<input id="s-usage_guard_pct" type="number" min="0" max="90" value="${esc(v.usage_guard_pct || '15')}"><span class="hint">Below this much left, a bot’s threads take turns again to save your plan.</span></label>
    <label class="field">Auto-compact at (% of context)<input id="s-auto_compact_pct" type="number" min="0" max="95" value="${esc(v.auto_compact_pct || '20')}"><span class="hint">When a chat’s context passes this, Nimbus compacts it between messages. 0 turns it off. You can also type <code>/compact</code> in any chat.</span></label>
    <h3>Backups</h3>
    <p class="muted">Every night at 3:15 Nimbus saves an encrypted copy of all bots, chats, memories and settings (last 14 kept on this server).
      Set a target to also copy each backup to another machine. Keep the key file <code>~/opt/nimbus-backup.key</code> somewhere safe: backups can’t be opened without it.</p>
    <label class="field">Copy backups to (optional)<input id="s-backup_target" value="${esc(v.backup_target || '')}" placeholder="user@nas:/mnt/pool/nimbus-backups"><span class="hint">Over SSH, using this server’s key.</span></label>
    <div class="update-box"><button class="btn small" data-backup>Back up now</button><span class="muted" id="bk-status">Checking…</span></div>
    <div class="modal-foot"><button class="btn left" data-test>Test computer VM</button><button class="btn" data-close>Cancel</button><button class="btn primary" data-save>Save</button></div>`);
  api('/api/backup').then(({ last }) => { const st = $('#bk-status', el); if (st) st.textContent = !last ? 'No backup yet.'
    : last.ok ? `Last backup ${timeAgo(Math.round(last.at / 1000))}: ${fmtSize(last.size)}${last.remote ? ', copied to ' + last.remote : ', on this server only'}` : `✗ Last backup failed: ${last.error}`; }).catch(() => {});
  const values = () => {
    const out = {};
    for (const k of Object.keys(v)) { const i = $('#s-' + k, el); if (!i) continue; out[k] = i.type === 'password' && !i.value ? (v[k] ? '__saved__' : '') : i.value; }
    return out;
  };
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    try {
      if (e.target.closest('[data-backup]')) {
        await api('/api/settings', { method: 'PUT', body: values() });
        $('#bk-status', el).textContent = 'Backing up…';
        const r = await api('/api/backup', { method: 'POST' });
        $('#bk-status', el).textContent = r.ok ? `✓ Saved ${fmtSize(r.size)}${r.remote ? ' and copied to ' + r.remote : ''}` : '✗ ' + r.error;
        return;
      }
      if (e.target.closest('[data-update]')) {
        if (!await askConfirm('Update all bot computers now? Each one restarts, so any task running on a computer is interrupted. It takes a few minutes.', { ok: 'Update now', danger: false })) return;
        await api('/api/computers/update', { method: 'POST' });
        const st = $('#upd-status', el), btn = e.target.closest('[data-update]');
        btn.disabled = true;
        const poll = async () => {
          const u = await api('/api/computers/update').catch(() => null);
          if (!document.body.contains(st)) return;
          if (u?.running) { st.textContent = 'Updating… ' + (u.log.trim().split('\n').pop() || ''); return setTimeout(poll, 4000); }
          btn.disabled = false;
          st.textContent = u?.ok ? '✓ Computers updated.' : '✗ Update failed: ' + (u?.log.trim().split('\n').pop() || 'unknown error');
          compAt = 0;
        };
        st.textContent = 'Updating…'; return poll();
      }
      if (e.target.closest('[data-test]')) {
        await api('/api/settings', { method: 'PUT', body: values() });
        const h = await api('/api/settings/test-agent', { method: 'POST' });
        return toast(h.ok ? 'Computer VM is reachable' : 'Computer VM answered, but isn’t healthy');
      }
      if (e.target.closest('[data-save]')) {
        await api('/api/settings', { method: 'PUT', body: values() });
        pveAt = 0; closeModal(); await refreshState(); toast('Settings saved');
      }
    } catch (err) { toast(err.message); }
  });
}

// ---------- bot computers ----------
async function computerModal(b) {
  if (!window.isSecureContext && !S.httpsPort) S.httpsPort = (await api('/api/https-port').catch(() => ({}))).port;
  const el = modal(`<div class="modal-head"><h2>${esc(b.name)}’s computer</h2>
      <div class="seg cm-tabs"><button data-tab="screen" aria-pressed="true">Screen</button><button data-tab="files" aria-pressed="false">Files</button></div>
      <button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div id="cm-body"><div class="muted">Checking…</div></div>`, { wide: true, cls: 'computer' });
  let tab = 'screen', dir = 'Downloads', info = null;
  const drawScreen = (c) => {
    $('#cm-body', el).innerHTML = !c.exists
      ? `<p>${esc(b.name)} doesn’t have a computer yet. It gets one automatically on its next task, or you can start it now to sign it into websites first.</p>
         <div class="modal-foot"><button class="btn primary" data-start>Start computer</button></div>`
      : !c.running
      ? `<p>😴 ${esc(b.name)}’s computer is asleep to save memory. It wakes up by itself on the next task, with its files, browser and sign-ins as they were.</p>
         <div class="modal-foot"><button class="btn primary" data-start>Wake it now</button></div>`
      : !window.isSecureContext
      ? `<p>The desktop needs a secure (HTTPS) connection, and this page is plain HTTP.</p>
         <p class="muted">Open Nimbus over HTTPS instead. The first time, your browser warns that the certificate isn’t trusted: choose <b>Advanced → Proceed</b>. It’s Nimbus’s own certificate on your network.</p>
         <div class="modal-foot"><a class="btn primary" href="https://${location.hostname}:${S.httpsPort || 8443}/#bot:${b.id}">Open Nimbus over HTTPS</a></div>`
      : `<div class="screen"><iframe src="/computer/${b.id}/" title="${esc(b.name)}’s screen" allow="clipboard-read; clipboard-write"></iframe></div>
         <div class="cm-info">
           <span class="muted">Shown through Nimbus, so no sign-in needed. Direct link: ${esc(c.url)} (user <code>${esc(c.user)}</code>, password <button class="link" data-reveal="${esc(c.password)}">show</button>)</span>
           <span class="grow"></span>
           <a class="btn small" href="/computer/${b.id}/" target="_blank" rel="noopener">Open in new tab</a>
           <button class="btn small danger" data-delete>Delete computer</button>
         </div>
         <p class="muted">You can use this screen yourself, for example to sign ${esc(b.name)} into a website. Anything the bot opens in its browser shows up here.</p>`;
  };
  // Files: the bot's home folder on its computer. Downloads first, since that's where browser downloads land.
  const drawFiles = async () => {
    const body = $('#cm-body', el);
    if (!info?.exists) { body.innerHTML = `<p class="muted">${esc(b.name)} doesn’t have a computer yet.</p>`; return; }
    body.innerHTML = '<div class="muted">Loading files…</div>';
    let r;
    try { r = await api(`/api/bots/${b.id}/files?dir=${encodeURIComponent(dir)}`); } catch (err) { body.innerHTML = `<p class="muted">${esc(err.message)}</p>`; return; }
    const parts = r.dir ? r.dir.split('/') : [];
    const crumbs = [`<button class="link" data-dir="">Home</button>`, ...parts.map((p, i) => `<button class="link" data-dir="${esc(parts.slice(0, i + 1).join('/'))}">${esc(p)}</button>`)].join(' / ');
    const hidden = new Set(['browser-profile', 'ssl', 'Templates', 'Public']);
    const nimbusFiles = new Set(['CLAUDE.md', 'MEMORY.md', 'ask-bot.mjs']); // Nimbus's own files in ~/work
    const items = r.items.filter((it) => (r.dir ? !(r.dir === 'work' && nimbusFiles.has(it.name)) : !hidden.has(it.name)));
    body.innerHTML = `<div class="files-bar"><span>${crumbs}</span><span class="grow"></span>
        ${['Downloads', 'work', 'Desktop'].map((d) => `<button class="btn small ${r.dir === d ? 'primary' : ''}" data-dir="${d}">${d === 'work' ? 'Bot’s work' : d}</button>`).join('')}
        <button class="icon-btn" data-dir="${esc(r.dir)}" title="Refresh" aria-label="Refresh">↻</button></div>
      ${r.error ? `<p class="muted">${esc(r.error === 'Folder not found' ? 'This folder is empty or doesn’t exist yet.' : r.error)}</p>` : ''}
      <div class="file-list">${items.length ? items.map((it) => {
        const rel = (r.dir ? r.dir + '/' : '') + it.name;
        return it.dir
          ? `<button class="file-row" data-dir="${esc(rel)}"><span class="fi">📁</span><span class="fn">${esc(it.name)}</span><span class="fm">${timeAgo(it.mtime)}</span></button>`
          : `<a class="file-row" href="/api/bots/${b.id}/file?path=${encodeURIComponent(rel)}" download><span class="fi">📄</span><span class="fn">${esc(it.name)}</span><span class="fm">${fmtSize(it.size)} · ${timeAgo(it.mtime)}</span><span class="fd">⬇</span></a>`;
      }).join('') : (r.error ? '' : '<p class="muted">Nothing here yet. When the bot downloads or saves files here, you can download them.</p>')}</div>`;
  };
  const draw = () => (tab === 'screen' ? drawScreen(info) : drawFiles());
  const load = async (method = 'GET') => {
    try { info = await api(`/api/bots/${b.id}/computer`, { method }); draw(); }
    catch (err) { $('#cm-body', el).innerHTML = `<p class="muted">${esc(err.message)}</p>`; }
  };
  load();
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-pressed', x === tb)); return info ? draw() : load(); }
    const dv = e.target.closest('[data-dir]');
    if (dv) { dir = dv.dataset.dir; return drawFiles(); }
    const rv = e.target.closest('[data-reveal]');
    if (rv) { rv.outerHTML = `<code class="secret-inline">${esc(rv.dataset.reveal)}</code>`; return; }
    if (e.target.closest('[data-start]')) { $('#cm-body', el).innerHTML = '<div class="muted">Starting… this can take up to a minute.</div>'; return load('POST'); }
    if (e.target.closest('[data-delete]')) {
      if (!await askConfirm(`Delete ${b.name}’s computer? Its files, browser and sign-ins are erased. The bot stays, and works on this PC until you turn “Own computer” back on.`)) return;
      try { await api(`/api/bots/${b.id}/computer`, { method: 'DELETE' }); closeModal(); await refreshState(); renderMain(); toast('Computer deleted'); }
      catch (err) { toast(err.message); }
    }
  });
}

// ---------- two-factor ----------
function loadQrLib() {
  if (window.QRCode) return Promise.resolve();
  return new Promise((ok, fail) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
    sc.onload = ok; sc.onerror = fail; document.head.append(sc);
  });
}
async function mfaModal() {
  const st = await api('/api/mfa');
  const head = `<div class="modal-head"><h2>Two-factor authentication</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>`;
  if (!st.available) {
    const el = modal(`${head}<p>You’re signed in with the shared password. Authenticator codes are for email + password accounts (set NIMBUS_ALLOWED_EMAILS).</p><div class="modal-foot"><button class="btn primary" data-close>Done</button></div>`);
    return el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
  }
  if (st.enabled) {
    const el = modal(`${head}<p><span class="on-pill">On</span> Signing in with your password also asks for a code from your authenticator app.</p>
      <p class="muted">${st.recoveryLeft} of 8 recovery codes left.</p>
      <details class="adv"><summary>Turn off two-factor</summary>
        <label class="field">Password<input type="password" id="mf-pw" autocomplete="current-password"></label>
        <label class="field">Current code (or a recovery code)<input id="mf-code" inputmode="numeric" autocomplete="one-time-code"></label>
        <div class="modal-foot"><button class="btn danger" id="mf-off">Turn off</button></div>
      </details>
      <div class="modal-foot"><button class="btn primary" data-close>Done</button></div>`);
    return el.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return closeModal();
      if (e.target.id === 'mf-off') {
        try { await api('/api/mfa/disable', { method: 'POST', body: { password: $('#mf-pw', el).value, code: $('#mf-code', el).value } }); closeModal(); toast('Two-factor is off'); }
        catch (err) { toast(err.message); }
      }
    });
  }
  const setup = await api('/api/mfa/setup', { method: 'POST' });
  const el = modal(`${head}
    <p>1. Scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</p>
    <div class="qr-wrap"><div id="mf-qr"></div></div>
    <details class="adv"><summary>Can’t scan? Enter this key instead</summary><code class="secret">${esc(setup.secret.match(/.{1,4}/g).join(' '))}</code></details>
    <label class="field">2. Enter the 6-digit code the app shows<input id="mf-code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mf-on">Turn on</button></div>`);
  loadQrLib().then(() => new window.QRCode($('#mf-qr', el), { text: setup.uri, width: 184, height: 184, colorDark: '#000000', colorLight: '#ffffff' }))
    .catch(() => { $('#mf-qr', el).innerHTML = '<p class="muted">Couldn’t load the QR code. Use the key below instead.</p>'; el.querySelector('.adv').open = true; });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.id !== 'mf-on') return;
    try {
      const { recovery } = await api('/api/mfa/enable', { method: 'POST', body: { code: $('#mf-code', el).value } });
      const done = modal(`<div class="modal-head"><h2>Two-factor is on</h2></div>
        <p>Save these recovery codes somewhere safe, like a password manager. Each one works once if you lose your phone. You won’t see them again.</p>
        <pre class="codes">${recovery.map(esc).join('\n')}</pre>
        <div class="modal-foot"><button class="btn" id="mf-copy">Copy</button><button class="btn primary" data-close>I saved them</button></div>`, { sticky: true });
      done.addEventListener('click', (ev) => {
        if (ev.target.id === 'mf-copy') clip(recovery.join('\n')).then((ok) => toast(ok ? 'Copied' : 'Copy failed; select and copy them instead'));
        if (ev.target.closest('[data-close]')) closeModal();
      });
    } catch (err) { toast(err.message); }
  });
}

function rejectModal(id) {
  const el = modal(`<div class="modal-head"><h2>Reject</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">Tell the bot why or what to do instead (optional)<textarea id="rj" rows="3" placeholder="Don't offer a discount above 10%."></textarea></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rj-go">Reject</button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) closeModal();
    if (e.target.id === 'rj-go') { await decide(id, 'reject', { note: $('#rj', el).value.trim() }); closeModal(); }
  });
}
async function decide(id, decision, extra = {}) {
  JUST.set(id, decision); setTimeout(() => JUST.delete(id), 4000);
  document.querySelector(`[data-approve="${id}"]`)?.closest('.approval')?.classList.add('going', decision);
  try { await api(`/api/approvals/${id}`, { method: 'POST', body: { decision, ...extra } }); }
  catch (e) { toast(e.message); }
}

export { activityLogModal, appearanceModal, botPluginsModal, ccPluginsModal, claudeModal, computerModal, decide, languageModal, marketModal, mfaModal, rejectModal, serverModal };
