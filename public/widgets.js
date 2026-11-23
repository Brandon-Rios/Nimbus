// Bot widgets in the side panel: what a bot proposed (Pin or Dismiss) and what you pinned (live data).
// Cards are drawn here from plain data, never from bot-written code. Pinned cards refresh on their own timer.
let X;
export function initWidgets(ctx) { X = ctx; }
const timers = new Map(); // widget id -> interval
const panel = () => document.getElementById('info');
const ago = (t) => { const s = Math.max(0, Date.now() / 1000 - t); return s < 90 ? 'just now' : s < 5400 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : 'a while ago'; };
const srcLabel = (w) => w.source.type === 'file' ? w.source.path : `API tool /${w.source.name}`;

export function closeWidgets() {
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
  panel()?.classList.remove('open');
}
export async function openWidgets(botId) {
  const b = X.bot(botId);
  if (!b) return;
  panel().classList.add('open');
  await render(botId);
}
async function render(botId) {
  const el = panel(), b = X.bot(botId);
  el.dataset.bot = botId;
  let widgets = [];
  try { ({ widgets } = await X.api(`/api/widgets?bot=${botId}`)); } catch (e) { X.toast(e.message); }
  const proposed = widgets.filter((w) => w.status === 'proposed'), pinned = widgets.filter((w) => w.status === 'pinned');
  for (const t of timers.values()) clearInterval(t);
  timers.clear();
  el.innerHTML = `<div class="aside-head"><b>${X.esc(b.name)}’s widgets</b><button class="icon-btn" data-wg="close" aria-label="Close">${X.ICON.close}</button></div>
    <div class="wg-body">
      ${proposed.length ? `<h4 class="wg-h">Proposed</h4>${proposed.map(proposedCard).join('')}` : ''}
      <h4 class="wg-h">Pinned <span class="muted">${pinned.length} of 3</span></h4>
      ${pinned.length ? pinned.map(pinnedCard).join('') : `<p class="muted wg-empty">Nothing pinned. When ${X.esc(b.name)} offers a widget, pin it here.</p>`}
    </div>`;
  for (const w of pinned) {
    load(w);
    timers.set(w.id, setInterval(() => load(w), w.refresh * 1000));
  }
}
function proposedCard(w) {
  return `<section class="wg wg-proposed" data-wg-id="${w.id}"><div class="wg-top"><b>${X.esc(w.title)}</b><small class="muted">${w.kind}</small></div>
    <p class="muted wg-src">From ${X.esc(srcLabel(w))}</p>
    <div class="wg-acts"><button class="btn primary" data-wg="pin" data-id="${w.id}">Pin</button><button class="btn" data-wg="del" data-id="${w.id}">Dismiss</button></div></section>`;
}
function pinnedCard(w) {
  return `<section class="wg" data-wg-id="${w.id}"><div class="wg-top"><b>${X.esc(w.title)}</b><small class="muted" data-wg-when></small>
    <button class="icon-btn wg-x" data-wg="unpin" data-id="${w.id}" aria-label="Unpin ${X.esc(w.title)}" title="Unpin">${X.ICON.close}</button></div>
    <div class="wg-data"><span class="muted">Loading…</span></div></section>`;
}
// Reads a pinned widget's data. A failure replaces the card's data with the error.
async function load(w) {
  const card = panel()?.querySelector(`[data-wg-id="${w.id}"]`);
  if (!panel()?.classList.contains('open')) return closeWidgets(); // panel closed elsewhere: stop refreshing
  if (!card) { clearInterval(timers.get(w.id)); timers.delete(w.id); return; }
  let r;
  try { r = await X.api(`/api/widgets/${w.id}/data`); } catch (e) { r = { ok: false, error: e.message }; }
  const box = card.querySelector('.wg-data');
  if (!r.ok) { box.innerHTML = `<span class="wg-err">⚠ ${X.esc(r.error)}</span>`; return; }
  box.innerHTML = w.kind === 'stat' ? statHtml(r.data) : listHtml(r.data);
  const when = card.querySelector('[data-wg-when]');
  if (when) when.textContent = `Updated ${ago(r.at)}`;
}
function statHtml(d) {
  const n = Number(d.value), pct = d.total && Number.isFinite(n) ? Math.min(100, Math.max(0, (n / d.total) * 100)) : null;
  return `<div class="wg-stat">${X.esc(d.value)}${d.label ? ` <span class="wg-unit">${X.esc(d.label)}</span>` : ''}</div>
    ${d.sub ? `<div class="muted">${X.esc(d.sub)}</div>` : ''}
    ${pct != null ? `<div class="wg-bar" role="img" aria-label="${Math.round(pct)}%"><i style="width:${pct}%"></i></div>` : ''}`;
}
function listHtml(d) {
  const rows = d.items.map((i) => `<li class="${i.done ? 'done' : ''}"><span>${X.esc(i.text)}</span>${i.note ? `<em>${X.esc(i.note)}</em>` : ''}</li>`).join('');
  return `<ul class="wg-list">${rows || '<li class="muted">Empty</li>'}${d.more ? `<li class="muted">+${d.more} more</li>` : ''}</ul>`;
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-wg]'); if (!t) return;
  const act = t.dataset.wg, id = t.dataset.id;
  if (act === 'close') return closeWidgets();
  try {
    if (act === 'pin') await X.api(`/api/widgets/${id}/pin`, { method: 'POST' });
    if (act === 'unpin') await X.api(`/api/widgets/${id}/unpin`, { method: 'POST' });
    if (act === 'del') await X.api(`/api/widgets/${id}`, { method: 'DELETE' });
  } catch (err) { return X.toast(err.message); }
  const botId = panel()?.dataset.bot;
  if (botId) render(botId);
});
