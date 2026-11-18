// Tool-call gate (gate.js) decision table: no server, no Claude, runs in milliseconds.
// Run: node test/gate.mjs   (part of npm test)
import { createGate, rememberRule } from '../gate.js';

const N = '/srv/nimbus', OWN = (id) => `${N}/data/bots/${id}`;
let pass = 0; const failed = [];
const bot = (id, approval_rules = ['Bash', 'Write'], allow_rules = []) => ({ id, approval_rules, allow_rules });
function gateWith(over = {}) {
  const log = { journal: 0, asked: 0 };
  const g = createGate({
    nimbusDir: N, ownDir: OWN, trusted: (id) => id === 3, allowedEmails: ['me@example.com'],
    journal: () => { log.journal++; }, planAllows: (t, tool, i) => i?.command === 'planned cmd',
    autoApprove: async (b, r, tool, i) => ({ allow: i?.command === 'ls /tmp' }), runStatus: () => 'running',
    ask: () => { log.asked++; return 42; }, ...over,
  });
  return { g, log };
}
const run = { id: 1, thread: 't:1', bot_id: 9 };
async function t(name, b, tool, input, want, over) {
  const { g, log } = gateWith(over);
  const r = await g.decide(b, run, tool, input);
  const got = r.decision + (r.approvalId ? ':' + r.approvalId : '');
  if (got === want) { pass++; console.log('  ok  ', name); } else { failed.push(name); console.log('  FAIL', name, '- expected', want, 'got', got, r.reason || ''); }
  return log;
}

console.log('Gate');
await t('reading Nimbus data is denied', bot(9), 'Read', { file_path: `${N}/data/nimbus.db` }, 'deny');
await t('a shell command naming data/ is denied', bot(9), 'Bash', { command: `cat ${N}/data/secret.key` }, 'deny');
await t('~/nimbus/.env in a command is denied', bot(9), 'Bash', { command: 'cat ~/nimbus/.env' }, 'deny');
await t('editing Nimbus code is denied', bot(9, []), 'Edit', { file_path: `${N}/server.js` }, 'deny');
await t('own folder is open', bot(9, []), 'Read', { file_path: `${OWN(9)}/MEMORY.md` }, 'allow');
await t('relative path in own folder is open', bot(9, []), 'Write', { file_path: 'notes.md' }, 'allow');
await t('another bot’s folder is denied', bot(9, []), 'Read', { file_path: `${OWN(4)}/.env` }, 'deny');
await t('chat uploads are open', bot(9, []), 'Read', { file_path: `${N}/data/uploads/a.png` }, 'allow');
await t('trusted bot may read data/', bot(3, []), 'Read', { file_path: `${N}/data/nimbus.db` }, 'allow');
await t('ungated tool is allowed', bot(9), 'Read', { file_path: '/etc/hosts' }, 'allow');
await t('gated tool asks', bot(9), 'Bash', { command: 'rm -rf /tmp/x' }, 'ask:42');
await t('Always-allow pattern skips asking', bot(9, ['Bash'], ['Bash(git status*)']), 'Bash', { command: 'git status -s' }, 'allow');
await t('pattern doesn’t leak to other commands', bot(9, ['Bash'], ['Bash(git status*)']), 'Bash', { command: 'git push' }, 'ask:42');
await t('planned command is allowed', bot(9), 'Bash', { command: 'planned cmd' }, 'allow');
await t('auto-approve allows', bot(9), 'Bash', { command: 'ls /tmp' }, 'allow');
await t('auto-approve error falls back to asking', bot(9), 'Bash', { command: 'x' }, 'ask:42', { autoApprove: async () => { throw new Error('boom'); } });
await t('stopped run gets no card', bot(9), 'Bash', { command: 'x' }, 'deny', { runStatus: () => 'stopped' });
await t('@self-email to the owner is allowed', bot(9, ['*Gmail__send_message'], ['@self-email']), 'mcp__g__Gmail__send_message', { to: 'Me <me@example.com>' }, 'allow');
await t('@self-email to someone else asks', bot(9, ['*Gmail__send_message'], ['@self-email']), 'mcp__g__Gmail__send_message', { to: 'me@example.com, x@y.z' }, 'ask:42');
{ const log = await t('denied calls are not journaled', bot(9), 'Write', { file_path: `${N}/server.js` }, 'deny'); if (log.journal) failed.push('journal on deny'); }
{ const ok = rememberRule('Bash', { command: 'git log --oneline' }, 'pattern') === 'Bash(git log *)'; ok ? pass++ : failed.push('rememberRule'); console.log(ok ? '  ok  ' : '  FAIL', 'remember a command pattern'); }

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
