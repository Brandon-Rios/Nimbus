// Two-tier memory: lines move to LONG_MEMORY.md only when MEMORY.md is over the cap, oldest first, never pinned lines,
// and only after they have been there for the minimum age.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promoteMemory } from '../memory.js';

let failed = 0;
const check = (name, ok) => { console.log(`${ok ? '  ok  ' : 'FAIL  '} ${name}`); if (!ok) failed++; };
const DAY = 86400000;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-mem-'));
const memFile = path.join(dir, 'MEMORY.md'), longFile = path.join(dir, 'LONG_MEMORY.md');
const write = (lines) => fs.writeFileSync(memFile, `# Memory\n\n${lines.join('\n')}\n`);
const items = () => fs.readFileSync(memFile, 'utf8').split('\n').filter((l) => /^\s*- /.test(l));
const lines = (n, tag = 'lesson') => Array.from({ length: n }, (_, i) => `- ${tag} ${i}`);

// 1. Under the cap: nothing moves.
write(lines(3));
check('under the cap moves nothing', promoteMemory(dir, { cap: 40, now: 0 }).moved === 0 && items().length === 3);

// 2. Over the cap but every line is new (first seen now): nothing moves until the minimum age has passed.
write(lines(5));
check('new lines wait for the minimum age', promoteMemory(dir, { cap: 3, minDays: 7, now: 1000 }).moved === 0);

// 3. A week later: the oldest unpinned lines move until the cap is met; pinned lines stay.
const later = 1000 + 8 * DAY;
write([...lines(4), '- user rule: always ask first [pin]']);
const moved = promoteMemory(dir, { cap: 3, minDays: 7, now: later }).moved;
check('moves only what is over the cap', moved === 2 && items().length === 3);
check('pinned line stays in MEMORY.md', items().some((l) => l.includes('[pin]')));
check('moved lines land in LONG_MEMORY.md', fs.readFileSync(longFile, 'utf8').includes('- lesson 0') && fs.readFileSync(longFile, 'utf8').includes('- lesson 1'));
check('newest unpinned line stays short-term', items().some((l) => l.includes('lesson 3')));

// 4. Moving is an append, not a delete: running it again on the same over-cap file keeps LONG_MEMORY.md growing.
const before = fs.readFileSync(longFile, 'utf8').length;
write([...lines(5, 'more')]);
promoteMemory(dir, { cap: 3, minDays: 7, now: later });       // records when these lines first appeared
promoteMemory(dir, { cap: 3, minDays: 7, now: later + 9 * DAY }); // a week and a bit later they can move
check('long-term file only grows', fs.readFileSync(longFile, 'utf8').length > before);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : '\nall memory checks passed');
process.exit(failed ? 1 : 0);
