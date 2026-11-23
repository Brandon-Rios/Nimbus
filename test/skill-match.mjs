// Skill matching (skill-match.js): which installed skills fit a message. Pure; no server, no Claude.
// Run: node test/skill-match.mjs   (part of npm test)
import { matchSkills, words } from '../skill-match.js';

let pass = 0; const failed = [];
const t = (name, fn) => { try { fn(); pass++; console.log('  ok  ', name); } catch (e) { failed.push(name); console.log('  FAIL', name, '-', e.message); } };
const eq = (a, b, what = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const skills = [
  { name: 'safe-change', description: 'Use before changing any config, service or device in the homelab (firewall rules, Proxmox guests, Docker, network): back up, change, verify, roll back on failure.' },
  { name: 'tdd', description: 'Use when building a feature or fixing a bug in code test-first (red-green), or when adding tests.' },
  { name: 'research', description: 'Use when asked to research a question, gather docs or API facts, or compare options from reliable sources.' },
];

t('stop words and short words are ignored', () => eq(words('how do I do it'), []));
t('endings are trimmed so changing matches change', () => eq(words('changing the configs')[0], 'chang'));
t('a message about a firewall change picks safe-change', () => eq(matchSkills('change the firewall rules, is it safe?', skills), ['safe-change']));
t('a request for tests picks tdd', () => eq(matchSkills('add tests for the login bug', skills), ['tdd']));
t('one shared word is not enough', () => eq(matchSkills('what is the weather', skills), []));
t('no skills, no picks', () => eq(matchSkills('add tests', []), []));
t('at most two picks', () => eq(matchSkills('compare options and research the docs for the firewall change in the config service', skills).length <= 2, true));

console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
