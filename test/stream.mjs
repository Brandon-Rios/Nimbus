// Replays a saved Claude Code stream (test/fixtures/*.jsonl) through stream.js and checks the trace.
// Run: node test/stream.mjs   (part of npm test; no Claude, no server)
import fs from 'node:fs';
import { createStreamReader } from '../stream.js';

let pass = 0; const failed = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { failed.push(name); console.log('  FAIL', name, '-', e.message); } };
const eq = (a, b, what = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const raw = fs.readFileSync(new URL('./fixtures/stream-basic.jsonl', import.meta.url), 'utf8');

function replay(chunkSize) {
  const trace = { steps: [] }; let changes = 0; const done = [];
  const r = createStreamReader(trace, { onChange: () => changes++, stepExtra: (b) => (b.name === 'Bash' ? { cmd: b.input.command } : null), onToolDone: (s) => done.push(s.id) });
  for (let i = 0; i < raw.length; i += chunkSize) r.feed(raw.slice(i, i + chunkSize));
  return { trace, r: r.result, changes, done };
}

console.log('Stream');
const a = replay(1e6), b = replay(7);
t('steps and their states', () => eq(a.trace.steps.map((s) => [s.tool, s.state]), [['Bash', 'done'], ['Write', 'rejected'], ['Read', 'error']]));
t('step summary', () => eq(a.trace.steps[0].text, 'Bash(ls -la /tmp)'));
t('stepExtra adds fields', () => eq(a.trace.steps[0].cmd, 'ls -la /tmp'));
t('onToolDone per result', () => eq(a.done, ['t1', 't2', 't3']));
t('final reply, cost, session', () => eq([a.r.finalText, a.r.cost, a.r.isError, a.r.sessionId], ['Done: listed /tmp.', 0.0123, false, 's-1']));
t('compaction recorded', () => eq([a.r.compacted, a.trace.context], [{ pre: 150000, post: 9000, trigger: 'auto' }, 9000]));
t('tokens and context window', () => eq([a.trace.tokens, a.trace.contextWindow], [{ in: 3020, out: 40 }, 200000]));
t('last thought', () => eq(a.trace.lastThought, 'Let me look.'));
t('chunks split mid-line give the same trace', () => eq([b.trace, b.r], [a.trace, a.r]));
t('trace saved on each change', () => eq(a.changes, 8));

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
