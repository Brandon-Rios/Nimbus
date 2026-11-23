// Bot widgets: what a widget may hold. Pure checks (no database, no files) so the tests can run them alone.
// A widget is data a bot describes, never code: Nimbus draws it, so nothing a bot writes runs as script here.
import path from 'node:path';

export const KINDS = ['stat', 'list'];
export const MAX_PINNED = 3, MAX_PROPOSED = 5;
export const MIN_REFRESH = 60, DEFAULT_REFRESH = 300, MAX_REFRESH = 86400;
const str = (v, n) => String(v ?? '').slice(0, n);

// Checks what a bot proposed. Throws a message the bot can read.
export function cleanSpec(w) {
  const title = str(w?.title, 60).trim();
  if (!title) throw new Error('Give the widget a title');
  if (!KINDS.includes(w.kind)) throw new Error('kind must be "stat" or "list"');
  const s = w.source || {};
  let source;
  if (s.type === 'file') {
    const rel = str(s.path, 200).trim();
    if (!rel || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..') || !/\.json$/i.test(rel)) throw new Error('A file source must be a .json path inside your folder, e.g. widgets/list.json');
    source = { type: 'file', path: rel };
  } else if (s.type === 'tool') {
    const name = str(s.name, 40).trim();
    if (!/^[\w-]+$/.test(name)) throw new Error('A tool source needs the name of one of your API tools');
    source = { type: 'tool', name, args: str(s.args, 200) };
  } else throw new Error('source.type must be "file" or "tool"');
  const refresh = Math.max(MIN_REFRESH, Math.min(MAX_REFRESH, Math.round(Number(w.refresh)) || DEFAULT_REFRESH));
  return { title, kind: w.kind, source, refresh };
}

// Turns what the source produced into what the widget draws. Anything else is an error, shown on the card.
export function readData(kind, raw) {
  const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('The source must give a JSON object');
  if (kind === 'stat') {
    if (d.value === undefined || d.value === null || typeof d.value === 'object') throw new Error('A stat needs "value" (a number or short text)');
    return { value: str(d.value, 40), label: str(d.label, 60), sub: str(d.sub, 120), total: typeof d.total === 'number' ? d.total : null };
  }
  if (!Array.isArray(d.items)) throw new Error('A list needs an "items" array');
  const items = d.items.slice(0, 8).map((it) => typeof it === 'string'
    ? { text: str(it, 120), note: '', done: false }
    : { text: str(it?.text, 120), note: str(it?.note, 40), done: !!it?.done });
  return { items, more: Math.max(0, d.items.length - items.length), open: d.items.filter((i) => !i?.done).length };
}
