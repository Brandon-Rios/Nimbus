// Bot widgets: the spec and data checks (widgets-spec.js). No server, no database, no Claude.
// Run: node test/widgets.mjs   (part of npm test)
import { cleanSpec, readData } from '../widgets-spec.js';

let pass = 0; const failed = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { failed.push(name); console.log('  FAIL', name, '-', e.message); } };
const eq = (a, b, what = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const throws = (fn, what) => { try { fn(); } catch { return; } throw new Error(`${what} should be refused`); };

t('a file source inside the folder is accepted', () => eq(cleanSpec({ title: 'Shopping', kind: 'list', source: { type: 'file', path: 'widgets/list.json' } }).source, { type: 'file', path: 'widgets/list.json' }));
t('paths that leave the folder are refused', () => {
  for (const p of ['../secret.json', '/etc/passwd.json', 'a/../../b.json', 'notes.txt']) throws(() => cleanSpec({ title: 'x', kind: 'stat', source: { type: 'file', path: p } }), p);
});
t('tool sources need a plain tool name', () => {
  throws(() => cleanSpec({ title: 'x', kind: 'stat', source: { type: 'tool', name: '../rm' } }), 'bad tool name');
  eq(cleanSpec({ title: 'x', kind: 'stat', source: { type: 'tool', name: 'stock' } }).source.name, 'stock');
});
t('kind and title are required', () => {
  throws(() => cleanSpec({ title: '', kind: 'stat', source: { type: 'file', path: 'a.json' } }), 'empty title');
  throws(() => cleanSpec({ title: 'x', kind: 'chart', source: { type: 'file', path: 'a.json' } }), 'unknown kind');
});
t('refresh is clamped between 1 minute and 1 day (default 5 minutes)', () => {
  eq(cleanSpec({ title: 'x', kind: 'stat', refresh: 5, source: { type: 'file', path: 'a.json' } }).refresh, 60);
  eq(cleanSpec({ title: 'x', kind: 'stat', refresh: 1e9, source: { type: 'file', path: 'a.json' } }).refresh, 86400);
  eq(cleanSpec({ title: 'x', kind: 'stat', source: { type: 'file', path: 'a.json' } }).refresh, 300);
});
t('a stat takes value, label, sub and total', () => eq(readData('stat', { value: 6, total: 10, label: 'left' }), { value: '6', label: 'left', sub: '', total: 10 }));
t('a stat with an object value is refused', () => throws(() => readData('stat', { value: { a: 1 } }), 'object value'));
t('a list keeps 8 items and counts the rest', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ text: 'item ' + i, done: i < 2 }));
  const d = readData('list', { items });
  eq(d.items.length, 8, 'shown'); eq(d.more, 2, 'more'); eq(d.open, 8, 'open');
});
t('a list accepts plain strings and truncates long text', () => eq(readData('list', { items: ['x'.repeat(300)] }).items[0].text.length, 120));
t('data that is not a JSON object is refused', () => { throws(() => readData('list', '[1,2]'), 'array'); throws(() => readData('list', 'nope'), 'not json'); });

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
