// Interface language. The app is written in English; when another language is picked, this watches the page
// and swaps interface text (buttons, menus, labels, hints, tooltips) for translations made on the server by
// Argos Translate (offline, no Claude usage). Translations are cached on the server and on this device.
// Chat messages, documents, names and anything you type are never touched.
export const LANGS = [['', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['pt', 'Português'], ['it', 'Italiano'],
  ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['uk', 'Українська'],
  ['ja', '日本語'], ['zh', '中文'], ['ko', '한국어'], ['hi', 'हिन्दी'], ['vi', 'Tiếng Việt'], ['id', 'Bahasa Indonesia']];
export const LANG_NAMES = { es: 'Spanish', fr: 'French', de: 'German', pt: 'Portuguese', it: 'Italian', nl: 'Dutch', pl: 'Polish', sv: 'Swedish', tr: 'Turkish',
  ru: 'Russian', uk: 'Ukrainian', ja: 'Japanese', zh: 'Chinese', ko: 'Korean', hi: 'Hindi', vi: 'Vietnamese', id: 'Indonesian' };

const SKIP = '.bubble, .msg-body, .md, pre, code, textarea, input, select option[data-raw], [contenteditable], .side-item .name, .side-item .sub, .side-hit, .head .title, .ctx-title, .voice-said, .voice-name, .doc-view, .doc-body, .trace, .no-i18n, script, style';
const ATTRS = ['title', 'placeholder', 'aria-label'];
const lang = () => localStorage.lang || '';
let names = () => [];
export function setI18nNames(fn) { names = fn; }
let dict = {}, missing = new Set(), timer = null, applying = false;
const done = new WeakMap(); // node -> { en, out } so we know what we wrote

export function uiLang() { return lang(); }
export function setUiLang(code) { if (code) localStorage.lang = code; else delete localStorage.lang; location.reload(); }

const wanted = (s) => s.length > 1 && s.length < 400 && /\p{L}{2}/u.test(s) && !/^(https?:|\/|[\w.-]+@)/.test(s);
// Numbers become {#} so "37% left" and "38% left" share one translation.
function lookup(en) {
  if (names().includes(en)) return null; // a bot, chat or project name on its own
  const nums = [], key = en.replace(/\d+(?:[.,:]\d+)*/g, (m) => { nums.push(m); return '{#}'; });
  const out = dict[key];
  if (out !== undefined) return nums.length ? out.replace(/\{#\}/g, () => nums.shift() ?? '') : out;
  missing.add(key); clearTimeout(timer); timer = setTimeout(fetchMissing, 250);
  return null;
}
function doText(node) {
  const p = node.parentElement;
  if (!p || p.closest(SKIP)) return;
  const prev = done.get(node);
  if (prev && node.data === prev.out) return; // ours
  const raw = node.data, en = raw.trim();
  if (!wanted(en)) return;
  const out = lookup(en);
  if (out == null) return;
  const lead = raw.match(/^\s*/)[0], tail = raw.match(/\s*$/)[0];
  done.set(node, { en, out: lead + out + tail });
  node.data = lead + out + tail;
}
function doAttrs(el) {
  if (el.closest(SKIP + ', .no-i18n')) { if (!el.matches('input, textarea')) return; }
  for (const a of ATTRS) {
    const v = el.getAttribute(a); if (!v) continue;
    const key = 'i18n-' + a, mine = el.dataset[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())];
    if (mine && v === mine) continue;
    const en = v.trim(); if (!wanted(en)) continue;
    const out = lookup(en); if (out == null) continue;
    el.dataset[key.replace(/-(\w)/g, (_, c) => c.toUpperCase())] = out;
    el.setAttribute(a, out);
  }
}
function walk(root) {
  if (root.nodeType === 3) return doText(root);
  if (root.nodeType !== 1) return;
  doAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? doText(n) : doAttrs(n);
}
function run(fn) { applying = true; try { fn(); } finally { applying = false; } }

async function fetchMissing() {
  const texts = [...missing].slice(0, 40); missing = new Set([...missing].slice(40));
  if (!texts.length) return;
  try {
    const r = await fetch(`/api/i18n/${lang()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texts, keep: names().filter((n) => n && texts.some((t) => t.includes(n))) }) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    Object.assign(dict, d.translations);
    try { localStorage['i18n.' + lang()] = JSON.stringify(dict); } catch {}
    run(() => walk(document.body));
  } catch { /* translation service not ready: stay in English */ }
  if (missing.size) timer = setTimeout(fetchMissing, 250);
}

export async function startI18n() {
  const code = lang(); if (!code) return;
  document.documentElement.lang = code;
  try { dict = JSON.parse(localStorage['i18n.' + code] || '{}'); } catch { dict = {}; }
  const obs = new MutationObserver((list) => {
    if (applying) return;
    run(() => { for (const m of list) {
      if (m.type === 'childList') m.addedNodes.forEach(walk);
      else if (m.type === 'characterData') doText(m.target);
      else if (m.type === 'attributes') doAttrs(m.target);
    } });
  });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  run(() => walk(document.body));
  try { // the server's full cache (shared by everyone on this server)
    const d = await (await fetch(`/api/i18n/${code}`)).json();
    if (d.translations) { dict = { ...d.translations, ...dict }; Object.assign(dict, d.translations); try { localStorage['i18n.' + code] = JSON.stringify(dict); } catch {} run(() => walk(document.body)); }
  } catch {}
}
