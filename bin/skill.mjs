#!/usr/bin/env node
// For bots: the team's shared skills library (step-by-step how-tos every Nimbus bot loads as a Claude Code skill).
//   node skill.mjs list
//   node skill.mjs save <name> "<when to use it>" <file with the steps | ->
const { NIMBUS_URL, NIMBUS_HOOK_TOKEN, NIMBUS_RUN_ID } = process.env;
if (!NIMBUS_URL || !NIMBUS_HOOK_TOKEN || !NIMBUS_RUN_ID) { console.error('Run this from inside a Nimbus bot run.'); process.exit(2); }
import fs from 'node:fs';
const [cmd, name, description, file] = process.argv.slice(2);
const headers = { 'x-nimbus-hook': NIMBUS_HOOK_TOKEN, 'content-type': 'application/json' };
const base = `${NIMBUS_URL}/api/hook/skill?run=${Number(NIMBUS_RUN_ID)}`;
if (cmd === 'list') {
  const d = await (await fetch(base, { headers })).json();
  if (!d.items?.length) console.log('No shared skills yet.');
  for (const s of d.items || []) console.log(`- ${s.name}: ${s.description}`);
} else if (cmd === 'save' && name && description && file) {
  const body = fs.readFileSync(file === '-' ? 0 : file, 'utf8');
  const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name, description, body }) });
  if (!r.ok) { console.error((await r.json().catch(() => ({}))).error || r.status); process.exit(1); }
  console.log(`Saved skill ${name}. Every bot gets it from its next task.`);
} else { console.error('Usage: skill.mjs list | save <name> "<when to use it>" <file|->'); process.exit(2); }
