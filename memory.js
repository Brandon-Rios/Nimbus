// Two-tier bot memory. MEMORY.md is short-term: it is loaded into every run, so it stays short. When it grows past
// the cap, the oldest unpinned lines move to LONG_MEMORY.md, which a bot searches only when it needs something.
// Local logic only (no Claude call). A line marked [pin] never moves; a line moves only after it has been there
// for minDays, so new lessons get a chance to be used first.
import fs from 'node:fs';
import path from 'node:path';

const isItem = (l) => /^\s*- /.test(l);
const key = (l) => l.trim();

export function promoteMemory(dir, { cap = 40, minDays = 7, now = Date.now() } = {}) {
  const mem = path.join(dir, 'MEMORY.md'), meta = path.join(dir, 'MEMORY.meta.json'), long = path.join(dir, 'LONG_MEMORY.md');
  if (!fs.existsSync(mem)) return { moved: 0 };
  let seen = {};
  try { seen = JSON.parse(fs.readFileSync(meta, 'utf8')); } catch { /* first run: nothing known yet */ }
  const lines = fs.readFileSync(mem, 'utf8').split('\n');
  // When each line was first seen here. Lines seen for the first time count as added now.
  const first = {};
  for (const l of lines) if (isItem(l)) first[key(l)] = seen[key(l)] ?? now;
  const items = lines.map((l, i) => ({ l, i })).filter((x) => isItem(x.l));
  const over = items.length - cap;
  let moved = 0;
  if (over > 0) {
    const minMs = minDays * 86400000;
    const candidates = items
      .filter(({ l }) => !/\[pin\]/.test(l) && now - first[key(l)] >= minMs)
      .sort((a, b) => first[key(a.l)] - first[key(b.l)])
      .slice(0, over);
    if (candidates.length) {
      const drop = new Set(candidates.map((c) => c.i));
      if (!fs.existsSync(long)) fs.writeFileSync(long, '# Long-term memory\n\nOlder lessons. Not loaded every run: search it when you need something (grep).\n');
      const day = new Date(now).toISOString().slice(0, 10);
      fs.appendFileSync(long, `\n## Moved ${day}\n${candidates.map((c) => c.l.trim()).join('\n')}\n`);
      fs.writeFileSync(mem, lines.filter((_, i) => !drop.has(i)).join('\n'));
      moved = candidates.length;
    }
  }
  // Remember when each remaining line was first seen, so the next sweep can tell old from new.
  const out = {};
  for (const l of fs.readFileSync(mem, 'utf8').split('\n')) if (isItem(l)) out[key(l)] = first[key(l)] ?? now;
  fs.writeFileSync(meta, JSON.stringify(out));
  return { moved };
}
