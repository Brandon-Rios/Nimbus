// Live documents: the in-page editor (moved out of app.js). App helpers come from app.js; listeners are
// registered by initDocEditor(), which app.js calls where this code used to be so handler order is unchanged.
import { $, ART, ED, ICON, S, V, api, bot, closeInfo, closeModal, copyText, download, esc, md, modal, stopBrowserView, stopEditor, svg, timeAgo, toast, userName } from './app.js';

// ---------- live documents (in-page editor) ----------
// A document is a list of blocks with stable ids (see docs.js). You type straight into the page: each block is
// editable in place and saves itself (as Markdown, guarded by the hash you started from) a moment after you stop
// typing or when you click away. Bots edit through operations and you see their changes appear live; if a bot
// changes the block you're typing in, you choose whose text to keep. Comments anchor to a block and the quoted
// words. Tabs are <!-- tab: Name --> marker blocks; pictures are image blocks.
const DOC = { id: null, d: null, editing: null, hash: null, dirty: false, cur: null, panel: '', flash: new Set(), tab: 0, timer: null, q: Promise.resolve(), focusNext: null, rendering: false };
const docInline = (t) => esc(t)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<em>$2</em>')
  .replace(/~~([^~]+)~~/g, '<s>$1</s>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
function docBlockMd(b) {
  const a = b.attrs || {};
  switch (b.type) {
    case 'heading': return '#'.repeat(a.level || 2) + ' ' + b.md;
    case 'quote': return b.md.split('\n').map((l) => '> ' + l).join('\n');
    case 'code': return '```' + (a.lang || '') + '\n' + b.md + '\n```';
    case 'chart': return '```chart\n' + b.md + '\n```';
    case 'divider': return '---';
    case 'pending': return `<!-- pending: ${a.intent || ''} -->`;
    case 'tab': return `<!-- tab: ${a.title || 'Tab'} -->`;
    default: return b.md;
  }
}
const CE = 'contenteditable="true" spellcheck="true"';
function docTable(src) {
  const rows = src.split('\n').filter((l) => l.trim() && !/^\s*\|?\s*:?-{2,}/.test(l)).map((l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
  if (!rows.length) return '';
  const [head, ...body] = rows;
  return `<div class="dt-wrap"><table class="ed-table"><thead><tr>${head.map((c) => `<th ${CE} class="ed">${docInline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${head.map((_, i) => `<td ${CE} class="ed">${docInline(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function docChart(svg) {
  // A sandboxed frame with no scripts and no network: the chart can't reach the app or the internet.
  const vb = svg.match(/viewBox="\s*[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)/);
  const ratio = vb ? `${vb[1]} / ${vb[2]}` : '16 / 9';
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>html,body{margin:0;height:100%;background:#fff}svg{width:100%;height:100%;display:block}</style>${svg}`;
  return `<iframe class="doc-chart" sandbox="" referrerpolicy="no-referrer" style="aspect-ratio:${ratio}" srcdoc="${esc(html)}" title="Chart"></iframe>`;
}
// Only pictures stored with the doc (or https links) are shown.
const docImgOk = (u) => /^\/api\/docs\/d_[0-9a-f]+\/img\/[\w-]+\.(png|jpe?g|gif|webp)$/i.test(u) || /^https:\/\/\S+$/i.test(u);
function docMarkQuotes(html, b) {
  const cms = (DOC.d?.comments || []).filter((c) => c.block_id === b.id && !c.resolved && !c.parent && c.quote && !c.detached);
  for (const c of cms) { const q = esc(c.quote); const i = html.indexOf(q); if (i >= 0) html = html.slice(0, i) + `<mark class="cm" data-cm="${c.id}">${q}</mark>` + html.slice(i + q.length); }
  return html;
}
function docBlockHtml(b) {
  const a = b.attrs || {};
  const items = (re) => b.md.split('\n').filter((l) => l.trim()).map((l) => `<li data-ind="${Math.min(4, Math.floor(l.match(/^\s*/)[0].length / 2))}">${docInline(l.replace(re, ''))}</li>`).join('');
  let h;
  switch (b.type) {
    case 'heading': { const n = Math.min(4, a.level || 2); h = `<h${n} class="ed" ${CE} data-ph="Heading">${docInline(b.md)}</h${n}>`; break; }
    case 'bullets': h = `<ul class="ed" ${CE}>${items(/^\s*[-*+] /)}</ul>`; break;
    case 'numbered': h = `<ol class="ed" ${CE}>${items(/^\s*\d+[.)] /)}</ol>`; break;
    case 'todo': h = `<ul class="todo ed" ${CE}>${b.md.split('\n').filter((l) => l.trim()).map((l) => { const done = /\[[xX]\]/.test(l); return `<li class="${done ? 'done' : ''}"><input type="checkbox" contenteditable="false" data-todo ${done ? 'checked' : ''}><span>${docInline(l.replace(/^\s*[-*+] \[[ xX]\] ?/, '')) || '<br>'}</span></li>`; }).join('')}</ul>`; break;
    case 'quote': h = `<blockquote class="ed" ${CE}>${docInline(b.md).replace(/\n/g, '<br>')}</blockquote>`; break;
    case 'code': h = `<pre class="ed" ${CE} spellcheck="false"><code>${esc(b.md)}</code></pre>`; break;
    case 'table': h = docTable(b.md); break;
    case 'divider': h = '<hr>'; break;
    case 'chart': h = docChart(b.md); break;
    case 'image': { const m = b.md.match(/^!\[([^\]]*)\]\(([^)\s]+)\)/); h = m && docImgOk(m[2]) ? `<figure class="doc-img"><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy"></figure>` : `<p class="muted">${esc(b.md)}</p>`; break; }
    case 'pending': h = `<div class="pending"><span class="shimmer">${esc(a.intent || 'Writing…')}</span><i></i><i></i><i></i></div>`; break;
    default: h = `<p class="ed" ${CE} data-ph="Type something…">${docInline(b.md).replace(/\n/g, '<br>')}</p>`;
  }
  const n = (DOC.d?.comments || []).filter((c) => c.block_id === b.id && !c.resolved).length;
  return `<div class="blk ${b.type} ${DOC.flash.has(b.id) ? 'flash' : ''}" data-bid="${b.id}">
    <div class="blk-gutter" contenteditable="false"><button class="blk-btn" data-blk-add title="Add a line below">+</button><button class="blk-btn" data-blk-menu title="More">⋮</button></div>
    <div class="blk-body">${docMarkQuotes(h, b)}</div>${n ? `<button class="blk-cm" data-blk-comments title="Comments">💬 ${n}</button>` : ''}</div>`;
}

// ---------- page → Markdown ----------
const mdWrap = (m, s) => { if (!s.trim()) return s; const [, l, mid, r] = s.match(/^(\s*)([\s\S]*?)(\s*)$/); return l + m + mid + m + r; };
function inlineMd(node) {
  let out = '';
  for (const n of node.childNodes) {
    if (n.nodeType === 3) { out += n.nodeValue.replace(/\u00a0/g, ' ').replace(/\u200b/g, ''); continue; }
    if (n.nodeType !== 1) continue;
    const t = n.tagName;
    if (t === 'BR') out += '\n';
    else if (t === 'INPUT' || n.matches('.blk-conflict')) continue;
    else if (t === 'B' || t === 'STRONG' || (t === 'SPAN' && /bold|[6-9]00/.test(n.style.fontWeight))) out += mdWrap('**', inlineMd(n));
    else if (t === 'I' || t === 'EM') out += mdWrap('*', inlineMd(n));
    else if (t === 'S' || t === 'STRIKE' || t === 'DEL') out += mdWrap('~~', inlineMd(n));
    else if (t === 'CODE') out += n.textContent ? '`' + n.textContent.replace(/`/g, "'") + '`' : '';
    else if (t === 'A') { const href = n.getAttribute('href') || ''; out += /^https?:/.test(href) ? `[${inlineMd(n)}](${href})` : inlineMd(n); }
    else if (t === 'DIV' || t === 'P' || t === 'LI') { if (out && !out.endsWith('\n')) out += '\n'; out += inlineMd(n) + '\n'; }
    else out += inlineMd(n);
  }
  return out;
}
const oneLine = (s) => s.replace(/\s*\n\s*/g, ' ').trim();
// The Markdown for one block as it is on the page now.
function blockMdFromDom(blk, b) {
  const el = blk.querySelector('.ed, .ed-table');
  if (!el) return docBlockMd(b);
  const a = b.attrs || {};
  const lis = () => [...el.children].filter((x) => x.tagName === 'LI');
  switch (b.type) {
    case 'heading': {
      const [first, ...rest] = inlineMd(el).replace(/\n+$/, '').split('\n');
      return first.trim() ? ['#'.repeat(a.level || 2) + ' ' + first.trim(), ...rest.filter((l) => l.trim())].join('\n\n') : rest.join('\n').trim();
    }
    case 'bullets': case 'numbered':
      return lis().map((li) => [li, oneLine(inlineMd(li))]).filter(([, t]) => t).map(([li, t], i) => '  '.repeat(Number(li.dataset.ind) || 0) + (b.type === 'numbered' ? `${i + 1}. ` : '- ') + t).join('\n');
    case 'todo':
      return lis().map((li) => [li, oneLine(inlineMd(li))]).filter(([, t]) => t).map(([li, t]) => `- [${li.querySelector('input')?.checked ? 'x' : ' '}] ${t}`).join('\n');
    case 'quote': { const t = inlineMd(el).replace(/\n+$/, '').trim(); return t ? t.split('\n').map((l) => '> ' + l).join('\n') : ''; }
    case 'code': return '```' + (a.lang || '') + '\n' + el.textContent.replace(/\n$/, '') + '\n```';
    case 'table': {
      const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => oneLine(inlineMd(c)).replace(/\|/g, '/')));
      if (!rows.length) return '';
      const row = (r) => '| ' + r.map((c) => c || ' ').join(' | ') + ' |';
      return [row(rows[0]), '|' + rows[0].map(() => '---').join('|') + '|', ...rows.slice(1).map(row)].join('\n');
    }
    default: return inlineMd(el).replace(/\n+$/, '').trim();
  }
}

// ---------- tabs ----------
function docTabs(d) {
  const tabs = [];
  let cur = { title: null, marker: null, blocks: [] };
  for (const b of d.blocks) {
    if (b.type === 'tab') { if (cur.marker || cur.blocks.length) tabs.push(cur); cur = { title: b.attrs?.title || 'Tab', marker: b, blocks: [] }; }
    else cur.blocks.push(b);
  }
  tabs.push(cur);
  tabs.forEach((t, i) => { t.title ??= 'Tab ' + (i + 1); });
  return tabs;
}
const curTab = () => { const tabs = docTabs(DOC.d); DOC.tab = Math.max(0, Math.min(DOC.tab, tabs.length - 1)); return tabs[DOC.tab]; };
// Where "add at the end" goes in the tab you're looking at.
function tabEndTarget() {
  const t = curTab(), last = t.blocks[t.blocks.length - 1] || t.marker;
  return last ? { target: { blocks: [last.id] }, side: 'after' } : { target: { at: 'start' }, side: 'before' };
}

// ---------- rendering ----------
const TB = (k, label, title) => `<button class="tb-btn" data-tb="${k}" title="${title}" aria-label="${title}">${label}</button>`;
function renderDoc() {
  const el = $('#docpane'), d = DOC.d;
  if (!d) return;
  // Keep the block you're typing in exactly as it is (text and cursor), unless someone else changed it and you
  // haven't typed yet.
  const fresh = d.blocks.find((b) => b.id === DOC.editing);
  const live = DOC.editing && fresh && (DOC.dirty || fresh.hash === DOC.hash) ? el.querySelector(`.blk[data-bid="${DOC.editing}"]`) : null;
  const sel = getSelection();
  const keepSel = live && sel.rangeCount && live.contains(sel.anchorNode) ? [sel.anchorNode, sel.anchorOffset, sel.focusNode, sel.focusOffset] : null;
  const refocus = !live && DOC.editing && document.activeElement?.closest?.(`.blk[data-bid="${DOC.editing}"]`) ? DOC.editing : null;
  const scroll = el.querySelector('.doc-scroll')?.scrollTop || 0;
  const created = d.created_at ? new Date(d.created_at * 1000).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '';
  const author = d.bot_id ? bot(d.bot_id)?.name : userName();
  const open = (d.comments || []).filter((c) => !c.resolved).length;
  const tabs = docTabs(d), tab = curTab();
  DOC.rendering = true;
  el.innerHTML = `
    <div class="doc-head">
      <span class="doc-name">${esc(d.title)}</span>
      <div class="doc-tools">
        <button class="icon-btn" data-doc-link title="Copy a link to this document" aria-label="Copy link">🔗</button>
        <button class="icon-btn" data-doc-panel="comments" title="Comments" aria-label="Comments">💬${open ? `<i class="count">${open}</i>` : ''}</button>
        <button class="icon-btn" data-doc-panel="history" title="Version history" aria-label="History">${ICON.clock}</button>
        <button class="btn pill small" data-doc-export>Export</button>
        <button class="icon-btn" data-doc-wide title="Wider" aria-label="Wider">↔</button>
        <button class="icon-btn" data-doc-close aria-label="Close">${ICON.close}</button>
      </div>
    </div>
    <div class="doc-toolbar" data-doc-tb>
      <div class="doc-tabs">${tabs.map((t, i) => `<button class="doc-tab ${i === DOC.tab ? 'on' : ''}" data-doc-tab="${i}" title="${i === DOC.tab ? 'Rename or delete this tab' : 'Open tab'}">${esc(t.title)}${i === DOC.tab ? ' ▾' : ''}</button>`).join('')}<button class="doc-tab add" data-doc-tab-new title="New tab">+</button></div>
      <span class="tb-sep"></span>
      ${TB('style', 'T<small>T</small>', 'Text style')}${TB('bold', '<b>B</b>', 'Bold (Ctrl+B)')}${TB('italic', '<i>I</i>', 'Italic (Ctrl+I)')}${TB('strike', '<s>S</s>', 'Strikethrough')}${TB('code', '&lt;/&gt;', 'Inline code')}${TB('link', '🔗', 'Link (Ctrl+K)')}
      <span class="tb-sep"></span>
      ${TB('bullets', '•≡', 'Bulleted list')}${TB('numbered', '1≡', 'Numbered list')}${TB('todo', '☑', 'Checklist')}
      <span class="tb-sep"></span>
      ${TB('table', '▦', 'Insert table')}${TB('image', '🖼', 'Insert picture (or paste one)')}${TB('insert', '+ ▾', 'Insert')}
    </div>
    <div class="doc-main">
      <div class="doc-scroll"><article class="doc">
        <h1 class="doc-title" contenteditable="true" spellcheck="false" data-doc-title>${esc(d.title)}</h1>
        <div class="doc-meta"><span class="chip">📅 ${esc(created)}</span><span class="chip">@${esc(author || 'You')}</span>${d.shares?.length ? `<span class="chip" title="${esc(d.shares.map((s) => s.name || s.email).join(', '))}">👥 ${d.shares.length}</span>` : ''}<span class="muted small">rev ${d.rev}</span></div>
        ${tab.blocks.map(docBlockHtml).join('')}
        <button class="doc-add-end" data-blk-add-end>${tab.blocks.length ? '+ Add a line' : 'Click to start writing…'}</button>
      </article></div>
      ${DOC.panel ? `<div class="doc-side">${DOC.panel === 'history' ? '<div class="muted">Loading…</div>' : docCommentsHtml()}</div>` : ''}
    </div>
    <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" data-doc-img-input hidden multiple>`;
  if (live) {
    const slot = el.querySelector(`.blk[data-bid="${DOC.editing}"]`);
    if (slot) {
      slot.replaceWith(live);
      if (keepSel) { const ed = keepSel[0].parentElement?.closest('[contenteditable="true"]') || live.querySelector('.ed'); ed?.focus({ preventScroll: true }); try { getSelection().setBaseAndExtent(...keepSel); } catch {} }
    }
  }
  el.querySelector('.doc-scroll').scrollTop = scroll;
  DOC.rendering = false;
  const next = DOC.focusNext || (refocus && { id: refocus, at: 'end' });
  DOC.focusNext = null;
  if (next) docFocus(next.id, next.at);
  if (DOC.panel === 'history') loadDocHistory();
  DOC.flash.clear();
}
// Put the cursor at the start or end of a block.
function docFocus(id, at = 'end') {
  const ed = $(`#docpane .blk[data-bid="${id}"] .ed`);
  if (!ed) return;
  const target = at === 'start' ? ed : ([...ed.querySelectorAll('li > span, li')].pop() || ed);
  ed.focus({ preventScroll: false });
  const r = document.createRange();
  r.selectNodeContents(target); r.collapse(at === 'start');
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
  ed.closest('.blk')?.scrollIntoView({ block: 'nearest' });
}
function docCommentsHtml() {
  const cs = DOC.d.comments || [];
  const roots = cs.filter((c) => !c.parent);
  const replies = (id) => cs.filter((c) => c.parent === id);
  const one = (c) => `<div class="cm-item ${c.resolved ? 'resolved' : ''}" data-cm-id="${c.id}">
      ${c.quote ? `<div class="cm-quote ${c.detached ? 'detached' : ''}" data-cm-goto="${esc(c.block_id || '')}">“${esc(c.quote)}”${c.detached ? ' · text changed' : ''}</div>` : ''}
      <div class="cm-by"><b>${esc(c.author)}</b> <span class="muted">${timeAgo(c.created_at)}</span></div><div class="cm-body">${docInline(c.body)}</div>
      ${replies(c.id).map((r) => `<div class="cm-reply"><b>${esc(r.author)}</b> ${docInline(r.body)}</div>`).join('')}
      ${c.resolved ? '<div class="muted small">Resolved</div>' : `<div class="cm-actions"><input placeholder="Reply…" data-cm-reply="${c.id}"><button class="btn pill small" data-cm-resolve="${c.id}">Resolve</button></div>`}</div>`;
  return `<div class="doc-side-head"><b>Comments</b><span class="muted small">Select some text, then ⋮ → Comment</span></div>
    ${roots.length ? roots.sort((a, b) => a.resolved - b.resolved).map(one).join('') : '<div class="muted">No comments yet.</div>'}`;
}
async function loadDocHistory() {
  const side = $('#docpane .doc-side');
  const vs = await api(`/api/docs/${DOC.id}/versions`).catch(() => []);
  if (!side || DOC.panel !== 'history') return;
  side.innerHTML = `<div class="doc-side-head"><b>Version history</b></div>` + vs.map((v) => `
    <div class="ver"><div><b>Version ${v.rev}</b> <span class="muted small">${timeAgo(v.at)}</span></div><div class="muted small">${esc(v.actor || '')} · ${esc(v.summary || '')}</div>
    ${v.rev !== DOC.d.rev ? `<button class="btn pill small" data-doc-restore="${v.rev}">Restore</button>` : '<span class="muted small">Current</span>'}</div>`).join('');
}
async function openDoc(id) {
  if (DOC.id && DOC.id !== id) await docFlush();
  DOC.id = id; DOC.editing = null; DOC.dirty = false; DOC.tab = 0; DOC.cur = null;
  closeInfo(); $('#aside').classList.remove('open');
  const el = $('#docpane');
  el.classList.add('open');
  el.innerHTML = `<div class="doc-head"><span class="doc-name">Loading…</span><div class="doc-tools"><button class="icon-btn" data-doc-close aria-label="Close">${ICON.close}</button></div></div>`;
  try { DOC.d = await api(`/api/docs/${id}`); renderDoc(); }
  catch (e) { toast(e.message); closeDoc(); }
}
function closeDoc() {
  ART.open = false; $('#docpane').onclick = null;
  if (V.dirty && $('#docpane .html-frame.editing') && !confirm('Discard unsaved HTML changes?')) return;
  if (DOC.id && DOC.dirty) docFlush();
  V.code = V.dirty = false; if (ED.ed) stopEditor(); stopBrowserView();
  V.doc = null; V.fileId = null; DOC.id = null; DOC.d = null; DOC.editing = null; DOC.dirty = false;
  $('#docpane').classList.remove('open', 'wide');
}
async function reloadDoc(flashIds = []) {
  if (!DOC.id) return;
  const id = DOC.id;
  const d = await api(`/api/docs/${id}`).catch(() => null);
  if (!d || DOC.id !== id) return;
  flashIds.filter((x) => x !== DOC.editing).forEach((x) => DOC.flash.add(x));
  DOC.d = d;
  renderDoc();
}
async function docOps(payload) {
  try { return await api(`/api/docs/${DOC.id}/ops`, { method: 'POST', body: payload }); }
  catch (e) { toast(e.message); throw e; }
}

// ---------- saving what you type ----------
// Saves run one at a time, so a quick second save never trips over the first one's new hash.
function docSave(blk, force = false) { clearTimeout(DOC.timer); DOC.q = DOC.q.then(() => docSaveNow(blk, force)).catch(() => {}); return DOC.q; }
const docFlush = () => { const blk = DOC.editing && document.querySelector(`#docpane .blk[data-bid="${DOC.editing}"]`); return blk && DOC.dirty ? docSave(blk) : DOC.q; };
async function docSaveNow(blk, force) {
  const id = blk.dataset.bid, b = DOC.d?.blocks.find((x) => x.id === id), docId = DOC.id;
  if (!b || (!DOC.dirty && !force)) return;
  const md = blockMdFromDom(blk, b);
  DOC.dirty = false;
  if (md === docBlockMd(b)) return;
  const op = md.trim() ? { op: 'replace', target: { blocks: [id] }, with: { markdown: md } } : { op: 'delete', target: { blocks: [id] } };
  if (!force) op.ifHash = DOC.editing === id ? DOC.hash : b.hash;
  const r = await fetch(`/api/docs/${docId}/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [op] }) });
  const out = await r.json().catch(() => ({}));
  if (DOC.id !== docId) return;
  if (r.status === 409) {
    // Someone (usually a bot) changed this block while you typed. You decide.
    DOC.dirty = true;
    blk.querySelector('.blk-conflict')?.remove();
    blk.querySelector('.blk-body').insertAdjacentHTML('beforeend', `<div class="blk-conflict" contenteditable="false">This changed while you were typing.
      <button class="btn pill small primary" data-conflict="mine">Keep mine</button><button class="btn pill small" data-conflict="theirs">Use the new version</button></div>`);
    return;
  }
  if (!r.ok) { DOC.dirty = true; return toast(out.error || 'Couldn’t save'); }
  const mine = out.blocks?.find((x) => x.id === id);
  if (mine && DOC.editing === id) DOC.hash = mine.hash;
  // Typing "## " or "- " at the start of a line (or pasting several paragraphs) can turn one block into others:
  // show the result as the server sees it.
  const reshaped = !md.trim() || out.created?.length || mine?.type !== b.type;
  if (reshaped && DOC.editing === id) { DOC.editing = null; DOC.focusNext = { id: out.created?.length ? out.created[out.created.length - 1] : id, at: 'end' }; if (!md.trim()) DOC.focusNext = null; }
  await reloadDoc();
}
// Replace one block with new content (or several), then put the cursor in the given block.
async function docReplace(id, withWhat, focus) {
  await docFlush();
  const b = DOC.d.blocks.find((x) => x.id === id);
  try {
    const r = await docOps({ ops: [{ op: 'replace', target: { blocks: [id] }, ifHash: b?.hash, with: withWhat }] });
    DOC.editing = null; DOC.dirty = false;
    if (focus) DOC.focusNext = typeof focus === 'object' ? focus : { id, at: 'end' };
    await reloadDoc();
    return r;
  } catch { reloadDoc(); }
}
async function docInsert(where, source, focusAt = 'end') {
  await docFlush();
  try {
    const r = await docOps({ ops: [{ op: 'insert', ...where, source }] });
    DOC.editing = null; DOC.dirty = false;
    if (focusAt && r.created?.length) DOC.focusNext = { id: r.created[0], at: focusAt };
    await reloadDoc();
    return r;
  } catch {}
}
const afterBlock = (id) => (id ? { target: { blocks: [id] }, side: 'after' } : tabEndTarget());
const emptyLine = { block: { type: 'paragraph', md: '' } };

// Enter, Backspace and friends behave like a word processor.
// Pasting: pictures become image blocks; text comes in as plain text (Markdown in it is understood when it saves).
async function docAddImages(files, afterId) {
  let at = afterId && DOC.d.blocks.some((b) => b.id === afterId) ? afterId : null;
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} is over 10 MB`); continue; }
    toast('Adding picture…');
    try {
      const data = await new Promise((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = fail; r.readAsDataURL(f); });
      const img = await api(`/api/docs/${DOC.id}/images`, { method: 'POST', body: { name: f.name || 'pasted.png', data } });
      const r = await docInsert(afterBlock(at), { markdown: img.markdown }, null);
      at = r?.created?.[0] || at;
    } catch (err) { toast(err.message); }
  }
}

// ---------- toolbar ----------
function docLink() {
  const sel = getSelection();
  if (!sel.rangeCount || !sel.anchorNode?.parentElement?.closest('#docpane .ed')) return toast('Select some text first');
  const r = sel.getRangeAt(0).cloneRange();
  const url = prompt('Link to (https://…)', 'https://');
  if (!url || !/^https?:\/\/\S+$/.test(url)) return;
  sel.removeAllRanges(); sel.addRange(r);
  if (r.collapsed) document.execCommand('insertText', false, url);
  else document.execCommand('createLink', false, url);
}
const curBlk = () => { const id = DOC.editing || DOC.cur; return id && document.querySelector(`#docpane .blk[data-bid="${id}"]`); };
// Change the current block's kind (heading, list, quote…) keeping its text.
async function docSetType(type, attrs = {}) {
  const blk = curBlk(), b = blk && DOC.d.blocks.find((x) => x.id === blk.dataset.bid);
  if (!b) return toast('Click into a line first');
  if (!/^(paragraph|heading|bullets|numbered|todo|quote|code)$/.test(b.type)) return toast('That can’t change style');
  const el = blk.querySelector('.ed');
  const lines = b.type === 'code' ? el.textContent.replace(/\n$/, '').split('\n')
    : /^(bullets|numbered|todo)$/.test(b.type) ? [...el.children].filter((x) => x.tagName === 'LI').map((li) => oneLine(inlineMd(li)))
      : inlineMd(el).replace(/\n+$/, '').split('\n');
  const L = lines.filter((l, i) => l.trim() || i === 0);
  let md;
  switch (type) {
    case 'heading': md = '#'.repeat(attrs.level || 2) + ' ' + L.join(' ').trim(); break;
    case 'bullets': md = L.map((l) => '- ' + l).join('\n'); break;
    case 'numbered': md = L.map((l, i) => `${i + 1}. ${l}`).join('\n'); break;
    case 'todo': md = L.map((l) => '- [ ] ' + l).join('\n'); break;
    case 'quote': md = L.map((l) => '> ' + l).join('\n'); break;
    case 'code': md = '```\n' + L.join('\n') + '\n```'; break;
    default: md = L.join('\n');
  }
  const blank = !L.join('').trim();
  const withWhat = blank ? { block: { type, md: type === 'code' ? '' : '', attrs: type === 'heading' ? { level: attrs.level || 2 } : {} } } : { markdown: md };
  if (blank && /^(bullets|numbered|todo)$/.test(type)) withWhat.block.md = type === 'todo' ? '- [ ] ' : type === 'numbered' ? '1. ' : '- ';
  DOC.dirty = false;
  await docReplace(b.id, withWhat, true);
}
function docPopover(anchor, items, onPick) {
  document.querySelector('.doc-menu')?.remove();
  const m = document.createElement('div');
  m.className = 'popover doc-menu';
  m.innerHTML = items.map(([k, l]) => `<button data-dm="${k}"><span>${l}</span></button>`).join('');
  document.body.append(m);
  const r = anchor.getBoundingClientRect();
  m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + 'px';
  m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  m.addEventListener('mousedown', (e) => e.preventDefault()); // keep the cursor where it was
  m.addEventListener('click', (e) => { const k = e.target.closest('[data-dm]')?.dataset.dm; if (!k) return; m.remove(); onPick(k); });
  setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('mousedown', off); } }), 0);
}
// Toolbar buttons don't take the focus, so the cursor and selection stay in the page.
async function docToolbar(btn) {
  const k = btn.dataset.tb;
  const markDirty = () => { const blk = curBlk(); if (blk && DOC.editing === blk.dataset.bid) { DOC.dirty = true; clearTimeout(DOC.timer); DOC.timer = setTimeout(() => docSave(blk), 800); } };
  switch (k) {
    case 'bold': case 'italic': case 'strike':
      if (!getSelection().anchorNode?.parentElement?.closest('#docpane .ed')) return toast('Select some text first');
      document.execCommand(k === 'strike' ? 'strikeThrough' : k); return markDirty();
    case 'code': {
      const sel = getSelection();
      if (!sel.rangeCount || sel.isCollapsed || !sel.anchorNode?.parentElement?.closest('#docpane .ed')) return toast('Select some text first');
      const c = document.createElement('code'); c.textContent = String(sel); const r = sel.getRangeAt(0); r.deleteContents(); r.insertNode(c);
      return markDirty();
    }
    case 'link': return docLink();
    case 'bullets': case 'numbered': case 'todo': return docSetType(k);
    case 'style': return docPopover(btn, [['p', 'Text'], ['h1', '<span style="font-size:20px">Heading 1</span>'], ['h2', '<span style="font-size:17px">Heading 2</span>'], ['h3', '<b>Heading 3</b>'], ['quote', '❝ Quote'], ['code', '&lt;/&gt; Code block']],
      (s) => (s === 'p' ? docSetType('paragraph') : s[0] === 'h' ? docSetType('heading', { level: Number(s[1]) }) : docSetType(s)));
    case 'table': return docInsert(afterBlock(DOC.cur), { markdown: '| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n|   |   |   |\n|   |   |   |' }, 'start');
    case 'image': return $('#docpane [data-doc-img-input]')?.click();
    case 'insert': {
      const inTable = curBlk()?.classList.contains('table');
      return docPopover(btn, [['line', '¶ Text'], ['divider', '― Divider'], ['todo', '☑ Checklist'], ['table', '▦ Table'], ['image', '🖼 Picture'], ...(inTable ? [['row', '+ Table row'], ['col', '+ Table column']] : []), ['tab', '🗂 New tab']], async (s) => {
        if (s === 'line') return docInsert(afterBlock(DOC.cur), emptyLine, 'start');
        if (s === 'divider') return docInsert(afterBlock(DOC.cur), { markdown: '---' }, null);
        if (s === 'todo') return docInsert(afterBlock(DOC.cur), { block: { type: 'todo', md: '- [ ] ' } }, 'start');
        if (s === 'table') return docToolbar({ dataset: { tb: 'table' } });
        if (s === 'image') return $('#docpane [data-doc-img-input]')?.click();
        if (s === 'tab') return docNewTab();
        if (s === 'row' || s === 'col') {
          const blk = curBlk(), t = blk.querySelector('table');
          if (s === 'row') { const tr = t.querySelector('tbody tr:last-child') || t.querySelector('tr'); const n = tr.cloneNode(true); n.querySelectorAll('th, td').forEach((c) => { c.innerHTML = ''; }); (t.tBodies[0] || t).append(n); }
          else t.querySelectorAll('tr').forEach((tr, i) => { const c = document.createElement(i ? 'td' : 'th'); c.className = 'ed'; c.setAttribute('contenteditable', 'true'); c.textContent = i ? '' : 'Column'; tr.append(c); });
          DOC.editing = blk.dataset.bid; DOC.hash = DOC.d.blocks.find((b) => b.id === blk.dataset.bid)?.hash; DOC.dirty = true;
          return docSave(blk);
        }
      });
    }
  }
}

// ---------- tabs ----------
async function docNewTab() {
  await docFlush();
  const tabs = docTabs(DOC.d), name = prompt('Name the new tab', 'Tab ' + (tabs.length + 1));
  if (name == null) return;
  const ops = [];
  if (!tabs[0].marker) ops.push({ op: 'insert', target: { at: 'start' }, source: { block: { type: 'tab', md: '', attrs: { title: tabs[0].title } } } });
  ops.push({ op: 'insert', target: { at: 'end' }, source: { block: { type: 'tab', md: '', attrs: { title: name.trim().slice(0, 80) || 'Tab' } } } });
  ops.push({ op: 'insert', target: { at: 'end' }, source: emptyLine });
  try {
    const r = await docOps({ ops });
    DOC.tab = tabs.length; DOC.focusNext = { id: r.created[r.created.length - 1], at: 'start' };
    reloadDoc();
  } catch {}
}
async function docTabMenu(btn, i) {
  const tabs = docTabs(DOC.d), t = tabs[i];
  docPopover(btn, [['rename', 'Rename'], ...(tabs.length > 1 ? [['delete', 'Delete tab']] : [])], async (k) => {
    if (k === 'rename') {
      const name = prompt('Tab name', t.title); if (!name?.trim()) return;
      const op = t.marker ? { op: 'set', target: { blocks: [t.marker.id] }, attrs: { title: name.trim().slice(0, 80) } }
        : { op: 'insert', target: { at: 'start' }, source: { block: { type: 'tab', md: '', attrs: { title: name.trim().slice(0, 80) } } } };
      await docOps({ ops: [op] }).catch(() => {});
    } else {
      if (!confirm(`Delete the tab “${t.title}” and everything in it? You can restore it from Version history.`)) return;
      const ids = [...(t.marker ? [t.marker.id] : []), ...t.blocks.map((b) => b.id)];
      if (ids.length) await docOps({ ops: [{ op: 'delete', target: { blocks: ids } }] }).catch(() => {});
      DOC.tab = Math.max(0, i - 1);
    }
    DOC.editing = null; reloadDoc();
  });
}

// ---------- block menu and clicks ----------
function docBlockMenu(btn, blk) {
  const sel = String(getSelection() || '').trim();
  const quote = sel && blk.contains(getSelection().anchorNode) ? sel.slice(0, 300) : '';
  docPopover(btn, [['comment', quote ? `Comment on “${esc(quote.slice(0, 24))}${quote.length > 24 ? '…' : ''}”` : 'Comment'], ['up', 'Move up'], ['down', 'Move down'], ['delete', 'Delete']], async (k) => {
    await docFlush();
    const id = blk.dataset.bid, list = curTab().blocks, i = list.findIndex((b) => b.id === id), b = list[i];
    if (!b) return;
    if (k === 'delete') { DOC.editing = null; await docOps({ ops: [{ op: 'delete', target: { blocks: [id] } }] }).catch(() => {}); return reloadDoc(); }
    if (k === 'up' && i > 0) { await docOps({ ops: [{ op: 'move', target: { blocks: [id] }, side: 'before', ref: list[i - 1].id }] }).catch(() => {}); return reloadDoc(); }
    if (k === 'down' && i < list.length - 1) { await docOps({ ops: [{ op: 'move', target: { blocks: [id] }, side: 'after', ref: list[i + 1].id }] }).catch(() => {}); return reloadDoc(); }
    if (k === 'comment') {
      const text = prompt(quote ? `Comment on “${quote}”` : 'Comment on this block');
      if (!text?.trim()) return;
      await api(`/api/docs/${DOC.id}/comments`, { method: 'POST', body: { blockId: id, quote, body: text } }).catch((err) => toast(err.message));
      DOC.panel = 'comments'; reloadDoc();
    }
  });
}
// Warn before leaving with unsaved typing (it normally saves within a second or two).

async function docsModal() {
  const list = await api('/api/docs').catch(() => []);
  const el = modal(`<div class="modal-head"><h2>Documents</h2><button class="icon-btn" data-close aria-label="Close">${ICON.close}</button></div>
    <div class="doc-list">${list.length ? list.map((d) => `<button class="card-item" data-doc-open="${d.id}">📄<span><b>${esc(d.title)}</b><small>${d.bot_id ? esc(bot(d.bot_id)?.name || '') + ' · ' : ''}${timeAgo(d.updated_at)} · rev ${d.rev}</small></span></button>`).join('') : '<div class="muted">No documents yet. Ask a bot to write one, or start your own.</div>'}</div>
    <div class="modal-foot"><button class="btn" data-close>Close</button><button class="btn primary" data-new-doc>New document</button></div>`);
  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-close]')) return closeModal();
    if (e.target.closest('[data-doc-open]')) return closeModal();
    if (e.target.closest('[data-new-doc]')) { const d = await api('/api/docs', { method: 'POST', body: { title: 'Untitled', markdown: 'Start writing…' } }); closeModal(); openDoc(d.id); }
  });
}

export function initDocEditor() {
  document.addEventListener('focusin', (e) => {
    const ed = e.target.closest?.('#docpane .ed'); if (!ed) return;
    const blk = ed.closest('.blk'), id = blk.dataset.bid;
    DOC.cur = id;
    if (DOC.editing === id) return;
    const prev = DOC.editing && document.querySelector(`#docpane .blk[data-bid="${DOC.editing}"]`);
    if (prev && DOC.dirty) docSave(prev);
    DOC.editing = id; DOC.dirty = false; DOC.hash = DOC.d.blocks.find((b) => b.id === id)?.hash;
  });
  document.addEventListener('focusout', (e) => {
    const ed = e.target.closest?.('#docpane .ed'); if (!ed || DOC.rendering) return;
    const blk = ed.closest('.blk');
    if (e.relatedTarget && blk.contains(e.relatedTarget)) return; // e.g. table cell to table cell
    setTimeout(() => {
      if (blk.contains(document.activeElement) || document.activeElement?.closest?.('[data-doc-tb], .doc-menu')) return;
      if (DOC.dirty && DOC.editing === blk.dataset.bid) docSave(blk);
      if (DOC.editing === blk.dataset.bid && !DOC.dirty) DOC.editing = null;
    }, 0);
  });
  document.addEventListener('input', (e) => {
    const ed = e.target.closest?.('#docpane .ed'); if (!ed) return;
    const blk = ed.closest('.blk');
    if (DOC.editing !== blk.dataset.bid) return;
    DOC.dirty = true;
    clearTimeout(DOC.timer);
    DOC.timer = setTimeout(() => docSave(blk), 1200);
  });
  document.addEventListener('keydown', async (e) => {
    const ed = e.target.closest?.('#docpane .ed'); if (!ed) return;
    const blk = ed.closest('.blk'), id = blk.dataset.bid, b = DOC.d.blocks.find((x) => x.id === id);
    if (!b) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); return docLink(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); return docSave(blk); }
    if (e.key === 'Escape') { ed.blur(); return; }
    const sel = getSelection(), empty = !ed.textContent.trim();
    if (e.key === 'Tab' && b.type === 'code') { e.preventDefault(); return document.execCommand('insertText', false, '  '); }
    if (e.key === 'Tab' && (b.type === 'bullets' || b.type === 'numbered')) {
      e.preventDefault();
      const li = sel.anchorNode?.parentElement?.closest('li') || (sel.anchorNode?.nodeName === 'LI' ? sel.anchorNode : null);
      if (li) { li.dataset.ind = Math.max(0, Math.min(4, (Number(li.dataset.ind) || 0) + (e.shiftKey ? -1 : 1))); DOC.dirty = true; docSave(blk); }
      return;
    }
    if (e.key === 'Backspace' && empty && ['paragraph', 'heading', 'quote'].includes(b.type)) {
      e.preventDefault();
      const list = curTab().blocks, i = list.findIndex((x) => x.id === id), prev = list.slice(0, i).reverse().find((x) => /^(paragraph|heading|bullets|numbered|todo|quote|code)$/.test(x.type));
      DOC.editing = null; DOC.dirty = false;
      await docOps({ ops: [{ op: 'delete', target: { blocks: [id] } }] }).catch(() => {});
      if (prev) DOC.focusNext = { id: prev.id, at: 'end' };
      return reloadDoc();
    }
    if (e.key !== 'Enter' || mod) return;
    if (b.type === 'table') { e.preventDefault(); return; }
    if (b.type === 'code') { e.preventDefault(); return document.execCommand('insertText', false, '\n'); }
    if (e.shiftKey || b.type === 'quote') { e.preventDefault(); return document.execCommand('insertLineBreak'); }
    if (b.type === 'bullets' || b.type === 'numbered' || b.type === 'todo') {
      const li = (sel.anchorNode?.nodeType === 1 ? sel.anchorNode : sel.anchorNode?.parentElement)?.closest('li');
      if (li && !li.textContent.trim()) { // Enter on an empty item ends the list
        e.preventDefault();
        const last = li === ed.lastElementChild;
        li.remove(); DOC.dirty = true; await docSave(blk);
        if (last) return docInsert(afterBlock(id), emptyLine, 'start');
        return;
      }
      if (b.type === 'todo' && li) {
        e.preventDefault();
        const r = sel.getRangeAt(0); r.deleteContents();
        const span = li.querySelector('span') || li;
        const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(span, span.childNodes.length);
        const frag = tail.extractContents();
        const nli = document.createElement('li');
        nli.innerHTML = '<input type="checkbox" contenteditable="false" data-todo><span></span>';
        nli.querySelector('span').append(frag);
        if (!nli.querySelector('span').textContent) nli.querySelector('span').innerHTML = '<br>';
        li.after(nli);
        const c = document.createRange(); c.setStart(nli.querySelector('span'), 0); c.collapse(true); sel.removeAllRanges(); sel.addRange(c);
        DOC.dirty = true;
      }
      return; // other lists: the browser adds the new item
    }
    // Paragraphs and headings: Enter splits the block at the cursor; the second half becomes a new paragraph.
    e.preventDefault();
    const r = sel.getRangeAt(0); r.deleteContents();
    const tail = document.createRange(); tail.setStart(r.endContainer, r.endOffset); tail.setEnd(ed, ed.childNodes.length);
    const box = document.createElement('div'); box.append(tail.extractContents());
    const after = inlineMd(box).replace(/\n+$/, '').trim();
    const before = blockMdFromDom(blk, b);
    clearTimeout(DOC.timer);
    const ops = [];
    ops.push(before.trim() ? { op: 'replace', target: { blocks: [id] }, ifHash: DOC.hash, with: { markdown: before } } : { op: 'replace', target: { blocks: [id] }, ifHash: DOC.hash, with: { block: { type: b.type, md: '', attrs: b.attrs } } });
    ops.push({ op: 'insert', target: { blocks: [id] }, side: 'after', source: { block: { type: 'paragraph', md: after } } });
    DOC.editing = null; DOC.dirty = false;
    try {
      const out = await docOps({ ops });
      DOC.focusNext = { id: out.created[out.created.length - 1], at: 'start' };
    } catch {}
    reloadDoc();
  });
  document.addEventListener('change', (e) => {
    if (!e.target.matches?.('#docpane [data-todo]')) return;
    const blk = e.target.closest('.blk');
    e.target.closest('li')?.classList.toggle('done', e.target.checked);
    if (DOC.editing !== blk.dataset.bid) { DOC.editing = blk.dataset.bid; DOC.hash = DOC.d.blocks.find((b) => b.id === blk.dataset.bid)?.hash; }
    DOC.dirty = true; docSave(blk);
  });
  document.addEventListener('paste', (e) => {
    if (!e.target.closest?.('#docpane .doc') || e.target.closest('[data-doc-title]')) return;
    const imgs = [...(e.clipboardData?.files || [])].filter((f) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type));
    if (imgs.length) { e.preventDefault(); return docAddImages(imgs, e.target.closest('.blk')?.dataset.bid || DOC.cur); }
    if (e.target.closest('.ed')) { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')); }
  });
  document.addEventListener('dragover', (e) => { if (e.target.closest?.('#docpane .doc') && [...(e.dataTransfer?.items || [])].some((i) => i.kind === 'file')) e.preventDefault(); });
  document.addEventListener('drop', (e) => {
    if (!e.target.closest?.('#docpane .doc')) return;
    const imgs = [...(e.dataTransfer?.files || [])].filter((f) => /^image\//.test(f.type));
    if (!imgs.length) return;
    e.preventDefault();
    docAddImages(imgs, e.target.closest('.blk')?.dataset.bid || null);
  });
  document.addEventListener('mousedown', (e) => { if (e.target.closest?.('#docpane [data-tb]')) e.preventDefault(); });
  document.addEventListener('change', (e) => {
    if (!e.target.matches?.('#docpane [data-doc-img-input]')) return;
    const files = [...e.target.files]; e.target.value = '';
    if (files.length) docAddImages(files, DOC.cur);
  });
  document.addEventListener('click', async (e) => {
    const pane = e.target.closest('#docpane');
    const open = e.target.closest('[data-doc-open]');
    if (open) { e.preventDefault(); return openDoc(open.dataset.docOpen); }
    if (!pane || !DOC.id) return;
    const t = e.target;
    if (t.closest('[data-doc-close]')) { await docFlush(); return closeDoc(); }
    if (t.closest('[data-doc-wide]')) return pane.classList.toggle('wide');
    if (t.closest('[data-doc-link]')) return copyText(`${location.origin}/#doc:${DOC.id}`);
    if (t.closest('[data-doc-panel]')) { const p = t.closest('[data-doc-panel]').dataset.docPanel; DOC.panel = DOC.panel === p ? '' : p; return renderDoc(); }
    if (t.closest('[data-tb]')) { e.stopImmediatePropagation(); return docToolbar(t.closest('[data-tb]')); }
    if (t.closest('[data-doc-tab-new]')) return docNewTab();
    if (t.closest('[data-doc-tab]')) {
      e.stopImmediatePropagation();
      const i = Number(t.closest('[data-doc-tab]').dataset.docTab);
      if (i === DOC.tab) return docTabMenu(t.closest('[data-doc-tab]'), i);
      await docFlush(); DOC.tab = i; DOC.editing = null; DOC.cur = null; return renderDoc();
    }
    if (t.closest('[data-doc-export]')) {
      e.stopImmediatePropagation();
      document.querySelector('.doc-menu')?.remove();
      const m = document.createElement('div');
      m.className = 'popover doc-menu';
      m.innerHTML = [['docx', 'Word (.docx)'], ['pdf', 'PDF'], ['md', 'Markdown']].map(([f, l]) => `<a href="/api/docs/${DOC.id}/export/${f}" download><span>${l}</span></a>`).join('');
      document.body.append(m);
      const r = t.closest('[data-doc-export]').getBoundingClientRect();
      m.style.top = r.bottom + 4 + 'px'; m.style.left = Math.max(8, r.right - m.offsetWidth) + 'px';
      setTimeout(() => document.addEventListener('mousedown', function off(ev) { if (!m.contains(ev.target)) { setTimeout(() => m.remove(), 200); document.removeEventListener('mousedown', off); } }), 0);
      return;
    }
    if (t.closest('[data-doc-restore]')) { const rev = t.closest('[data-doc-restore]').dataset.docRestore; if (!confirm(`Restore version ${rev}? The current text stays in the history.`)) return; DOC.editing = null; DOC.dirty = false; await api(`/api/docs/${DOC.id}/restore`, { method: 'POST', body: { rev: Number(rev) } }).catch((err) => toast(err.message)); return reloadDoc(); }
    if (t.closest('[data-cm-resolve]')) { await api(`/api/docs/${DOC.id}/comments/${t.closest('[data-cm-resolve]').dataset.cmResolve}/resolve`, { method: 'POST', body: {} }); return reloadDoc(); }
    if (t.closest('[data-cm-goto]')) { const blk = pane.querySelector(`.blk[data-bid="${t.closest('[data-cm-goto]').dataset.cmGoto}"]`); blk?.scrollIntoView({ behavior: 'smooth', block: 'center' }); blk?.classList.add('flash'); setTimeout(() => blk?.classList.remove('flash'), 1600); return; }
    if (t.closest('[data-blk-comments]')) { DOC.panel = 'comments'; return renderDoc(); }
    const blk = t.closest('.blk');
    if (t.closest('[data-conflict]') && blk) {
      blk.querySelector('.blk-conflict')?.remove();
      if (t.closest('[data-conflict]').dataset.conflict === 'mine') { DOC.dirty = true; return docSave(blk, true); }
      DOC.editing = null; DOC.dirty = false; return reloadDoc();
    }
    if (t.closest('[data-blk-add-end]')) return docInsert(tabEndTarget(), emptyLine, 'start');
    if (!blk) return;
    if (t.closest('[data-blk-add]')) return docInsert(afterBlock(blk.dataset.bid), emptyLine, 'start');
    // stopImmediatePropagation: the general click handler below would close this popover in the same click.
    if (t.closest('[data-blk-menu]')) { e.stopImmediatePropagation(); return docBlockMenu(t.closest('[data-blk-menu]'), blk); }
    // Links in the page open with Ctrl/Cmd+click; a plain click puts the cursor there.
    const a = t.closest('.ed a');
    if (a && !(e.ctrlKey || e.metaKey)) e.preventDefault();
  });
  document.addEventListener('keydown', async (e) => {
    const reply = e.target.closest?.('[data-cm-reply]');
    if (reply && e.key === 'Enter' && reply.value.trim()) {
      await api(`/api/docs/${DOC.id}/comments`, { method: 'POST', body: { parent: Number(reply.dataset.cmReply), body: reply.value } }).catch((err) => toast(err.message));
      reloadDoc();
    }
    const title = e.target.closest?.('[data-doc-title]');
    if (title && e.key === 'Enter') { e.preventDefault(); title.blur(); }
  });
  document.addEventListener('focusout', async (e) => {
    const title = e.target.closest?.('[data-doc-title]');
    if (!title || !DOC.d || DOC.rendering) return;
    const v = title.textContent.trim();
    if (v && v !== DOC.d.title) { await docOps({ ops: [], title: v }).catch(() => {}); reloadDoc(); }
  });
  addEventListener('beforeunload', (e) => { if (DOC.dirty) { docFlush(); e.preventDefault(); } });
}
export { DOC, closeDoc, docsModal, openDoc, reloadDoc };
