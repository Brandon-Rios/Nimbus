// Nimbus web app. Plain JS, no build step.
import { attachAutocorrect } from './autocorrect.js';
import { THEMES, resolveTheme, applyThemeVars } from './themes.js';
import { startVoice, voiceMessage } from './voice.js';
import { LANGS, LANG_NAMES, uiLang, setUiLang, startI18n, setI18nNames } from './i18n.js';
import { initPages, usagePage, statusPage, whatsNew, searchPage, tour, friendly, setConnected, queueSend } from './pages.js';
import { initCode, codeSidebar, codeProject, codeThreadOpened, toggleCodePane, toggleBotTile, syncBotBtns, onCodeChanged, renderChanges, codeStepHtml, codeProjectModal, runInTerminal, botWorkspaceUpdate, CODE_ICON, CM, setCodeMode, codeModeSide, newCodeThread, codeDraftMain, codeDraftSend, deleteCodeProject } from './codeui.js';
import { highlight, langOf, LANG_NAME } from './hl.js';
import { initCodeIde, renderTestRun, fileMatches } from './codeide.js';
import { initAiTools, autoApprovePage, dreamPage, skillsPage, connectorsPage, memoryButton, cameraModal, voiceMode } from './aitools.js';
import { initDocEditor, DOC, closeDoc, docsModal, openDoc, reloadDoc } from './docedit.js';
import { activityLogModal, appearanceModal, botPluginsModal, ccPluginsModal, claudeModal, computerModal, decide, languageModal, marketModal, mfaModal, rejectModal, serverModal } from './panels.js';
import { initHomelab, backupsPage, ipMapPage, journalPage, logsPage, routingPage, mapPage, officePage, officeHandoff, PLAN_TAG, planButton, approvePlan } from './homelab.js';
import { initAutomation, watchdogPage, playbooksPage, chainsPage, factsPage, budgetsPage, laterModal, saveAsPlaybook, postMortemPrompt, digestCard } from './automation.js';
import { startRecording, stopRecording, cancelRecording, isRecording, browserDictation } from './dictation.js';
const $ = (s, el = document) => el.querySelector(s);
// Split panes: an extra pane is this same app in a frame (?pane=<id>), showing one chat without the sidebar.
const EMBED = new URLSearchParams(location.search).get('pane') || '';
if (EMBED) document.documentElement.classList.add('embed');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EFFORTS = [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max']];
const BOT_COLORS = ['#f4f6ff', '#c7e3ff', '#d9d1ff', '#ffd3e0', '#ffe6a8', '#c9f2d8', '#ffcfb0', '#8fb8ff', '#b39dff', '#ff9fb5', '#7fd6c2', '#9aa3ad',
  '#ff6b6b', '#ff9f43', '#feca57', '#a3e635', '#2ed573', '#1dd1a1', '#48dbfb', '#54a0ff', '#5f27cd', '#c56cf0', '#ff7eb3', '#576574', '#f5e6d3', '#8d6e63', '#2d3436', '#ffffff'];
const svg = (d, w = 18) => `<svg width="${w}" height="${w}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const ICON = {
  home: svg('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h5v-6h4v6h5V9.5"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  send: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', 16),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  menu: svg('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  clock: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  book: svg('<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h10"/>'),
  back: svg('<path d="m15 18-6-6 6-6"/>'),
  fwd: svg('<path d="m9 18 6-6-6-6"/>'),
  reload: svg('<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>'),
  plug: svg('<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0zM12 17v4"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2-1.2L14.2 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.4-.9-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-.9a7 7 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7 7 0 0 0 2-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  file: svg('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>'),
  box: svg('<path d="M3 7l9-4 9 4v10l-9 4-9-4z"/><path d="M3 7l9 4 9-4M12 11v10"/>'),
  folder: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  download: svg('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  share: svg('<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6"/>'),
  compose: svg('<path d="M12 20h8M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  bell: svg('<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>'),
  dots: svg('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', 14),
  check: svg('<path d="m5 12 5 5 9-10"/>', 14),
  sidebar: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>', 14),
  voice: svg('<path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/>'),
  wave: svg('<path d="M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2"/>'),
  camera: svg('<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>'),
  mic: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  clip: svg('<path d="m20 11.5-8.3 8.3a5 5 0 0 1-7-7l8.8-8.8a3.3 3.3 0 0 1 4.7 4.7l-8.8 8.8a1.7 1.7 0 0 1-2.4-2.4l8.1-8.1"/>'),
  keyboard: svg('<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>'),
  split: svg('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>'),
  monitor: svg('<rect x="3" y="4.5" width="18" height="12" rx="2"/><path d="M9 20h6M12 16.5V20"/>')
};

const S = { data: null, current: null, messages: [], loadingThread: false, market: null };

// ---------- API ----------
async function api(path, opts = {}) {
  let res;
  try { res = await fetch(path, { ...opts, headers: { 'content-type': 'application/json' }, body: opts.body ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { const err = new Error(friendly(e)); err.offline = true; throw err; }
  if (res.status === 401) { location.href = '/login'; throw new Error('Logged out'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(friendly(data.error || 'Request failed'));
  return data;
}
// Downloads go through fetch so errors show, and so the Android app (whose WebView ignores download links)
// can save the file through its bridge.
async function download(url, fallbackName) {
  try {
    const res = await fetch(url);
    if (res.status === 401) { location.href = '/login'; return; }
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Download failed (${res.status})`);
    const m = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('content-disposition') || '');
    const name = m ? decodeURIComponent(m[1]) : fallbackName || url.split('/').pop();
    const blob = await res.blob();
    if (window.NimbusApp?.saveFile) {
      const b64 = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      window.NimbusApp.saveFile(name, blob.type || 'application/octet-stream', b64);
      return;
    }
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  } catch (e) { toast(e.message); }
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[download]');
  if (!a || a.href.startsWith('blob:')) return;
  e.preventDefault(); e.stopPropagation();
  download(a.href, a.getAttribute('download') || undefined);
  a.closest('.doc-menu')?.remove();
});
// Copy to the clipboard. navigator.clipboard only exists on HTTPS (and localhost), so over plain http
// fall back to the old copy command on a hidden text box. Resolves true if it copied.
async function clip(text) {
  try { if (navigator.clipboard && isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
  const prev = document.activeElement;
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove(); prev?.focus?.({ preventScroll: true });
  return ok;
}
function copyText(text) { clip(text).then((ok) => toast(ok ? 'Link copied' : text)); }
// A short message at the bottom. With { action, onAction } it gets a button (e.g. Undo) and stays a bit longer.
function toast(text, { action, onAction, ms, type } = {}) {
  type ||= /fail|error|couldn|can.t|denied|invalid|not allowed|too |reach/i.test(text) ? 'bad' : /saved|copied|done|sent|added|deleted|approved|ready|refreshed/i.test(text) ? 'ok' : 'info';
  const t = document.createElement('div');
  t.className = `toast t-${type}` + (action ? ' has-act' : ''); t.setAttribute('role', type === 'bad' ? 'alert' : 'status');
  const life = ms || (action ? 5000 : type === 'bad' ? 5000 : 2600);
  t.innerHTML = `<i class="t-ico">${{ ok: '✓', bad: '!', info: 'i' }[type]}</i><span class="t-txt"></span><b class="t-bar" style="animation-duration:${life}ms"></b>`;
  t.querySelector('.t-txt').textContent = text;
  if (action) {
    const b = document.createElement('button'); b.textContent = action;
    b.onclick = () => { onAction?.(); t.classList.add('out'); setTimeout(() => t.remove(), 220); };
    t.append(b);
  }
  let stack = document.getElementById('toasts');
  if (!stack) { stack = document.createElement('div'); stack.id = 'toasts'; document.body.append(stack); }
  [...stack.children].slice(0, -2).forEach((o) => o.remove()); // at most 3 at once
  stack.append(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, life);
}

// A light tap on phones (Android browsers and the Nimbus app); ignored elsewhere.
const buzz = (ms = 8) => { try { if (matchMedia('(pointer: coarse)').matches) navigator.vibrate?.(ms); } catch {} };

// ---------- theme ----------
function getPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem('nimbus.appearance')) || {}; } catch {}
  // Older settings had { mode: dark|light|system, accent } and no theme.
  if (!p.theme) { p.theme = p.mode || 'dark'; if (p.accent === '#3b82f6') delete p.accent; } // old default accent: use the theme's
  return p;
}
function applyTheme() {
  const p = getPrefs();
  const theme = resolveTheme(p, matchMedia('(prefers-color-scheme: dark)').matches);
  $('meta[name=theme-color]').content = applyThemeVars(document.documentElement, theme, p.accent);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

// ---------- helpers ----------
const bot = (id) => S.data?.bots.find((b) => b.id === Number(id));
const room = (id) => S.data?.rooms.find((r) => r.id === Number(id));
const threadKey = () => S.current ? S.current.thread || `${S.current.type}:${S.current.id}` : null;
// ---------- threads and projects ----------
const STARTERS = `<div class="starters">${['What can you help me with?', 'What did you work on recently?', 'Check your notes and suggest what to do next'].map((t) => `<button class="chip" data-starter="${t}">${t}</button>`).join('')}</div>`;
const threadOf = (key) => { const m = /^t:(\d+)$/.exec(key || ''); return m ? (S.data?.threads || []).find((t) => t.id === Number(m[1])) || null : null; };
const projectOf = (id) => (S.data?.projects || []).find((p) => p.id === id) || null;
const threadName = (key) => (String(key).startsWith('bot:') ? 'General' : threadOf(key)?.title || 'New thread');
const botKeys = (id) => ['bot:' + id, ...(S.data?.threads || []).filter((t) => t.bot_id === id).map((t) => 't:' + t.id)];
const TI = {
  chat: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"/></svg>',
  inbox: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1z"/></svg>',
  chev: '<svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><path d="m9 6 6 6-6 6"/></svg>',
  dots: '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
};
const sideOpen = JSON.parse(localStorage.sideOpen || '{}'); // bot id / 'p<id>' -> expanded?
const saveSideOpen = () => { localStorage.sideOpen = JSON.stringify(sideOpen); };
initAutomation({ S, api, esc, modal, closeModal: (...a) => closeModal(...a), toast, bot, avatar, ICON, openSettings: (k, r) => openSettings(k, r) });
initHomelab({ S, api, esc, modal, closeModal: (...a) => closeModal(...a), toast, bot, avatar, ICON, openThread: (k) => openThread(k) });
initCodeIde({ S, api, esc, modal, closeModal: (...a) => closeModal(...a), toast, bot, avatar, ICON, openThread: (k) => openThread(k), threadKey: () => threadKey(), refreshState: () => refreshState() });
initAiTools({ S, api, esc, modal, closeModal: (...a) => closeModal(...a), toast, bot, avatar, ICON, openThread: (k) => openThread(k), threadKey: () => threadKey(), addFiles: (f) => addFiles(f) });
initPages({ S, api, esc, modal, closeModal, toast, bot, avatar, ICON, openThread, refreshState: () => refreshState(), stamp, threadName, botOfThread: (k) => { const m = /^bot:(\d+)$/.exec(k || ''); return m ? Number(m[1]) : threadOf(k)?.bot_id ?? null; }, kbHint: (a) => { if (a === 'palette') return 'Ctrl+K'; const c = kbGet(a); return c ? kbLabel(c) : ''; } });
initCode({ mountBrowser: (id, el) => openBrowser(id, el), stopBrowserView: () => stopBrowserView(), browserBot: () => BR.bot, botEnvHtml, S, api, esc, modal, closeModal, toast, bot, avatar, ICON, TI, BOT_COLORS, threadKey, threadOf, openThread, refreshState, renderSide: () => renderSide(), renderMain: () => renderMain(), stamp, popover, sideOpen });
function crumbHtml() {
  const t = threadOf(threadKey()), p = t?.project_id ? projectOf(t.project_id) : null;
  return (p ? `<span class="muted">${esc(p.name)} ›</span> ` : '') + `<span>${esc(threadName(threadKey()))}</span>` + TI.chev;
}
function sideTree(b, key) {
  const ts = S.data.threads.filter((t) => t.bot_id === b.id && !t.archived);
  const row = (k, label, icon, cls = '') => `<button class="side-sub-item ${cls} ${key === k ? 'active' : ''}" data-open="${k}">${icon}<span class="lbl">${esc(label)}</span>${S.data.last[k] ? `<span class="time">${stamp(S.data.last[k].at)}</span>` : ''}</button>`;
  const chats = (list, cls = '') => list.filter((t) => t.kind === 'chat').sort((a, x) => (S.data.last['t:' + x.id]?.at || x.created_at) - (S.data.last['t:' + a.id]?.at || a.created_at))
    .map((t) => row('t:' + t.id, t.title || 'New thread', TI.chat, cls)).join('');
  const pids = [...new Set([...S.data.projects.filter((p) => p.owner_bot_id === b.id && !p.archived).map((p) => p.id), ...ts.filter((t) => t.project_id).map((t) => t.project_id)])];
  let h = row('bot:' + b.id, 'General', TI.chat);
  for (const pid of pids) {
    const p = projectOf(pid); if (!p || p.kind === 'code') continue; // code projects have their own section
    const open = sideOpen['p' + pid] !== false || ts.some((t) => t.project_id === pid && key === 't:' + t.id);
    h += `<div class="side-proj"><button class="side-sub-item proj ${open ? 'open' : ''}" data-proj-toggle="${pid}">${TI.chev}${ICON.folder}<span class="lbl">${esc(p.name)}</span>${p.owner_bot_id == null ? '<em>shared</em>' : ''}</button><button class="side-more" data-proj-menu="${pid}" data-bot="${b.id}" aria-label="Project options">${TI.dots}</button></div>`;
    if (open) h += chats(ts.filter((t) => t.project_id === pid), 'in-proj') || `<div class="side-sub-empty in-proj">No threads yet</div>`;
  }
  h += chats(ts.filter((t) => !t.project_id));
  const inbox = ts.find((t) => t.kind === 'inbox'), rt = ts.find((t) => t.kind === 'routines');
  if (inbox) h += row('t:' + inbox.id, 'Inbox', TI.inbox, 'builtin');
  if (rt) h += row('t:' + rt.id, 'Routines', ICON.clock, 'builtin');
  const arch = S.data.threads.filter((t) => t.bot_id === b.id && t.archived && t.kind === 'chat');
  if (arch.length) {
    const ao = !!sideOpen['a' + b.id];
    h += `<button class="side-sub-item builtin proj ${ao ? 'open' : ''}" data-arch-toggle="${b.id}">${TI.chev}${ICON.box}<span class="lbl">Archived (${arch.length})</span></button>`;
    if (ao) h += arch.map((t) => row('t:' + t.id, t.title || 'New thread', TI.chat, 'in-proj archived')).join('');
  }
  h += `<div class="side-sub-add"><button data-new-thread="${b.id}">${ICON.plus}<span>New thread</span></button><button data-new-project="${b.id}">${ICON.folder}<span>New project</span></button></div>`;
  return `<div class="side-sub">${h}</div>`;
}
function sharedProjects(key) {
  const ps = S.data.projects.filter((p) => p.owner_bot_id == null && !p.archived && p.kind !== 'code');
  if (!ps.length) return '';
  return `<div class="side-section">Shared projects</div>` + ps.map((p) => {
    const ts = S.data.threads.filter((t) => t.project_id === p.id && !t.archived && t.kind === 'chat');
    const rooms = S.data.rooms.filter((r) => r.project_id === p.id);
    const open = sideOpen['p' + p.id] !== false;
    return `<div class="side-proj top"><button class="side-sub-item proj ${open ? 'open' : ''}" data-proj-toggle="${p.id}">${TI.chev}${ICON.folder}<span class="lbl">${esc(p.name)}</span><span class="mini-avs">${p.members.slice(0, 4).map((id) => bot(id) ? avatar(bot(id), 16) : '').join('')}</span></button><button class="side-more" data-proj-menu="${p.id}" aria-label="Project options">${TI.dots}</button></div>`
      + (open ? `<div class="side-sub shared">${rooms.map((r) => `<button class="side-sub-item ${key === 'room:' + r.id ? 'active' : ''}" data-open="room:${r.id}">${roomAvatar(r, 16)}<span class="lbl">${esc(r.name)}</span></button>`).join('')}
        ${ts.filter((t) => !PENDING_DEL.has(t.id)).map((t) => `<button class="side-sub-item ${key === 't:' + t.id ? 'active' : ''}" data-open="t:${t.id}">${bot(t.bot_id) ? avatar(bot(t.bot_id), 16) : ''}<span class="lbl">${esc(t.title || 'New thread')}</span>${S.data.last['t:' + t.id] ? `<span class="time">${stamp(S.data.last['t:' + t.id].at)}</span>` : ''}</button>`).join('')}
        <div class="side-sub-add"><button data-proj-thread="${p.id}">${ICON.plus}<span>New thread</span></button></div></div>` : '');
  }).join('');
}
const BT = [['about', 'Overview: branch, merge, push', '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4-6 3-12 6"/>'], ['terminal', 'Terminal', '<path d="m5 8 4 4-4 4M12 16h7"/>'], ['changes', 'Changes', '<path d="M12 4v10M7 9h10M7 20h10"/>'], ['preview', 'Browser: app preview', '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>'], ['files', 'Files', '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/>'], ['tests', 'Tests', '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>'], ['commits', 'Commits', '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>'], ['pr', 'Pull request: checks and review comments', '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/><path d="M6 8v8M18 16V9a3 3 0 0 0-3-3h-4m2-2-2 2 2 2"/>'], ['issues', 'GitHub issues', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="1.5"/>'], ['search', 'Search in files (Ctrl+Shift+F)', '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5"/>'], ['problems', 'Problems: lint and type errors', '<path d="M12 3 2 20h20L12 3zM12 10v4M12 17h.01"/>']];
const BT_BTNS = `<span class="bt-group">${BT.map(([k, l, d]) => `<button class="icon-btn bt-btn" data-bt="${k}" title="${l}" aria-label="${l}"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>${k === 'changes' ? '<small class="bt-n"></small>' : ''}</button>`).join('')}</span>`;
const WS_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M9 12h12"/></svg>';
const PENDING_DEL = new Set(); // threads deleted a moment ago, still undoable
async function newThread(botId, projectId = null) {
  try {
    const { key } = await api('/api/threads', { method: 'POST', body: { botId, projectId } });
    sideOpen[botId] = true; saveSideOpen();
    await refreshState(); openThread(key);
  } catch (e) { toast(e.message); }
}
function projectModal(p, { ownerBotId = null, shared = false } = {}) {
  const isNew = !p;
  p = p || { name: '', instructions: '', owner_bot_id: shared ? null : ownerBotId, members: ownerBotId ? [ownerBotId] : [] };
  const members = new Set(p.members);
  const el = modal(`
    <div class="modal-head"><h2>${isNew ? (p.owner_bot_id == null ? 'New shared project' : `New project for ${esc(bot(p.owner_bot_id)?.name || 'bot')}`) : 'Project settings'}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">Name<input id="p-name" value="${esc(p.name)}" placeholder="Firewall hardening"></label>
    <label class="field">Instructions (optional)<textarea id="p-ins" rows="4" placeholder="What this project is about, rules, where things are. The bot reads this when a thread in the project starts.">${esc(p.instructions)}</textarea><span class="hint">Kept short is better: it's read at the start of every thread in the project.</span></label>
    ${p.owner_bot_id == null ? '<div class="field">Bots in this project<div id="p-picks" class="picks"></div></div>' : ''}
    <div class="modal-foot">
      ${isNew ? '' : '<button class="btn danger left" id="p-del">Delete project</button>'}
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="p-save">${isNew ? 'Create project' : 'Save'}</button>
    </div>`);
  const draw = () => { const pk = $('#p-picks', el); if (pk) pk.innerHTML = S.data.bots.map((b) => `<label class="pick ${members.has(b.id) ? 'on' : ''}"><input type="checkbox" data-pm="${b.id}" ${members.has(b.id) ? 'checked' : ''}>${avatar(b, 28)}<span>${esc(b.name)}</span></label>`).join(''); };
  draw();
  el.addEventListener('change', (e) => { if (e.target.dataset.pm) { const id = Number(e.target.dataset.pm); e.target.checked ? members.add(id) : members.delete(id); draw(); } });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    try {
      if (e.target.id === 'p-del' && confirm(`Delete the project "${p.name}"? Its threads and files are kept (the threads move out of the project).`)) {
        await api(`/api/projects/${p.id}`, { method: 'DELETE' }); closeModal(); return refreshState();
      }
      if (e.target.id === 'p-save') {
        const b = { name: $('#p-name', el).value, instructions: $('#p-ins', el).value, ...(p.owner_bot_id == null ? { members: [...members] } : {}) };
        if (isNew) { await api('/api/projects', { method: 'POST', body: { ...b, ownerBotId: p.owner_bot_id } }); if (p.owner_bot_id) { sideOpen[p.owner_bot_id] = true; saveSideOpen(); } }
        else await api(`/api/projects/${p.id}`, { method: 'PATCH', body: b });
        closeModal(); refreshState();
      }
    } catch (err) { toast(err.message); }
  });
  setTimeout(() => $('#p-name', el)?.focus(), 50);
}
function moveThreadModal(t) {
  const ps = S.data.projects.filter((p) => !p.archived && (p.owner_bot_id === t.bot_id || (p.owner_bot_id == null && p.members.includes(t.bot_id))));
  const el = modal(`<div class="modal-head"><h2>Move “${esc(t.title || 'New thread')}”</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="stack-list">${ps.map((p) => `<button class="card-item ${t.project_id === p.id ? 'active' : ''}" data-mv="${p.id}">${ICON.folder}<span><b>${esc(p.name)}</b><small>${p.owner_bot_id == null ? 'Shared project' : 'This bot’s project'}</small></span></button>`).join('')}
      <button class="card-item" data-mv="">${TI.chat}<span><b>No project</b><small>Keep it as a loose thread</small></span></button>
      <button class="card-item" data-mv-new>${ICON.plus}<span><b>New project…</b></span></button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-mv-new]')) return projectModal(null, { ownerBotId: t.bot_id });
    const mv = e.target.closest('[data-mv]'); if (!mv) return;
    try { await api(`/api/threads/${t.id}`, { method: 'PATCH', body: { projectId: mv.dataset.mv ? Number(mv.dataset.mv) : null } }); closeModal(); refreshState(); } catch (err) { toast(err.message); }
  });
}
let menuThread = null, menuProject = null;
// A bot's look is stored in `shape` as "hat/glasses/body/face/extra". Older bots only have
// "hat/glasses"; the missing parts fall back to the original cloud with a smile.
const HATS = ['none', 'cap', 'beanie', 'tophat', 'crown', 'party', 'headphones', 'halo', 'wizard', 'chef', 'cowboy', 'bow', 'flower', 'horns', 'antenna', 'santa', 'sprout'];
const GLASSES = ['none', 'shades', 'specs', 'monocle', 'visor', '3d', 'round', 'heart', 'star', 'eyepatch', 'goggles'];
const BODIES = ['cloud', 'blob', 'ghost', 'box', 'cat'];
const FACES = ['smile', 'happy', 'wink', 'surprised', 'sleepy', 'cat', 'tongue', 'mustache', 'grumpy'];
const EXTRAS = ['none', 'bowtie', 'scarf', 'tie', 'sparkles', 'hearts', 'badge'];
const LOOK_PARTS = [['body', BODIES, 'Body'], ['face', FACES, 'Face'], ['hat', HATS, 'Hat'], ['glasses', GLASSES, 'Glasses'], ['extra', EXTRAS, 'Extra']];
const px = (x, y, w, h, fill, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"${extra}/>`;
function outfit(b) {
  const [hat, glasses, body, face, extra] = String(b?.shape || '').split('/');
  const pick = (v, list) => (list.includes(v) ? v : list[0]);
  return { hat: pick(hat, HATS), glasses: pick(glasses, GLASSES), body: pick(body, BODIES), face: pick(face, FACES), extra: pick(extra, EXTRAS) };
}
const lookShape = (l) => [l.hat, l.glasses, l.body, l.face, l.extra].join('/');

// Body outlines as [row, firstCol, lastCol] spans on the 14x14 grid; eyes and cheeks sit on rows 6-8 for every body.
const BODY_ROWS = {
  cloud: { rows: [[2, 4, 6], [3, 3, 7], [3, 9, 10], [4, 2, 11], [5, 1, 12], [6, 1, 12], [7, 1, 12], [8, 1, 12], [9, 2, 5], [9, 7, 11]], feet: true },
  blob: { rows: [[2, 5, 8], [3, 3, 10], [4, 2, 11], [5, 1, 12], [6, 1, 12], [7, 1, 12], [8, 1, 12], [9, 2, 11]], feet: true },
  ghost: { rows: [[2, 4, 9], [3, 3, 10], [4, 2, 11], [5, 2, 11], [6, 2, 11], [7, 2, 11], [8, 2, 11], [9, 2, 11], [10, 2, 3], [10, 5, 6], [10, 8, 9], [10, 11, 11]], feet: false },
  box: { rows: [[3, 2, 11], [4, 1, 12], [5, 1, 12], [6, 1, 12], [7, 1, 12], [8, 1, 12], [9, 2, 11]], feet: true },
  cat: { rows: [[1, 2, 3], [1, 10, 11], [2, 2, 4], [2, 9, 11], [3, 2, 11], [4, 1, 12], [5, 1, 12], [6, 1, 12], [7, 1, 12], [8, 1, 12], [9, 2, 5], [9, 7, 11]], feet: true }
};

function critter(color, look = {}, legacyGlasses) {
  if (typeof look === 'string') look = { hat: look, glasses: legacyGlasses }; // old (color, hat, glasses) calls
  const { hat = 'none', glasses = 'none', body = 'cloud', face = 'smile', extra = 'none' } = look;
  const c = esc(color || '#f4f6ff'), ink = '#16204a', shade = ' opacity=".12"';
  const B = BODY_ROWS[body] || BODY_ROWS.cloud;
  const feet = B.feet ? [[4, 10, 2], [8, 10, 2]] : [];
  const bottom = Math.max(...B.rows.map((r) => r[0]));
  let s = B.rows.map(([y, a, z]) => px(a - 0.5, y - 0.5, z - a + 2, 2, ink)).join('')
    + feet.map(([x, y, w]) => px(x - 0.5, y - 0.2, w + 1, 1.7, ink)).join('')
    + B.rows.map(([y, a, z]) => px(a, y, z - a + 1, 1, c)).join('')
    + feet.map(([x, y, w]) => px(x, y, w, 1, c)).join('')
    + B.rows.filter(([y]) => y === bottom).map(([y, a, z]) => px(a, y, z - a + 1, 1, ink, shade)).join('')
    + px(4.3, (B.rows[0][0]) + 0.3, 1.2, 0.5, '#fff', ' opacity=".8"');
  if (body === 'box') s += px(6.5, 1, 1, 2, ink) + px(6.1, 0.4, 1.8, 1, '#f5c542');
  if (body === 'cat') s += px(2.6, 1.6, 0.8, 0.8, '#f59bb0') + px(10.6, 1.6, 0.8, 0.8, '#f59bb0');

  // Face: eyes, cheeks and mouth.
  const eye = (x) => px(x, 6, 1.3, 1.5, ink, ' class="eye"') + px(x + 0.4, 6.2, 0.45, 0.45, '#fff', ' class="eye"');
  const closed = (x) => px(x - 0.1, 6.7, 1.5, 0.45, ink);
  const arc = (x) => px(x, 6.4, 0.45, 0.45, ink) + px(x + 0.4, 6, 0.6, 0.45, ink) + px(x + 0.9, 6.4, 0.45, 0.45, ink);
  const cheeks = px(2.4, 7.7, 1.1, 0.6, '#f59bb0') + px(10.5, 7.7, 1.1, 0.6, '#f59bb0');
  const smile = px(6.1, 7.6, 0.4, 0.4, ink) + px(6.5, 8, 1, 0.4, ink) + px(7.5, 7.6, 0.4, 0.4, ink);
  s += cheeks + {
    smile: eye(3.8) + eye(8.9) + smile,
    happy: arc(3.8) + arc(8.9) + px(6.1, 7.6, 1.8, 0.5, ink) + px(6.4, 8.1, 1.2, 0.5, '#e2475f'),
    wink: eye(3.8) + arc(8.9) + smile,
    surprised: eye(3.8) + eye(8.9) + px(6.4, 7.6, 1.2, 1.2, ink),
    sleepy: closed(3.8) + closed(8.9) + px(6.5, 8, 1, 0.4, ink) + px(11.6, 3.2, 0.9, 0.3, ink) + px(12.2, 2.9, 0.3, 0.3, ink) + px(11.6, 2.6, 0.9, 0.3, ink),
    cat: eye(3.8) + eye(8.9) + px(5.9, 7.7, 0.4, 0.4, ink) + px(6.3, 8.1, 0.6, 0.4, ink) + px(6.8, 7.7, 0.4, 0.4, ink) + px(7.1, 8.1, 0.6, 0.4, ink) + px(7.6, 7.7, 0.4, 0.4, ink),
    tongue: eye(3.8) + eye(8.9) + smile + px(6.6, 8.3, 0.8, 0.7, '#e2475f'),
    mustache: eye(3.8) + eye(8.9) + px(5.3, 7.6, 3.4, 0.6, '#5a3a22') + px(4.9, 7.9, 0.6, 0.5, '#5a3a22') + px(8.5, 7.9, 0.6, 0.5, '#5a3a22'),
    grumpy: eye(3.8) + eye(8.9) + px(3.6, 5.4, 1.5, 0.35, ink) + px(8.9, 5.4, 1.5, 0.35, ink) + px(6.1, 8, 0.4, 0.4, ink) + px(6.5, 7.7, 1, 0.4, ink) + px(7.5, 8, 0.4, 0.4, ink)
  }[face];

  const E = 6, L = 3.3, R = 8.4;
  const heart = (x, y, f) => px(x, y, 0.8, 0.8, f) + px(x + 1.2, y, 0.8, 0.8, f) + px(x - 0.2, y + 0.5, 2.4, 0.8, f) + px(x + 0.3, y + 1.2, 1.4, 0.6, f) + px(x + 0.7, y + 1.7, 0.6, 0.4, f);
  const star = (x, y, f, k = 1) => px(x + 0.8 * k, y, 0.6 * k, 2.2 * k, f) + px(x, y + 0.8 * k, 2.2 * k, 0.6 * k, f) + px(x + 0.4 * k, y + 0.4 * k, 1.4 * k, 1.4 * k, f);
  s += {
    none: '',
    shades: px(L, E - 0.2, 2.4, 1.8, '#111') + px(R, E - 0.2, 2.4, 1.8, '#111') + px(L + 2.4, E + 0.3, R - L - 2.4, 0.45, '#111') + px(L + 0.3, E + 0.1, 0.7, 0.35, '#fff', ' opacity=".55"') + px(R + 0.3, E + 0.1, 0.7, 0.35, '#fff', ' opacity=".55"'),
    specs: `<g fill="rgba(255,255,255,.25)" stroke="${ink}" stroke-width=".4">${px(L, E - 0.3, 2.4, 2, '')}${px(R, E - 0.3, 2.4, 2, '')}</g>` + px(L + 2.4, E + 0.4, R - L - 2.4, 0.4, ink),
    monocle: `<rect x="${R - 0.1}" y="${E - 0.4}" width="2.6" height="2.2" rx="1" fill="rgba(255,255,255,.25)" stroke="#f5c542" stroke-width=".4"/>` + px(R + 2.2, E + 1.8, 0.4, 2, '#f5c542'),
    visor: px(1.5, E - 0.4, 11, 2.1, '#48d6f0') + px(1.5, E - 0.4, 11, 0.55, '#b8f3ff') + px(3.8, E + 0.1, 1.3, 1.1, '#0b3a44', ' opacity=".55"') + px(8.9, E + 0.1, 1.3, 1.1, '#0b3a44', ' opacity=".55"'),
    '3d': `<g stroke="#f4f4f4" stroke-width=".4">${px(L, E - 0.3, 2.4, 2, '#e2475f')}${px(R, E - 0.3, 2.4, 2, '#3fb6e8')}</g>` + px(L + 2.4, E + 0.4, R - L - 2.4, 0.4, '#f4f4f4'),
    round: `<g fill="rgba(255,255,255,.2)" stroke="#b07a3b" stroke-width=".45"><circle cx="${L + 1.2}" cy="${E + 0.7}" r="1.35"/><circle cx="${R + 1.2}" cy="${E + 0.7}" r="1.35"/></g>` + px(L + 2.5, E + 0.5, R - L - 2.6, 0.35, '#b07a3b'),
    heart: heart(L + 0.2, E - 0.3, '#e84fa0') + heart(R + 0.2, E - 0.3, '#e84fa0') + px(L + 2.4, E + 0.3, R - L - 2.4, 0.4, '#e84fa0'),
    star: star(L + 0.1, E - 0.5, '#f5c542') + star(R + 0.1, E - 0.5, '#f5c542') + px(L + 2.3, E + 0.4, R - L - 2.2, 0.4, '#f5c542'),
    eyepatch: px(R - 0.1, E - 0.4, 2.6, 2.2, '#111') + px(1, E - 1.6, R - 1, 0.4, '#111') + px(R + 2.5, E - 0.4, 2, 0.4, '#111'),
    goggles: px(1.2, E + 0.2, 11.6, 0.6, '#5a3a22') + `<g stroke="#8a8f98" stroke-width=".5" fill="#9be7c4" fill-opacity=".55">${px(L - 0.2, E - 0.5, 2.8, 2.4, '')}${px(R - 0.2, E - 0.5, 2.8, 2.4, '')}</g>`
  }[glasses] || '';

  const X = 5.5, T = (B.rows[0][0] === 1 ? 2 : B.rows[0][0]) + 1; // hat centre and the top of the body
  s += {
    none: '',
    cap: px(X - 2.5, T - 1.6, 5, 1.9, '#2f6fed') + px(X + 1.5, T - 0.2, 4, 0.9, '#2356c4') + px(X - 0.5, T - 2, 1, 0.5, '#2356c4'),
    beanie: px(X - 2.5, T - 2.2, 5, 1.8, '#1f9d6b') + px(X - 3, T - 0.6, 6, 1, '#167a52') + px(X - 0.5, T - 3.1, 1, 1, '#f4f4f4'),
    tophat: px(X - 1.8, T - 4, 3.6, 3.4, '#1b1b1b') + px(X - 1.8, T - 1.4, 3.6, 0.6, '#e2475f') + px(X - 2.9, T - 0.6, 5.8, 0.9, '#1b1b1b'),
    crown: px(X - 2.5, T - 1, 5, 1.1, '#f5c542') + px(X - 2.5, T - 2.1, 1, 1.1, '#f5c542') + px(X - 0.5, T - 2.5, 1, 1.5, '#f5c542') + px(X + 1.5, T - 2.1, 1, 1.1, '#f5c542') + px(X - 0.5, T - 0.8, 1, 0.7, '#e2475f'),
    party: px(X - 2, T - 0.8, 4, 1, '#e84fa0') + px(X - 1.5, T - 1.8, 3, 1, '#f5c542') + px(X - 1, T - 2.8, 2, 1, '#e84fa0') + px(X - 0.5, T - 3.8, 1, 1, '#3fb6e8'),
    headphones: px(2.2, T - 0.3, 9.6, 0.7, '#262626') + px(1.6, T + 0.2, 0.8, 2.5, '#262626') + px(11.6, T + 0.2, 0.8, 2.5, '#262626') + px(0.2, 5, 1.8, 2.6, '#262626') + px(12, 5, 1.8, 2.6, '#262626'),
    halo: `<ellipse cx="${X + 3}" cy="${T - 1.6}" rx="2.8" ry=".8" fill="none" stroke="#8b93f5" stroke-width=".55"/>`,
    wizard: px(X - 3, T - 0.6, 6.5, 0.9, '#5b3fc4') + px(X - 2, T - 1.6, 4.5, 1, '#6b4fe0') + px(X - 1.2, T - 2.6, 3, 1, '#6b4fe0') + px(X - 0.4, T - 3.6, 1.8, 1, '#6b4fe0') + px(X + 0.6, T - 4.3, 1.2, 0.8, '#6b4fe0') + px(X - 1, T - 1.4, 0.6, 0.6, '#f5c542') + px(X + 1.2, T - 2.4, 0.5, 0.5, '#f5c542'),
    chef: px(X - 2.2, T - 1.2, 4.4, 1.4, '#f4f4f4') + px(X - 2.6, T - 3, 1.9, 1.9, '#f4f4f4') + px(X - 1, T - 3.5, 2, 2.4, '#f4f4f4') + px(X + 0.7, T - 3, 1.9, 1.9, '#f4f4f4') + px(X - 2.2, T - 0.2, 4.4, 0.4, '#c9ccd4'),
    cowboy: px(X - 4, T - 0.4, 8, 0.9, '#8a5a2b') + px(X - 4.4, T - 0.9, 1, 0.7, '#8a5a2b') + px(X + 3.4, T - 0.9, 1, 0.7, '#8a5a2b') + px(X - 2, T - 2.6, 4, 2.3, '#a86d35') + px(X - 2, T - 1, 4, 0.5, '#5a3a22'),
    bow: px(X + 1.5, T - 1.2, 1.6, 1.8, '#e84fa0') + px(X + 4, T - 1.2, 1.6, 1.8, '#e84fa0') + px(X + 3, T - 0.8, 1.1, 1.1, '#c23a84'),
    flower: px(X + 2.6, T - 2.4, 1.1, 1.1, '#ff9fb5') + px(X + 1.5, T - 1.3, 1.1, 1.1, '#ff9fb5') + px(X + 3.7, T - 1.3, 1.1, 1.1, '#ff9fb5') + px(X + 2.6, T - 0.2, 1.1, 1.1, '#ff9fb5') + px(X + 2.6, T - 1.3, 1.1, 1.1, '#f5c542'),
    horns: px(2.2, T - 1, 1.2, 1.2, '#e2475f') + px(1.6, T - 2.2, 1, 1.4, '#e2475f') + px(10.6, T - 1, 1.2, 1.2, '#e2475f') + px(11.4, T - 2.2, 1, 1.4, '#e2475f'),
    antenna: px(X + 1.2, T - 3, 0.5, 3, ink) + px(X + 0.8, T - 4, 1.3, 1.3, '#48d6f0') + px(X + 1, T - 3.8, 0.4, 0.4, '#fff'),
    santa: px(X - 2.6, T - 0.6, 5.6, 1.1, '#f4f4f4') + px(X - 2, T - 2, 4.4, 1.5, '#e2475f') + px(X - 0.6, T - 3, 3, 1.1, '#e2475f') + px(X + 2, T - 2.6, 1.1, 1.1, '#e2475f') + px(X + 2.8, T - 2.2, 1.1, 1.1, '#f4f4f4'),
    sprout: px(X + 1.3, T - 2, 0.45, 2, '#1f9d6b') + px(X - 0.2, T - 2.8, 1.5, 0.9, '#3ccf8e') + px(X + 1.7, T - 3.3, 1.7, 1, '#3ccf8e')
  }[hat] || '';

  s += {
    none: '',
    bowtie: px(5.2, 8.9, 1.5, 1.2, '#e2475f') + px(7.3, 8.9, 1.5, 1.2, '#e2475f') + px(6.6, 9.1, 0.8, 0.8, '#b8324a'),
    scarf: px(1.5, 8.6, 11, 1, '#f08a3c') + px(9, 9.4, 1.4, 2, '#f08a3c') + px(9, 10.9, 1.4, 0.4, '#c96a26') + px(3, 8.6, 0.5, 1, '#c96a26', ' opacity=".6"') + px(6, 8.6, 0.5, 1, '#c96a26', ' opacity=".6"'),
    tie: px(6.4, 8.7, 1.2, 0.8, '#2f6fed') + px(6.2, 9.4, 1.6, 1.6, '#2f6fed') + px(6.6, 10.9, 0.8, 0.5, '#2f6fed'),
    sparkles: star(11.2, 0.6, '#f5c542', 0.8) + star(0.4, 2.6, '#f5c542', 0.6) + px(12.6, 4.4, 0.5, 0.5, '#f5c542'),
    hearts: heart(11.3, 1, '#e84fa0') + heart(0.5, 2.8, '#ff9fb5'),
    badge: `<circle cx="10.2" cy="9.3" r="1.1" fill="#f5c542" stroke="${ink}" stroke-width=".3"/>` + px(9.9, 9, 0.6, 0.6, '#e2475f')
  }[extra] || '';
  return s;
}
function avatar(b, size = 36) {
  if (!b) b = { color: '#9aa3ad' };
  return `<span class="avatar" style="width:${size}px;height:${size}px;--c:${esc(b.color)};border-radius:${Math.round(size * 0.28)}px"><svg viewBox="0 0 14 14" width="${Math.round(size * 0.86)}" height="${Math.round(size * 0.86)}" shape-rendering="crispEdges" aria-hidden="true">${critter(b.color, outfit(b))}</svg></span>`;
}
function roomAvatar(r, size = 36) {
  const m = r.members.slice(0, 2).map((id) => bot(id));
  if (m.length < 2) return avatar(m[0], size);
  const s = Math.round(size * 0.66);
  return `<span class="avatar stack" style="width:${size}px;height:${size}px"><span style="left:0;top:0">${avatar(m[0], s)}</span><span style="right:0;bottom:0">${avatar(m[1], s)}</span></span>`;
}
function stamp(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000), now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], now - d < 6 * 864e5 ? { weekday: 'long' } : { month: 'short', day: 'numeric' });
}
function timeAgo(sec) {
  const d = Date.now() / 1000 - sec;
  if (d < 60) return 'now'; if (d < 3600) return Math.floor(d / 60) + 'm';
  if (d < 86400) return Math.floor(d / 3600) + 'h'; return Math.floor(d / 86400) + 'd';
}
function msgStamp(sec) {
  if (!sec) return '';
  const d = new Date(sec * 1000), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const day = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday'
    : d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `<time class="stamp" datetime="${d.toISOString()}" title="${esc(d.toLocaleString([], { dateStyle: 'full', timeStyle: 'short' }))}">${day} ${clock(sec)}</time>`;
}
function clock(sec) { return new Date(sec * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function whenNext(ms) {
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  if (d.toDateString() === now.toDateString()) return t;
  const tmr = new Date(now); tmr.setDate(now.getDate() + 1);
  if (d.toDateString() === tmr.toDateString()) return 'Tmr ' + t;
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + t;
}
// Makes bare web addresses in already-escaped HTML clickable: after spaces, brackets, quotes, bold or inside
// `code`, with trailing punctuation left out ("see https://x.com." links x.com). Existing links are skipped.
function linkify(h) {
  return h.split(/(<a\b[^>]*>[\s\S]*?<\/a>)/).map((seg, i) => i % 2 ? seg : seg.replace(
    /(^|[\s(\[>*_]|&quot;|&#39;|&lt;)((?:https?:\/\/|www\.)[^\s<]+)/g, (all, pre, url) => {
      let tail = '';
      for (;;) {
        const m = url.match(/(?:[.,;:!?*_\]]|&quot;|&#39;|&gt;|\)(?![^(]*\())$/);
        if (!m || (m[0] === ')' && (url.match(/\(/g) || []).length >= (url.match(/\)/g) || []).length)) break;
        tail = m[0] + tail; url = url.slice(0, -m[0].length);
      }
      if (!/[\w/)]/.test(url.slice(-1))) return all;
      const href = url.startsWith('www.') ? 'https://' + url : url;
      return `${pre}<a href="${href}" target="_blank" rel="noopener">${url}</a>${tail}`;
    })).join('');
}
function md(src) {
  const blocks = String(src ?? '').split(/```/);
  return blocks.map((part, i) => {
    if (i % 2) {
      const tag = (part.match(/^([\w+#.-]*)\n/) || [, ''])[1], code = part.slice(tag.length).replace(/^\n/, '').replace(/\n$/, ''), lang = langOf(tag, code);
      return `<div class="codeblk"><div class="cb-head"><span>${esc(LANG_NAME[lang] || tag || 'Code')}</span>${['sh', 'ps'].includes(lang) ? '<button class="cb-copy cb-run" data-run-code title="Run in this task’s terminal">▷ Run</button>' : ''}<button class="cb-copy" data-copy-code title="Copy code">Copy</button></div><pre><code class="hl no-i18n">${highlight(code, lang)}</code></pre></div>`;
    }
    return part.trim().split(/\n{2,}/).map((para) => {
      let h = esc(para)
        .replace(/`([^`]+)`/g, (a, c) => `<code${/^[~.\w-]*\/[\w./-]+$|^[\w-]+\.(?:js|mjs|ts|py|sh|json|md|css|html|ya?ml|conf|txt|sql|ps1|cs|java|go|rs)$/.test(c) ? ' class="path" data-copy-path title="Click to copy"' : ''}>${c}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
        .replace(/(^|\s)@([A-Z][\w]*(?: [A-Z][\w]*)?)/g, '$1<strong class="mention">@$2</strong>');
      h = linkify(h);
      if (/^\s*[-*] /m.test(para) && para.split('\n').every((l) => /^\s*[-*] /.test(l) || !l.trim())) {
        return '<ul>' + h.split('\n').filter((l) => l.trim()).map((l) => `<li>${l.replace(/^\s*[-*] /, '')}</li>`).join('') + '</ul>';
      }
      return `<p>${h.replace(/\n/g, '<br>')}</p>`;
    }).join('');
  }).join('');
}
function userName() {
  const e = S.data?.user?.email || '';
  const n = e.split('@')[0] || 'You';
  return n.charAt(0).toUpperCase() + n.slice(1);
}

// ---------- sidebar ----------
let sideQuery = '';
function renderSide() {
  const d = S.data;
  const key = threadKey();
  if (CM.on && !EMBED) { $('#side').innerHTML = codeModeSide(key); return; }
  const items = [
    ...d.bots.map((b) => ({ key: 'bot:' + b.id, bot: b, name: b.name, av: avatar(b, 38), state: b.status.state, last: botKeys(b.id).map((k) => d.last[k]).filter(Boolean).sort((x, y) => y.at - x.at)[0], fallback: b.role, created: b.created_at })),
    ...d.rooms.map((r) => ({ key: 'room:' + r.id, name: r.name, av: roomAvatar(r, 38), state: r.members.some((id) => bot(id)?.status.state === 'working') ? 'working' : 'idle', last: d.last['room:' + r.id], fallback: `${r.members.length} bots`, created: r.created_at }))
  ].filter((it) => !sideQuery || it.name.toLowerCase().includes(sideQuery))
    .sort((a, b) => (b.last?.at || b.created || 0) - (a.last?.at || a.created || 0));
  // Your own order (from dragging) wins; chats not placed yet stay on top, newest first.
  if (d.sideOrder) {
    const pos = new Map(d.sideOrder.map((k, i) => [k, i]));
    items.sort((a, b) => (pos.has(a.key) ? pos.get(a.key) : -1) - (pos.has(b.key) ? pos.get(b.key) : -1));
  }
  const pending = d.approvals.length;
  for (const it of items) if (it.last && isActiveItem(it, key)) markSeen(it.key, it.last.at);
  SIDE_ITEMS = items;
  $('#side').innerHTML = `
    <div class="side-top">
      <label class="search">${ICON.search}<input id="side-search" placeholder="Search" title="Search chats and messages · Ctrl+K jumps anywhere" value="${esc(sideQuery)}" autocomplete="off"></label>
      <button class="icon-btn" data-act="new-menu" aria-label="New">${ICON.plus}</button>
      <button class="icon-btn side-collapse" data-act="side-collapse" aria-label="Collapse sidebar" title="Collapse sidebar (${esc(kbLabel(kbGet('sidebar')))})">${ICON.sidebar}</button>
    </div>
    <div class="side-list">
      ${sideQuery ? '' : `<button class="side-item side-home ${S.home ? 'active' : ''}" data-act="home"><span class="av-wrap"><span class="home-ico">${ICON.home}</span></span><span class="meta"><span class="row1"><span class="name">Home</span>${homeCount() ? `<span class="unread-badge">${homeCount()}</span>` : ''}</span><span class="sub">What your bots are up to</span></span></button>`}
      ${items.length ? sideSections(items).map(([g, list]) => (g ? `<div class="side-group-head" data-group="${g.id}"><span class="side-caret ${g.collapsed ? '' : 'open'}">${TI.chev}</span><span class="g-name">${esc(g.name)}</span><span class="g-count">${list.length}</span><span class="icon-btn g-edit" data-group-edit="${g.id}" role="button" aria-label="Edit group">${ICON.dots || '⋯'}</span></div><div class="side-group-body" ${g.collapsed && !sideQuery ? 'hidden' : ''}>` : '') + list.map((it) => `
        <button class="side-item ${isUnread(it) ? 'unread' : ''} ${key === it.key || (it.bot && S.current?.type === 'bot' && S.current.id === it.bot.id && !sideIsOpen(it.bot.id)) ? 'active' : ''}" data-open="${it.key}" data-key="${it.key}">
          <span class="av-wrap ${it.bot && S.data.moods?.[it.bot.id] ? 'mood-' + S.data.moods[it.bot.id] : ''}">${it.av}${it.state !== 'idle' ? `<span class="dot ${it.state}"></span>` : ''}</span>
          <span class="meta">
            <span class="row1"><span class="name">${esc(it.name)}</span><span class="time">${it.last ? stamp(it.last.at) : ''}</span>${isUnread(it) ? '<i class="unread-dot" aria-label="Unread"></i>' : ''}</span>
            <span class="sub">${esc(it.last ? (it.last.author === 'user' ? 'You: ' : '') + it.last.text : it.fallback || 'Say hi')}</span>
          </span>
          ${it.bot ? `<span class="side-caret ${sideIsOpen(it.bot.id) ? 'open' : ''}" data-expand="${it.bot.id}" role="button" aria-label="Show threads">${TI.chev}</span>` : ''}
        </button>${it.bot && !sideQuery && sideIsOpen(it.bot.id) ? sideTree(it.bot, key) : ''}`).join('') + (g ? '</div>' : '')).join('') + (sideQuery ? '' : codeSidebar(key) + sharedProjects(key)) + (sideQuery ? '' : d.sideOrder ? '<button class="side-reset" data-act="side-recent">↺ Sort by recent activity</button>'
          : items.length > 1 ? '<div class="side-hint">Tip: drag chats to arrange them</div>' : '')
        : sideQuery ? '<div class="side-empty">No chats match</div>'
        : `<div class="side-empty">No bots yet.<br><button class="link" data-act="market">Browse Connectors</button> or <button class="link" data-act="new-bot">make one</button>.</div>`}
    </div>
    ${sideQuery.length >= 2 ? `<div class="side-hits" id="side-hits"><div class="side-empty">Searching messages…</div></div>` : ''}
    <div class="side-foot">
      ${pending ? `<button class="foot-item" data-act="panel">${ICON.bell}<span>Approvals</span><span class="badge">${pending}</span></button>` : ''}
      <button class="foot-item" data-act="market">${ICON.grid}<span>Connectors</span></button>
      <button class="foot-item" data-act="cc-plugins">${ICON.plug}<span>Plugins &amp; skills</span></button>
      <button class="foot-item user" data-act="user-menu"><span class="initial">${esc(userName()[0])}</span><span>${esc(userName())}</span></button>
    </div>`;
}

const _renderSide = renderSide;
renderSide = function () {
  if (drag?.started) return; // don't rebuild the list under your finger mid-drag
  _renderSide(); if (sideQuery.length >= 2) searchMessages(); // keep message hits after re-renders
};

// Sidebar groups: ungrouped chats first, then each group in its order. Empty groups still show (when not searching).
function sideSections(items) {
  const groups = S.data.sideGroups || [], byKey = new Map(items.map((it) => [it.key, it])), used = new Set();
  const out = groups.map((g) => { const list = items.filter((it) => g.keys.includes(it.key)); list.forEach((it) => used.add(it.key)); return [g, list]; });
  return [[null, items.filter((it) => !used.has(it.key))], ...out.filter(([, l]) => l.length || !sideQuery)].filter(([g, l]) => g || l.length);
}
function saveGroups() { renderSide(); return api('/api/side-groups', { method: 'PUT', body: { groups: S.data.sideGroups } }).catch((err) => toast(err.message)); }
document.addEventListener('click', (e) => {
  const ed = e.target.closest('[data-group-edit]');
  if (ed) { e.stopPropagation(); return groupModal((S.data.sideGroups || []).find((g) => g.id === ed.dataset.groupEdit)); }
  const h = e.target.closest('.side-group-head'); if (!h) return;
  const g = (S.data.sideGroups || []).find((x) => x.id === h.dataset.group); if (g) { g.collapsed = !g.collapsed; saveGroups(); }
});
function groupModal(g) {
  const isNew = !g || g.fresh;
  g = g ? { ...g, fresh: undefined } : { id: Math.random().toString(36).slice(2, 10), name: '', collapsed: false, keys: [] };
  const inOther = new Map((S.data.sideGroups || []).filter((x) => x.id !== g.id).flatMap((x) => x.keys.map((k) => [k, x.name])));
  const chats = [...S.data.bots.map((b) => ['bot:' + b.id, avatar(b, 28), b.name]), ...S.data.rooms.map((r) => ['room:' + r.id, roomAvatar(r, 28), r.name])];
  const el = modal(`
    <div class="modal-head"><h2>${isNew ? 'New sidebar group' : 'Edit group'}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">Name<input id="g-name" value="${esc(g.name)}" placeholder="Homelab"></label>
    <div class="field">Bots and chats<div class="picks">${chats.map(([k, av, name]) => `<label class="pick ${g.keys.includes(k) ? 'on' : ''}"><input type="checkbox" data-key="${k}" ${g.keys.includes(k) ? 'checked' : ''}>${av}<span>${esc(name)}${inOther.has(k) ? ` <span class="hint">(in ${esc(inOther.get(k))})</span>` : ''}</span></label>`).join('')}</div></div>
    <div class="modal-foot">
      ${isNew ? '' : '<button class="btn danger left" id="g-del">Delete group</button>'}
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="g-save">${isNew ? 'Create group' : 'Save'}</button>
    </div>`);
  el.addEventListener('change', (e) => e.target.dataset.key && e.target.closest('.pick').classList.toggle('on', e.target.checked));
  $('#g-save', el).onclick = () => {
    const keys = [...el.querySelectorAll('input[data-key]:checked')].map((i) => i.dataset.key);
    const groups = (S.data.sideGroups || []).filter((x) => x.id !== g.id).map((x) => ({ ...x, keys: x.keys.filter((k) => !keys.includes(k)) }));
    const next = { ...g, name: $('#g-name', el).value.trim() || 'Group', keys };
    if (isNew) groups.push(next); else groups.splice((S.data.sideGroups || []).findIndex((x) => x.id === g.id), 0, next);
    S.data.sideGroups = groups; closeModal(); saveGroups();
  };
  const del = $('#g-del', el);
  if (del) del.onclick = () => { S.data.sideGroups = S.data.sideGroups.filter((x) => x.id !== g.id); closeModal(); saveGroups(); };
}

// A bot's threads show when you expand it; the bot you're in is expanded unless you closed it.
function sideIsOpen(id) { return sideOpen[id] ?? (S.current?.type === 'bot' && S.current.id === id); }
document.addEventListener('click', (e) => {
  const c = e.target.closest('[data-expand]'); if (!c) return;
  e.stopPropagation(); e.preventDefault();
  const id = Number(c.dataset.expand); sideOpen[id] = !sideIsOpen(id); saveSideOpen(); renderSide();
}, true);

// ---------- drag to reorder the sidebar ----------
// Mouse: press and move. Touch: hold for a moment, then drag (a quick swipe still scrolls the list).
// The order is saved on the server, so it's the same on every device.
let drag = null; // { item, list, startY, grabDy, ty, started, timer, touch }
let suppressClickUntil = 0;
document.addEventListener('click', (e) => { if (Date.now() < suppressClickUntil) { e.stopPropagation(); e.preventDefault(); } }, true);
function dragBegin(item, y, touch) {
  if (sideQuery) return; // the list is filtered while searching
  drag = { item, list: item.parentElement, startY: y, started: false, touch };
  if (touch) drag.timer = setTimeout(() => dragStart(y), 320);
}
function dragStart(y) {
  if (!drag) return;
  drag.started = true;
  const r = drag.item.getBoundingClientRect();
  drag.grabDy = y - r.top;
  drag.item.classList.add('dragging');
  document.body.classList.add('reordering');
  buzz(12);
}
function dragMove(y) {
  if (!drag) return;
  if (!drag.started) {
    if (Math.abs(y - drag.startY) < 6) return;
    if (drag.touch) { clearTimeout(drag.timer); drag = null; return; } // moved before the hold: it's a scroll
    dragStart(drag.startY);
  }
  const { item, list } = drag;
  // Follow the pointer, then swap with a neighbour once the pointer passes its middle.
  const siblings = [...list.querySelectorAll(':scope > .side-item:not(.dragging)')];
  const target = siblings.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
  const before = siblings.map((el) => [el, el.getBoundingClientRect().top]);
  const next = item.nextElementSibling?.classList.contains('side-item') ? item.nextElementSibling : null;
  if ((target || null) !== next) {
    list.insertBefore(item, target || siblings.at(-1)?.nextSibling || null);
    // Slide the others into their new places (FLIP).
    for (const [el, top] of before) {
      const dy = top - el.getBoundingClientRect().top;
      if (dy) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
  }
  const natural = item.getBoundingClientRect().top - (drag.ty || 0); // where it sits without the offset
  drag.ty = y - drag.grabDy - natural;
  item.style.transform = `translateY(${drag.ty}px) scale(1.03)`;
  // Scroll the list when dragging near its edges.
  const lr = list.getBoundingClientRect();
  if (y < lr.top + 40) list.scrollTop -= 8; else if (y > lr.bottom - 40) list.scrollTop += 8;
}
async function dragEnd() {
  if (!drag) return;
  clearTimeout(drag.timer);
  const was = drag; drag = null;
  if (!was.started) return;
  was.item.classList.remove('dragging'); was.item.style.transform = '';
  document.body.classList.remove('reordering');
  suppressClickUntil = Date.now() + 400; // the click that follows a drag shouldn't open the chat
  const order = [...was.list.closest('.side-list').querySelectorAll('.side-item[data-key]')].map((el) => el.dataset.key);
  S.data.sideOrder = order;
  renderSide();
  try { await api('/api/side-order', { method: 'PUT', body: { order } }); } catch (err) { toast(err.message); }
}
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  const item = e.target.closest('.side-list .side-item'); if (item) dragBegin(item, e.clientY, false);
});
document.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && drag) { dragMove(e.clientY); if (drag?.started) e.preventDefault(); } });
document.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') dragEnd(); });
document.addEventListener('touchstart', (e) => {
  const item = e.target.closest('.side-list .side-item'); if (item && e.touches.length === 1) dragBegin(item, e.touches[0].clientY, true);
}, { passive: true });
document.addEventListener('touchmove', (e) => {
  if (!drag) return;
  dragMove(e.touches[0].clientY);
  if (drag?.started) e.preventDefault(); // holding a chat: move it instead of scrolling
}, { passive: false });
document.addEventListener('touchend', dragEnd);
document.addEventListener('touchcancel', dragEnd);
document.addEventListener('contextmenu', (e) => { if (drag?.touch) e.preventDefault(); }); // no long-press menu while holding

// ---------- right-click a bot in the sidebar ----------
function menuAt(x, y, html) {
  closePopover();
  const el = document.createElement('div');
  el.className = 'popover ctx-menu'; el.innerHTML = html;
  document.body.append(el);
  el.style.left = Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8)) + 'px';
  return el;
}
document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.side-list .side-item[data-key^="bot:"]');
  if (!item || drag?.started) return;
  e.preventDefault();
  const b = bot(Number(item.dataset.key.slice(4))); if (!b) return;
  const groups = S.data.sideGroups || [], inGroup = groups.find((g) => g.keys.includes('bot:' + b.id));
  const el = menuAt(e.clientX, e.clientY, `
    <div class="ctx-title">${avatar(b, 20)}<span>${esc(b.name)}</span></div>
    <button data-bm="pane">${ICON.split}<span>Open in a new pane</span></button>
    <button data-bm="thread">${ICON.compose}<span>New thread</span></button>
    <button data-bm="project">${ICON.folder}<span>New project</span></button>
    <hr>
    <button data-bm="rename">${ICON.compose}<span>Rename…</span></button>
    <button data-bm="move">${ICON.grid}<span>Move to group</span><span class="ctx-sub">${esc(inGroup ? inGroup.name : 'None')} ›</span></button>
    <button data-bm="settings">${ICON.gear}<span>Bot settings</span></button>
    <hr>
    <button data-bm="delete" class="danger">${ICON.close}<span>Delete bot…</span></button>`);
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-bm]')?.dataset.bm; if (!a) return;
    ev.stopPropagation();
    if (a === 'move') return moveMenu('bot:' + b.id, b.name, el.getBoundingClientRect());
    closePopover();
    if (a === 'pane') return paneCmd('split-right', { key: 'bot:' + b.id });
    if (a === 'thread') return newThread(b.id);
    if (a === 'project') return projectModal(null, { ownerBotId: b.id });
    if (a === 'rename') return renameBot(b);
    if (a === 'settings') return botModal(b);
    if (a === 'delete') return deleteBot(b);
  });
});
// Move to group: pick a group, take it out of its group, or make a new group for it.
function moveMenu(key, name, r) {
  const groups = S.data.sideGroups || [], cur = groups.find((g) => g.keys.includes(key));
  const el = menuAt(r.right - 4, r.top, `<div class="ctx-title"><span>Move ${esc(name)} to…</span></div>
    ${groups.map((g) => `<button data-mg="${g.id}">${g === cur ? ICON.check : '<i class="ctx-gap"></i>'}<span>${esc(g.name)}</span></button>`).join('')}
    ${groups.length ? '<hr>' : ''}
    ${cur ? `<button data-mg="">${'<i class="ctx-gap"></i>'}<span>No group (top of the list)</span></button>` : ''}
    <button data-mg="new">${ICON.plus}<span>New group…</span></button>`);
  el.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-mg]'); if (!btn) return;
    ev.stopPropagation(); closePopover();
    const id = btn.dataset.mg;
    if (id === 'new') return groupModal({ id: Math.random().toString(36).slice(2, 10), name: '', collapsed: false, keys: [key], fresh: true });
    S.data.sideGroups = groups.map((g) => ({ ...g, keys: g.id === id ? [...g.keys.filter((k) => k !== key), key] : g.keys.filter((k) => k !== key) }));
    saveGroups();
  });
}
function renameBot(b, what = 'bot', url = `/api/bots/${b.id}`) {
  const el = modal(`<div class="modal-head"><h2>Rename ${what}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">New name<input id="rn-name" value="${esc(b.name)}" maxlength="60"></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="rn-save">Rename</button></div>`);
  const input = $('#rn-name', el); setTimeout(() => input.select(), 40);
  const save = async () => {
    const name = input.value.trim(); if (!name) return toast(`Give the ${what} a name`);
    try { await api(url, { method: 'PATCH', body: { name } }); closeModal(); await refreshState(); renderSide(); if (S.current?.id === b.id) renderMain(); } catch (err) { toast(err.message); }
  };
  $('#rn-save', el).onclick = save;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}
// Delete takes two steps: confirm what it means, then type the bot's name.
function deleteBot(b) {
  const el = modal(`<div class="modal-head"><h2>Delete ${esc(b.name)}?</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div id="del-step1"><p>This removes the bot, its routines and its place in group chats. Its past messages stay saved, but you can't talk to it again.</p>
      <div class="modal-foot"><button class="btn" data-close>Keep bot</button><button class="btn danger" id="del-next">Yes, continue</button></div></div>
    <div id="del-step2" hidden><p>To confirm, type the bot's name: <b>${esc(b.name)}</b></p>
      <label class="field"><input id="del-name" autocomplete="off" placeholder="${esc(b.name)}"></label>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn danger" id="del-go" disabled>Delete forever</button></div></div>`);
  const input = $('#del-name', el), go = $('#del-go', el);
  $('#del-next', el).onclick = () => { $('#del-step1', el).hidden = true; $('#del-step2', el).hidden = false; input.focus(); };
  input.addEventListener('input', () => { go.disabled = input.value.trim() !== b.name.trim(); });
  go.onclick = async () => {
    if (go.disabled) return;
    try {
      await api(`/api/bots/${b.id}`, { method: 'DELETE' }); closeModal();
      if (S.current?.id === b.id) { S.current = null; history.replaceState(null, '', '#'); }
      await refreshState(); renderSide(); renderMain(); toast(`${b.name} was deleted`);
    } catch (err) { toast(err.message); }
  };
}

// Right-click a group chat in the sidebar.
document.addEventListener('contextmenu', (e) => {
  const item = e.target.closest('.side-list .side-item[data-key^="room:"]');
  if (!item || drag?.started) return;
  e.preventDefault();
  const r = room(item.dataset.key.slice(5)); if (!r) return;
  const key = 'room:' + r.id, inGroup = (S.data.sideGroups || []).find((g) => g.keys.includes(key));
  const el = menuAt(e.clientX, e.clientY, `
    <div class="ctx-title">${roomAvatar(r, 20)}<span>${esc(r.name)}</span></div>
    <button data-rm="pane">${ICON.split}<span>Open in a new pane</span></button>
    <hr>
    <button data-rm="rename">${ICON.compose}<span>Rename…</span></button>
    <button data-rm="move">${ICON.grid}<span>Move to group</span><span class="ctx-sub">${esc(inGroup ? inGroup.name : 'None')} ›</span></button>
    <button data-rm="settings">${ICON.gear}<span>Group chat settings</span></button>
    <hr>
    <button data-rm="delete" class="danger">${ICON.close}<span>Delete group chat…</span></button>`);
  el.addEventListener('click', (ev) => {
    const a = ev.target.closest('[data-rm]')?.dataset.rm; if (!a) return;
    ev.stopPropagation();
    if (a === 'move') return moveMenu(key, r.name, el.getBoundingClientRect());
    closePopover();
    if (a === 'pane') return paneCmd('split-right', { key });
    if (a === 'rename') return renameBot(r, 'group chat', `/api/rooms/${r.id}`);
    if (a === 'settings') return roomModal(r);
    if (a === 'delete') return deleteRoom(r);
  });
});
// Same two steps as deleting a bot: confirm, then type the chat's name.
function deleteRoom(r) {
  const el = modal(`<div class="modal-head"><h2>Delete ${esc(r.name)}?</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div id="del-step1"><p>This removes the group chat. The bots in it are not affected.</p>
      <div class="modal-foot"><button class="btn" data-close>Keep chat</button><button class="btn danger" id="del-next">Yes, continue</button></div></div>
    <div id="del-step2" hidden><p>To confirm, type the chat's name: <b>${esc(r.name)}</b></p>
      <label class="field"><input id="del-name" autocomplete="off" placeholder="${esc(r.name)}"></label>
      <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn danger" id="del-go" disabled>Delete forever</button></div></div>`);
  const input = $('#del-name', el), go = $('#del-go', el);
  $('#del-next', el).onclick = () => { $('#del-step1', el).hidden = true; $('#del-step2', el).hidden = false; input.focus(); };
  input.addEventListener('input', () => { go.disabled = input.value.trim() !== r.name.trim(); });
  go.onclick = async () => {
    if (go.disabled) return;
    try {
      await api(`/api/rooms/${r.id}`, { method: 'DELETE' }); closeModal();
      if (S.current?.type === 'room' && S.current.id === r.id) { S.current = null; history.replaceState(null, '', '#'); }
      await refreshState(); renderSide(); renderMain(); toast(`${r.name} was deleted`);
    } catch (err) { toast(err.message); }
  };
}

// ---------- activity drawer ----------
function renderAside() {
  const d = S.data;
  const pct = d.usage.budget ? Math.min(100, Math.round((d.usage.windowCost / d.usage.budget) * 100)) : null;
  $('#aside').innerHTML = `
    <div class="aside-head"><b>Activity</b><button class="icon-btn" data-act="panel" aria-label="Close">${ICON.close}</button></div>
    <div class="af-bar">${[['all', 'All'], ['ap', 'Approvals'], ['rt', 'Routines'], ['lr', 'Learned'], ['sys', 'System']].map(([k, l]) => `<button class="af ${(localStorage.asideF || 'all') === k ? 'on' : ''}" data-af="${k}">${l}</button>`).join('')}
      <button class="link af-read" data-act="mark-all-read" title="Mark every chat as read">Mark all read</button></div>
    <section data-af-sec="ap">
      <h4>Approvals ${d.approvals.length ? `<span class="badge">${d.approvals.length}</span>` : ''}</h4>
      ${d.approvals.length ? d.approvals.map((a) => `
        <button class="card-item" data-open="${esc(a.thread)}">${avatar(bot(a.bot_id), 26)}<span><small>${esc(bot(a.bot_id)?.name)} · ${timeAgo(a.created_at)}</small>${esc(describeTool(a.tool, a.input))}</span></button>`).join('')
        : '<div class="muted">Nothing waiting on you.</div>'}
    </section>
    <section data-af-sec="rt">
      <h4>Up next</h4>
      ${d.upNext.length ? d.upNext.map((r) => `<div class="sched"><span>${whenNext(r.next)}</span><span>${esc(bot(r.bot_id)?.name)} · ${esc(r.prompt.slice(0, 60))}</span></div>`).join('')
        : '<div class="muted">No routines yet.</div>'}
    </section>
    <section data-af-sec="lr">
      <h4>Learned recently</h4>
      ${d.learned.length ? d.learned.map((l) => `<div class="learned">“${esc(l.text)}” <span class="muted">· ${esc(bot(l.botId)?.name)}</span></div>`).join('')
        : '<div class="muted">When you tell a bot a rule, it shows up here.</div>'}
    </section>
    ${d.computers ? '<section data-af-sec="sys" id="comp-box"><h4>Bot computers</h4><div class="muted">Loading…</div></section>' : ''}
    ${d.proxmox ? '<section data-af-sec="sys" id="pve-box"><h4>Proxmox</h4><div class="muted">Loading…</div></section>' : ''}
    ${d.usage.byBot?.length ? `<section><h4>Usage by bot · 7 days</h4>${(() => { const total = d.usage.byBot.reduce((a, x) => a + x.cost, 0) || 1;
      return d.usage.byBot.slice(0, 6).map((x) => { const b = bot(x.bot_id); const pc = Math.round((x.cost / total) * 100);
        return `<div class="ubot">${avatar(b, 20)}<span class="un">${esc(b?.name || 'Deleted bot')}</span><span class="muted">${x.runs} runs · ${b ? esc(EFFORTS.find((e) => e[0] === b.effort)?.[1] || b.effort) : ''}</span><b>${pc}%</b></div>
          <div class="meter thin"><div style="width:${pc}%"></div></div>`; }).join(''); })()}
      <div class="muted small">Heavy bots on High or Max effort usually do fine on Medium for routine work.</div></section>` : ''}
    <section class="usage" id="usage-box">${usageFallback(d, pct)}</section>`;
  loadPlanUsage();
  if (d.proxmox) loadProxmox();
  if (d.computers) loadComputers();
}

// Plan usage: the real % of your Claude plan's limits left (like /usage in Claude Code).
// Falls back to the old cost estimate if Anthropic's usage check isn't available.
function usageFallback(d, pct) {
  return (pct != null ? `<div class="row"><span>Usage, last 5 hours</span><span>${pct}%</span></div><div class="meter"><div style="width:${pct}%"></div></div>`
    : `<div class="row"><span>Est. usage, last 5 hours</span><span>$${d.usage.windowCost.toFixed(2)}</span></div>`)
    + `<div class="muted">${d.usage.running} running · ${d.bots.filter((b) => b.status.state === 'working').length} bots busy</div>`;
}
let planLast = null, planAt = 0;
async function loadPlanUsage() {
  if (planLast) drawPlanUsage(planLast);
  if (Date.now() - planAt < 60_000) return;
  planAt = Date.now();
  try { planLast = await api('/api/plan-usage'); } catch { planLast = { ok: false }; }
  drawPlanUsage(planLast);
}
function resetsIn(iso) {
  const m = Math.max(0, Math.round((new Date(iso) - Date.now()) / 60000));
  if (m < 60) return `${m}m`;
  if (m < 48 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`;
  return new Date(iso).toLocaleDateString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}
function drawPlanUsage(p) {
  const box = $('#usage-box'); if (!box || !p?.ok) return;
  const d = S.data;
  box.innerHTML = `<h4>Claude plan${p.plan ? ` · ${esc(p.plan[0].toUpperCase() + p.plan.slice(1))}` : ''}</h4>` + p.windows.map((w) => {
    const left = Math.max(0, Math.round(100 - w.used));
    return `<div class="row"><span>${esc(w.label)}</span><span><b>${left}% left</b></span></div>
      <div class="meter ${w.used >= 90 ? 'hot' : w.used >= 70 ? 'warm' : ''}"><div style="width:${Math.min(100, w.used)}%"></div></div>
      <div class="muted small">${Math.round(w.used)}% used${w.resets ? ` · resets in ${resetsIn(w.resets)}` : ''}</div>`;
  }).join('') + `<div class="muted">${d.usage.running} running · ${d.bots.filter((b) => b.status.state === 'working').length} bots busy</div>`;
}

// Bot computers: which are awake or asleep, their memory, and the VM's memory.
let compLast = null, compAt = 0;
async function loadComputers() {
  if (compLast) drawComputers(compLast);
  if (Date.now() - compAt < 15000) return;
  compAt = Date.now();
  try { compLast = await api('/api/computers'); } catch (err) { compLast = { error: err.message }; }
  drawComputers(compLast);
}
function drawComputers(c) {
  const box = $('#comp-box'); if (!box) return;
  if (c.error) { box.innerHTML = `<h4>Bot computers</h4><div class="muted">Couldn’t reach the computer VM: ${esc(c.error)}</div>`; return; }
  const pct = c.vm ? Math.round((c.vm.memUsed / c.vm.memTotal) * 100) : 0;
  box.innerHTML = `<h4>Bot computers</h4>
    ${(c.computers || []).length ? c.computers.map((x) => `<button class="card-item comp-row" data-computer="${x.bot}">${avatar(bot(x.bot), 26)}
      <span><small>${x.running ? `<span class="dot-inline on"></span>Awake${x.mem ? ` · ${esc(x.mem)}` : ''}` : '<span class="dot-inline"></span>Asleep'}</small>${esc(bot(x.bot)?.name || 'Bot ' + x.bot)}</span></button>`).join('')
      : '<div class="muted">No bot has its own computer yet.</div>'}
    ${c.vm ? `<div class="row"><span>VM memory</span><span>${(c.vm.memUsed / 2 ** 30).toFixed(1)} of ${(c.vm.memTotal / 2 ** 30).toFixed(1)} GB</span></div>
      <div class="meter ${pct >= 90 ? 'hot' : pct >= 75 ? 'warm' : ''}"><div style="width:${pct}%"></div></div>` : ''}
    ${c.sleepAfterMin ? `<div class="muted small">Idle computers sleep after ${c.sleepAfterMin >= 60 ? c.sleepAfterMin / 60 + ' h' : c.sleepAfterMin + ' min'}.</div>` : ''}`;
}

// Host load and guest status, fetched separately so a slow Proxmox never delays the app.
let pveLast = null, pveAt = 0;
async function loadProxmox() {
  if (pveLast) drawProxmox(pveLast);
  if (Date.now() - pveAt < 15000) return;
  pveAt = Date.now();
  try { pveLast = await api('/api/proxmox'); } catch (err) { pveLast = { error: err.message }; }
  drawProxmox(pveLast);
}
// Home: every Proxmox CT and VM as a tile with an up/down light. Clicking one opens Proxmox Manager.
function pveHomeHtml(p) {
  const pm = S.data.bots.find((b) => /proxmox/i.test(b.name));
  const g = p?.guests || [], up = g.filter((x) => x.status === 'running').length;
  const head = `<h3>Proxmox${p && !p.error ? ` <span class="pve-sum ${up < g.length ? 'bad' : ''}">${up} of ${g.length} up</span>` : ''}</h3>`;
  if (!p) return head + `<div class="muted">${LOADER} Checking…</div>`;
  if (p.error) return head + `<div class="muted">Couldn’t reach Proxmox: ${esc(p.error)}</div>`;
  return head + `<div class="pve-grid">${g.map((x) => `<button class="pve-tile ${x.status === 'running' ? 'up' : 'down'}" ${pm ? `data-open="bot:${pm.id}"` : ''} title="${x.type === 'qemu' ? 'VM' : 'CT'} ${x.id} on ${esc(x.node)}: ${esc(x.status)}"><i></i><span><b>${esc(x.name || '')}</b><small>${x.type === 'qemu' ? 'VM' : 'CT'} ${x.id} · ${x.status === 'running' ? 'up' : esc(x.status)}</small></span></button>`).join('')}</div>`;
}
setInterval(() => { if (S.home && !S.current && S.data?.proxmox && !document.hidden) loadProxmox(); }, 30000);
function drawProxmox(p) {
  const hb = $('#home-pve'); if (hb) hb.innerHTML = pveHomeHtml(p);
  const box = $('#pve-box'); if (!box) return;
  const pc = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const meter = (label, v) => `<div class="row"><span>${label}</span><span>${v}%</span></div><div class="meter"><div style="width:${v}%"></div></div>`;
  const down = (p.guests || []).filter((g) => g.status !== 'running');
  box.innerHTML = `<h4>Proxmox</h4>${p.error ? `<div class="muted">Couldn’t reach Proxmox: ${esc(p.error)}</div>`
    : (p.nodes || []).map((n) => `<div class="pve-node"><b>${esc(n.name)}</b> <span class="muted">${n.status === 'online' ? `up ${Math.floor(n.uptime / 86400)}d` : esc(n.status)}</span>
        ${meter('CPU', Math.round(n.cpu * 100))}${meter('Memory', pc(n.mem, n.maxmem))}${meter('Root disk', pc(n.disk, n.maxdisk))}</div>`).join('')
      + `<div class="muted">${(p.guests || []).length - down.length} of ${(p.guests || []).length} guests running</div>`
      + down.map((g) => `<div class="sched"><span>${esc(g.status)}</span><span>${g.id} · ${esc(g.name)}</span></div>`).join('')}`;
}
function describeTool(tool, input = {}) {
  if (tool === 'Bash') return 'Run: ' + String(input.command || '').slice(0, 80);
  const pretty = tool.replace(/^mcp__/, '').replace(/__/g, ' › ').replace(/_/g, ' ');
  const hint = input.to || input.subject || input.title || input.url || input.file_path || '';
  return pretty + (hint ? ' — ' + String(hint).slice(0, 60) : '');
}

// ---------- main ----------
let viewKey = '';
function renderMain() {
  requestAnimationFrame(syncBotBtns);
  const main = $('#main');
  // Switching chats (or to Home) fades the new view in; redraws of the same view don't.
  const vk = S.current ? threadKey() : S.home ? 'home' : '';
  if (vk !== viewKey) { viewKey = vk; requestAnimationFrame(() => { main.classList.remove('view-in'); void main.offsetWidth; main.classList.add('view-in'); }); }
  if (CM.draft) { main.innerHTML = codeDraftMain(); attachAutocorrect($('#msg')); autosize($('#msg')); return; }
  if (!S.current && S.home && !EMBED) {
    // Live updates redraw Home; keep what you were typing (and which bot) in the quick-ask box.
    const q = $('#home-q'), keep = q && { v: q.value, f: document.activeElement === q, s: q.selectionStart, bot: $('#home-bot')?.value };
    main.innerHTML = renderHome(); digestCard(); if (S.data.proxmox) loadProxmox();
    if (keep) { const n = $('#home-q'); n.value = keep.v; $('#home-bot').value = keep.bot; if (keep.f) { n.focus(); n.setSelectionRange(keep.s, keep.s); } }
    return;
  }
  if (!S.current) {
    const none = !S.data.bots.length;
    if (EMBED) { main.innerHTML = `<header class="head"><b class="pane-pick-title">Pick a chat for this pane</b><div class="actions">${paneBtns()}</div></header>
      <div class="thread"><div class="pane-pick">${pickList()}</div></div>`; return; }
    main.innerHTML = `<header class="head"><button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${ICON.menu}</button><div class="actions" style="margin-left:auto">${paneBtns()}</div></header>
      <div class="thread"><div class="empty">
        <img class="logo-art" src="/nimbus.webp" alt="Nimbus" width="160" height="160">
        <h2>${none ? 'Build your team' : 'Pick a bot to talk to'}</h2>
        <p>${none ? 'Bots are teammates you hand work to. They run on your computer with Claude Code and ask before anything risky.' : 'Hand off a task. You’ll see each step, and it’ll check with you before sending, paying, deleting or merging.'}</p>
        ${none ? `<div class="row"><button class="btn primary" data-act="market">${ICON.grid} Browse Connectors</button><button class="btn" data-act="new-bot">${ICON.plus} New bot</button></div>` : ''}
      </div></div>`;
    return;
  }
  const isBot = S.current.type === 'bot';
  const b = isBot ? bot(S.current.id) : null;
  const r = !isBot ? room(S.current.id) : null;
  if (!b && !r) { S.current = null; return renderMain(); }
  const nRoutines = isBot ? S.data.routines.filter((x) => x.bot_id === b.id).length : 0;
  const pending = S.data.approvals.length;
  main.innerHTML = `
    <header class="head">
      <button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${ICON.menu}</button>
      <button class="title" data-act="${isBot ? 'edit-bot' : 'edit-room'}">
        ${isBot ? avatar(b, 24) : roomAvatar(r, 24)}
        <b>${esc(isBot ? b.name : r.name)}</b>
        ${isBot && b.status.state !== 'idle' ? `<span class="status ${b.status.state}">${esc(b.status.label)}</span>` : ''}
      </button>
      ${isBot ? `<button class="th-crumb" data-act="thread-menu" title="Thread options">${crumbHtml()}</button>` : ''}
      <div class="actions">
        ${EMBED || leaves().length > 1 ? paneBtns() : ''}
        ${isBot ? `
          <label class="effort" title="Effort: higher is smarter but uses more of your plan">
            <button class="effort-btn" data-act="effort-menu" aria-label="Effort" aria-haspopup="menu">${esc(EFFORTS.find(([v]) => v === b.effort)?.[1] || 'Medium')}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></button>
          </label>
          <button class="icon-btn" data-act="new-thread" title="New thread" aria-label="New thread">${ICON.compose}</button>
          ${codeProject(threadKey()) ? BT_BTNS : ''}
          <button class="icon-btn" data-act="files" title="Files in this chat" aria-label="Files">${ICON.folder}</button>
          <button class="icon-btn" data-act="info" title="Chat details: environment, context, connectors" aria-label="Chat details">${ICON.sidebar}</button>
          <button class="icon-btn" data-act="more-menu" title="More: voice, routines, browser, plugins, memory, artifacts, split, settings" aria-label="More">${ICON.dots}${nRoutines || artNew[threadKey()] ? '<i class="count dot"></i>' : ''}</button>`
        : `<button class="icon-btn" data-act="files" title="Files in this chat" aria-label="Files">${ICON.folder}</button>
           <button class="icon-btn" data-act="edit-room" title="Settings" aria-label="Settings">${ICON.gear}</button>`}
        <button class="icon-btn" data-act="panel" title="Activity" aria-label="Activity">${ICON.bell}${pending ? `<i class="count hot">${pending}</i>` : ''}</button>
      </div>
    </header>
    <div class="thread" id="thread"><div class="thread-inner">${renderMessages()}</div></div>
    ${threadOf(threadKey())?.kind === 'inbox' ? `<div class="composer inbox-note">${TI.inbox}<span>Inbox: requests from other bots and ${esc(b.name)}’s answers. To talk to ${esc(b.name)}, use General or another thread.</span></div>` : `<div class="composer">
      <div class="attach-list" id="attach-list"></div>
      <form id="composer">
        <button type="button" class="plus" data-act="${isBot ? 'plugins' : 'edit-room'}" aria-label="${isBot ? 'Plugins' : 'Chat settings'}">${ICON.plus}</button>
        <button type="button" class="plus" data-act="attach" aria-label="Attach files">${ICON.clip}</button>
        <button type="button" class="plus plan-tg ${S.planFirst ? 'on' : ''}" data-act="plan-toggle" aria-pressed="${!!S.planFirst}" aria-label="Plan first" title="Plan first: the bot shows its plan and commands, you approve once">${ICON.check}</button>
        <button type="button" class="plus" data-act="later" aria-label="Send later" title="Send later">${ICON.clock}</button>
        <button type="button" class="plus mic" data-act="dictate" aria-label="Dictate" title="Dictate (tap to start, tap to stop)">${ICON.mic}</button>
        ${isBot ? `<button type="button" class="plus" data-act="voice-mode" aria-label="Voice mode" title="Voice mode: talk back and forth, hands-free">${ICON.wave}</button>` : ''}
        <button type="button" class="plus" data-act="camera" aria-label="Camera" title="Take a photo and attach it">${ICON.camera}</button>
        <input type="file" id="file-pick" multiple hidden>
        <label for="msg" class="sr">Message</label>
        <textarea id="msg" rows="1" placeholder="${isBot ? `Message ${esc(b.name)}${codeProject(threadKey())?.p.members.length > 1 ? ' · @ a bot to hand it work' : ''}` : `Message ${esc(r.name)} · @ a bot to direct it`}"></textarea>
        <button class="send" aria-label="Send">${ICON.send}</button>
      </form>
    </div>`}`;
  const cm = CM.on && isBot && codeProject(threadKey());
  if (cm) { // Nimbus Code: a quiet header, project / thread, like T3 Code
    const ini = (cm.p.name.match(/[A-Za-z0-9]+/g) || ['?']).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
    main.querySelector('.head').innerHTML = `<button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${ICON.menu}</button>
      <span class="cm-crumb"><i class="cm-badge">${esc(ini)}</i><button class="linkish" data-code-edit-p="${cm.p.id}">${esc(cm.p.name)}</button> <span class="muted">/</span> <button class="linkish" data-act="thread-menu"><b>${esc(cm.t.title || 'New thread')}</b></button></span>
      <div class="actions">${(S.data.busyThreads || []).includes(threadKey()) ? `<span class="status working">${esc(b.name)} working</span>` : ''}
        <label class="effort" title="Effort"><button class="effort-btn" data-act="effort-menu" aria-label="Effort" aria-haspopup="menu">${avatar(b, 16)} ${esc(b.name)} · ${esc(EFFORTS.find(([v]) => v === b.effort)?.[1] || 'Medium')}</button></label>
        <button class="icon-btn" data-act="files" title="Files in this chat" aria-label="Files">${ICON.folder}</button>
        <button class="icon-btn" data-act="panel" title="Activity" aria-label="Activity">${ICON.bell}${pending ? `<i class="count hot">${pending}</i>` : ''}</button>
        ${BT_BTNS}</div>`;
    const ta = $('#msg'); if (ta) ta.placeholder = `Ask ${b.name} anything${cm.p.members.length > 1 ? ' · @ a bot to hand it work' : ''}`;
  }
  if (!$('#msg')) { const th = $('#thread'); th.scrollTop = th.scrollHeight; return; }
  attachAutocorrect($('#msg'));
  if (isRecording() || browserStop) micState('recording'); // re-render during dictation
  const th = $('#thread');
  th.scrollTop = th.scrollHeight;
  const ta = $('#msg');
  const draft = sessionDraft.get(threadKey());
  if (draft) ta.value = draft;
  autosize(ta);
  if (matchMedia('(min-width: 761px)').matches) ta.focus();
}
const sessionDraft = new Map();
function autosize(ta) { ta.style.height = 'auto'; ta.style.height = Math.min(200, ta.scrollHeight) + 'px'; }

function renderMessages() {
  if (S.loadingThread) return '<div class="skel" aria-label="Loading"><i class="b"></i><i class="u"></i><i class="b w"></i><i class="u s"></i><i class="b"></i></div>';
  if (!S.messages.length) {
    const isBot = S.current.type === 'bot';
    const b = isBot ? bot(S.current.id) : null;
    const th = threadOf(threadKey());
    if (th && th.kind === 'chat') return `<div class="empty">${avatar(b, 72)}<h2>${esc(th.title || 'New thread')}</h2><p>A fresh conversation with ${esc(b.name)}. It still knows its role and memory${th.project_id ? `, and reads the “${esc(projectOf(th.project_id)?.name || '')}” project instructions` : ''}.</p>${STARTERS}</div>`;
    if (th) return `<div class="empty">${th.kind === 'inbox' ? TI.inbox : ICON.clock}<h2>${th.kind === 'inbox' ? 'Inbox' : 'Routines'}</h2><p>${th.kind === 'inbox' ? `Requests from other bots to ${esc(b.name)} land here, with its answers.` : `${esc(b.name)}’s scheduled routines post here.`}</p></div>`;
    return `<div class="empty">${isBot ? avatar(b, 72) : roomAvatar(room(S.current.id), 72)}<h2>${esc(isBot ? b.name : room(S.current.id).name)}</h2><p${isBot && b.role ? ' class="no-i18n"' : ''}>${isBot ? esc(b.role || 'Give this bot a task. It’ll ask before sending, paying, deleting or merging.') : 'Post a goal. The lead bot splits the work, and bots @mention each other to hand things off.'}</p>${STARTERS}</div>`;
  }
  // A quiet divider where each day starts, so timestamps can stay out of the way.
  let day = '';
  return pinsHtml() + S.messages.map((m, i) => {
    const d = m.created_at ? new Date(m.created_at * 1000).toDateString() : day, sep = d !== day && m.created_at ? daySep(m.created_at) : '';
    day = d; return sep + renderMessage(m, S.messages[i - 1]);
  }).join('');
}
// Pinned replies, per chat, kept on this device. They show as chips at the top; click one to jump to it.
const pinKey = () => 'pins:' + threadKey();
const getPins = () => { try { return JSON.parse(localStorage[pinKey()] || '[]'); } catch { return []; } };
const isPinned = (id) => getPins().includes(id);
function pinsHtml() {
  const pins = getPins().map((id) => S.messages.find((m) => m.id === id)).filter(Boolean);
  if (!pins.length) return '<div class="pins" hidden></div>';
  return `<div class="pins"><span class="pins-ico">📌</span>${pins.map((m) => `<button class="pin-chip" data-pin-go="${m.id}" title="Jump to this reply">${esc(m.body.replace(/```[\w+#.-]*/g, ' ').replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 60))}</button>`).join('')}</div>`;
}
function togglePin(id) {
  const p = getPins(), on = !p.includes(id);
  localStorage[pinKey()] = JSON.stringify(on ? [...p, id] : p.filter((x) => x !== id));
  $('#thread .pins')?.replaceWith(Object.assign(document.createElement('div'), { innerHTML: pinsHtml() }).firstElementChild);
  const b = $(`[data-pin="${id}"]`); if (b) b.textContent = on ? 'Unpin' : 'Pin';
  buzz(6); toast(on ? 'Pinned to the top of this chat' : 'Unpinned');
}
const quoteOf = (m) => m.body.trim().split('\n').slice(0, 8).map((l) => '> ' + l.slice(0, 200)).join('\n') + '\n\n';
function daySep(sec) {
  const d = new Date(sec * 1000), now = new Date(), y = new Date(now); y.setDate(now.getDate() - 1);
  const t = d.toDateString() === now.toDateString() ? 'Today' : d.toDateString() === y.toDateString() ? 'Yesterday'
    : d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  return `<div class="day-sep"><span>${t}</span></div>`;
}

// Show the bot's name above its bubble in group chats, when the speaker changes.
function speakerLabel(m, prev) {
  if (m.author === 'user') return '';
  if (S.current?.type !== 'room' && !(codeProject(threadKey())?.p.members.length > 1)) return '';
  if (prev && prev.author === m.author && prev.kind !== 'note') return '';
  const b = bot(m.author);
  return `<div class="speaker">${avatar(b, 18)}<span style="color:${esc(b?.color || '#999')}">${esc(b?.name || 'Deleted bot')}</span></div>`;
}
const fileUrl = (f) => `/api/files/${f.id}/${encodeURIComponent(f.name)}`;
const isImage = (f) => /^image\/(png|jpe?g|gif|webp|avif)$/.test(f.type);
function renderFiles(m) {
  let files = [];
  try { files = JSON.parse(m.files || '[]'); } catch {}
  if (!files.length) return '';
  return `<div class="files">${files.map((f) => isHtml(f)
    ? `<div class="html-card"><a class="hc-thumb" href="${fileUrl(f)}" data-view="${f.id}" data-doc="${f.doc || ''}" aria-label="Open ${esc(f.name)}"><iframe class="html-thumb" src="${fileUrl(f)}?sandbox" sandbox="allow-scripts" tabindex="-1" loading="lazy" title="Preview of ${esc(f.name)}"></iframe></a>
        <div class="hc-row"><span class="hc-badge">${ICON.globe} Web page</span><span class="hc-name">${esc(f.name)}</span><small>${f.version > 1 ? `v${f.version} · ` : ''}${fmtSize(f.size)}</small>
        <a class="btn pill small primary" href="${fileUrl(f)}" data-view="${f.id}" data-doc="${f.doc || ''}">Open</a></div></div>`
    : isImage(f)
    ? `<span class="file-img-wrap"><a class="file-img" href="${fileUrl(f)}" target="_blank" rel="noopener"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"></a>${m.author === 'user' ? `<button type="button" class="file-del" data-file-del="${m.id}:${f.id}" title="Delete this image" aria-label="Delete ${esc(f.name)}">${ICON.close}</button>` : ''}</span>`
    : f.preview ? `<div class="file-card"><a href="${fileUrl(f)}" data-view="${f.id}" data-doc="${f.doc || ''}"><img src="${fileUrl(f.preview)}" alt="Preview of ${esc(f.name)}" loading="lazy"></a>
        <div class="fc-row">${ICON.file}<span>${esc(f.name)}</span><small>${f.version > 1 ? `v${f.version} · ` : ''}${fmtSize(f.size)}</small><a class="btn pill small" href="${fileUrl(f)}" data-view="${f.id}" data-doc="${f.doc || ''}">Open</a></div></div>`
        : `<a class="file-chip" href="${fileUrl(f)}" data-view="${f.id}" data-doc="${f.doc || ''}">${ICON.file}<span>${esc(f.name)}</span><small>${f.version > 1 ? `v${f.version} · ` : ''}${fmtSize(f.size)}</small></a>`).join('')}</div>`;
}
const isHtml = (f) => /\.html?$/i.test(f.name) || f.type === 'text/html';
function fmtSize(n) { return n < 1024 ? n + ' B' : n < 1048576 ? Math.round(n / 1024) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }

// Delete a file you sent: gone from the chat, the server and the bot's copy.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-file-del]'); if (!b) return;
  e.preventDefault(); e.stopPropagation(); closePopover();
  const [mid, fid] = b.dataset.fileDel.split(':');
  if (!confirm(fid === 'all' ? 'Delete the files in this message? They are removed from Nimbus for good.' : 'Delete this image? It is removed from Nimbus for good.')) return;
  try { await api(`/api/messages/${mid}/files/${fid}`, { method: 'DELETE' }); buzz(10); toast('Deleted'); } catch (err) { toast(err.message); }
}, true);
document.addEventListener('click', async (e) => {
  const c = e.target.closest('#thread code[data-copy-path]'); if (!c) return;
  buzz(6); toast(await clip(c.textContent) ? 'Copied ' + c.textContent : 'Couldn’t copy');
});

// ---------- right-click (or long-press) a message: redact ----------
document.addEventListener('contextmenu', (e) => {
  const msg = e.target.closest('#thread .msg[data-mid], #thread .note[data-mid]');
  if (!msg || drag) return;
  const bubble = msg.querySelector('.bubble, .approval, .trace') || msg;
  const sel = String(getSelection() || '').trim();
  const inside = sel && getSelection().anchorNode && bubble.contains(getSelection().anchorNode);
  e.preventDefault();
  closePopover();
  const id = Number(msg.dataset.mid);
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = `${inside ? `<button data-redact-sel>${ICON.lock}<span>Redact “${esc(sel.length > 24 ? sel.slice(0, 24) + '…' : sel)}”</span></button>` : ''}
    <button data-redact-all>${ICON.lock}<span>Redact whole message</span></button>
    <button data-copy-msg>${ICON.check}<span>Copy</span></button>
    ${(() => { const mm = S.messages.find((x) => x.id === id); let n = 0; try { n = JSON.parse(mm?.files || '[]').length; } catch {} return mm?.author === 'user' && n ? `<button data-file-del="${id}:all">${ICON.close}<span>Delete ${n > 1 ? `all ${n} files` : 'attached file'}</span></button>` : ''; })()}`;
  document.body.append(el);
  el.style.left = Math.max(8, Math.min(e.clientX, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(e.clientY, innerHeight - el.offsetHeight - 8)) + 'px';
  el.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button'); if (!b) return;
    closePopover();
    const m = S.messages.find((x) => x.id === id);
    if (b.dataset.fileDel) return;
    if (b.dataset.copyMsg !== undefined) { return toast(await clip(m?.body || '') ? 'Copied' : 'Couldn’t copy'); }
    const text = b.dataset.redactSel !== undefined ? sel : '';
    if (!confirm(text ? `Replace “${text.slice(0, 80)}” with [REDACTED] everywhere Nimbus stored it?` : 'Replace this whole message with [REDACTED]? It’s also removed from saved prompts and bot transcripts.')) return;
    try {
      const r = await api(`/api/messages/${id}/redact`, { method: 'POST', body: { text } });
      buzz(10); toast(`Redacted${r.transcripts ? ` (also in ${r.transcripts} transcript${r.transcripts > 1 ? 's' : ''})` : ''}`);
    } catch (err) { toast(err.message); }
  });
});

// ---------- slash commands in the message box ----------
// Slash commands, like Claude Code. Nimbus's own run here (no Claude usage); /compact and the bot's skills,
// custom commands and plugin commands (from /api/bots/:id/commands) go to Claude Code as typed.
// [command, args hint, description, handler(arg, bot) or null = send to the bot]
const SLASH = [
  ['/help', '', 'List every command', () => slashHelp()],
  ['/context', '', 'What’s using this chat’s context', (a, b) => openInfo(b)],
  ['/compact', '', 'Shrink this chat’s history so it uses less context (memory is kept)', null],
  ['/new', '', 'Start this thread fresh (memory is kept)', () => api(`/api/bots/${S.current.id}/reset`, { method: 'POST', body: { thread: threadKey() } })],
  ['/clear', '', 'Same as /new', () => api(`/api/bots/${S.current.id}/reset`, { method: 'POST', body: { thread: threadKey() } })],
  ['/model', '[name]', 'Change this bot’s model', (a, b) => slashModel(a, b)],
  ['/effort', '[low|medium|high|xhigh|max]', 'Change this bot’s effort', (a, b) => slashEffort(a, b)],
  ['/usage', '', 'How much of your Claude plan is left', () => slashUsage()],
  ['/cost', '', 'Same as /usage', () => slashUsage()],
  ['/stop', '', 'Stop what the bot is doing in this thread', () => slashStop()],
  ['/memory', '', 'Open the bot’s memory', (a, b) => memoryModal(b)],
  ['/plugins', '', 'Turn plugins on or off for this bot', (a, b) => botPluginsModal(b)],
  ['/routines', '', 'The bot’s scheduled routines', (a, b) => routinesModal(b)],
  ['/rename', '<name>', 'Rename this thread', (a) => slashRename(a)],
  ['/thread', '[name]', 'Start a new thread with this bot', (a, b) => slashThread(a, b)],
  ['/later', '[message]', 'Schedule a message to send later', (a) => { laterModal(threadKey(), a || ''); }],
  ['/project', '', 'Move this thread into a project', () => { const t = threadOf(threadKey()); if (t?.kind !== 'chat') return toast('Start a thread with /thread first: General, Inbox and Routines stay where they are'); moveThreadModal(t); }],
  ['/browser', '', 'Open the bot’s browser', (a, b) => openBrowser(b.id)],
  ['/split', '[down]', 'Split the view into another pane', (a) => paneCmd(/^d/i.test(a) ? 'split-down' : 'split-right')],
  ['/shortcuts', '', 'Keyboard shortcuts', () => EMBED ? paneCmd('shortcuts') : shortcutsModal()],
  ['/api-tools', '[scan]', 'This bot’s API tools: quick commands that run without Claude (scan = have the bot set them up)', (a, b) => /^scan/i.test(a) ? apiToolsScan(b) : apiToolsModal(b)]
];
const botCmds = new Map(); // bot id -> { at, list } (skills and custom commands, fetched when you type /)
function loadBotCmds(id) {
  const c = botCmds.get(id);
  if (c && Date.now() - c.at < 60_000) return c.list;
  botCmds.set(id, { at: Date.now(), list: c?.list || [] });
  api(`/api/bots/${id}/commands`).then((r) => { botCmds.set(id, { at: Date.now(), list: r.commands || [] }); slashHint($('#msg')?.value || ''); }).catch(() => {});
  return c?.list || [];
}
function slashHint(v) {
  let box = $('#slash-hint');
  const show = S.current?.type === 'bot' && /^\/[\w:.-]*$/.test(v);
  const q = v.toLowerCase();
  const items = !show ? [] : [
    ...SLASH.filter(([c]) => c.startsWith(q)).map(([c, a, d]) => ({ c, a, d })),
    ...loadBotCmds(S.current.id).filter((x) => x.cmd.toLowerCase().includes(q.slice(1)) && !SLASH.some(([c]) => c === x.cmd)).map((x) => ({ c: x.cmd, a: x.args || '', d: x.desc, src: x.source, api: x.api }))
  ].sort((a, b) => !a.c.toLowerCase().startsWith(q) - !b.c.toLowerCase().startsWith(q)).slice(0, 40);
  if (!items.length) return box?.remove();
  slashSel = 0;
  if (!box) { box = document.createElement('div'); box.id = 'slash-hint'; box.className = 'slash-hint'; $('.composer').prepend(box); }
  box.innerHTML = items.map((i, n) => `<button type="button" class="${n ? '' : 'sel'}" data-slash="${esc(i.c)}" data-args="${i.a ? 1 : ''}" data-api="${i.api ? 1 : ''}"><b>${esc(i.c)}</b>${i.a ? `<i>${esc(i.a)}</i>` : ''}<span>${esc(i.d)}</span>${i.src ? `<em>${esc(i.src)}</em>` : ''}${n ? '' : '<kbd>Tab</kbd>'}</button>`).join('');
}
// Tab fills the highlighted command; Up/Down move the highlight.
let slashSel = 0;
function slashMove(d) {
  const all = [...document.querySelectorAll('#slash-hint [data-slash]')]; if (!all.length) return false;
  slashSel = (slashSel + d + all.length) % all.length;
  all.forEach((b, n) => { b.classList.toggle('sel', n === slashSel); b.querySelector('kbd')?.remove(); });
  all[slashSel].insertAdjacentHTML('beforeend', '<kbd>Tab</kbd>'); all[slashSel].scrollIntoView({ block: 'nearest' });
  return true;
}
// @ in a group chat or Nimbus Code thread: pick a bot to hand the message to.
function mentionBots() {
  if (CM.draft) return (projectOf(CM.draft.project)?.members || []).map(bot).filter(Boolean);
  if (S.current?.type === 'room') return (room(S.current.id)?.members || []).map(bot).filter(Boolean);
  const c = codeProject(threadKey()); return c ? c.p.members.map(bot).filter(Boolean) : [];
}
function mentionHint(ta) {
  const m = ta.value.slice(0, ta.selectionStart).match(/(?:^|\s)@([\w./-]*)$/);
  const q = m?.[1].toLowerCase();
  const list = m && !/[./]/.test(q) ? mentionBots().filter((b) => b.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || b.name.toLowerCase().startsWith(q)) : [];
  // Nimbus Code: @ also picks a file, so the bot gets its exact path instead of searching for it.
  const fl = m && codeProject(threadKey()) ? fileMatches(q, list.length ? 5 : 8) : [];
  let box = $('#mention-hint');
  if (!list.length && !fl.length) return box?.remove();
  if (!box) { box = document.createElement('div'); box.id = 'mention-hint'; box.className = 'slash-hint mention-hint'; $('.composer').prepend(box); }
  box.innerHTML = list.map((b, i) => `<button type="button" class="${i === 0 ? 'on' : ''}" data-mention="${b.id}">${avatar(b, 20)}<b>${esc(b.name)}</b><span>${esc(b.role || '')}</span></button>`).join('')
    + fl.map((f, i) => `<button type="button" class="${!list.length && i === 0 ? 'on' : ''}" data-mention="f:${esc(f)}"><span class="mono">📄</span><b>${esc(f.split('/').pop())}</b><span class="mono">${esc(f)}</span></button>`).join('');
}
function pickMention(id) {
  const ta = $('#msg'), file = String(id).startsWith('f:') ? String(id).slice(2) : null, b = file ? null : bot(Number(id)); $('#mention-hint')?.remove(); if (!ta || (!b && !file)) return;
  const pos = ta.selectionStart, before = ta.value.slice(0, pos).replace(/@[\w./-]*$/, '@' + (file || b.name) + ' ');
  ta.value = before + ta.value.slice(pos); ta.focus(); ta.setSelectionRange(before.length, before.length); autosize(ta);
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-mention]'); if (b) pickMention(b.dataset.mention); });
document.addEventListener('keydown', (e) => {
  const box = $('#mention-hint'); if (e.target.id !== 'msg' || !box) return;
  const items = [...box.querySelectorAll('[data-mention]')], i = items.findIndex((x) => x.classList.contains('on'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); items[i]?.classList.remove('on'); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].classList.add('on'); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pickMention(items[Math.max(i, 0)].dataset.mention); }
  else if (e.key === 'Escape') { e.stopImmediatePropagation(); box.remove(); }
}, true);
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-slash]'); if (!b) return;
  const ta = $('#msg'); $('#slash-hint')?.remove();
  const local = SLASH.find(([c]) => c === b.dataset.slash);
  // Commands that take words (and the bot's skills, which usually do) wait for you to type them.
  if (b.dataset.args || (!local && !b.dataset.api)) { ta.value = b.dataset.slash + ' '; ta.focus(); autosize(ta); return; }
  ta.value = b.dataset.slash; $('#composer').requestSubmit();
});
// Runs a Nimbus command; returns true if the text was one (so it isn't sent to the bot).
function runSlash(text) {
  const m = text.match(/^(\/[\w-]+)(?:\s+([\s\S]*))?$/); if (!m || S.current?.type !== 'bot') return false;
  const cmd = SLASH.find(([c]) => c === m[1].toLowerCase());
  const tool = !cmd && (botCmds.get(S.current.id)?.list || []).find((x) => x.api && x.cmd === m[1].toLowerCase());
  if (tool) { runApiTool(bot(S.current.id), tool.cmd.slice(1), (m[2] || '').trim()).catch((err) => toast(err.message)); return true; }
  if (!cmd || !cmd[3]) return false;
  Promise.resolve(cmd[3]((m[2] || '').trim(), bot(S.current.id))).catch((err) => toast(err.message));
  return true;
}
// ---------- API tools: the bot's own quick commands (apitools.js) ----------
async function apiToolsModal(b) {
  const { tools } = await api(`/api/bots/${b.id}/api-tools`);
  const el = modal(`<div class="modal-head"><h2>${esc(b.name)}’s API tools</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p class="muted">Quick commands for the services ${esc(b.name)} can reach. They run directly on the server: no Claude, no plan usage. Type them like any slash command. You approve each script once; ones that change things ask every time.</p>
    ${tools.length ? `<div class="api-tools">${tools.map((t) => `<div class="api-tool">
      <div class="at-row"><b>/${esc(t.name)}</b>${t.args ? ` <i class="muted">${esc(t.args)}</i>` : ''}<span class="muted at-desc">${esc(t.desc)}</span>
        ${t.changes ? '<span class="at-badge warn">changes things</span>' : ''}${t.approved ? '' : '<span class="at-badge">needs approval</span>'}</div>
      <details><summary>Script</summary><pre class="no-i18n">${esc(t.run)}</pre></details>
      <div class="at-btns">${t.approved ? '' : `<button class="btn small" data-at-ok="${esc(t.name)}">Approve</button>`}<button class="btn small" data-at-run="${esc(t.name)}" ${t.args ? 'data-at-args="1"' : ''}>Run</button></div>
    </div>`).join('')}</div>` : `<p>${esc(b.name)} has no API tools yet.</p>`}
    <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn primary" id="at-scan">${tools.length ? 'Rescan and update' : 'Set them up'}</button></div>`, { wide: true });
  el.addEventListener('click', async (e) => {
    const ok = e.target.closest('[data-at-ok]'), run = e.target.closest('[data-at-run]');
    if (ok) { await api(`/api/bots/${b.id}/api-tools/${ok.dataset.atOk}/approve`, { method: 'POST' }); loadBotCmds(b.id); return apiToolsModal(b); }
    if (run) {
      closeModal();
      if (run.dataset.atArgs) { const ta = $('#msg'); ta.value = '/' + run.dataset.atRun + ' '; ta.focus(); autosize(ta); return; }
      return runApiTool(b, run.dataset.atRun, '').catch((err) => toast(err.message));
    }
    if (e.target.id === 'at-scan') { closeModal(); apiToolsScan(b); }
  });
}
async function apiToolsScan(b) {
  await api(`/api/bots/${b.id}/api-tools-scan`, { method: 'POST', body: { thread: threadKey() } });
  botCmds.delete(b.id);
  toast(`${b.name} is setting up its API tools. When it’s done, type / to see them.`);
}
async function runApiTool(b, name, args) {
  const { tools } = await api(`/api/bots/${b.id}/api-tools`);
  const t = tools.find((x) => x.name === name); if (!t) throw new Error(`No API tool /${name}`);
  if (!t.approved || t.changes) {
    const go = await new Promise((resolve) => {
      const el = modal(`<div class="modal-head"><h2>${t.approved ? `Run /${esc(name)}?` : `Approve /${esc(name)}?`}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
        <p>${t.approved ? 'This tool changes things.' : `${esc(b.name)} wrote this tool. Check what it runs before it can run (you’re asked again if the script changes).`}</p>
        <p class="muted">${esc(t.desc)}${args ? ` · with: <b>${esc(args)}</b>` : ''}</p>
        <pre class="at-script no-i18n">${esc(t.run)}</pre>
        <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn ${t.changes ? 'danger' : 'primary'}" id="at-go">${t.approved ? 'Run it' : 'Approve and run'}</button></div>`);
      $('#at-go', el).onclick = () => { resolve(true); closeModal(); };
      el.closest('.scrim').addEventListener('click', (e) => { if (e.target.closest('[data-close]') || e.target.classList.contains('scrim')) resolve(false); });
    });
    if (!go) return;
    if (!t.approved) await api(`/api/bots/${b.id}/api-tools/${name}/approve`, { method: 'POST' });
  }
  await api(`/api/bots/${b.id}/api-tools/${name}/run`, { method: 'POST', body: { args, thread: threadKey() } });
}
function slashHelp() {
  const mine = botCmds.get(S.current?.id)?.list || [];
  const el = modal(`<h3>Slash commands</h3>
    <p class="muted">Type <b>/</b> in a bot chat. These run in Nimbus and don’t use your plan:</p>
    <div class="kb-list">${SLASH.filter(([, , , fn]) => fn).map(([c, a, d]) => `<div class="kb-row"><span><b>${c}</b> <i class="muted">${esc(a)}</i></span><span class="muted" style="flex:2">${esc(d)}</span></div>`).join('')}</div>
    <p class="muted">Sent to the bot (Claude Code runs them, like a normal message): <b>/compact</b>${mine.length ? ` and this bot’s ${mine.length} skills and commands:` : '.'}</p>
    ${mine.length ? `<div class="kb-list">${mine.map((x) => `<div class="kb-row"><span><b>${esc(x.cmd)}</b></span><span class="muted" style="flex:2">${esc(x.desc)} <em>· ${esc(x.source)}</em></span></div>`).join('')}</div>` : ''}
    <div class="row"><button class="btn primary" data-close>Done</button></div>`, { wide: true });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
}
async function slashModel(arg, b) {
  if (!arg) return botModal(b);
  const r = await api('/api/models');
  if (!r?.ok) throw new Error('Couldn’t load models');
  const q = arg.toLowerCase(), m = /^default$/.test(q) ? { id: '', name: 'Default' } : r.models.find((x) => x.id.toLowerCase() === q) || r.models.find((x) => x.name.toLowerCase().includes(q) || x.id.toLowerCase().includes(q));
  if (!m) return toast(`No model matches “${arg}”. Try: ${r.models.map((x) => x.name).join(', ')}, default`);
  await api(`/api/bots/${b.id}`, { method: 'PATCH', body: { model: m.id } });
  await refreshState(); renderMain(); toast(`${b.name} now uses ${m.name}`);
}
async function slashEffort(arg, b) {
  if (!arg) return $('[data-act="effort-menu"]')?.click();
  const e = EFFORTS.find(([v, l]) => v === arg.toLowerCase() || l.toLowerCase() === arg.toLowerCase() || v.startsWith(arg.toLowerCase()));
  if (!e) return toast('Effort: ' + EFFORTS.map(([v]) => v).join(', '));
  await api(`/api/bots/${b.id}`, { method: 'PATCH', body: { effort: e[0] } });
  await refreshState(); renderMain(); toast(`Effort: ${e[1]}`);
}
async function slashUsage() {
  const p = await api('/api/plan-usage');
  if (!p?.ok) return toast('Couldn’t read your plan usage right now');
  const el = modal(`<h3>Claude plan${p.plan ? ` · ${esc(p.plan[0].toUpperCase() + p.plan.slice(1))}` : ''}</h3>` + p.windows.map((w) => {
    const left = Math.max(0, Math.round(100 - w.used));
    return `<div class="row"><span>${esc(w.label)}</span><span><b>${left}% left</b></span></div>
      <div class="meter ${w.used >= 90 ? 'hot' : w.used >= 70 ? 'warm' : ''}"><div style="width:${Math.min(100, w.used)}%"></div></div>
      <div class="muted small">${Math.round(w.used)}% used${w.resets ? ` · resets in ${resetsIn(w.resets)}` : ''}</div>`;
  }).join('') + '<div class="row"><button class="btn primary" data-close>Done</button></div>', { cls: 'usage-modal' });
  el.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
}
async function slashStop() {
  const b = [...document.querySelectorAll('#thread [data-stop]')].pop();
  if (!b) return toast('Nothing is running in this thread');
  await api(`/api/runs/${b.dataset.stop}/stop`, { method: 'POST' }); toast('Stopped');
}
async function slashRename(name) {
  const t = threadOf(threadKey());
  if (t?.kind !== 'chat') return toast('Only threads you started can be renamed (not General, Inbox or Routines)');
  if (!name) name = prompt('Thread name', t.title || ''); if (!name) return;
  await api(`/api/threads/${t.id}`, { method: 'PATCH', body: { title: name } }); await refreshState(); renderMain();
}
async function slashThread(name, b) {
  const t = threadOf(threadKey());
  const { key } = await api('/api/threads', { method: 'POST', body: { botId: b.id, projectId: t?.kind === 'chat' ? t.project_id : null, title: name || '' } });
  sideOpen[b.id] = true; saveSideOpen(); await refreshState(); openThread(key);
}

// ---------- read aloud ----------
// Plays a bot reply spoken by Piper on the server. Tapping again (or another reply) stops it.
let speaking = null; // { audio, btn }
async function speak(btn) {
  const same = speaking?.btn === btn;
  if (speaking) { speaking.audio.pause(); speaking.btn.textContent = '▶ Read aloud'; speaking = null; }
  if (same) return;
  btn.textContent = '… Loading';
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: Number(btn.dataset.speak) }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Couldn’t read that aloud');
    const audio = new Audio(URL.createObjectURL(await r.blob()));
    speaking = { audio, btn };
    btn.textContent = '■ Stop';
    audio.onended = () => { if (speaking?.audio === audio) { btn.textContent = '▶ Read aloud'; speaking = null; } };
    await audio.play();
  } catch (err) { btn.textContent = '▶ Read aloud'; toast(err.message); }
}
function flashMessage(id) {
  const el = document.querySelector(`[data-mid="${id}"]`);
  if (!el) return toast('That message is further back in the chat');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 2200);
}

// ---------- share from other apps (Android app) ----------
// The app calls this with { text, files: [{ name, type, data (base64) }] }; you pick which bot gets it.
window.nimbusShare = (share) => {
  if (!S.data) { setTimeout(() => window.nimbusShare(share), 500); return; }
  const files = (share.files || []).map((f) => {
    const bin = atob(f.data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], f.name || 'shared-file', { type: f.type || '' });
  });
  const what = [share.text ? 'text' : '', files.length ? `${files.length} file${files.length > 1 ? 's' : ''}` : ''].filter(Boolean).join(' and ');
  const el = modal(`<div class="modal-head"><h2>Share ${esc(what)} with…</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="stack-list">${S.data.bots.map((b) => `<button class="card-item" data-share-to="bot:${b.id}">${avatar(b, 30)}<span><b>${esc(b.name)}</b><small>${esc(b.role || '')}</small></span></button>`).join('')}</div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    const t = e.target.closest('[data-share-to]'); if (!t) return;
    closeModal();
    await openThread(t.dataset.shareTo);
    const ta = $('#msg');
    if (share.text && ta) { ta.value = share.text.trim(); autosize(ta); }
    if (files.length) addFiles(files);
    ta?.focus();
  });
};

// ---------- dictation ----------
// Tap the mic to start, tap again to stop; the text lands at the cursor for you to edit before sending.
let browserStop = null;
function insertAtCursor(text) {
  const ta = $('#msg'); if (!ta || !text) return;
  const a = ta.selectionStart ?? ta.value.length, b = ta.selectionEnd ?? a;
  const before = ta.value.slice(0, a), after = ta.value.slice(b);
  const piece = (before && !/\s$/.test(before) ? ' ' : '') + text.trim() + (after && !/^\s/.test(after) ? ' ' : '');
  ta.value = before + piece + after;
  const pos = before.length + piece.length;
  ta.focus(); ta.setSelectionRange(pos, pos); autosize(ta);
}
function micState(state) {
  const btn = $('.composer .mic'); if (!btn) return;
  btn.classList.toggle('recording', state === 'recording');
  btn.classList.toggle('busy', state === 'busy');
  btn.setAttribute('aria-label', state === 'recording' ? 'Stop dictation' : 'Dictate');
  if (state !== 'recording') btn.style.removeProperty('--level');
}
async function finishDictation() {
  micState('busy');
  try { insertAtCursor(await stopRecording(api)); }
  catch (err) {
    toast(err.message);
  } finally { micState('idle'); }
}
async function toggleDictation(btn) {
  buzz(10);
  if (browserStop) { browserStop(); browserStop = null; return micState('idle'); }
  if (isRecording()) return finishDictation();
  if (btn.classList.contains('busy')) return;
  if (S.whisper === undefined) S.whisper = (await api('/api/transcribe').catch(() => ({}))).available;
  if (!S.whisper) {
    // Server dictation is off: use the browser's own recognition if it has one.
    browserStop = browserDictation(insertAtCursor, () => { browserStop = null; micState('idle'); });
    if (browserStop) { micState('recording'); return toast('Using your browser’s dictation (server dictation is off)'); }
    return toast('Dictation isn’t available right now');
  }
  try {
    await startRecording({
      onLevel: (p) => btn.style.setProperty('--level', Math.min(1, p * 3).toFixed(2)),
      onLimit: () => { toast('Stopped at 5 minutes'); finishDictation(); }
    });
    micState('recording');
  } catch (err) {
    cancelRecording();
    toast(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser’s site settings.' : err.message);
  }
}

// ---------- attachments ----------
// Files upload as soon as they're picked, pasted or dropped; Send includes the finished ones.
let attachments = []; // { key, name, type, size, id?, error?, preview? }
function drawAttachments() {
  const el = $('#attach-list'); if (!el) return;
  el.innerHTML = attachments.map((a) => `<span class="attach ${a.id ? '' : a.error ? 'bad' : 'busy'}" title="${esc(a.error || a.name)}">
    ${a.preview ? `<img src="${a.preview}" alt="">` : ICON.clip}<span>${esc(a.name)}</span><small>${a.error ? 'Failed' : a.id ? fmtSize(a.size) : 'Uploading…'}</small>
    <button type="button" data-unattach="${a.key}" aria-label="Remove ${esc(a.name)}">${ICON.close}</button></span>`).join('');
}
function addFiles(list) {
  for (const file of list) {
    if (attachments.length >= 10) { toast('Up to 10 files per message'); break; }
    if (file.size > 20 * 1024 * 1024) { toast(`${file.name} is over 20 MB`); continue; }
    const a = { key: Math.random().toString(36).slice(2), name: file.name || 'pasted-image.png', type: file.type, size: file.size,
      preview: /^image\//.test(file.type) ? URL.createObjectURL(file) : null };
    attachments.push(a);
    const reader = new FileReader();
    reader.onload = async () => {
      try { Object.assign(a, await api('/api/uploads', { method: 'POST', body: { name: a.name, type: a.type, data: String(reader.result).split(',')[1] || '' } })); }
      catch (err) { a.error = err.message; }
      drawAttachments();
    };
    reader.readAsDataURL(file);
  }
  drawAttachments();
}
function clearAttachments() {
  for (const a of attachments) if (a.preview) URL.revokeObjectURL(a.preview);
  attachments = []; drawAttachments();
}

function renderMessage(m, prev) {
  if (m.author === 'user') return `<div class="msg user" data-mid="${m.id}">${renderFiles(m)}${m.body ? `<div class="bubble">${linkify(esc(m.body))}</div>` : ''}${msgStamp(m.created_at)}
    ${m.queued ? `<div class="queued-tag">Queued · waits for the current task</div><div class="msg-actions show"><button data-qedit="${m.id}">Edit</button><button data-qcancel="${m.id}">Cancel</button></div>` : m.body ? `<div class="msg-actions"><button data-copy="${m.id}" title="Copy">Copy</button><button data-edit="${m.id}" title="Edit and resend">Edit</button><button data-retry="${m.id}" title="Send again">Retry</button>${S.current?.type === 'bot' ? `<button data-rewind="${m.id}" title="Undo everything from here on: the bot’s file changes and this part of the chat">Rewind</button>` : ''}</div>` : ''}</div>`;
  if (m.kind === 'testrun') return renderTestRun(m);
  if (m.kind === 'note') return `<div class="note" data-mid="${m.id}">${esc(m.body)}${renderFiles(m)}</div>`;
  if (m.kind === 'quiet') return `<div class="note quiet-ok" data-mid="${m.id}" title="Quiet check at ${clock(m.created_at)}">✓ All clear · ${esc(m.body)} <span class="muted">· ${clock(m.created_at)}</span></div>`;
  const b = bot(m.author) || { name: 'Deleted bot', color: '#555' };
  if (m.kind === 'trace') return renderTrace(m, prev);
  if (m.kind === 'changes') return renderChanges(m);
  if (m.kind === 'approval') return renderApproval(m, b, prev);
  if (m.kind === 'docuse') {
    let u = {}; try { u = JSON.parse(m.body); } catch {}
    const names = { read: 'Read doc', edit: 'Edit doc', comment: 'Comment on doc', image: 'Add picture to doc' };
    const docs = u.docs || [];
    return `<div class="msg bot" data-mid="${m.id}">${speakerLabel(m, prev)}<details class="docuse"><summary>Used Docs · ${docs.map((d) => esc(d.title)).join(', ')} ${ICON.chevron}</summary>
      <div class="docuse-acts">${docs.map((d) => d.acts.map((a) => `<button class="docuse-act" data-doc-open="${esc(d.id)}">${names[a] || esc(a)}${docs.length > 1 ? ` · <span class="muted">${esc(d.title)}</span>` : ''} <span class="go">›</span></button>`).join('')).join('')}</div></details></div>`;
  }
  if (m.kind === 'doc') { let d = {}; try { d = JSON.parse(m.body); } catch {} return `<div class="msg bot" data-mid="${m.id}">${speakerLabel(m, prev)}<button class="doc-card" data-doc-open="${esc(d.docId || '')}"><span class="dc-ico">📄</span><span><b>${esc(d.title || 'Document')}</b><small>Live document · click to open</small></span><span class="dc-open">Open</span></button></div>`; }
  return `<div class="msg bot ${m.kind === 'error' ? 'error' : ''}" data-mid="${m.id}" title="${clock(m.created_at)}">${speakerLabel(m, prev)}${m.body ? `<div class="bubble md">${md(m.body.replace(/\n?PLAN_READY\s*$/, ''))}</div>` : ''}${m.kind === 'text' ? planButton(m) + memoryButton(m) : ''}${renderFiles(m)}${msgStamp(m.created_at)}
    <div class="msg-actions"><button data-copy="${m.id}">Copy</button>${m.kind === 'error' ? '<button data-continue="1">Try again</button>' : `<button data-quote="${m.id}" title="Quote this in your reply">Quote</button><button data-pin="${m.id}">${isPinned(m.id) ? 'Unpin' : 'Pin'}</button><button data-branch="${m.id}" title="Start a new thread that picks up from this reply">New thread from here</button><button data-speak="${m.id}">▶ Read aloud</button><button data-continue="1">Continue</button><button data-postmortem="1" title="Have the bot write up this fix as a live doc">Post-mortem</button>`}</div></div>`;
}

// While a bot works, the label cycles through cloud-themed phrases. The phrase is picked from the
// elapsed time, so re-renders never make it jump, and every live trace stays in step.
const WORK_PHRASES = ['Thinking', 'Gathering clouds', 'Connecting the dots', 'Drifting through ideas', 'Brewing a plan',
  'Reading the sky', 'Condensing thoughts', 'Tinkering', 'Chasing a hunch', 'Weaving it together', 'Polishing', 'Almost there, probably'];
const PHRASE_MS = 3500;
// Clamped at 0: the server's clock can be ahead of this device's, which made the index negative ("undefined").
const elapsedMs = (started) => Math.max(0, Date.now() - (Number(started) || Date.now()));
const workPhrase = (started) => WORK_PHRASES[Math.floor(elapsedMs(started) / PHRASE_MS) % WORK_PHRASES.length];
const fmtDur = (secs) => (secs >= 60 ? `${Math.floor(secs / 60)}m ${String(secs % 60).padStart(2, '0')}s` : `${secs}s`);
const LOADER = '<span class="loader" aria-hidden="true"><i></i><i></i><i></i></span>';

// Run stats instead of a dollar figure: tokens used, how full the context is, and plan usage left.
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? Math.round(n / 1e3) + 'k' : String(n));
function traceStats(t) {
  const bits = [];
  if (t.routed) bits.push(`<span title="Model routing picked a lighter model for this task">${esc(t.routed)}</span>`);
  if (t.tokens) bits.push(`<span title="Tokens read / written this run (including cached context)">${fmtTok(t.tokens.in)} in · ${fmtTok(t.tokens.out)} out</span>`);
  if (t.context) {
    const win = t.contextWindow || 200000, pc = Math.min(100, Math.round((t.context / win) * 100));
    bits.push(`<button class="ctx ${pc >= 80 ? 'hot' : pc >= 60 ? 'warm' : ''}" data-ctx="1" title="Context in use: ${t.context.toLocaleString()} of ${win.toLocaleString()} tokens. Click for details.">ctx ${pc}%</button>`);
  }
  const five = planLast?.ok && planLast.windows.find((w) => w.label === '5-hour limit');
  if (five && t.status !== 'running') bits.push(`<span title="Claude plan: 5-hour limit left right now">${Math.max(0, Math.round(100 - five.used))}% left</span>`);
  return bits.length ? ' · ' + bits.join(' · ') : '';
}


// Steps read as plain language ("Searched files", "Edited docs.js"); the exact command shows when you click the step.
const baseName = (p) => String(p || '').replace(/[)"']+$/, '').split('/').filter(Boolean).pop() || p;
const MCP_SAY = { send_message: 'Sent an email', create_draft: 'Drafted an email', search_threads: 'Searched email', get_thread: 'Read an email thread',
  get_message: 'Read an email', list_events: 'Checked the calendar', create_event: 'Added a calendar event', update_event: 'Updated a calendar event',
  delete_event: 'Removed a calendar event', suggest_time: 'Looked for free time', list_calendars: 'Listed calendars' };
function friendlyStep(st) {
  const tool = st.tool || String(st.text).split('(')[0], arg = String(st.text).slice(tool.length + 1).replace(/\)…?$/, '');
  switch (tool) {
    case 'Read': return `Read ${baseName(arg)}`;
    case 'Write': return `Wrote ${baseName(arg)}`;
    case 'Edit': case 'MultiEdit': case 'NotebookEdit': return `Edited ${baseName(arg)}`;
    case 'Grep': return 'Searched the code';
    case 'Glob': return 'Looked for files';
    case 'WebSearch': return `Searched the web${arg ? ': ' + arg.slice(0, 60) : ''}`;
    case 'WebFetch': { const h = (arg.match(/https?:\/\/([^/\s"]+)/) || [])[1]; return `Opened ${h || 'a web page'}`; }
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return 'Updated its to-do list';
    case 'Task': case 'Agent': return 'Started a helper';
    case 'ToolSearch': return 'Loaded tools';
    case 'TaskStop': return 'Stopped a background task';
    case 'Skill': return `Used a skill${arg ? ': ' + arg.slice(0, 40) : ''}`;
    case 'Bash': {
      const c = arg.replace(/^cd [^&;]+(&&|;)\s*/, '').trim(), cPath = (c.match(/\/[\w.\-/]+|\b[\w\-]+\.(js|mjs|py|css|html|md|json|sh|ts|txt|yml|yaml|conf|log)\b/) || [])[0];
      if (/ask-bot\.mjs/.test(c)) { const who = (c.match(/ask-bot\.mjs"?\s+(?:--no-wait\s+)?"([^"]+)"/) || [])[1]; const n = who && (who.startsWith('#') ? bot(Number(who.slice(1)))?.name : who); return `Asked ${n || 'another bot'}`; }
      if (/send-file\.mjs/.test(c)) return 'Sent you a file';
      if (/doc\.mjs/.test(c)) return 'Worked on a live document';
      if (/thread\.mjs/.test(c)) return 'Organized threads';
      if (/nimbus\.mjs/.test(c)) return 'Changed Nimbus settings';
      if (/^git (commit|push|merge|rebase)/.test(c)) return `Git: ${c.split(/\s+/)[1]}`;
      if (/^git /.test(c)) return 'Checked git history';
      if (/^(grep|rg|find)\b/.test(c)) return 'Searched files';
      if (/^(cat|head|tail|less|sed -n|wc|ls|tree|du)\b/.test(c)) return cPath ? `Looked at ${baseName(cPath)}` : 'Looked at files';
      if (/^(npm|pnpm|yarn) (test|run test)|pytest|node --test/.test(c)) return 'Ran tests';
      if (/^(npm|pnpm|yarn|pip|apt) /.test(c)) return 'Installed or updated packages';
      if (/^(curl|wget)\b/.test(c)) { const h = (c.match(/https?:\/\/([^/\s"']+)/) || [])[1]; return `Called ${h || 'a web address'}`; }
      if (/^ssh\b/.test(c)) { const h = (c.match(/@([\w.-]+)/) || [])[1]; return `Connected to ${h || 'another machine'}`; }
      if (/^(python3?|node)\b/.test(c)) return 'Ran a script';
      if (/^(systemctl|service|docker|pct|qm)\b/.test(c)) return 'Managed a service';
      return 'Ran a command';
    }
  }
  if (tool.startsWith('mcp__')) { const parts = tool.split('__'), act = parts.pop(), srv = parts.pop().replace(/^claude_ai_/, '').replace(/_/g, ' ');
    return MCP_SAY[act] || `${srv}: ${act.replace(/_/g, ' ')}`; }
  return st.text;
}
function renderTrace(m, prev) {
  const t = JSON.parse(m.body);
  const running = t.status === 'running';
  if (t.status === 'done' && !t.steps.length) return `<div data-mid="${m.id}" hidden></div>`;
  const secs = Math.round((t.ended ? Math.max(0, t.ended - t.started) : elapsedMs(t.started)) / 1000);
  const dur = fmtDur(secs);
  const mark = { done: '✓', waiting: '⏸', error: '✗', rejected: '✗', stopped: '■', running: '' };
  const waiting = running && t.steps.some((s) => s.state === 'waiting');
  const label = running ? (waiting ? 'Waiting for your approval' : t.source === 'auto-compact' || t.compacting ? '<span class="shimmer">Compacting the chat…</span>' : `<span class="shimmer" data-phrase>${workPhrase(t.started)}</span>`) :
    t.status === 'done' ? `${t.steps.length} step${t.steps.length === 1 ? '' : 's'}` : t.status === 'stopped' ? 'Stopped' : t.status === 'interrupted' ? 'Interrupted' : 'Run failed';
  const open = running || openTraces.has(m.id);
  return `<div class="msg bot" data-mid="${m.id}">${speakerLabel(m, prev)}<details class="trace ${running ? 'live' : ''} ${waiting ? 'paused' : ''}" ${open ? 'open' : ''} data-started="${t.started}">
    <summary>${running ? LOADER : ICON.chevron}<span>${label}</span><span class="sp"><span data-dur>${dur}</span>${traceStats(t)}</span>${running ? `<button class="stop" data-stop="${m.run_id}">Stop</button>` : ''}</summary>
    <div class="steps">
      ${t.steps.map((s) => codeStepHtml(s, mark[s.state] ?? '', !codeProject(threadKey())) ?? `<div class="step"><span class="mark ${s.state}">${mark[s.state] ?? ''}</span><span><code class="step-raw no-i18n">${s.tool === 'Bash' ? highlight(s.text, 'sh') : esc(s.text)}</code></span></div>`).join('')}
      ${!running && t.steps.some((s) => s.tool === 'Bash' && s.cmd && s.state === 'done') ? `<div class="trace-tools"><button class="btn small" data-save-pb="${m.id}">${ICON.check} Save as playbook</button><span class="muted small">Rerun these commands later without Claude</span></div>` : ''}
      ${running && t.lastThought ? `<div class="thought">${esc(t.lastThought)}</div>` : ''}
    </div>
  </details></div>`;
}
const openTraces = new Set();

const JUST = new Map(); // approvals decided on this screen in the last few seconds: their card plays the stamp once
function renderApproval(m, b, prev) {
  const a = JSON.parse(m.body);
  const pending = a.status === 'pending';
  const input = a.tool === 'Bash' ? a.input.command : JSON.stringify(a.input, null, 2);
  const done = { approved: 'Approved', rejected: 'Rejected', expired: 'Expired' }[a.status];
  return `<div class="msg bot" data-mid="${m.id}">${speakerLabel(m, prev)}<div class="approval ${pending ? '' : `decided ${a.status}`} ${!pending && JUST.has(a.approvalId) ? 'just' : ''}">
    <div class="label">${pending ? ICON.lock : `<span class="stamp">${a.status === 'approved' ? '✓' : '✕'}</span>`} ${pending ? 'Needs your approval' : done}</div>
    <div>${esc(describeTool(a.tool, a.input).split(' — ')[0].replace(/^Run: .*/, 'Run a command'))}</div>
    <pre>${esc(input)}</pre>
    ${a.why && pending ? `<div class="aa-why">⚠ ${esc(a.why)}</div>` : ''}
    ${a.note ? `<div class="muted">Your note: ${esc(a.note)}</div>` : ''}
    ${pending ? `<div class="row">
      <button class="btn primary" data-approve="${a.approvalId}">Approve</button>
      <button class="btn" data-reject="${a.approvalId}">Reject…</button>
      <label>Then <select data-remember="${a.approvalId}">
        <option value="">ask again next time</option>
        <option value="exact">always allow ${a.tool === 'Bash' ? 'this exact command' : 'this tool'}</option>
        ${a.pattern ? `<option value="pattern">always allow “${esc(a.pattern)}”</option>` : ''}
      </select></label>
    </div>` : ''}
  </div></div>`;
}

// ---------- navigation ----------
let openSeq = 0;
const liveBuf = new Map(); // id -> message (or a deletion) that arrived for the chat being loaded
async function openThread(key) {
  let [type, id] = key.split(':'), thread = null;
  if (type === 't') {
    const t = threadOf(key);
    if (!t) { const b = S.data.bots[0]; return b ? openThread('bot:' + b.id) : renderMain(); }
    type = 'bot'; id = t.bot_id; thread = key;
  }
  const prev = threadKey();
  if (prev) sessionDraft.set(prev, $('#msg')?.value || '');
  S.current = { type, id: Number(id), ...(thread ? { thread } : {}) }; S.home = false;
  CM.draft = null; setCodeMode(!!codeProject(key) && !EMBED); if (!CM.on) S.lastPlain = key;
  // The browser pane follows the chat: switching bots shows the new bot's own browser.
  if (BR.bot && !(type === 'bot' && Number(id) === BR.bot)) { if (type === 'bot') openBrowser(Number(id)); else closeDoc(); }
  history.replaceState(null, '', '#' + key);
  if (EMBED) parent.postMessage({ nimbusPane: 'key', id: EMBED, key }, location.origin); else paneMainKey(key);
  if (infoBot) { if (type === 'bot') { if (infoBot !== Number(id)) { $('#info').innerHTML = ''; openInfo({ id: Number(id) }); } } else closeInfo(); }
  const seq = ++openSeq; S.loadingThread = true; S.messages = []; liveBuf.clear();
  $('#side').classList.remove('open'); $('#aside').classList.remove('open');
  renderSide(); renderMain();
  codeThreadOpened(key);
  const list = await api(`/api/threads/${encodeURIComponent(key)}/messages`);
  // Clicking another chat while this one loaded: a late answer must not replace the newer chat's messages.
  if (seq !== openSeq || threadKey() !== key) return;
  // Messages and step updates that arrived while loading are newer than (or missing from) the list: keep them.
  const byId = new Map(list.map((m, i) => [m.id, i]));
  for (const m of liveBuf.values()) { if (m.deleted) { if (byId.has(m.id)) list[byId.get(m.id)] = null; } else if (byId.has(m.id)) list[byId.get(m.id)] = m; else if (!list.length || m.id > list[list.length - 1].id) list.push(m); }
  liveBuf.clear();
  S.messages = list.filter(Boolean).sort((a, b) => a.id - b.id);
  S.hasOlder = S.messages.length >= PAGE; S.loadingOlder = false;
  S.loadingThread = false;
  renderMain(); $('.thread-inner')?.classList.add('fade-in');
}

// Older messages load in pages as you scroll up to the top of a chat.
const PAGE = 80; // the server's page size
async function loadOlder() {
  const key = threadKey(), th = $('#thread'), first = S.messages[0];
  if (!key || !th || !first || !S.hasOlder || S.loadingOlder || S.loadingThread) return;
  S.loadingOlder = true; th.classList.add('loading-older');
  try {
    const older = await api(`/api/threads/${encodeURIComponent(key)}/messages?before=${first.id}`);
    if (threadKey() !== key || S.messages[0] !== first) return;
    S.hasOlder = older.length >= PAGE;
    const add = older.filter((m) => m.id < first.id);
    if (!add.length) return;
    const inner = $('.thread-inner', th), h0 = th.scrollHeight, top0 = th.scrollTop;
    S.messages = [...add, ...S.messages];
    inner.insertAdjacentHTML('afterbegin', add.map((m, i) => renderMessage(m, add[i - 1])).join(''));
    // The message that was first now has one before it (speaker labels depend on that).
    const el = inner.querySelector(`[data-mid="${first.id}"]`); if (el) el.outerHTML = renderMessage(first, add[add.length - 1]);
    th.scrollTop = top0 + (th.scrollHeight - h0); // keep what you were reading in place
  } catch (e) { toast(e.message); }
  finally { S.loadingOlder = false; th.classList.remove('loading-older'); }
}
document.addEventListener('click', (e) => { const st = e.target.closest('[data-step-raw]'); if (st && !getSelection().toString()) st.classList.toggle('show-raw'); });
document.addEventListener('scroll', (e) => { if (e.target.id === 'thread' && e.target.scrollTop < 400) loadOlder(); }, true);

let stateSeq = 0;
async function refreshState() {
  // Overlapping refreshes can finish out of order; only the newest one wins.
  const seq = ++stateSeq;
  const data = await api('/api/state');
  if (seq !== stateSeq) return;
  S.data = data;
  const focused = document.activeElement?.id === 'side-search';
  renderSide(); renderAside();
  if (focused) { const i = $('#side-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }
}

// ---------- live updates ----------
function connect() {
  const es = new EventSource('/api/events');
  es.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    voiceMessage(m);
    if (S.loadingThread && m.thread === threadKey()) { liveBuf.set(m.id, m); return soon(); }
    if (m.thread === threadKey() && m.author !== 'user' && isArtifactMsg(m) && !S.messages.some((x) => x.id === m.id)) artifactAdded();
    if (m.thread === threadKey() && !S.messages.some((x) => x.id === m.id)) {
      const prev = S.messages[S.messages.length - 1];
      S.messages.push(m);
      const th = $('#thread');
      if (!th) return;
      const nearBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 200;
      const inner = $('.thread-inner', th);
      if (S.messages.length === 1) inner.innerHTML = '';
      inner.insertAdjacentHTML('beforeend', renderMessage(m, prev));
      inner.lastElementChild?.classList.add('enter');
      if (m.author !== 'user' && m.kind === 'text') { buzz(6); revealWords(inner.lastElementChild?.querySelector('.bubble')); }
      if (nearBottom || m.author === 'user') th.scrollTop = th.scrollHeight;
      botWorkspaceUpdate();
    }
    if (m.kind === 'approval' && m.author !== 'user') notify(m);
    soon();
  });
  es.addEventListener('message_delete', (e) => {
    const { id } = JSON.parse(e.data);
    if (S.loadingThread) liveBuf.set(id, { id, deleted: true });
    S.messages = S.messages.filter((x) => x.id !== id);
    document.querySelector(`#thread [data-mid="${id}"]`)?.remove();
  });
  es.addEventListener('message_update', (e) => {
    const m = JSON.parse(e.data);
    if (S.loadingThread && m.thread === threadKey()) { liveBuf.set(m.id, m); return; }
    const i = S.messages.findIndex((x) => x.id === m.id);
    if (i < 0) return;
    S.messages[i] = m;
    if (m.kind === 'trace') botWorkspaceUpdate();
    if (m.kind === 'trace' && infoBot && m.thread === threadKey() && S.current?.id === infoBot && JSON.parse(m.body || '{}').status !== 'running') setTimeout(loadInfo, 800);
    const el = document.querySelector(`[data-mid="${m.id}"]`);
    if (el) {
      const th = $('#thread');
      const nearBottom = th.scrollHeight - th.scrollTop - th.clientHeight < 200;
      const before = el.querySelectorAll('.trace .steps > .step');
      const was = [...before].map((x) => x.querySelector('.mark')?.className), wasLive = !!el.querySelector('.trace.live');
      el.outerHTML = renderMessage(m, S.messages[i - 1]);
      animateTrace(document.querySelector(`[data-mid="${m.id}"]`), was, wasLive, m);
      if (nearBottom) th.scrollTop = th.scrollHeight;
    }
  });
  let pending;
  const soon = () => { clearTimeout(pending); pending = setTimeout(async () => { await refreshState(); if (S.current) updateHeaderBits(); }, 150); };
  for (const ev of ['bot_status', 'state_changed', 'approvals_changed']) es.addEventListener(ev, soon);
  es.addEventListener('docs_changed', () => fileDocsChanged());
  es.addEventListener('handoff', (e) => officeHandoff(JSON.parse(e.data)));
  es.addEventListener('thread_reload', (e) => { if (JSON.parse(e.data).thread === threadKey()) openThread(threadKey()); });
  es.addEventListener('extras', (e) => { const d = JSON.parse(e.data); if (S.home) digestCard(); if (d.what === 'watch') refreshState(); });
  es.addEventListener('code_changed', (e) => { const d = JSON.parse(e.data); onCodeChanged(d.thread, d.file); });
  es.addEventListener('doc_changed', (e) => {
    const m = JSON.parse(e.data);
    if (m.id !== DOC.id) return;
    if (m.deleted) return closeDoc();
    if (m.actor === 'you' && !m.comments) return; // our own edit: already reloaded
    reloadDoc(m.blocks || []);
  });
  es.onerror = () => { setConnected(false); fetch('/api/state').then((r) => { if (r.status === 401) location.href = '/login'; }).catch(() => {}); };
  es.onopen = () => { setConnected(true); refreshState(); if (S.current) openThread(threadKey()); };
}
// New replies fade in word by word (about a second at most; code blocks fade in whole). Skipped with reduced motion.
function revealWords(el) {
  if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.parentElement.closest('pre, .codeblk') || !n.textContent.trim() ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; for (let n; (n = walk.nextNode());) nodes.push(n);
  const total = nodes.reduce((k, n) => k + n.textContent.split(/\s+/).length, 0), step = Math.min(28, 1100 / Math.max(1, total));
  let i = 0;
  for (const n of nodes) {
    const f = document.createDocumentFragment();
    for (const part of n.textContent.split(/(\s+)/)) {
      if (!part || /^\s+$/.test(part) || i > 400) { f.append(part); continue; }
      const w = document.createElement('span'); w.className = 'w'; w.style.animationDelay = Math.round(i++ * step) + 'ms'; w.textContent = part; f.append(w);
    }
    n.replaceWith(f);
  }
  el.querySelectorAll('.codeblk').forEach((c) => { c.classList.add('w'); c.style.animationDelay = Math.round(i * step) + 'ms'; });
}
// Steps that just finished tick in; when the whole run finishes the bot gives a little hop.
function animateTrace(el, was, wasLive, m) {
  if (!el || m.kind !== 'trace') return;
  el.querySelectorAll('.trace .steps > .step').forEach((st, k) => {
    const mk = st.querySelector('.mark');
    if (k >= was.length) st.classList.add('step-new');
    if (mk && mk.className !== was[k] && /\b(done|error|rejected)\b/.test(mk.className)) mk.classList.add('tick');
  });
  if (wasLive && !el.querySelector('.trace.live')) {
    el.querySelector('.trace')?.classList.add('finished');
    const av = document.querySelector('.head .avatar'); if (av) { av.classList.remove('hop'); void av.offsetWidth; av.classList.add('hop'); }
  }
}
function updateHeaderBits() {
  const b = S.current?.type === 'bot' ? bot(S.current.id) : null;
  const st = $('.head .status');
  if (b) {
    const html = b.status.state !== 'idle' ? `<span class="status ${b.status.state}">${esc(b.status.label)}</span>` : '';
    if (st) st.outerHTML = html; else if (html) $('.head .title')?.insertAdjacentHTML('beforeend', html);
  }
  const cr = $('.head .th-crumb'); if (cr && S.current?.type === 'bot') cr.innerHTML = crumbHtml();
  const bell = $('.head [data-act="panel"]');
  if (bell) bell.innerHTML = ICON.bell + (S.data.approvals.length ? `<i class="count hot">${S.data.approvals.length}</i>` : '');
}
setInterval(() => { // tick live timers and rotate phrases in place, so animations don't restart
  document.querySelectorAll('details.trace.live').forEach((el) => {
    const started = Number(el.dataset.started);
    const dur = $('[data-dur]', el);
    if (dur) dur.textContent = fmtDur(Math.round(elapsedMs(started) / 1000));
    const ph = $('[data-phrase]', el), next = workPhrase(started);
    if (ph && ph.textContent !== next) {
      ph.classList.add('out');
      setTimeout(() => { ph.textContent = next; ph.classList.remove('out'); }, 250);
    }
  });
}, 1000);

function notify(m) {
  if (EMBED) return; // the main window notifies
  if (!('Notification' in window) || Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const a = JSON.parse(m.body);
  const n = new Notification(`${bot(m.author)?.name || 'A bot'} needs approval`, { body: describeTool(a.tool, a.input), icon: '/icon-192.png', tag: 'approval-' + a.approvalId });
  n.onclick = () => { window.focus(); openThread(m.thread); };
}

// ---------- popover menus ----------
function popover(anchor, items) {
  closePopover();
  const r = anchor.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'popover';
  el.innerHTML = items.map(([act, label, icon]) => `<button data-act="${act}">${icon || ''}<span>${label}</span></button>`).join('');
  document.body.append(el);
  const below = r.bottom + el.offsetHeight + 8 < innerHeight;
  el.style.top = (below ? r.bottom + 6 : r.top - el.offsetHeight - 6) + 'px';
  el.style.left = Math.max(8, Math.min(r.left, innerWidth - el.offsetWidth - 8)) + 'px';
}
function closePopover() { document.querySelector('.popover')?.remove(); }

// ---------- modals ----------
// While Settings is open, every settings screen draws inside its right-hand side instead of a new window.
let MODAL_HOST = null;
function modal(html, { wide = false, cls = '', sticky = false } = {}) {
  closePopover();
  if (MODAL_HOST?.isConnected) { MODAL_HOST.innerHTML = `<div class="modal embedded ${cls}">${html}</div>`; MODAL_HOST.scrollTop = 0; setTimeout(() => MODAL_HOST?.querySelector('input:not([type=checkbox]):not([type=color]), textarea')?.focus(), 30); return MODAL_HOST.firstElementChild; }
  MODAL_HOST = null;
  const root = $('#modal-root');
  root.innerHTML = `<div class="scrim"><div class="modal ${wide ? 'wide' : ''} ${sticky ? 'sticky' : ''} ${cls}" role="dialog" aria-modal="true">${html}</div></div>`;
  const scrim = $('.scrim', root);
  if (!sticky) scrim.addEventListener('mousedown', (e) => { if (e.target === scrim) closeModal(true); });
  setTimeout(() => $('input:not([type=checkbox]):not([type=color]), textarea', root)?.focus(), 30);
  return $('.modal', root);
}
// Plays the close animation, unless another modal replaced this one meanwhile.
let SET_GO = null;
function closeModal(all = false) {
  // Inside Settings, "close" on a screen (Cancel, Save) goes back to that screen, not out of Settings.
  if (!all && MODAL_HOST?.isConnected && SET_GO) return SET_GO(localStorage.setKey);
  MODAL_HOST = null; SET_GO = null;
  const root = $('#modal-root'), scrim = $('.scrim', root);
  if (!scrim || scrim.classList.contains('closing')) return;
  scrim.classList.add('closing');
  setTimeout(() => { if (root.contains(scrim)) root.innerHTML = ''; }, 160);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('.modal.sticky')) closeModal(true); closePopover(); } });

// Where this chat's context goes, from Claude Code's own /context report.
const CTX_COLORS = { 'System prompt': '#9ca3af', 'System tools': '#6366f1', 'System tools (deferred)': '#6b7280', 'MCP tools': '#10b981', 'MCP tools (deferred)': '#6b7280',
  'Memory files': '#a78bfa', 'Skills': '#f59e0b', 'Custom agents': '#ec4899', 'Messages': '#f97316', 'Autocompact buffer': '#4b5563', 'Free space': 'transparent' };
// Chat details: a side panel like Claude's — where the bot runs, what's using its context, its connectors.
let infoBot = null, infoBusy = false;
function openInfo(b) {
  infoBot = b.id;
  $('#aside').classList.remove('open');
  const el = $('#info');
  el.classList.add('open');
  loadInfo();
}
function closeInfo() { infoBot = null; $('#info').classList.remove('open'); }
async function loadInfo() {
  const b = bot(infoBot), el = $('#info');
  if (!b || infoBusy) return;
  infoBusy = true;
  const keep = el.querySelector('.info-body') ? [...el.querySelectorAll('details[open]')].map((d) => d.dataset.k) : ['env', 'ctx', 'conn'];
  if (!el.querySelector('.info-body')) el.innerHTML = `<div class="aside-head"><b>${esc(b.name)}</b><button class="icon-btn" data-info-close aria-label="Close">${ICON.close}</button></div><div class="info-body"><div class="muted">${LOADER} Loading…</div></div>`;
  let r;
  try { r = await api(`/api/bots/${b.id}/context` + (S.current?.type === 'bot' && S.current.id === b.id ? `?thread=${encodeURIComponent(threadKey())}` : '')); }
  catch (e) { r = { error: e.message }; }
  infoBusy = false;
  if (infoBot !== b.id) return;
  const sec = (k, title, body) => `<details class="info-sec" data-k="${k}" ${keep.includes(k) ? 'open' : ''}><summary>${title}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m6 9 6 6 6-6"/></svg></summary>${body}</details>`;
  el.querySelector('.info-body').innerHTML = infoSections(r, sec);
}
// Environment, context and connectors for a bot (chat details panel and the workspace's Environment tile).
function infoSections(r, sec) {
  const env = r.env ? `
    <div class="info-line">${ICON.monitor}<span>${esc(r.env.where)}</span></div>
    <div class="info-line" title="${esc(r.env.folder)}">${ICON.folder}<span>${esc(r.env.folder.split(/[\\/]/).slice(-3).join('/'))}</span></div>
    <div class="info-line">${ICON.gear}<span>${esc(r.context?.model || r.env.model || 'Default model')} · ${esc(EFFORTS.find(([v]) => v === r.env.effort)?.[1] || r.env.effort)} effort</span></div>` : '';
  const conn = r.env ? [
    ...(r.plugins || []).map((p) => `<div class="info-line"><span class="pi" style="background:${esc(p.color || '#666')}">${esc(p.icon || p.name[0])}</span><span>${esc(p.name)}</span><em>plugin</em></div>`),
    ...(r.connectors || []).map((c) => `<div class="info-line"><span class="pi" style="background:${esc(c.color || '#666')}">${esc(c.icon || c.name[0])}</span><span>${esc(c.name)}</span><em class="${c.status === 'connected' ? '' : 'bad'}">${c.status === 'connected' ? '' : esc(c.status)}</em></div>`)
  ].join('') || '<div class="muted">No connectors. Add some from Connectors.</div>' : '';
  return (r.env ? sec('env', 'Environment', env) : '') +
    sec('ctx', 'Context', r.context ? contextHtml(r.context) : `<div class="muted">${esc(r.error || 'Not available')}</div>`) +
    (r.env ? sec('conn', 'Connectors', conn + `<button class="btn pill small" data-act="plugins">Manage connectors</button>`) : '');
}
async function botEnvHtml(botId, key) {
  const r = await api(`/api/bots/${botId}/context?thread=${encodeURIComponent(key)}`);
  return `<div class="info-body ws-info">${infoSections(r, (k, title, body) => `<h4 class="ws-h">${title}</h4>${body}`)}</div>`;
}
function contextHtml(r) {
  const deferred = (c) => /deferred/i.test(c.name);
  const live = r.categories.filter((c) => !deferred(c)), later = r.categories.filter(deferred);
  const pctUsed = r.total ? Math.round((r.used / r.total) * 100) : 0;
  const color = (n) => CTX_COLORS[n] || '#9ca3af';
  const pc = (c) => (c.pct < 0.1 && c.tokens ? '<0.1' : c.pct.toFixed(1)) + '%';
  const row = (c, dim) => `<div class="ctx-row ${dim ? 'dim' : ''}"><i style="background:${color(c.name)}"></i><span>${esc(c.name)}</span><b>${fmtTok(c.tokens)}</b><em>${dim ? '—' : pc(c)}</em></div>`;
  return `<div class="ctxp">
    <div class="ctx-top"><b>${pctUsed}% used</b><span>${fmtTok(r.used)} / ${fmtTok(r.total)}</span></div>
    <div class="ctx-bar">${live.filter((c) => c.name !== 'Free space').map((c) => `<i style="width:${Math.max(c.pct, c.tokens ? 0.4 : 0)}%;background:${color(c.name)}" title="${esc(c.name)}: ${fmtTok(c.tokens)}"></i>`).join('')}</div>
    <div class="ctx-rows">${live.map((c) => row(c)).join('')}</div>
    ${later.length ? `<div class="ctx-rows later" title="Loaded only when the bot asks for them">${later.map((c) => row(c, true)).join('')}</div>` : ''}
    ${r.sections.map((s) => `<details class="ctx-sec"><summary>${ICON.chevron}<span>${esc(s.title)}</span><em>${s.rows.length}</em></summary>
      ${s.rows.map((x) => `<div class="ctx-item"><span title="${esc(x.detail)}">${esc(x.name)}${x.detail ? `<small>${esc(x.detail)}</small>` : ''}</span><b>${x.tokens ? fmtTok(x.tokens) : ''}</b></div>`).join('')}</details>`).join('')}
    <div class="ctx-foot"><button class="btn pill small" data-info-refresh>Refresh</button><button class="btn pill small" data-ctx-compact>Compact now</button></div></div>`;
}
document.addEventListener('click', async (e) => {
  if (!e.target.closest('#info')) return;
  if (e.target.closest('[data-info-close]')) return closeInfo();
  if (e.target.closest('[data-info-refresh]')) return loadInfo();
  if (e.target.closest('[data-ctx-compact]') && infoBot) await api(`/api/threads/${encodeURIComponent('bot:' + infoBot)}/messages`, { method: 'POST', body: { text: '/compact' } });
});

// Plays a short sample of a voice (bot settings → Voice → Preview).
let previewAudio = null;
async function previewVoice(voice, name, btn) {
  previewAudio?.pause();
  btn.disabled = true; btn.textContent = '…';
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ voice, text: `Hi, I'm ${name || 'your new bot'}. This is how I'll sound when I read replies and talk with you.` }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Preview failed');
    const url = URL.createObjectURL(await r.blob());
    previewAudio = new Audio(url); previewAudio.onended = () => URL.revokeObjectURL(url);
    await previewAudio.play();
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; btn.textContent = '▶ Preview'; }
}
function botModal(b) {
  const isNew = !b;
  b = b || { name: '', role: '', instructions: '', color: BOT_COLORS[S.data.bots.length % BOT_COLORS.length], shape: 'none/none', effort: 'medium', model: '',
    approval_rules: ['Bash(git push*)', 'Bash(rm -rf*)', 'Bash(*gh pr merge*)', 'mcp__*send*', 'mcp__*delete*', 'mcp__*pay*', 'mcp__*create_event*'], allow_rules: [] };
  let color = b.color;
  const look = outfit(b);
  const el = modal(`
    <div class="modal-head"><h2>${isNew ? 'New bot' : 'Bot settings'}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="bot-look"><div id="f-preview"></div>
      <div class="look-pick">
        <div class="swatches">${BOT_COLORS.map((c) => `<button type="button" class="swatch" data-color="${c}" style="background:${c}" aria-pressed="${c === color}" aria-label="Color ${c}"></button>`).join('')}
          <label class="swatch custom" title="Pick any color" aria-pressed="${!BOT_COLORS.includes(color)}" style="${BOT_COLORS.includes(color) ? '' : `background:${esc(color)}`}"><input type="color" id="f-color" value="${esc(/^#[0-9a-f]{6}$/i.test(color) ? color : '#c9c2f0')}" aria-label="Custom color"></label>
          <button type="button" class="btn small" data-random title="Random look">🎲 Surprise me</button></div>
        <div class="look-tabs" role="tablist">${LOOK_PARTS.map(([k, , label], i) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${i === 0}">${label}</button>`).join('')}</div>
        <div class="shapes" id="f-picks"></div>
      </div></div>
    <label class="field">Name<input id="f-name" value="${esc(b.name)}" placeholder="e.g. Inbox Manager"></label>
    <label class="field">Role (one line)<input id="f-role" value="${esc(b.role)}" placeholder="Gets my inbox to zero and drafts replies"></label>
    <label class="field">Instructions<textarea id="f-instr" rows="6" placeholder="What this bot is for, how it should work, what tools or folders to use…">${esc(b.instructions)}</textarea></label>
    <div class="two">
      <label class="field">Effort<select id="f-effort">${EFFORTS.map(([v, l]) => `<option value="${v}" ${b.effort === v ? 'selected' : ''}>${l}</option>`).join('')}</select><span class="hint">Lower effort uses less of your plan.</span></label>
      <label class="field">Model<select id="f-model"><option value="">Default</option>${b.model ? `<option value="${esc(b.model)}" selected>${esc(b.model)}</option>` : ''}</select><span class="hint" id="f-model-hint">Loading models on your plan…</span></label>
    </div>
    <div class="field">Voice<div class="voice-pick"><select id="f-voice"><option value="">Loading voices…</option></select><button type="button" class="btn small" id="f-voice-play">▶ Preview</button></div><span class="hint">Used for read aloud and voice chat.</span></div>
    <label class="toggle-row"><span class="p-icon" style="width:34px;height:34px;background:#2a3a6b">${ICON.monitor}</span>
      <span class="m-text"><b>Own computer</b><span>${S.data.computers ? 'Works on its own desktop on your computer VM, with its own browser and sign-ins.' : 'Set up the computer VM first in Server settings (see deploy/computer/README.md).'}</span></span>
      <input type="checkbox" class="switch" id="f-computer" ${b.computer ? 'checked' : ''} ${S.data.computers ? '' : 'disabled'}></label>
    <details class="adv"><summary>Approval rules</summary>
      <label class="field">Ask me before (one rule per line)<textarea id="f-rules" class="code" rows="5">${esc(b.approval_rules.join('\n'))}</textarea>
        <span class="hint">Tool names with * wildcards. Bash(pattern) matches commands, e.g. Bash(git push*). Plugin tools start with mcp__.</span></label>
      <label class="field">Always allow (overrides the list above)<textarea id="f-allow" class="code" rows="2">${esc(b.allow_rules.join('\n'))}</textarea>
        <span class="hint">Add <code>@self-email</code> to let this bot email only you without asking.</span></label>
    </details>
    <div class="modal-foot">
      ${isNew ? '' : '<button class="btn danger left" id="f-del">Delete bot</button>'}
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="f-save">${isNew ? 'Create bot' : 'Save'}</button>
    </div>`, { wide: true });
  const preview = () => { $('#f-preview', el).innerHTML = avatar({ color, shape: lookShape(look) }, 84); };
  let tab = 'body';
  const setColor = (c) => {
    color = c;
    el.querySelectorAll('[data-color]').forEach((x) => x.setAttribute('aria-pressed', x.dataset.color === c));
    const cu = $('.swatch.custom', el); cu.setAttribute('aria-pressed', !BOT_COLORS.includes(c)); cu.style.background = BOT_COLORS.includes(c) ? '' : c;
    preview(); drawPicks();
  };
  // One row of choices for the selected tab; each shows the critter in the current color with that item.
  const drawPicks = () => {
    const [key, list] = LOOK_PARTS.find(([k]) => k === tab);
    $('#f-picks', el).innerHTML = list.map((v) => `<button type="button" class="shape" data-part="${key}" data-val="${v}" aria-pressed="${look[key] === v}" title="${v}" aria-label="${key}: ${v}">
      <svg viewBox="0 0 14 14" width="30" height="30" shape-rendering="crispEdges">${critter(color, { ...look, [key]: v })}</svg></button>`).join('');
  };
  preview();
  // Fill the model dropdown with what your Claude plan offers; keep a saved model even if it's not listed.
  api('/api/models').then((r) => {
    const sel = $('#f-model', el), hint = $('#f-model-hint', el);
    if (!r?.ok) { hint.textContent = `Couldn’t load models (${r?.error || 'unknown error'}); Default is used.`; return; }
    const known = new Set(r.models.map((m) => m.id));
    sel.innerHTML = `<option value="">Default</option>${b.model && !known.has(b.model) ? `<option value="${esc(b.model)}">${esc(b.model)}</option>` : ''}`
      + r.models.map((m) => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    sel.value = b.model || '';
    hint.textContent = 'Models available on your Claude plan.';
  }).catch((e) => { $('#f-model-hint', el).textContent = `Couldn’t load models (${e.message}); Default is used.`; });
  el.addEventListener('input', (e) => { if (e.target.id === 'f-color') setColor(e.target.value); });
  el.addEventListener('click', async (e) => {
    const sw = e.target.closest('[data-color]');
    if (sw) setColor(sw.dataset.color);
    const tb = e.target.closest('[data-tab]');
    if (tb) { tab = tb.dataset.tab; el.querySelectorAll('[data-tab]').forEach((x) => x.setAttribute('aria-selected', x === tb)); drawPicks(); }
    const pb = e.target.closest('[data-part]');
    if (pb) { look[pb.dataset.part] = pb.dataset.val; preview(); drawPicks(); }
    if (e.target.closest('[data-random]')) {
      const any = (l) => l[Math.floor(Math.random() * l.length)];
      // Accessories are optional, so "none" comes up often enough to keep random bots readable.
      for (const [k, list] of LOOK_PARTS) look[k] = ['hat', 'glasses', 'extra'].includes(k) && Math.random() < 0.35 ? list[0] : any(list);
      setColor(any(BOT_COLORS));
    }
    if (e.target.closest('[data-close]')) closeModal();
    if (e.target.id === 'f-del') return deleteBot(b);
    if (e.target.id === 'f-voice-play') return previewVoice($('#f-voice', el).value, $('#f-name', el).value.trim(), e.target);
    if (e.target.id === 'f-save') {
      const lines = (id) => $(id, el).value.split('\n').map((s) => s.trim()).filter(Boolean);
      const payload = { name: $('#f-name', el).value.trim(), role: $('#f-role', el).value.trim(), instructions: $('#f-instr', el).value, color, shape: lookShape(look),
        effort: $('#f-effort', el).value, computer: $('#f-computer', el).checked, model: $('#f-model', el).value.trim(), approval_rules: lines('#f-rules'), allow_rules: lines('#f-allow') };
      if (!payload.name) return toast('Give the bot a name');
      try {
        const saved = isNew ? await api('/api/bots', { method: 'POST', body: payload }) : await api(`/api/bots/${b.id}`, { method: 'PATCH', body: payload });
        const v = $('#f-voice', el).value;
        if (v !== (el.dataset.voice || '')) await api(`/api/bots/${saved.id}/voice`, { method: 'PUT', body: { voice: v } });
        closeModal(); await refreshState(); openThread('bot:' + saved.id);
      } catch (err) { toast(err.message); }
    }
  });
  drawPicks();
  api('/api/voices').then(({ voices, default: def, byBot }) => {
    const cur = el.dataset.voice = (!isNew && byBot[b.id]) || '';
    $('#f-voice', el).innerHTML = `<option value="">Default (${esc(voices.find((v) => v.id === def)?.name || 'standard')})</option>` + [...new Set(voices.map((v) => v.group))].map((grp) => `<optgroup label="${esc(grp)}">` + voices.filter((v) => v.group === grp && v.id !== def).map((v) => `<option value="${esc(v.id)}" ${v.id === cur ? 'selected' : ''}>${esc(v.name)}</option>`).join('') + '</optgroup>').join('');
  }).catch(() => { $('#f-voice', el).innerHTML = '<option value="">Default</option>'; });
}

function roomModal(r) {
  const isNew = !r;
  r = r || { name: '', goal: '', members: [], lead_bot_id: null, bots_can_talk: 1 };
  if (isNew && !S.data.bots.length) return toast('Add a bot first');
  const members = new Set(r.members);
  let lead = r.lead_bot_id;
  const el = modal(`
    <div class="modal-head"><h2>${isNew ? 'New group chat' : 'Group chat settings'}</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <label class="field">Name<input id="r-name" value="${esc(r.name)}" placeholder="Offsite crew"></label>
    <label class="field">Goal (bots see this)<textarea id="r-goal" rows="2" placeholder="Plan the team offsite for March.">${esc(r.goal)}</textarea></label>
    <div class="field">Bots<div id="r-picks" class="picks"></div></div>
    <label class="check"><input type="checkbox" id="r-talk" ${r.bots_can_talk ? 'checked' : ''}> Bots can @mention each other to hand off work</label>
    ${S.data.projects.some((p) => p.owner_bot_id == null && !p.archived) ? `<label class="field">Shared project (optional)<select id="r-proj"><option value="">None</option>${S.data.projects.filter((p) => p.owner_bot_id == null && !p.archived).map((p) => `<option value="${p.id}" ${r.project_id === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select><span class="hint">The chat shows under the project in the sidebar.</span></label>` : ''}
    <div class="modal-foot">
      ${isNew ? '' : '<button class="btn danger left" id="r-del">Delete chat</button>'}
      <button class="btn" data-close>Cancel</button>
      <button class="btn primary" id="r-save">${isNew ? 'Create chat' : 'Save'}</button>
    </div>`);
  const drawPicks = () => {
    $('#r-picks', el).innerHTML = S.data.bots.map((b) => {
      const on = members.has(b.id);
      return `<label class="pick ${on ? 'on' : ''}">
        <input type="checkbox" data-member="${b.id}" ${on ? 'checked' : ''}>${avatar(b, 28)}<span>${esc(b.name)}</span>
        ${on ? `<span class="lead"><input type="radio" name="lead" data-lead="${b.id}" ${lead === b.id ? 'checked' : ''}> Lead</span>` : ''}
      </label>`;
    }).join('');
  };
  drawPicks();
  el.addEventListener('change', (e) => {
    if (e.target.dataset.member) {
      const id = Number(e.target.dataset.member);
      e.target.checked ? members.add(id) : members.delete(id);
      if (!members.has(lead)) lead = [...members][0] ?? null;
      drawPicks();
    }
    if (e.target.dataset.lead) lead = Number(e.target.dataset.lead);
  });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) closeModal();
    if (e.target.id === 'r-del') { closeModal(); return deleteRoom(r); }
    if (e.target.id === 'r-save') {
      const payload = { name: $('#r-name', el).value.trim(), goal: $('#r-goal', el).value.trim(), members: [...members], lead_bot_id: lead, bots_can_talk: $('#r-talk', el).checked, ...($('#r-proj', el) ? { project_id: $('#r-proj', el).value ? Number($('#r-proj', el).value) : null } : {}) };
      if (!payload.name) return toast('Give the chat a name');
      if (!payload.members.length) return toast('Pick at least one bot');
      const saved = isNew ? await api('/api/rooms', { method: 'POST', body: payload }) : await api(`/api/rooms/${r.id}`, { method: 'PATCH', body: payload });
      closeModal(); await refreshState(); openThread('room:' + saved.id);
    }
  });
}

const PRESETS = [['Every morning, 9am', '0 9 * * *'], ['Weekdays, 8am', '0 8 * * 1-5'], ['Every 2 hours', '0 */2 * * *'], ['Every hour', '0 * * * *'], ['Mondays, 9am', '0 9 * * 1'], ['Every evening, 6pm', '0 18 * * *']];
function routinesModal(b) {
  const el = modal(`<div class="modal-head"><h2>Routines</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p class="muted">Things ${esc(b.name)} does on a schedule, even when the app is closed.</p>
    <div id="rt-list" class="stack-list"></div>
    <div class="panel">
      <label class="field">What should it do?<textarea id="rt-prompt" rows="2" placeholder="Triage my inbox and draft replies to clients."></textarea></label>
      <label class="field">When (cron: minute hour day month weekday)<input id="rt-cron" class="code" value="0 9 * * *"></label>
      <label class="toggle-row"><span class="m-text"><b>Quiet check</b><span>Only tell me if something needs attention. When all is fine it leaves a small “✓ All clear” line, with no notification.</span></span>
        <input type="checkbox" class="switch" id="rt-quiet"></label>
      <div class="chips">${PRESETS.map(([l, c]) => `<button type="button" class="chip" data-cron="${c}">${l}</button>`).join('')}</div>
      <div class="modal-foot"><button class="btn primary" id="rt-add">Add routine</button></div>
    </div>`, { wide: true });
  const draw = () => {
    const list = S.data.routines.filter((r) => r.bot_id === b.id);
    $('#rt-list', el).innerHTML = list.length ? list.map((r) => `
      <div class="panel">
        <div class="top"><code>${esc(r.cron)}</code>${r.quiet ? '<span class="chip">Quiet</span>' : ''}${r.enabled ? '' : '<span class="muted">Paused</span>'}
          <span class="grow"></span>
          <button class="btn small" data-run="${r.id}">Run now</button>
          <button class="btn small" data-toggle="${r.id}" data-en="${r.enabled}">${r.enabled ? 'Pause' : 'Resume'}</button>
          <button class="btn small danger" data-delr="${r.id}">Delete</button>
        </div>
        <div>${esc(r.prompt)}</div>
      </div>`).join('') : '<div class="muted">No routines yet.</div>';
  };
  draw();
  el.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.close !== undefined) return closeModal();
    if (t.dataset.cron) $('#rt-cron', el).value = t.dataset.cron;
    try {
      if (t.id === 'rt-add') {
        const prompt = $('#rt-prompt', el).value.trim();
        if (!prompt) return toast('Say what the routine should do');
        await api('/api/routines', { method: 'POST', body: { bot_id: b.id, cron: $('#rt-cron', el).value, prompt, quiet: $('#rt-quiet', el).checked } });
        $('#rt-prompt', el).value = '';
      }
      if (t.dataset.run) { await api(`/api/routines/${t.dataset.run}/run`, { method: 'POST' }); toast('Started'); closeModal(); return; }
      if (t.dataset.toggle) await api(`/api/routines/${t.dataset.toggle}`, { method: 'PATCH', body: { enabled: t.dataset.en === '1' ? 0 : 1 } });
      if (t.dataset.delr) await api(`/api/routines/${t.dataset.delr}`, { method: 'DELETE' });
      await refreshState(); draw(); renderMain();
    } catch (err) { toast(err.message); }
  });
}

async function memoryModal(b) {
  const { text, hash } = await api(`/api/bots/${b.id}/memory`);
  const el = modal(`<div class="modal-head"><h2>Memory</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <p class="muted">What ${esc(b.name)} has learned. It adds to this itself when you tell it a rule; edit freely.</p>
    <label class="field"><textarea id="mem" class="code" rows="14">${esc(text)}</textarea></label>
    <div class="modal-foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="mem-save">Save</button></div>`, { wide: true });
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) closeModal();
    if (e.target.id === 'mem-save') { await api(`/api/bots/${b.id}/memory`, { method: 'PUT', body: { text: $('#mem', el).value, hash } }).then(() => { closeModal(); toast('Memory saved'); }, (err) => toast(err.message)); }
  });
}

// ---------- moved to public/panels.js ----------
// ---------- live documents: public/docedit.js ----------
initDocEditor();
// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, [data-open]');
  if (!e.target.closest('.popover') && !t?.dataset.act?.endsWith('menu')) closePopover();
  if (!t) {
    if (!e.target.closest('.side') && !e.target.closest('.aside')) { $('#side').classList.remove('open'); $('#aside').classList.remove('open'); }
    return;
  }
  if (t.closest('#modal-root')) return;
  const cur = S.current?.type === 'bot' ? bot(S.current.id) : null;
  if (t.dataset.open) return paneOpen(t.dataset.open);
  if (t.dataset.projToggle) { const k = 'p' + t.dataset.projToggle; sideOpen[k] = !t.classList.contains('open'); saveSideOpen(); return renderSide(); }
  if (t.dataset.archToggle) { sideOpen['a' + t.dataset.archToggle] = !sideOpen['a' + t.dataset.archToggle]; saveSideOpen(); return renderSide(); }
  if (t.dataset.newThread) return newThread(Number(t.dataset.newThread));
  if (t.dataset.newProject) return projectModal(null, { ownerBotId: Number(t.dataset.newProject) });
  if (t.dataset.projMenu) {
    e.stopPropagation(); menuProject = projectOf(Number(t.dataset.projMenu));
    return popover(t, [...(menuProject?.owner_bot_id != null ? [['pr-thread', 'New thread in project', ICON.plus]] : []), ['pr-edit', 'Project settings', ICON.gear]]);
  }
  if (t.dataset.projThread) {
    e.stopPropagation(); const p = projectOf(Number(t.dataset.projThread)); if (!p) return;
    if (p.members.length === 1) return newThread(p.members[0], p.id);
    menuProject = p;
    return popover(t, p.members.filter((id) => bot(id)).map((id) => ['ptb:' + id, `With ${esc(bot(id).name)}`, avatar(bot(id), 18)]));
  }
  if (t.dataset.codeEditP) return codeProjectModal(projectOf(Number(t.dataset.codeEditP)));
  if (t.dataset.act?.startsWith('code-task:')) { closePopover(); return newCodeThread(Number(t.dataset.act.slice(10))); }
  if (t.dataset.act?.startsWith('code-del:')) { closePopover(); return deleteCodeProject(projectOf(Number(t.dataset.act.slice(9)))).catch((err) => toast(err.message)); }
  if (t.dataset.act?.startsWith('code-edit:')) { closePopover(); return codeProjectModal(projectOf(Number(t.dataset.act.slice(10)))); }
  if (t.dataset.act?.startsWith('ptb:')) { closePopover(); return newThread(Number(t.dataset.act.slice(4)), menuProject.id); }
  if (t.dataset.computer) { const cb = bot(t.dataset.computer); if (cb) return computerModal(cb); }
  if (t.dataset.qcancel) { try { await api(`/api/messages/${t.dataset.qcancel}/queued`, { method: 'POST', body: { action: 'cancel' } }); toast('Removed from the queue'); } catch (err) { toast(err.message); } return; }
  if (t.dataset.qedit) {
    // Edit in place: the bubble becomes a text box with Save / Cancel.
    const m = S.messages.find((x) => x.id === Number(t.dataset.qedit)), node = t.closest('.msg'), bub = node?.querySelector('.bubble');
    if (!m || !bub || node.querySelector('.q-edit')) return;
    bub.hidden = true; t.closest('.msg-actions').hidden = true;
    bub.insertAdjacentHTML('afterend', `<div class="q-edit"><textarea rows="3">${esc(m.body)}</textarea><div class="row"><button class="btn small" data-qe-cancel>Cancel</button><button class="btn small primary" data-qe-save>Save</button></div></div>`);
    const box = node.querySelector('.q-edit'), ta = box.querySelector('textarea');
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); autosize(ta);
    const undo = () => { box.remove(); bub.hidden = false; t.closest('.msg-actions').hidden = false; };
    const save = async () => {
      const text = ta.value.trim(); if (!text) return toast('Message can’t be empty');
      if (text === m.body) return undo();
      try { await api(`/api/messages/${m.id}/queued`, { method: 'POST', body: { action: 'edit', text } }); } catch (err) { toast(err.message); undo(); }
    };
    box.addEventListener('click', (ev) => { if (ev.target.closest('[data-qe-cancel]')) undo(); if (ev.target.closest('[data-qe-save]')) save(); });
    ta.addEventListener('input', () => autosize(ta));
    ta.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') undo(); if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); save(); } });
    return;
  }
  if (t.dataset.runCode !== undefined) return runInTerminal(t.closest('.codeblk').querySelector('code').textContent);
  if (t.dataset.copyCode !== undefined) { const ok = await clip(t.closest('.codeblk').querySelector('code').textContent); buzz(6); t.textContent = ok ? 'Copied ✓' : 'Couldn’t copy'; t.classList.add('done'); setTimeout(() => { t.textContent = 'Copy'; t.classList.remove('done'); }, 1600); return; }
  if (t.dataset.pin) return togglePin(Number(t.dataset.pin));
  if (t.dataset.savePb) { const m = S.messages.find((x) => x.id === Number(t.dataset.savePb)); if (m) saveAsPlaybook(JSON.parse(m.body), S.current?.type === 'bot' ? S.current.id : null); return; }
  if (t.dataset.planOk) { t.disabled = true; return approvePlan(Number(t.dataset.planOk), threadKey()); }
  if (t.dataset.postmortem) { const ta = $('#msg'); if (ta) { ta.value = postMortemPrompt(); autosize(ta); $('#composer').requestSubmit(); } return; }
  if (t.dataset.exOpen) return openSettings(t.dataset.exOpen);
  if (t.dataset.pinGo) { const el = $(`#thread [data-mid="${t.dataset.pinGo}"]`); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } return; }
  if (t.dataset.quote) { const m = S.messages.find((x) => x.id === Number(t.dataset.quote)), ta = $('#msg'); if (ta && m) { ta.value = quoteOf(m) + ta.value; autosize(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } return; }
  if (t.dataset.branch) {
    const m = S.messages.find((x) => x.id === Number(t.dataset.branch)); if (!m || S.current?.type !== 'bot') return;
    const botId = S.current.id;
    try { const { key } = await api('/api/threads', { method: 'POST', body: { botId, projectId: threadOf(threadKey())?.project_id || null } }); sessionDraft.set(key, 'Picking up from this earlier reply:\n' + quoteOf(m)); sideOpen[botId] = true; saveSideOpen(); await refreshState(); openThread(key); }
    catch (err) { toast(err.message); }
    return;
  }
  if (t.dataset.copy) { const m = S.messages.find((x) => x.id === Number(t.dataset.copy)); const ok = await clip(m?.body || ''); buzz(6); return toast(ok ? 'Copied' : 'Couldn’t copy'); }
  if (t.dataset.edit) { const m = S.messages.find((x) => x.id === Number(t.dataset.edit)); const ta = $('#msg'); if (ta && m) { ta.value = m.body; autosize(ta); ta.focus(); } return; }
  if (t.dataset.retry) { const m = S.messages.find((x) => x.id === Number(t.dataset.retry)); if (m) await api(`/api/threads/${encodeURIComponent(threadKey())}/messages`, { method: 'POST', body: { text: m.body } }); return; }
  if (t.dataset.continue) { await api(`/api/threads/${encodeURIComponent(threadKey())}/messages`, { method: 'POST', body: { text: t.textContent === 'Try again' ? 'That failed. Please try again.' : 'Continue.' } }); return; }
  if (t.dataset.speak) return speak(t);
  if (t.dataset.hit) return openThread(t.dataset.hitThread).then(() => flashMessage(Number(t.dataset.hit)));
  if (t.dataset.approve || t.dataset.reject) buzz(12);
  if (t.dataset.approve) return decide(t.dataset.approve, 'approve', { remember: document.querySelector(`[data-remember="${t.dataset.approve}"]`)?.value || '' });
  if (t.dataset.reject) return rejectModal(t.dataset.reject);
  if (t.dataset.ctx) { e.preventDefault(); if (cur) openInfo(cur); return; }
  if (t.dataset.stop) { e.preventDefault(); return api(`/api/runs/${t.dataset.stop}/stop`, { method: 'POST' }); }
  if (t.dataset.unattach) { attachments = attachments.filter((a) => a.key !== t.dataset.unattach); return drawAttachments(); }
  const act = t.dataset.act;
  if (act) closePopover();
  switch (act) {
    case 'new-menu': e.stopPropagation(); return popover(t, [...(cur ? [['new-thread', `New thread with ${esc(cur.name)}`, TI.chat]] : []), ['new-bot', 'New bot', ICON.plus], ['new-room', 'New group chat', ICON.compose], ['new-side-group', 'New sidebar group', ICON.folder], ['new-shared-project', 'New shared project', ICON.folder], ['new-code-project', 'New Nimbus Code project', CODE_ICON], ['market', 'Browse Connectors', ICON.grid]]);
    case 'more-menu': {
      e.stopPropagation(); if (!cur) return;
      const nR = S.data.routines.filter((r) => r.bot_id === cur.id).length, nA = artNew[threadKey()] || 0;
      const comp = cur.computer && S.data.computers;
      return popover(t, [['voice', 'Voice chat', ICON.voice], ['routines', `Routines${nR ? ` (${nR})` : ''}`, ICON.clock],
        comp ? ['computer', 'Computer', ICON.monitor] : ['browser', 'Browser', ICON.globe],
        ['plugins', `Plugins${cur.plugins.length ? ` (${cur.plugins.length})` : ''}`, ICON.plug], ['memory', 'Memory', ICON.book],
        ['artifacts', `Artifacts${nA ? ` (${nA} new)` : ''}`, ICON.grid], ['pane-menu', 'Split pane', ICON.split], ['edit-bot', 'Bot settings', ICON.gear]]);
    }
    case 'later': return laterModal(threadKey(), $('#msg')?.value || '');
    case 'home': $('#side').classList.remove('open'); return openHome();
    case 'palette': return openPalette();
    case 'mark-all-read': SIDE_ITEMS.forEach((it) => it.last && markSeen(it.key, it.last.at)); renderSide(); return toast('All chats marked read', { type: 'ok' });
    case 'pro-settings': $('#side').classList.remove('open'); return openSettings();
    case 'pro-usage': return usagePage();
    case 'pro-status': return statusPage();
    case 'pro-new': return whatsNew();
    case 'pro-tour': closeModal(); return setTimeout(() => tour(), 200);
    case 'pro-search': $('#side').classList.remove('open'); return searchPage();
    case 'home-ask': return homeAsk();
    case 'claude': return claudeModal();
    case 'docs': return docsModal();
    case 'map': return mapPage();
    case 'office': return officePage();
    case 'plan-toggle': S.planFirst = !S.planFirst; t.classList.toggle('on', S.planFirst); t.setAttribute('aria-pressed', S.planFirst); return toast(S.planFirst ? 'Plan first: the bot plans, you approve once, then it runs' : 'Plan first off', { ms: 2500 });
    case 'artifacts': return openArtifacts();
    case 'files': return filesModal();
    case 'user-menu': e.stopPropagation(); return popover(t, [['pro-settings', 'Settings', ICON.gear], ['pro-search', 'Search messages', ICON.globe], ['pro-new', `What’s new${document.body.classList.contains('has-new') ? ' •' : ''}`, ICON.book], ...(window.NimbusApp ? [['app-update', 'App: check for updates', ICON.download], ['app-server', 'App: server address', ICON.gear]] : []), ['logout', 'Log out', ICON.close]]);
    case 'new-bot': return botModal();
    case 'edit-bot': return botModal(cur);
    case 'new-room': return roomModal();
    case 'new-side-group': return groupModal();
    case 'edit-room': return roomModal(room(S.current.id));
    case 'routines': return routinesModal(cur);
    case 'memory': return memoryModal(cur);
    case 'plugins': return botPluginsModal(cur);
    case 'market': $('#side').classList.remove('open'); return marketModal();
    case 'cc-plugins': $('#side').classList.remove('open'); return ccPluginsModal();
    case 'appearance': return appearanceModal();
    case 'language': return languageModal();
    case 'attach': return $('#file-pick').click();
    case 'dictate': return toggleDictation(t);
    case 'voice-mode': return voiceMode();
    case 'camera': return cameraModal();
    case 'voice': { const b = bot(S.current?.id); return b && startVoice({ api, thread: threadKey(), botName: b.name, avatarHtml: avatar(b, 28), character: { svg: critter(b.color, outfit(b)), color: b.color, ...outfit(b) }, toast }); }
    case 'mfa': return mfaModal();
    case 'server': return serverModal();
    case 'log': return activityLogModal();
    case 'app-server': return window.NimbusApp?.changeServer();
    case 'app-update': return window.NimbusApp?.checkUpdate ? window.NimbusApp.checkUpdate() : toast('This version of the app can’t update itself yet: download it once from /nimbus.apk');
    case 'computer': return computerModal(cur);
    case 'reset': await api(`/api/bots/${cur.id}/reset`, { method: 'POST', body: { thread: threadKey() } }); return;
    case 'new-thread': { const t = threadOf(threadKey()); return newThread(cur.id, t?.kind === 'chat' ? t.project_id : null); }
    case 'thread-menu': {
      e.stopPropagation(); menuThread = threadOf(threadKey());
      const chat = menuThread?.kind === 'chat';
      return popover(t, [['new-thread', 'New thread', ICON.plus], ...(chat ? [['th-rename', 'Rename', ICON.compose], ['th-move', 'Move to project…', ICON.folder], menuThread.archived ? ['th-unarchive', 'Unarchive', ICON.box] : ['th-archive', 'Archive', ICON.box], ['th-delete', 'Delete', ICON.close]] : []),
        ...(menuThread?.kind === 'inbox' ? [] : [['reset', 'Start fresh (memory kept)', ICON.clock]])]);
    }
    case 'th-rename': { const n = prompt('Thread name', menuThread?.title || ''); if (n == null || !menuThread) return; try { await api(`/api/threads/${menuThread.id}`, { method: 'PATCH', body: { title: n } }); refreshState().then(renderMain); } catch (err) { toast(err.message); } return; }
    case 'th-unarchive': if (!menuThread) return; try { await api(`/api/threads/${menuThread.id}`, { method: 'PATCH', body: { archived: false } }); await refreshState(); renderMain(); } catch (err) { toast(err.message); } return;
    case 'th-move': return menuThread && moveThreadModal(menuThread);
    case 'th-archive': if (!menuThread) return; try { await api(`/api/threads/${menuThread.id}`, { method: 'PATCH', body: { archived: true } }); await refreshState(); openThread('bot:' + menuThread.bot_id); toast('Archived. Find it under the bot’s “Archived” list.'); } catch (err) { toast(err.message); } return;
    case 'th-delete': {
      // Hidden right away; really deleted after a few seconds unless Undo is pressed.
      const th = menuThread; if (!th) return;
      const row = document.querySelector(`#side [data-open="t:${th.id}"]`); if (row) row.hidden = true;
      if (threadKey() === 't:' + th.id) openThread('bot:' + th.bot_id);
      let undone = false; PENDING_DEL.add(th.id);
      const go = setTimeout(async () => { PENDING_DEL.delete(th.id); if (undone) return; try { await api(`/api/threads/${th.id}`, { method: 'DELETE' }); await refreshState(); } catch (err) { toast(err.message); if (row) row.hidden = false; } }, 5200);
      toast(`Deleted “${th.title || 'New thread'}”`, { action: 'Undo', onAction: () => { undone = true; PENDING_DEL.delete(th.id); clearTimeout(go); renderSide(); if (row) row.hidden = false; } });
      return;
    }
    case 'pr-edit': return menuProject && projectModal(menuProject);
    case 'pr-thread': return menuProject && (menuProject.owner_bot_id != null ? newThread(menuProject.owner_bot_id, menuProject.id) : null);
    case 'new-shared-project': return projectModal(null, { shared: true });
    case 'new-code-project': return codeProjectModal();
    case 'code-pane': return toggleCodePane();
    case 'side-recent': S.data.sideOrder = null; renderSide(); return api('/api/side-order', { method: 'PUT', body: { order: null } });
    case 'effort-menu': {
      e.stopPropagation(); closePopover();
      const r = t.getBoundingClientRect(), el = document.createElement('div');
      el.className = 'popover effort-pop';
      el.innerHTML = EFFORTS.map(([v, l]) => `<button data-effort="${v}" aria-pressed="${cur.effort === v}">${cur.effort === v ? ICON.check : '<i></i>'}<span>${l}</span></button>`).join('')
        + '<div class="pop-hint">Lower effort uses less of your plan.</div>';
      document.body.append(el);
      el.style.top = r.bottom + 6 + 'px';
      el.style.left = Math.max(8, Math.min(r.right - el.offsetWidth, innerWidth - el.offsetWidth - 8)) + 'px';
      el.addEventListener('click', async (ev) => {
        const o = ev.target.closest('[data-effort]'); if (!o) return;
        closePopover(); buzz(8);
        await api(`/api/bots/${cur.id}`, { method: 'PATCH', body: { effort: o.dataset.effort } });
        await refreshState(); renderMain();
        toast(`${cur.name} will use ${o.textContent.trim().toLowerCase()} effort from the next task`);
      });
      return;
    }
    case 'menu': e.stopPropagation(); if (innerWidth > 760) return setSideCollapsed(false); return $('#side').classList.toggle('open');
    case 'side-collapse': return setSideCollapsed(true);
    case 'shortcuts': return EMBED ? paneCmd('shortcuts') : shortcutsModal();
    case 'panel': e.stopPropagation(); $('#side').classList.remove('open'); closeInfo(); return $('#aside').classList.toggle('open');
    case 'browser': return BR.bot === S.current.id ? closeDoc() : openBrowser(S.current.id);
    case 'info': e.stopPropagation(); return infoBot === cur?.id && $('#info').classList.contains('open') ? closeInfo() : cur && openInfo(cur);
    case 'logout': await api('/api/logout', { method: 'POST' }); location.href = '/login'; return;
    case 'notify':
      if (!('Notification' in window)) return toast('This browser doesn’t support notifications');
      if (!window.isSecureContext) return toast('Notifications need HTTPS. See the README for how to add it.');
      return Notification.requestPermission().then((r) => toast(r === 'granted' ? 'You’ll get a notification when a bot needs approval' : 'Notifications are off'));
  }
});
document.addEventListener('change', async (e) => {
  if (e.target.id === 'file-pick') { addFiles(e.target.files); e.target.value = ''; return; }
  if (!e.target.matches('[data-effort-select]')) return;
  const cur = bot(S.current?.id);
  await api(`/api/bots/${cur.id}`, { method: 'PATCH', body: { effort: e.target.value } });
  await refreshState();
  toast(`${cur.name} will use ${e.target.selectedOptions[0].text.toLowerCase()} effort from the next task`);
});
document.addEventListener('toggle', (e) => {
  if (e.target.matches?.('details.trace')) { const id = Number(e.target.closest('[data-mid]').dataset.mid); e.target.open ? openTraces.add(id) : openTraces.delete(id); }
}, true);
document.addEventListener('input', (e) => {
  if (e.target.id === 'msg') { autosize(e.target); slashHint(e.target.value); mentionHint(e.target); }
  if (e.target.id === 'side-search') { sideQuery = e.target.value.trim().toLowerCase(); refreshSideOnly(); }
});
let searchSeq = 0, searchTimer;
function searchMessages() {
  clearTimeout(searchTimer);
  if (sideQuery.length < 2) return;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq;
    const r = await api('/api/search?q=' + encodeURIComponent(sideQuery)).catch(() => ({ results: [] }));
    const box = $('#side-hits'); if (!box || seq !== searchSeq) return;
    const who = (t) => t.startsWith('bot:') ? bot(t.slice(4))?.name : room(t.slice(5))?.name;
    box.innerHTML = `<h5>Messages</h5>` + (r.results.length ? r.results.map((h) => `<button class="side-hit" data-hit="${h.id}" data-hit-thread="${esc(h.thread)}">
      <span class="row1"><b>${esc(who(h.thread) || h.thread)}</b><span class="time">${stamp(h.at)}</span></span>
      <span class="sub">${esc(h.author === 'user' ? 'You: ' : '')}${esc(h.snippet)}</span></button>`).join('') : '<div class="side-empty">No messages match</div>');
  }, 250);
}
function refreshSideOnly() {
  renderSide();
  const i = $('#side-search'); i.focus(); i.setSelectionRange(i.value.length, i.value.length);
}
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'msg' && $('#slash-hint') && !e.isComposing) {
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && slashMove(e.key === 'ArrowDown' ? 1 : -1)) return e.preventDefault();
    if (e.key === 'Tab' && !e.shiftKey) {
      const b = document.querySelectorAll('#slash-hint [data-slash]')[slashSel]; if (!b) return;
      e.preventDefault(); e.target.value = b.dataset.slash + ' '; autosize(e.target); $('#slash-hint')?.remove(); return;
    }
    if (e.key === 'Escape') { $('#slash-hint')?.remove(); return e.preventDefault(); }
  }
  if (e.target.id === 'msg' && e.key === 'Enter' && !e.shiftKey && !e.isComposing && matchMedia('(pointer: fine)').matches) {
    e.preventDefault();
    // A half-typed command with the list open: Enter picks the top match.
    const first = document.querySelectorAll('#slash-hint [data-slash]')[slashSel], v = e.target.value.trim();
    if (first && /^\/[\w:.-]*$/.test(v) && !SLASH.some(([c]) => c === v.toLowerCase()) && !botCmds.get(S.current?.id)?.list.some((x) => x.cmd === v)) return first.click(); $('#composer').requestSubmit();
  }
});
document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'composer') return;
  e.preventDefault();
  $('#mention-hint')?.remove();
  if (CM.draft) return codeDraftSend();
  const ta = $('#msg'); let text = ta.value.trim();
  if (!attachments.length && runSlash(text)) { ta.value = ''; autosize(ta); $('#slash-hint')?.remove(); return; }
  if (attachments.some((a) => !a.id && !a.error)) return toast('Still uploading…');
  const files = attachments.filter((a) => a.id).map((a) => a.id);
  if (!text && !files.length) return;
  const kept = attachments;
  if (S.planFirst && text && S.current?.type === 'bot') { text = PLAN_TAG + text; S.planFirst = false; $('.plan-tg')?.classList.remove('on'); }
  const sendBtn = $('.composer .send');
  sendBtn?.classList.remove('launch'); void sendBtn?.offsetWidth; sendBtn?.classList.add('launch');
  buzz(10);
  ta.value = ''; autosize(ta); $('#slash-hint')?.remove(); sessionDraft.delete(threadKey()); attachments = []; drawAttachments();
  try { await api(`/api/threads/${encodeURIComponent(threadKey())}/messages`, { method: 'POST', body: { text, files } }); kept.forEach((a) => a.preview && URL.revokeObjectURL(a.preview)); }
  catch (err) { if (err.offline) { queueSend(threadKey(), text, files); return; } ta.value = text; attachments = kept; drawAttachments(); toast(err.message); }
});

// Paste images/files into the message box, or drop them anywhere on the chat.
document.addEventListener('paste', (e) => {
  if (e.target.id !== 'msg') return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) { e.preventDefault(); addFiles(files); }
});
document.addEventListener('dragover', (e) => { if ($('#composer') && e.dataTransfer?.types.includes('Files')) { e.preventDefault(); document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) document.body.classList.remove('dropping'); });
document.addEventListener('drop', (e) => {
  document.body.classList.remove('dropping');
  if (!$('#composer') || !e.dataTransfer?.files.length) return;
  e.preventDefault(); addFiles(e.dataTransfer.files);
});

window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if (/^(bot|room|t):\d+$/.test(h) && h !== threadKey()) openThread(h);
  else if (h === 'home' && !S.home) openHome();
});

// ---------- Office files: preview in the side pane, versions, sharing, editing ----------
// The side pane shows a live preview of a file. When a bot (or someone in the editor) saves a new version,
// the pane follows it. Office files preview as PDF, made on the server with LibreOffice.
const V = { doc: null, fileId: null, follow: true, code: false, dirty: false };
const previewKind = (f) => isImage(f) ? 'image' : /pdf$/.test(f.type) ? 'pdf' : /\.html?$/i.test(f.name) ? 'html'
  : /\.(docx?|xlsx?|pptx?|od[tsp]|rtf)$/i.test(f.name) ? 'office' : /^text\/|json$/.test(f.type) || /\.(csv|md|txt|log|json)$/i.test(f.name) ? 'text' : 'none';
const pdfUrl = (f) => `/api/preview/${f.id}`;
async function openViewer(fileId, docId) {
  const d = docId ? await api(`/api/filedocs/${docId}`).catch(() => null) : null;
  closeDoc();
  V.doc = d; V.fileId = fileId; V.follow = !d || d.latest?.id === fileId; V.code = false; V.dirty = false;
  closeInfo(); $('#aside').classList.remove('open');
  drawViewer();
}
function viewerFile() { return V.doc?.versions.find((v) => v.id === V.fileId) || V.doc?.latest || (V.fileId && { id: V.fileId, name: 'file', type: '' }); }
async function drawViewer() {
  const el = $('#docpane'), f = viewerFile(), d = V.doc;
  if (!f) return closeDoc();
  const kind = previewKind(f);
  el.classList.add('open'); el.classList.toggle('wide', kind === 'html');
  el.innerHTML = `<header class="viewer-head">
      <div class="viewer-title">${ICON.file}<b title="${esc(f.name)}">${esc(f.name)}</b></div>
      ${d && d.versions.length > 1 ? `<select class="viewer-ver" aria-label="Version">${d.versions.map((v) => `<option value="${v.id}" ${v.id === f.id ? 'selected' : ''}>v${v.version}${v.id === d.latest.id ? ' (latest)' : ''} · ${esc(v.authorName || '')} · ${timeAgo(v.at)}</option>`).join('')}</select>` : ''}
      <button class="icon-btn" data-viewer="close" aria-label="Close preview">${ICON.close}</button>
    </header>
    <div class="viewer-bar">
      <a class="btn small" href="${fileUrl(f)}?download=1" download>${ICON.download} Download</a>
      ${kind === 'office' ? `<a class="btn small ghost" href="${pdfUrl(f)}?download=1" download>PDF</a>` : ''}
      ${kind === 'html' && d && f.id === d.latest.id ? (V.code
        ? `<button class="btn small primary" data-viewer="code-save">Save</button><button class="btn small ghost" data-viewer="code-close">Done</button><small class="muted code-state">Click anywhere on the page and type to edit</small>`
        : `<button class="btn small ghost" data-viewer="code">${ICON.compose} Edit</button>`) : ''}
      ${kind === 'html' ? `<button class="btn small ghost" data-viewer="html-tab">Open in new tab</button>` : ''}
      ${d?.editable ? `<button class="btn small ghost" data-viewer="edit">${ICON.compose} Edit</button>` : ''}
      ${d && f.id !== d.latest.id ? `<button class="btn small ghost" data-viewer="restore">Restore this version</button>` : ''}
    </div>
    <div class="viewer-body">${kind === 'image' ? `<img src="${fileUrl(f)}" alt="${esc(f.name)}">`
      : kind === 'pdf' || kind === 'office' ? `<div class="viewer-wait">${kind === 'office' ? 'Making a preview…' : ''}</div><iframe title="Preview of ${esc(f.name)}" src="${kind === 'pdf' ? fileUrl(f) : pdfUrl(f)}#view=FitH"></iframe>`
      : kind === 'html' ? `<iframe class="html-frame${V.code ? ' editing' : ''}" title="${V.code ? 'Editing' : 'Preview of'} ${esc(f.name)}" sandbox="${V.code ? 'allow-same-origin' : 'allow-scripts allow-forms allow-modals allow-popups'}"></iframe>`
      : kind === 'text' ? '<pre class="viewer-text">Loading…</pre>'
      : `<div class="viewer-none">No preview for this kind of file.<br><a class="btn" href="${fileUrl(f)}?download=1" download>${ICON.download} Download ${esc(f.name)}</a></div>`}</div>`;
  if (kind === 'office') {
    // Check the conversion first, so a missing LibreOffice shows a message instead of a JSON error in the frame.
    const r = await fetch(pdfUrl(f), { method: 'GET' });
    if (V.fileId !== f.id) return;
    if (!r.ok) { const e = await r.json().catch(() => ({})); $('.viewer-body', el).innerHTML = `<div class="viewer-none">${esc(e.error || 'Preview unavailable.')}<br><a class="btn" href="${fileUrl(f)}?download=1" download>${ICON.download} Download</a></div>`; }
  }
  if (kind === 'text') {
    const t = await fetch(fileUrl(f)).then((r) => r.text()).catch(() => '');
    const pre = $('.viewer-text', el); if (pre) pre.textContent = t.slice(0, 500_000);
  }
  if (kind === 'html') {
    // Sandboxed without allow-same-origin: the page's scripts run, but can't reach Nimbus or your session.
    const t = await fetch(fileUrl(f)).then((r) => r.text()).catch(() => '');
    if (V.fileId !== f.id) return;
    V.html = t;
    const fr = $('.html-frame', el);
    if (V.code) {
      // Editing: scripts are off (no allow-scripts) so the page can't run anything while we reach into it;
      // the page itself becomes editable, like a word processor.
      fr.addEventListener('load', () => {
        const doc = fr.contentDocument; if (!doc) return;
        doc.designMode = 'on';
        doc.addEventListener('input', () => { V.dirty = true; const st = $('.code-state'); if (st) st.textContent = 'Unsaved changes'; });
        doc.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveHtml(); } });
        doc.addEventListener('click', (e) => { if (e.target.closest('a')) e.preventDefault(); });
        doc.body?.focus();
      }, { once: true });
    }
    // Viewing: the saved page from its sandboxed URL. Editing: a script-free copy we can reach into.
    if (V.code) fr.srcdoc = t; else fr.src = fileUrl(f) + '?sandbox';
  }
  $('iframe', el)?.addEventListener('load', () => $('.viewer-wait', el)?.remove());
}
// Editing an HTML file in place: Save writes the edited page back as a new version.
const editedHtml = () => { const doc = $('#docpane .html-frame.editing')?.contentDocument; if (!doc?.documentElement) return null; doc.designMode = 'off'; const h = (doc.doctype ? new XMLSerializer().serializeToString(doc.doctype) + '\n' : '') + doc.documentElement.outerHTML; doc.designMode = 'on'; return h; };
async function saveHtml() {
  const html = editedHtml(); if (html == null || !V.doc) return;
  try {
    V.dirty = false;
    V.doc = await api(`/api/filedocs/${V.doc.id}/content`, { method: 'POST', body: { text: html } }); V.html = html;
    V.fileId = V.doc.latest.id; V.follow = true;
    const sel = $('.viewer-ver'); if (sel) drawViewer(); else { $('.code-state') && ($('.code-state').textContent = 'Saved'); }
    toast(`Saved as v${V.doc.latest.version}`);
  } catch (err) { V.dirty = true; toast(err.message); }
}
// A new version arrived: refresh the open file (following the latest one) and the Files list.
async function fileDocsChanged() {
  if (V.doc) {
    const d = await api(`/api/filedocs/${V.doc.id}`).catch(() => null);
    if (d && V.doc) { const moved = d.latest?.id !== V.doc.latest?.id; V.doc = d; if (moved && V.follow) V.fileId = d.latest.id; if (moved && !V.dirty && !ED.ed) drawViewer(); }
  }
  if ($('.files-modal')) filesModal(true);
}
const ART = { open: false, tab: 'all' }; // artifacts pane state
// ---------- artifacts: side pane listing everything this bot made (live docs, files, web pages, visuals) ----------
// A bot message that made something: a file, a live doc card, or an inline visual.
function isArtifactMsg(m) { let f = []; try { f = JSON.parse(m.files || '[]'); } catch {} return f.length > 0 || m.kind === 'doc' || (m.kind === 'text' && /```(visual|chart)\n/.test(m.body || '')); }
// New artifacts while the pane is closed light up a badge on the button; while it's open the list refreshes.
const artNew = {};
function artBadge() {
  const btn = $('[data-act="artifacts"]'); if (!btn) return;
  const n = artNew[threadKey()] || 0;
  btn.querySelector('.count')?.remove();
  if (n) btn.insertAdjacentHTML('beforeend', `<i class="count hot">${n > 9 ? '9+' : n}</i>`);
}
function artifactAdded() {
  if (ART.open) return setTimeout(() => ART.open && openArtifacts(true), 400); // let the message land in S.messages first
  artNew[threadKey()] = (artNew[threadKey()] || 0) + 1; artBadge();
}
async function openArtifacts(refresh = false) {
  const b = S.current?.type === 'bot' ? bot(S.current.id) : null; if (!b) return;
  if (!refresh) { closeDoc(); closeInfo(); $('#aside').classList.remove('open'); }
  ART.open = true; delete artNew[threadKey()]; artBadge();
  const el = $('#docpane'); el.classList.add('open');
  if (!refresh || !$('.art-body', el)) el.innerHTML = `<div class="doc-head"><span class="doc-name">Artifacts</span><div class="doc-tools"><button class="icon-btn" data-art-close aria-label="Close">${ICON.close}</button></div></div><div class="art-body"><p class="muted">Loading…</p></div>`;
  const key = threadKey();
  const [docs, files] = await Promise.all([api('/api/docs').catch(() => []), api(`/api/filedocs?thread=${encodeURIComponent(key)}`).catch(() => [])]);
  if (!ART.open || threadKey() !== key) return;
  // Inline visuals the bot drew in this chat (```visual fences).
  const visuals = S.messages.filter((m) => m.author !== 'user' && m.kind === 'text' && /```(visual|chart)\n/.test(m.body || ''))
    .flatMap((m) => [...m.body.matchAll(/```(?:visual|chart)\n([\s\S]*?)```/g)].map((x, i) => ({ mid: m.id, at: m.created_at, title: (x[1].match(/<title>([^<]{1,80})/)?.[1] || x[1].match(/aria-label="([^"]{1,80})"/)?.[1] || `Visual from ${clock(m.created_at)}`) + (i ? ` (${i + 1})` : '') })));
  const items = [
    ...docs.filter((d) => d.bot_id === b.id).map((d) => ({ kind: 'doc', at: d.updated_at, html: `<button class="file-row" data-doc-open="${esc(d.id)}"><span class="art-ico">📄</span><span class="fn"><b>${esc(d.title || 'Document')}</b><small>Live document · ${timeAgo(d.updated_at)}</small></span></button>` })),
    ...files.filter((f) => f.latest).map((f) => { const web = /\.html?$/i.test(f.name);
      return { kind: web ? 'web' : 'file', at: f.updated_at, html: `<button class="file-row" data-view="${f.latest.id}" data-doc="${f.id}"><span class="art-ico">${web ? '🌐' : ICON.file}</span><span class="fn"><b>${esc(f.name)}</b><small>${web ? 'Web page' : 'File'} · v${f.latest.version || 1} · ${esc(f.latest.authorName || '')} · ${timeAgo(f.updated_at)}</small></span></button>` }; }),
    ...visuals.map((v) => ({ kind: 'visual', at: v.at, html: `<button class="file-row" data-art-msg="${v.mid}"><span class="art-ico">📊</span><span class="fn"><b>${esc(v.title)}</b><small>Visual in chat · ${timeAgo(v.at)}</small></span></button>` }))
  ].sort((x, y) => y.at - x.at);
  const tabs = [['all', 'All'], ['doc', 'Docs'], ['file', 'Files'], ['web', 'Web pages'], ['visual', 'Visuals']].filter(([k]) => k === 'all' || items.some((i) => i.kind === k));
  const draw = () => {
    const shown = items.filter((i) => ART.tab === 'all' || i.kind === ART.tab);
    $('.art-body', el).innerHTML = `<div class="m-tabs">${tabs.map(([k, n]) => `<button class="${ART.tab === k ? 'on' : ''}" data-art-tab="${k}">${n}</button>`).join('')}</div>
      <div class="file-list">${shown.map((i) => i.html).join('') || `<p class="muted">Nothing yet. Ask ${esc(b.name)} for a document, spreadsheet, web page or chart and it shows up here.</p>`}</div>`;
  };
  if (!tabs.some(([k]) => k === ART.tab)) ART.tab = 'all';
  draw();
  el.onclick = (e) => {
    const t = e.target.closest('[data-art-tab]'); if (t) { ART.tab = t.dataset.artTab; return draw(); }
    if (e.target.closest('[data-art-close]')) { ART.open = false; el.onclick = null; return closeDoc(); }
    const m = e.target.closest('[data-art-msg]');
    if (m) { const node = document.querySelector(`#thread [data-mid="${m.dataset.artMsg}"]`); node?.scrollIntoView({ behavior: 'smooth', block: 'center' }); node?.classList.add('flash'); setTimeout(() => node?.classList.remove('flash'), 1500); }
    if (e.target.closest('[data-view], [data-doc-open]')) { ART.open = false; el.onclick = null; }
  };
}
async function filesModal(refresh = false) {
  const key = threadKey();
  const [docs, shared] = await Promise.all([key ? api(`/api/filedocs?thread=${encodeURIComponent(key)}`) : [], api('/api/filedocs')]);
  const row = (d) => `<button class="file-row" data-view="${d.latest?.id}" data-doc="${d.id}">${ICON.file}<span><b>${esc(d.name)}</b><small>v${d.latest?.version || 1} · ${esc(d.latest?.authorName || '')} · ${timeAgo(d.updated_at)} · ${fmtSize(d.latest?.size || 0)}${d.shares.length || d.links.length ? ' · shared' : ''}</small></span></button>`;
  const html = `<h2>Files</h2>
    <div class="file-list">${docs.length ? docs.map(row).join('') : '<p class="muted">No files in this chat yet. Attach one, or ask the bot to make a document, spreadsheet or deck.</p>'}</div>
    ${shared.length ? `<h3>Shared with you</h3><div class="file-list">${shared.map(row).join('')}</div>` : ''}
    <div class="modal-foot"><button class="btn" data-close>Close</button></div>`;
  if (refresh) { const m = $('.files-modal'); if (m) m.innerHTML = html; return; }
  const m = modal(html, { cls: 'files-modal' });
  m.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) closeModal(); });
}
// In-browser editing with ONLYOFFICE (if the server has it). Saving makes a new version the bot sees next time.
// Live editing in the side pane: autosaves every 30 s while you work (a new version the bot can read),
// and once more when you press Done.
const ED = { ed: null, timer: null, doc: null, key: null };
function stopEditor(save = true) {
  clearInterval(ED.timer); ED.timer = null;
  if (ED.doc && save) forceSave();
  try { ED.ed?.destroyEditor(); } catch {}
  ED.ed = null; ED.doc = null; ED.key = null;
}
const forceSave = () => ED.doc && api(`/api/filedocs/${ED.doc.id}/forcesave`, { method: 'POST', body: { key: ED.key } }).catch(() => {});
async function openEditor(d) {
  let cfg; try { cfg = await api(`/api/filedocs/${d.id}/editor`); } catch (e) { return toast(e.message); }
  // An old format (.xls, .doc, .ppt) comes back converted as a new file; edit and show that one.
  if (cfg.doc) { d = cfg.doc; V.doc = d; V.fileId = d.latest.id; V.follow = true; toast(`Converted to ${d.name} for editing`); }
  const el = $('#docpane');
  el.classList.add('open', 'wide');
  el.innerHTML = `<header class="viewer-head"><div class="viewer-title">${ICON.compose}<b title="${esc(d.name)}">${esc(d.name)}</b><small class="muted">Saves automatically</small></div><button class="btn small primary" data-editor-close>Done</button></header><div class="viewer-body oo-body"><div id="oo-editor"></div></div>`;
  try {
    if (!window.DocsAPI) await new Promise((ok, fail) => { const s = document.createElement('script'); s.src = cfg.api; s.onload = ok; s.onerror = () => fail(new Error('The document editor isn’t reachable')); document.head.append(s); });
    ED.ed = new window.DocsAPI.DocEditor('oo-editor', { ...cfg.config, width: '100%', height: '100%' });
    ED.doc = d; ED.key = cfg.config.document.key;
    ED.timer = setInterval(forceSave, 30_000);
  } catch (e) { toast(e.message); drawViewer(); }
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-editor-close]')) return;
  stopEditor(); toast('Saved. The new version appears in a few seconds');
  setTimeout(fileDocsChanged, 3000); drawViewer();
});
document.addEventListener('click', async (e) => {
  const v = e.target.closest('[data-view]');
  if (v && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (v.closest('.files-modal')) closeModal(); return openViewer(v.dataset.view, v.dataset.doc || null); }
  const a = e.target.closest('[data-viewer]'); if (!a) return;
  const f = viewerFile();
  switch (a.dataset.viewer) {
    case 'close': return closeDoc();
    case 'edit': return openEditor(V.doc);
    case 'code': V.code = true; V.dirty = false; return drawViewer();
    case 'code-save': return saveHtml();
    case 'code-close': if (V.dirty && !confirm('Discard unsaved changes?')) return; V.code = false; V.dirty = false; return drawViewer();
    case 'html-tab': { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups to open it'); w.opener = null;
      // Same sandbox as the pane, via a blob page that wraps it.
      const edited = editedHtml();
      if (edited == null) { w.location = fileUrl(f) + '?sandbox'; return; }
      const src = edited;
      w.location = URL.createObjectURL(new Blob([`<!doctype html><meta charset=utf-8><title>${esc(f.name)}</title><style>html,body,iframe{margin:0;width:100%;height:100%;border:0}</style><iframe sandbox="allow-scripts allow-forms allow-modals allow-popups" srcdoc="${esc(src)}"></iframe>`], { type: 'text/html' }));
      return; }
    case 'restore': try { V.doc = await api(`/api/filedocs/${V.doc.id}/restore`, { method: 'POST', body: { uploadId: f.id } }); V.fileId = V.doc.latest.id; V.follow = true; drawViewer(); toast('Restored as the newest version'); } catch (err) { toast(err.message); } return;
  }
});
document.addEventListener('change', (e) => { if (e.target.matches('.viewer-ver')) { V.fileId = e.target.value; V.follow = V.fileId === V.doc.latest.id; drawViewer(); } });


// ---------- resizable side pane ----------
// Drag the pane's left edge; the width is remembered.
function setPaneWidth(w) { document.documentElement.style.setProperty('--pane-w', Math.round(w) + 'px'); document.body.classList.add('pane-sized'); }
if (+localStorage.paneW) setPaneWidth(+localStorage.paneW);
document.addEventListener('pointerdown', (e) => {
  const pane = $('#docpane');
  if (e.target !== pane || e.clientX - pane.getBoundingClientRect().left > 8) return;
  e.preventDefault();
  document.body.classList.add('pane-drag');
  const move = (ev) => setPaneWidth(Math.max(360, Math.min(innerWidth - 320, innerWidth - ev.clientX)));
  const up = () => { document.body.classList.remove('pane-drag'); localStorage.paneW = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--pane-w')) || ''; removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
});
document.addEventListener('dblclick', (e) => { const pane = $('#docpane'); if (e.target === pane && e.clientX - pane.getBoundingClientRect().left <= 8) { delete localStorage.paneW; document.body.classList.remove('pane-sized'); } });


// ---------- boot ----------
applyTheme();
(async () => {
  await refreshState();
  const hash = location.hash.slice(1);
  const first = Object.entries(S.data.last).sort((a, b) => b[1].at - a[1].at)[0]?.[0];
  if (/^(bot|room|t):\d+$/.test(hash)) openThread(hash);
  else if (!EMBED && (hash === 'home' || !hash)) openHome();
  else if (hash === 'code' && !EMBED) newCodeThread();
  else if (EMBED) renderMain();
  else if (/^doc:d_[0-9a-f]+$/.test(hash)) { if (first || S.data.bots[0]) await openThread(first || 'bot:' + S.data.bots[0].id); openDoc(hash.slice(4)); }
  else if (matchMedia('(min-width: 761px)').matches && (first || S.data.bots[0])) openThread(first || 'bot:' + S.data.bots[0].id);
  else renderMain();
  connect();
  setI18nNames(() => [userName() === 'You' ? '' : userName(), ...S.data.bots.map((b) => b.name), ...S.data.rooms.map((r) => r.name), ...(S.data.threads || []).map((t) => t.title), ...(S.data.projects || []).map((p) => p.name), ...(S.data.sideGroups || []).map((g) => g.name)].filter(Boolean));
  startI18n();
  if (!EMBED) panesRestore();
})();

// ---------- sidebar size: drag its edge (200–520px, double-click resets), collapse with its button or Ctrl+B ----------
function setSideCollapsed(on) { document.body.classList.toggle('side-collapsed', on); localStorage.sideCollapsed = on ? '1' : ''; }
(() => {
  const root = document.documentElement, h = $('#side-resize');
  if (localStorage.sideW) root.style.setProperty('--side-w', localStorage.sideW + 'px');
  if (localStorage.sideCollapsed) document.body.classList.add('side-collapsed');
  h.addEventListener('pointerdown', (e) => {
    e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.body.classList.add('side-dragging');
    const move = (ev) => { const w = Math.round(ev.clientX); if (w < 120) return; root.style.setProperty('--side-w', Math.min(520, Math.max(200, w)) + 'px'); };
    const up = (ev) => {
      h.removeEventListener('pointermove', move); h.removeEventListener('pointerup', up); h.classList.remove('drag'); document.body.classList.remove('side-dragging');
      if (ev.clientX < 120) { root.style.setProperty('--side-w', (localStorage.sideW || 280) + 'px'); return setSideCollapsed(true); } // dragged nearly shut: collapse
      localStorage.sideW = parseInt(getComputedStyle(root).getPropertyValue('--side-w')) || 280;
    };
    h.addEventListener('pointermove', move); h.addEventListener('pointerup', up);
  });
  h.addEventListener('dblclick', () => { root.style.removeProperty('--side-w'); delete localStorage.sideW; });
})();

// ---------- Bot browser: live preview, like Claude Code desktop ----------
// The bot's own browser (the Browser plugin drives it) streams into the side pane. You can watch it work,
// type an address or a search, and click, scroll and type into the page yourself (e.g. to sign in).
const BR = { bot: null, es: null, ro: null, fitted: false, w: 1280, h: 800, typing: false };
function stopBrowserView() { BR.es?.close(); BR.es = null; BR.bot = null; BR.ro?.disconnect(); BR.ro = null; }
// host: render into this element (a workspace tile) instead of the side pane.
function openBrowser(botId, host = null) {
  if (host) stopBrowserView(); else { closeDoc(); closeInfo(); $('#aside').classList.remove('open'); }
  const b = S.data.bots.find((x) => x.id === botId);
  const el = host || $('#docpane');
  if (!host) el.classList.add('open', 'wide');
  el.innerHTML = `${host ? '<b data-br-title hidden></b>' : `<header class="viewer-head">
      <div class="viewer-title">${ICON.globe}<b data-br-title>${esc(b?.name || 'Bot')}’s browser</b></div>
      <button class="icon-btn" data-br="close" aria-label="Close browser">${ICON.close}</button>
    </header>`}
    <form class="br-bar" data-br-form>
      <button type="button" class="icon-btn" data-br="back" aria-label="Back">${ICON.back}</button>
      <button type="button" class="icon-btn" data-br="forward" aria-label="Forward">${ICON.fwd}</button>
      <button type="button" class="icon-btn" data-br="reload" aria-label="Reload">${ICON.reload}</button>
      <input class="br-url" name="url" placeholder="Search or enter address" aria-label="Search or enter address" autocomplete="off" spellcheck="false">
    </form>
    <div class="viewer-body br-body"><img class="br-screen" alt="Live view of the bot’s browser" tabindex="0" hidden><div class="viewer-wait br-wait">Starting the browser…</div></div>
    ${b?.plugins?.includes('browser') ? '' : `<div class="br-note">${ICON.plug} Turn on the <b>Browser</b> plugin for ${esc(b?.name || 'this bot')} so it can use this browser too.</div>`}`;
  BR.bot = botId; BR.fitted = false;
  const es = BR.es = new EventSource(`/api/bots/${botId}/browser/stream`);
  const img = $('.br-screen', el), url = $('.br-url', el);
  // Size the page to the pane, so it fills it at the right scale (and again when the pane or window resizes).
  let rt = null;
  const fit = () => { const r = $('.br-body', el).getBoundingClientRect(); if (r.width > 50 && r.height > 50) BR.bot && api(`/api/bots/${BR.bot}/browser`, { method: 'POST', body: { action: 'resize', w: r.width, h: r.height, dpr: devicePixelRatio || 1 } }).catch(() => {}); };
  BR.ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(fit, 150); });
  BR.ro.observe($('.br-body', el));
  es.onmessage = (e) => {
    if (BR.es !== es) return;
    const ev = JSON.parse(e.data);
    if (ev.type === 'info' && !BR.fitted) { BR.fitted = true; fit(); }
    if (ev.type === 'frame') { img.src = 'data:image/jpeg;base64,' + ev.data; BR.w = ev.w; BR.h = ev.h; img.hidden = false; $('.br-wait', el)?.remove(); }
    else if (ev.type === 'info') { if (document.activeElement !== url) url.value = ev.url === 'about:blank' ? '' : ev.url; $('[data-br-title]', el).textContent = ev.title && ev.url !== 'about:blank' ? ev.title : `${b?.name || 'Bot'}’s browser`; }
    else if (ev.type === 'error' || ev.type === 'closed') { es.close(); const w = $('.br-wait', el) || $('.br-body', el).appendChild(Object.assign(document.createElement('div'), { className: 'viewer-wait br-wait' })); w.textContent = ev.error || 'The browser closed.'; }
  };
}
const brSend = (body) => BR.bot && api(`/api/bots/${BR.bot}/browser`, { method: 'POST', body }).catch((e) => toast(e.message));
// Pane coordinates → page coordinates.
function brPoint(e, img) { const r = img.getBoundingClientRect(); return { x: Math.round((e.clientX - r.left) * BR.w / r.width), y: Math.round((e.clientY - r.top) * BR.h / r.height) }; }
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-br]');
  if (a) return a.dataset.br === 'close' ? closeDoc() : brSend({ action: a.dataset.br });

});
document.addEventListener('submit', (e) => {
  if (!e.target.matches('[data-br-form]')) return;
  e.preventDefault();
  const u = e.target.url.value.trim(); if (!u) return;
  e.target.url.blur(); brSend({ action: 'navigate', url: u });
});
let brWheel = null;
document.addEventListener('wheel', (e) => {
  if (!e.target.matches?.('.br-screen')) return;
  e.preventDefault();
  if (brWheel) { brWheel.dx += e.deltaX; brWheel.dy += e.deltaY; return; }
  brWheel = { ...brPoint(e, e.target), dx: e.deltaX, dy: e.deltaY };
  setTimeout(() => { brSend({ action: 'scroll', ...brWheel }); brWheel = null; }, 60);
}, { passive: false });
document.addEventListener('keydown', (e) => {
  if (!e.target.matches?.('.br-screen')) return;
  if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[acx]$/i.test(e.key)) {
    e.preventDefault();
    const k = e.key.toLowerCase();
    if (k === 'a') return brSend({ action: 'selectall' });
    return BR.bot && api(`/api/bots/${BR.bot}/browser`, { method: 'POST', body: { action: k === 'c' ? 'copy' : 'cut' } })
      .then((r) => r.text ? clip(r.text).then((ok) => toast(ok ? 'Copied' : 'Your browser blocked the clipboard')) : toast('Nothing selected'))
      .catch((err) => toast(err.message));
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  brSend(e.key.length === 1 ? { action: 'text', text: e.key } : { action: 'key', key: e.key });
});
// Paste into the page.
document.addEventListener('paste', (e) => { if (e.target.matches?.('.br-screen')) { e.preventDefault(); brSend({ action: 'text', text: e.clipboardData.getData('text') }); } });

// Press, drag and release in the pane: clicks, and drag to select text (moves are throttled).
let brDrag = null;
document.addEventListener('pointerdown', (e) => {
  if (!e.target.matches?.('.br-screen') || e.button !== 0) return;
  e.preventDefault(); e.target.focus(); e.target.setPointerCapture(e.pointerId);
  brDrag = { img: e.target, t: 0 };
  brSend({ action: 'mouse', type: 'down', ...brPoint(e, e.target) });
});
document.addEventListener('pointermove', (e) => {
  if (!brDrag || Date.now() - brDrag.t < 50) return;
  brDrag.t = Date.now(); brSend({ action: 'mouse', type: 'move', held: true, ...brPoint(e, brDrag.img) });
});
document.addEventListener('pointerup', (e) => {
  if (!brDrag) return;
  const img = brDrag.img; brDrag = null;
  brSend({ action: 'mouse', type: 'up', ...brPoint(e, img) });
});

// ---------- split panes (like Herdr): several chats side by side ----------
// The layout is a tree: a split {dir:'row'|'col', kids, sizes} or a pane {id, key}. Pane "main" is the normal
// chat view; others are frames of this app (?pane=<id>). Panes are placed absolutely from the tree, so a frame
// never moves in the page (moving it would reload it). Max 4 panes: each keeps a live connection, and browsers
// allow about 6 per server over http.
const PN = { tree: { id: 'main' }, focus: 'main', zoom: null, mainKey: '' };
const PANE_MAX = 4;
const narrow = () => matchMedia('(max-width: 760px)').matches;
const leaves = (n = PN.tree) => n.kids ? n.kids.flatMap((k) => leaves(k)) : [n];
const findParent = (id, n = PN.tree) => { if (!n.kids) return null; for (const k of n.kids) { if (k.id === id) return n; const p = findParent(id, k); if (p) return p; } return null; };
const findLeaf = (id) => leaves().find((l) => l.id === id);
const keyName = (key) => { if (!key) return 'Empty pane'; const t = threadOf(key), r = key.startsWith('room:') ? S.data.rooms.find((x) => 'room:' + x.id === key) : null;
  const b = t ? bot(t.bot_id) : key.startsWith('bot:') ? bot(Number(key.slice(4))) : null; return r ? r.name : b ? b.name + (t ? ' · ' + threadName(t) : '') : key; };

function paneBtns() {
  const multi = EMBED || leaves().length > 1;
  return `<button class="icon-btn" data-act="pane-menu" title="Split pane (${esc(kbLabel(kbGet('split-right')))} right, ${esc(kbLabel(kbGet('split-down')))} down)" aria-label="Split pane">${ICON.split}</button>`
    + (multi ? `<button class="icon-btn" data-act="pane-close" title="Close pane (${esc(kbLabel(kbGet('close')))})" aria-label="Close pane">${ICON.close}</button>` : '');
}
function pickList() {
  const items = [...S.data.bots.map((b) => ({ key: 'bot:' + b.id, html: avatar(b, 26), name: b.name, sub: b.role })), ...S.data.rooms.map((r) => ({ key: 'room:' + r.id, html: roomAvatar(r, 26), name: r.name, sub: `${r.members.length} bots` }))];
  return items.map((i) => `<button class="pane-pick-item" data-open="${i.key}">${i.html}<span><b>${esc(i.name)}</b><small>${esc(i.sub || '')}</small></span></button>`).join('') || '<p class="muted">No bots yet.</p>';
}
// A frame asks its parent; the parent acts.
function paneCmd(cmd, extra = {}) {
  if (EMBED) return parent.postMessage({ nimbusPane: cmd, id: EMBED, ...extra }, location.origin);
  paneDo(cmd, PN.focus, extra);
}
function paneDo(cmd, from, extra = {}) {
  if (from) PN.focus = from;
  if (cmd === 'split-right' || cmd === 'split-down') return paneSplit(narrow() ? 'col' : cmd === 'split-right' ? 'row' : 'col', extra.key || '');
  if (cmd === 'close') return paneClose(PN.focus);
  if (cmd === 'zoom') { PN.zoom = PN.zoom ? null : PN.focus; return panesLayout(); }
  if (cmd === 'focus') return panesLayout();
  if (cmd === 'next' || cmd === 'prev') { const l = leaves(), i = l.findIndex((x) => x.id === PN.focus); PN.focus = l[(i + (cmd === 'next' ? 1 : l.length - 1)) % l.length].id; panesLayout(); return paneFocusEl(); }
  if (cmd === 'menu') return paneMenu(extra.x, extra.y, from);
  if (cmd === 'shortcuts') return shortcutsModal();
  if (cmd === 'sidebar') return innerWidth > 760 && setSideCollapsed(!document.body.classList.contains('side-collapsed'));
}
function paneSplit(dir, key) {
  if (leaves().length >= PANE_MAX) return toast(`Up to ${PANE_MAX} panes at once`);
  const id = 'p' + Date.now().toString(36), leaf = findLeaf(PN.focus) || PN.tree, add = { id, key };
  const par = findParent(leaf.id);
  if (par && par.dir === dir) { const i = par.kids.indexOf(leaf); par.kids.splice(i + 1, 0, add); par.sizes = par.kids.map(() => 1 / par.kids.length); }
  else { const node = { id: leaf.id, key: leaf.key }; Object.keys(leaf).forEach((k) => delete leaf[k]); Object.assign(leaf, { dir, kids: [node, add], sizes: [0.5, 0.5] }); }
  PN.focus = id; PN.zoom = null;
  panesLayout(); panesSave(); renderMain();
}
function paneClose(id) {
  if (leaves().length < 2) return;
  if (id === 'main') { // keep the main view: it takes over the focused frame's chat
    const other = leaves().find((l) => l.id !== 'main'); const k = other.key; paneRemove(other.id); if (k) openThread(k); return;
  }
  paneRemove(id);
}
function paneRemove(id) {
  const par = findParent(id); if (!par) return;
  const i = par.kids.findIndex((k) => k.id === id);
  par.kids.splice(i, 1); par.sizes.splice(i, 1);
  const tot = par.sizes.reduce((a, b) => a + b, 0); par.sizes = par.sizes.map((s) => s / tot);
  if (par.kids.length === 1) { const only = par.kids[0]; Object.keys(par).forEach((k) => delete par[k]); Object.assign(par, only); }
  document.querySelector(`.pane-frame[data-pane="${id}"]`)?.remove();
  if (PN.focus === id || !findLeaf(PN.focus)) PN.focus = 'main';
  if (PN.zoom === id) PN.zoom = null;
  panesLayout(); panesSave(); renderMain();
}
// Clicking a chat in the sidebar opens it in the focused pane.
function paneOpen(key) {
  if (EMBED || PN.focus === 'main' || !findLeaf(PN.focus)) return openThread(key);
  const l = findLeaf(PN.focus); l.key = key;
  const f = document.querySelector(`.pane-frame[data-pane="${l.id}"] iframe`);
  if (f) f.contentWindow.location.hash = key;
  $('#side').classList.remove('open'); panesSave(); panesLayout();
}
function paneMainKey(key) { PN.mainKey = key; }
function paneFocusEl() { const f = document.querySelector(`.pane-frame[data-pane="${PN.focus}"] iframe`); (f ? f.contentWindow : window).focus(); }

function panesLayout() {
  const root = $('#panes'), multi = leaves().length > 1;
  document.body.classList.toggle('split', multi);
  root.querySelectorAll('.pane-div').forEach((d) => d.remove());
  const place = (el, r) => Object.assign(el.style, { left: r.x * 100 + '%', top: r.y * 100 + '%', width: r.w * 100 + '%', height: r.h * 100 + '%' });
  const walk = (n, r) => {
    if (!n.kids) {
      let el = n.id === 'main' ? $('#main') : root.querySelector(`.pane-frame[data-pane="${n.id}"]`);
      if (!el) { el = document.createElement('div'); el.className = 'pane-frame'; el.dataset.pane = n.id;
        el.innerHTML = `<iframe src="/?pane=${n.id}${n.key ? '#' + n.key : ''}" title="${esc(keyName(n.key))}"></iframe>`; root.append(el); }
      if (!multi) { el.removeAttribute('style'); el.classList.remove('pane-focus'); return; }
      const z = PN.zoom && findLeaf(PN.zoom);
      place(el, z ? { x: 0, y: 0, w: 1, h: 1 } : r);
      el.hidden = !!(z && PN.zoom !== n.id);
      el.classList.toggle('pane-focus', PN.focus === n.id);
      return;
    }
    let off = 0;
    n.kids.forEach((k, i) => {
      const s = n.sizes[i], kr = n.dir === 'row' ? { x: r.x + off * r.w, y: r.y, w: s * r.w, h: r.h } : { x: r.x, y: r.y + off * r.h, w: r.w, h: s * r.h };
      walk(k, kr); off += s;
      if (i < n.kids.length - 1 && !PN.zoom) {
        const d = document.createElement('div'); d.className = 'pane-div ' + n.dir;
        place(d, n.dir === 'row' ? { x: r.x + off * r.w, y: r.y, w: 0, h: r.h } : { x: r.x, y: r.y + off * r.h, w: r.w, h: 0 });
        d.addEventListener('pointerdown', (e) => paneDrag(e, n, i, r));
        root.append(d);
      }
    });
  };
  walk(PN.tree, { x: 0, y: 0, w: 1, h: 1 });
}
function paneDrag(e, n, i, r) {
  e.preventDefault(); document.body.classList.add('pane-drag');
  const box = $('#panes').getBoundingClientRect(), pair = n.sizes[i] + n.sizes[i + 1];
  const start = n.sizes.slice(0, i).reduce((a, b) => a + b, 0);
  const move = (ev) => {
    const f = n.dir === 'row' ? ((ev.clientX - box.left) / box.width - r.x) / r.w : ((ev.clientY - box.top) / box.height - r.y) / r.h;
    const a = Math.max(0.12, Math.min(pair - 0.12, f - start)); n.sizes[i] = a; n.sizes[i + 1] = pair - a; panesLayout();
  };
  const up = () => { document.body.classList.remove('pane-drag'); removeEventListener('pointermove', move); removeEventListener('pointerup', up); panesSave(); };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
function panesSave() { localStorage.panes = leaves().length > 1 ? JSON.stringify(PN.tree) : ''; }
function panesRestore() {
  try { const t = JSON.parse(localStorage.panes || 'null'); if (t?.kids && leaves(t).some((l) => l.id === 'main') && leaves(t).length <= PANE_MAX) PN.tree = t; } catch {}
  if (narrow() && leaves().length > 2) PN.tree = { id: 'main' };
  panesLayout(); if (leaves().length > 1) renderMain();
}
function paneMenu(x, y, from) {
  closePopover();
  const el = document.createElement('div'); el.className = 'popover';
  const multi = leaves().length > 1;
  el.innerHTML = `${narrow() ? '' : `<button data-pn="split-right">${ICON.split}<span>Split right</span><kbd>${esc(kbLabel(kbGet('split-right')))}</kbd></button>`}
    <button data-pn="split-down">${ICON.split}<span>Split down</span><kbd>${esc(kbLabel(kbGet('split-down')))}</kbd></button>
    ${multi ? `<button data-pn="zoom">${ICON.grid}<span>${PN.zoom ? 'Show all panes' : 'Zoom this pane'}</span><kbd>${esc(kbLabel(kbGet('zoom')))}</kbd></button>
    <button data-pn="next">${ICON.chevron}<span>Next pane</span><kbd>${esc(kbLabel(kbGet('next')))}</kbd></button>
    <button data-pn="close">${ICON.close}<span>Close pane</span><kbd>${esc(kbLabel(kbGet('close')))}</kbd></button>` : ''}`;
  document.body.append(el);
  const fr = from && from !== 'main' ? document.querySelector(`.pane-frame[data-pane="${from}"]`)?.getBoundingClientRect() : null;
  const px = (fr?.left || 0) + x, py = (fr?.top || 0) + y;
  el.style.left = Math.max(8, Math.min(px - el.offsetWidth, innerWidth - el.offsetWidth - 8)) + 'px';
  el.style.top = Math.max(8, Math.min(py, innerHeight - el.offsetHeight - 8)) + 'px';
  el.insertAdjacentHTML('beforeend', `<button data-pn="shortcuts">${ICON.keyboard}<span>Keyboard shortcuts</span><kbd>${esc(kbLabel(kbGet('shortcuts')))}</kbd></button>`);
  el.addEventListener('click', (ev) => { const b = ev.target.closest('[data-pn]'); if (!b) return; closePopover(); paneDo(b.dataset.pn, from); });
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act="pane-menu"], [data-act="pane-close"]'); if (!a) return;
  e.stopPropagation();
  const r = a.getBoundingClientRect();
  if (a.dataset.act === 'pane-close') return paneCmd('close');
  if (EMBED) paneCmd('menu', { x: r.right, y: r.bottom + 4 }); else paneDo('menu', 'main', { x: r.right, y: r.bottom + 4 });
}, true);
if (EMBED) {
  // Tell the parent which pane you're using, so the sidebar and shortcuts act on it.
  addEventListener('pointerdown', () => parent.postMessage({ nimbusPane: 'focus', id: EMBED }, location.origin), true);
  addEventListener('focusin', () => parent.postMessage({ nimbusPane: 'focus', id: EMBED }, location.origin), true);
} else {
  addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data?.nimbusPane || !findLeaf(e.data.id)) return;
    const { nimbusPane: cmd, id } = e.data;
    if (cmd === 'key') { findLeaf(id).key = e.data.key; panesSave(); return; }
    if (cmd === 'focus') { if (PN.focus !== id) { PN.focus = id; panesLayout(); } return; }
    paneDo(cmd, id, e.data);
  });
  $('#main').addEventListener('pointerdown', () => { if (PN.focus !== 'main') { PN.focus = 'main'; panesLayout(); } }, true);
  matchMedia('(max-width: 760px)').addEventListener('change', () => panesLayout());
}

// ---------- keyboard shortcuts: cheat sheet + your own bindings ----------
// Saved per browser/device (localStorage), so each person and each device can have their own.
// A binding is "Ctrl+Alt+Shift+Meta+<KeyboardEvent.code>" (code = the physical key, so layouts don't matter).
const KB = [
  ['split-right', 'Split pane right', 'Ctrl+Alt+Backslash'], ['split-down', 'Split pane down', 'Ctrl+Alt+Minus'],
  ['close', 'Close pane', 'Ctrl+Alt+KeyW'], ['zoom', 'Zoom pane / show all', 'Ctrl+Alt+Enter'],
  ['next', 'Next pane', 'Ctrl+Alt+ArrowRight'], ['prev', 'Previous pane', 'Ctrl+Alt+ArrowLeft'],
  ['sidebar', 'Show / hide the sidebar', 'Ctrl+KeyB'], ['shortcuts', 'Keyboard shortcuts', 'Ctrl+Slash'],
  ['new-thread', 'New thread', 'Ctrl+Alt+KeyN'], ['next-chat', 'Next chat', 'Alt+ArrowDown'], ['prev-chat', 'Previous chat', 'Alt+ArrowUp'],
  ['settings', 'Settings', 'Ctrl+Comma'], ['search', 'Search messages', 'Ctrl+Shift+KeyF']
];
const kbMine = () => { try { return JSON.parse(localStorage.keybinds || '{}'); } catch { return {}; } };
function kbGet(act) { const m = kbMine(); return act in m ? m[act] : KB.find((k) => k[0] === act)?.[2] || ''; }
const comboOf = (e) => ['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => e[m.toLowerCase() + 'Key']).concat(e.code).join('+');
const KEYNAME = { Backslash: '\\', Minus: '-', Equal: '=', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`',
  ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', Escape: 'Esc', Tab: 'Tab', Backspace: 'Backspace' };
function kbLabel(c) {
  if (!c) return 'none';
  return c.split('+').map((p) => KEYNAME[p] || p.replace(/^Key|^Digit|^Numpad/, '').replace('Meta', /Mac/.test(navigator.platform) ? '⌘' : 'Win')).join('+');
}
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.altKey || e.metaKey) || /^(Control|Alt|Shift|Meta)/.test(e.code) || $('.kb-rec')) return;
  const c = comboOf(e), hit = KB.find(([act]) => kbGet(act) === c);
  if (!hit) return;
  if (hit[0] === 'sidebar' && e.target.closest?.('[contenteditable="true"]')) return; // Ctrl+B is bold in the editor
  e.preventDefault(); e.stopPropagation();
  if (hit[0] === 'shortcuts') return EMBED ? paneCmd('shortcuts') : shortcutsModal();
  if (hit[0] === 'settings') return openSettings();
  if (hit[0] === 'search') return searchPage();
  if (hit[0] === 'new-thread') return $('[data-act="new-thread"]')?.click();
  if (hit[0] === 'next-chat' || hit[0] === 'prev-chat') {
    const list = [...document.querySelectorAll('#side .side-item[data-open]')]; if (!list.length) return;
    const i = list.findIndex((x) => x.classList.contains('active'));
    const n = list[(i + (hit[0] === 'next-chat' ? 1 : list.length - 1)) % list.length]; n.click(); n.scrollIntoView({ block: 'nearest' }); return;
  }
  if (hit[0] === 'sidebar') return EMBED ? paneCmd('sidebar') : (innerWidth > 760 && setSideCollapsed(!document.body.classList.contains('side-collapsed')));
  paneCmd(hit[0]);
}, true);
function shortcutsModal() {
  const fixed = [['Send message', 'Enter'], ['New line', 'Shift+Enter'], ['Close a menu or window', 'Esc']];
  const el = modal(`<h3>${ICON.keyboard} Keyboard shortcuts</h3>
    <p class="muted">Click a shortcut to change it, then press the new keys (with Ctrl, Alt or ${/Mac/.test(navigator.platform) ? '⌘' : 'Win'}). Saved on this device.</p>
    <div class="kb-list">${KB.map(([act, name]) => `<div class="kb-row"><span>${esc(name)}</span>
      <button class="kb-key" data-kb="${act}" title="Change">${esc(kbLabel(kbGet(act)))}</button>
      <button class="icon-btn kb-clear" data-kb-clear="${act}" title="Turn off" aria-label="Turn off">${ICON.close}</button></div>`).join('')}
      ${fixed.map(([n, k]) => `<div class="kb-row fixed"><span>${n}</span><kbd>${k}</kbd></div>`).join('')}</div>
    <div class="row"><button class="btn" data-kb-reset>Reset to defaults</button><button class="btn primary" data-kb-done>Done</button></div>`, { cls: 'kb-modal' });
  const save = (act, c) => { const m = kbMine(), def = KB.find((k) => k[0] === act)[2]; if (c === def) delete m[act]; else m[act] = c; localStorage.keybinds = JSON.stringify(m); };
  el.addEventListener('click', (ev) => {
    const t = ev.target.closest('button'); if (!t) return;
    if (t.dataset.kbDone !== undefined) return closeModal();
    if (t.dataset.kbReset !== undefined) { delete localStorage.keybinds; renderSide?.(); return shortcutsModal(); }
    if (t.dataset.kbClear) { save(t.dataset.kbClear, ''); return shortcutsModal(); }
    if (!t.dataset.kb) return;
    el.querySelector('.kb-rec')?.classList.remove('kb-rec');
    t.classList.add('kb-rec'); t.textContent = 'Press keys…';
    const rec = (e) => {
      if (/^(Control|Alt|Shift|Meta)/.test(e.code)) return;
      e.preventDefault(); e.stopPropagation(); removeEventListener('keydown', rec, true);
      if (e.key === 'Escape') return shortcutsModal();
      if (!(e.ctrlKey || e.altKey || e.metaKey)) { toast('Use Ctrl, Alt or ' + (/Mac/.test(navigator.platform) ? '⌘' : 'Win') + ' with a key'); return shortcutsModal(); }
      const c = comboOf(e), clash = KB.find(([a]) => a !== t.dataset.kb && kbGet(a) === c);
      if (clash) save(clash[0], ''); // a key does one thing: the old action loses it
      save(t.dataset.kb, c);
      if (clash) toast(`Moved from “${clash[1]}” (now off)`);
      shortcutsModal();
    };
    addEventListener('keydown', rec, true);
  });
}


// ---------- unread ----------
// A chat is unread when a bot (not you) wrote in it after you last had it open. Remembered per device.
let SIDE_ITEMS = [];
const SEEN = (() => { try { return JSON.parse(localStorage.seen || '{}'); } catch { return {}; } })();
function markSeen(k, at) { if ((SEEN[k] || 0) < at) { SEEN[k] = at; clearTimeout(markSeen.t); markSeen.t = setTimeout(() => { localStorage.seen = JSON.stringify(SEEN); }, 500); } }
const isActiveItem = (it, key) => key === it.key || (it.bot && S.current?.type === 'bot' && S.current.id === it.bot.id);
function isUnread(it) {
  if (!it.last || it.last.author === 'user' || isActiveItem(it, threadKey())) return false;
  if (!(it.key in SEEN)) { SEEN[it.key] = it.last.at; return false; } // first visit on this device: nothing is "new"
  return it.last.at > SEEN[it.key];
}
const homeCount = () => (S.data?.approvals.length || 0) + SIDE_ITEMS.filter(isUnread).length;

// ---------- Home ----------
function openHome() {
  const prev = threadKey(); if (prev) sessionDraft.set(prev, $('#msg')?.value || '');
  if (BR.bot) closeDoc();
  S.current = null; S.home = true; S.messages = []; CM.draft = null; setCodeMode(false);
  history.replaceState(null, '', '#home');
  if (!EMBED) paneMainKey?.('home');
  renderSide(); renderMain();
}
function greeting() { const h = new Date().getHours(); return h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function renderHome() {
  const d = S.data, first = (userName() === 'You' ? '' : userName()).split(/[\s.@]/)[0];
  const working = d.bots.filter((b) => b.status.state !== 'idle');
  const unread = SIDE_ITEMS.filter(isUnread);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const ranToday = d.routines.filter((r) => r.last_run && r.last_run * 1000 >= today.getTime()).sort((a, b) => b.last_run - a.last_run);
  const card = (title, body, extra = '') => `<section class="home-card ${extra}"><h3>${title}</h3>${body}</section>`;
  const row = (key, av, top, sub, right = '') => `<button class="home-row" data-open="${esc(key)}">${av}<span class="hr-meta"><b>${top}</b><small>${sub}</small></span>${right}</button>`;
  const recent = SIDE_ITEMS.filter((it) => it.last).slice(0, 6);
  return `<header class="head"><button class="icon-btn menu-btn" data-act="menu" aria-label="Menu">${ICON.menu}</button><b class="home-title">Home</b>
      <div class="actions" style="margin-left:auto"><button class="btn small" data-act="palette" title="Jump anywhere">${ICON.search}<span>Jump to…</span><kbd>Ctrl K</kbd></button></div></header>
    <div class="thread home"><div class="home-inner">
      <h1 class="home-hi">${greeting()}${first ? ', ' + esc(first) : ''}.</h1>
      <p class="home-sub">${working.length ? `${working.length} bot${working.length === 1 ? ' is' : 's are'} working` : 'All your bots are idle'}${d.approvals.length ? ` · <b>${d.approvals.length} waiting for you</b>` : ''}${unread.length ? ` · ${unread.length} unread` : ''}.</p>
      <form class="home-ask" id="home-ask" autocomplete="off">
        <select id="home-bot" aria-label="Bot">${d.bots.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join('')}</select>
        <input id="home-q" placeholder="Ask a bot something…" aria-label="Message">
        <button class="btn primary" data-act="home-ask" type="submit">Send</button>
      </form>
      <div class="home-grid">
        ${d.approvals.length ? card(`${ICON.lock} Needs you`, d.approvals.map((a) => row(a.thread, avatar(bot(a.bot_id), 30), esc(bot(a.bot_id)?.name || 'Bot'), esc(describeTool(a.tool, a.input)), `<span class="muted">${timeAgo(a.created_at)}</span>`)).join(''), 'urgent') : ''}
        ${card('Working now', working.length ? working.map((b) => row('bot:' + b.id, avatar(b, 30), esc(b.name), esc(b.status.label || 'Working…'), '<span class="dot working"></span>')).join('') : '<div class="muted">Nobody is busy. Ask something above.</div>')}
        ${card('Unread', unread.length ? unread.map((it) => row(it.key, it.av, esc(it.name), esc(it.last.text), `<span class="muted">${stamp(it.last.at)}</span>`)).join('') : '<div class="muted">You’re all caught up.</div>')}
        ${card('Routines today', (ranToday.length ? ranToday.map((r) => row('bot:' + r.bot_id, avatar(bot(r.bot_id), 30), esc(bot(r.bot_id)?.name || 'Bot'), esc(r.prompt.slice(0, 80)), `<span class="muted">ran ${clock(r.last_run)}</span>`)).join('') : '<div class="muted">Nothing has run yet today.</div>')
          + (d.upNext.length ? `<div class="home-next">Next: ${d.upNext.slice(0, 3).map((r) => `<span>${whenNext(r.next)} · ${esc(bot(r.bot_id)?.name || '')}</span>`).join('')}</div>` : ''))}
        <section class="home-card wide" id="home-digest"><h3>Since yesterday</h3><div class="muted">Loading…</div></section>
        ${d.proxmox ? `<section class="home-card wide" id="home-pve">${pveHomeHtml(pveLast)}</section>` : ''}
        ${card('Recent chats', recent.map((it) => row(it.key, it.av, esc(it.name), esc((it.last.author === 'user' ? 'You: ' : '') + it.last.text), `<span class="muted">${stamp(it.last.at)}</span>`)).join('') || '<div class="muted">No chats yet.</div>', 'wide')}
      </div>
    </div></div>`;
}
async function homeAsk() {
  const id = Number($('#home-bot')?.value), text = $('#home-q')?.value.trim();
  if (!id || !text) return $('#home-q')?.focus();
  try { await api(`/api/threads/${encodeURIComponent('bot:' + id)}/messages`, { method: 'POST', body: { text } }); openThread('bot:' + id); }
  catch (e) { toast(e.message); }
}
document.addEventListener('submit', (e) => { if (e.target.id === 'home-ask') { e.preventDefault(); homeAsk(); } });

// ---------- Ctrl+K: jump anywhere ----------
function paletteItems() {
  const d = S.data, out = [['home', 'Home', 'Go', ICON.home]];
  for (const b of d.bots) out.push(['open:bot:' + b.id, b.name, 'Bot', avatar(b, 20)]);
  for (const r of d.rooms) out.push(['open:room:' + r.id, r.name, 'Group chat', roomAvatar(r, 20)]);
  for (const t of d.threads || []) if (t.kind === 'chat' && !t.archived) out.push(['open:t:' + t.id, t.title || 'New thread', `Thread · ${bot(t.bot_id)?.name || ''}`, TI.chat]);
  const cur = bot(S.current?.id);
  if (cur && S.current?.type === 'bot') out.push(['new-thread', `New thread with ${cur.name}`, 'Action', ICON.compose], ['routines', `${cur.name}’s routines`, 'Action', ICON.clock],
    ['memory', `${cur.name}’s memory`, 'Action', ICON.book], ['plugins', `${cur.name}’s plugins`, 'Action', ICON.plug], ['edit-bot', `${cur.name} settings`, 'Action', ICON.gear], ['voice', `Voice chat with ${cur.name}`, 'Action', ICON.voice]);
  out.push(['new-bot', 'New bot', 'Action', ICON.plus], ['new-room', 'New group chat', 'Action', ICON.plus], ['docs', 'Documents', 'Open', ICON.book], ['map', 'Homelab map', 'Open', ICON.monitor], ['office', 'Bot office', 'Open', ICON.home], ['set:backups', 'Backups', 'Open', ICON.box], ['set:autoapprove', 'Auto-approve', 'Open', ICON.check], ['set:skills', 'Skills', 'Open', ICON.box], ['set:connectors', 'Custom connectors (MCP)', 'Open', ICON.plug], ['set:dream', 'Self-review', 'Open', ICON.book], ['voice-mode', 'Voice mode', 'Action', ICON.wave], ['set:ipmap', 'IP map', 'Open', ICON.globe], ['set:logs', 'Search logs', 'Open', ICON.search], ['set:journal', 'Change journal', 'Open', ICON.clock],
    ['appearance', 'Appearance and themes', 'Settings', ICON.gear], ['server', 'Server settings', 'Settings', ICON.monitor], ['log', 'Activity log', 'Open', ICON.clock],
    ['market', 'Connectors', 'Open', ICON.grid], ['cc-plugins', 'Plugins & skills', 'Open', ICON.plug], ['shortcuts', 'Keyboard shortcuts', 'Help', ICON.keyboard], ['panel', 'Approvals and activity', 'Open', ICON.bell]);
  return out;
}
function openPalette() {
  if (document.querySelector('.palette')) return;
  modal(`<div class="palette"><label class="search pal-search">${ICON.search}<input id="pal-q" placeholder="Jump to a bot, thread or action…" autocomplete="off"></label><div class="pal-list" id="pal-list"></div>
    <div class="pal-hint">↑↓ to move · Enter to open · Esc to close · type 2+ letters to also search messages</div></div>`, { cls: 'pal-modal' });
  const items = paletteItems(); let sel = 0, shown = items, hits = [], seq = 0;
  const draw = () => {
    const all = [...shown.slice(0, 40), ...hits];
    sel = Math.max(0, Math.min(sel, all.length - 1));
    $('#pal-list').innerHTML = all.length ? all.map(([act, label, kind, icon], i) => `<button class="pal-item ${i === sel ? 'sel' : ''}" data-pal="${esc(act)}">${icon || ''}<span class="pal-label">${esc(label)}</span><small>${esc(kind)}</small></button>`).join('') : '<div class="muted pal-empty">Nothing matches</div>';
    $('#pal-list .sel')?.scrollIntoView({ block: 'nearest' });
  };
  const run = (act) => {
    closeModal();
    if (act.startsWith('open:')) return openThread(act.slice(5));
    if (act.startsWith('set:')) return openSettings(act.slice(4));
    const b = document.createElement('button'); b.dataset.act = act; b.style.display = 'none'; document.body.append(b); b.click(); b.remove();
  };
  const q = $('#pal-q');
  q.addEventListener('input', async () => {
    const v = q.value.trim().toLowerCase(), words = v.split(/\s+/).filter(Boolean);
    shown = !v ? items : items.map((it) => [it, it[1].toLowerCase()]).filter(([, l]) => words.every((w) => l.includes(w)))
      .sort((a, b) => (b[1].startsWith(words[0]) - a[1].startsWith(words[0]))).map(([it]) => it);
    hits = []; sel = 0; draw();
    if (v.length >= 2) { const my = ++seq; try { const r = await api('/api/search?q=' + encodeURIComponent(v)); if (my !== seq) return;
      hits = r.results.slice(0, 8).map((m) => ['open:' + m.thread, m.snippet, `Message · ${m.author === 'user' ? 'You' : bot(Number(m.author))?.name || ''}`, ICON.search]); draw(); } catch {} }
  });
  q.addEventListener('keydown', (e) => {
    const n = shown.slice(0, 40).length + hits.length;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = (sel + 1) % Math.max(1, n); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = (sel - 1 + n) % Math.max(1, n); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const el = $('#pal-list .sel'); if (el) run(el.dataset.pal); }
  });
  $('#pal-list').addEventListener('click', (e) => { const b = e.target.closest('[data-pal]'); if (b) run(b.dataset.pal); });
  draw(); q.focus();
}
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (document.querySelector('.palette')) closeModal(); else openPalette(); }
});
document.addEventListener('click', (e) => { const b = e.target.closest('[data-bt]'); if (b) toggleBotTile(b.dataset.bt); });
// Same shortcuts as Claude Code desktop: Ctrl+` terminal, Ctrl+Shift+B browser (Nimbus Code threads).
document.addEventListener('keydown', (e) => {
  if (!codeProject(threadKey()) || !(e.ctrlKey || e.metaKey)) return;
  const k = e.key === '`' ? 'terminal' : e.shiftKey && e.key.toLowerCase() === 'b' ? 'preview' : null;
  if (k) { e.preventDefault(); toggleBotTile(k); }
});

// Starter prompts in an empty chat fill the message box.
document.addEventListener('click', (e) => { const b = e.target.closest('[data-starter]'); if (!b) return; const ta = $('#msg'); if (ta) { ta.value = b.dataset.starter; ta.focus(); autosize(ta); } });
// ? opens the shortcuts sheet (when not typing).
document.addEventListener('keydown', (e) => { if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); shortcutsModal(); } });
// Activity panel filter (remembered per device).
document.addEventListener('click', (e) => { const b = e.target.closest('[data-af]'); if (!b) return; localStorage.asideF = b.dataset.af; applyAsideFilter(); });
function applyAsideFilter() { const f = localStorage.asideF || 'all'; document.querySelectorAll('#aside [data-af]').forEach((b) => b.classList.toggle('on', b.dataset.af === f)); document.querySelectorAll('#aside section').forEach((sec) => { sec.hidden = f !== 'all' && sec.dataset.afSec !== f && !(f === 'sys' && !sec.dataset.afSec && /Usage/.test(sec.textContent.slice(0, 40))); }); }
new MutationObserver(() => applyAsideFilter()).observe(document.getElementById('aside') || document.body, { childList: true });

// ---------- Settings: one window, every setting in it ----------
const SET_NAV = [
  ['General', [['language', 'Language', ICON.globe, () => languageModal()], ['notify', 'Notifications', ICON.bell, () => notifyPane()], ['shortcuts', 'Keyboard shortcuts', ICON.keyboard, () => shortcutsModal()]]],
  ['Look', [['appearance', 'Appearance', ICON.gear, () => appearanceModal()]]],
  ['Account', [['claude', 'Claude account', ICON.plug, () => claudeModal()], ['mfa', 'Two-factor sign-in', ICON.lock, () => mfaModal()]]],
  ['Server', [['server', 'Server settings', ICON.monitor, () => serverModal()], ['status', 'System status', ICON.monitor, () => statusPage()], ['usage', 'Usage history', ICON.clock, () => usagePage()], ['log', 'Activity log', ICON.clock, () => activityLogModal()]]],
  ['Homelab', [['backups', 'Backups', ICON.box, () => backupsPage()], ['ipmap', 'IP map', ICON.globe, () => ipMapPage()], ['logs', 'Logs', ICON.search, () => logsPage()], ['journal', 'Change journal', ICON.clock, () => journalPage()], ['hmap', 'Homelab map', ICON.monitor, () => { closeModal(true); setTimeout(() => mapPage(() => openSettings('backups')), 50); }], ['office', 'Bot office', ICON.home, () => { closeModal(true); setTimeout(() => officePage(() => openSettings('backups')), 50); }]]],
  ['AI tools', [['autoapprove', 'Auto-approve', ICON.check, () => autoApprovePage()], ['dream', 'Self-review', ICON.book, () => dreamPage()], ['skills', 'Skills', ICON.box, () => skillsPage()], ['connectors', 'Custom connectors', ICON.plug, () => connectorsPage()]]],
  ['Automation', [['routing', 'Model routing', ICON.plug, () => routingPage()], ['watchdog', 'Watchdog', ICON.monitor, () => watchdogPage()], ['playbooks', 'Playbooks', ICON.check, () => playbooksPage()], ['handoffs', 'Hand-offs', ICON.plug, () => chainsPage()], ['facts', 'Team memory', ICON.book, () => factsPage()], ['budgets', 'Budgets', ICON.clock, () => budgetsPage()]]],
  ['Help', [['new', 'What’s new', ICON.book, () => whatsNew()], ['docs', 'Documents', ICON.book, () => docsModal()], ['tour', 'Take the tour', ICON.home, () => { closeModal(true); setTimeout(() => tour(), 200); }]]],
];
function notifyPane() {
  const st = !('Notification' in window) ? 'This browser doesn’t support notifications.' : !window.isSecureContext ? 'Notifications need HTTPS (see the README).' : Notification.permission === 'granted' ? 'On: you get a notification when a bot needs approval.' : Notification.permission === 'denied' ? 'Blocked in this browser’s site settings.' : 'Off on this device.';
  const el = modal(`<h3>${ICON.bell} Notifications</h3><p class="muted">${st}</p>${'Notification' in window && window.isSecureContext && Notification.permission === 'default' ? '<div class="row"><button class="btn primary" id="np-on">Turn on</button></div>' : ''}`);
  el.querySelector('#np-on')?.addEventListener('click', () => Notification.requestPermission().then(() => notifyPane()));
}
function openSettings(key = (['hmap', 'office'].includes(localStorage.setKey) ? 'backups' : localStorage.setKey) || 'appearance', render = null) {
  closeModal(true);
  setTimeout(() => {
    const el = modal(`<div class="set-wrap"><nav class="set-nav" aria-label="Settings"><div class="set-title"><b>Settings</b><button class="icon-btn" data-set-close aria-label="Close">${ICON.close}</button></div>
      ${SET_NAV.map(([g, items]) => `<small>${g}</small>${items.map(([k, l, ic]) => `<button data-set="${k}">${ic}<span>${l}</span></button>`).join('')}`).join('')}
      <button class="set-out" data-set-logout>${ICON.close}<span>Log out</span></button></nav><div class="set-body" id="set-body"></div></div>`, { wide: true, cls: 'set-modal' });
    const go = (k, fn = null) => {
      const item = SET_NAV.flatMap(([, i]) => i).find((i) => i[0] === k) || SET_NAV[1][1][0];
      if (!['hmap', 'office'].includes(item[0])) localStorage.setKey = item[0];
      el.querySelectorAll('[data-set]').forEach((b) => b.classList.toggle('on', b.dataset.set === item[0]));
      MODAL_HOST = el.querySelector('#set-body'); MODAL_HOST.innerHTML = '<p class="muted">Loading…</p>';
      (fn || item[3])();
    };
    el.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-set]'); if (b) return go(b.dataset.set);
      if (e.target.closest('[data-set-close]')) return closeModal(true);
      if (e.target.closest('[data-set-logout]')) { await api('/api/logout', { method: 'POST' }); location.href = '/login'; }
    });
    SET_GO = (k) => go(k); go(key, render);
  }, 0);
}

// Shared with the feature modules (docedit.js, ...).
export { $, ART, ED, ICON, JUST, S, V, api, applyTheme, avatar, bot, buzz, clip, closeInfo, closeModal, connect, copyText, describeTool, download, esc, fmtSize, getPrefs, md, modal, openThread, refreshState, renderMain, stamp, stopBrowserView, stopEditor, svg, timeAgo, toast, userName };
