// Picks the skills that fit a message. Runs locally (no Claude call): it compares the words in the message with
// each installed skill's name and description, and only suggests skills that share at least two meaningful words.
import fs from 'node:fs';
import path from 'node:path';

const STOP = new Set('a an the and or of to in on for with my your our is are be it this that do does did i me we you can could please how what when where why use make get about from at by as if so not no yes just any some all out up'.split(' '));
export const MIN_HITS = 2, MAX_PICKS = 2;

// Lowercase words without stop words, with simple endings removed (changes, changed, change -> chang).
export function words(text) {
  return [...new Set(String(text || '').toLowerCase().match(/[a-z][a-z0-9]+/g) || [])]
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 5 ? w.replace(/(ing|ed|es|s)$/, '') : w));
}

// Skills a bot has installed: name and description from each SKILL.md's front matter.
export function installedSkills(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.flatMap((name) => {
    try {
      const text = fs.readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
      const description = text.match(/^description:\s*(.*)$/m)?.[1] || '';
      return [{ name, description }];
    } catch { return []; }
  });
}

// Names of the skills that fit the message, best first. Empty when nothing fits well enough.
export function matchSkills(message, skills, max = MAX_PICKS) {
  const mine = words(message);
  if (!mine.length) return [];
  return skills
    .map((s) => { const theirs = new Set(words(`${s.name.replace(/-/g, ' ')} ${s.description}`)); return { name: s.name, hits: mine.filter((w) => theirs.has(w)).length }; })
    .filter((x) => x.hits >= MIN_HITS)
    .sort((a, b) => b.hits - a.hits || a.name.localeCompare(b.name))
    .slice(0, max)
    .map((x) => x.name);
}
