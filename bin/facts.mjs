#!/usr/bin/env node
// For bots: the team's shared memory (facts every Nimbus bot can search).
//   node facts.mjs search <words>        best matches first
//   node facts.mjs list                  newest 40
//   node facts.mjs add "<fact>" [--topic <word>]
const { NIMBUS_URL, NIMBUS_HOOK_TOKEN, NIMBUS_RUN_ID } = process.env;
if (!NIMBUS_URL || !NIMBUS_HOOK_TOKEN || !NIMBUS_RUN_ID) { console.error('Run this from inside a Nimbus bot run.'); process.exit(2); }
const [cmd, ...rest] = process.argv.slice(2);
const headers = { 'x-nimbus-hook': NIMBUS_HOOK_TOKEN, 'content-type': 'application/json' };
const base = `${NIMBUS_URL}/api/hook/facts?run=${Number(NIMBUS_RUN_ID)}`;
if (cmd === 'add') {
  const ti = rest.indexOf('--topic'), topic = ti >= 0 ? rest.splice(ti, 2)[1] : '';
  const r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ text: rest.join(' '), topic }) });
  if (!r.ok) { console.error((await r.json().catch(() => ({}))).error || r.status); process.exit(1); }
  console.log('Saved to team memory.');
} else if (cmd === 'search' || cmd === 'list') {
  const r = await fetch(`${base}&q=${encodeURIComponent(cmd === 'search' ? rest.join(' ') : '')}`, { headers });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { console.error(d.error || `HTTP ${r.status}`); process.exit(1); }
  if (!d.items?.length) console.log('Nothing in team memory matches.');
  for (const f of d.items || []) console.log(`- ${f.text}${f.topic ? ` [${f.topic}]` : ''} (${f.bot || 'user'}, ${new Date(f.updated_at * 1000).toISOString().slice(0, 10)})`);
} else { console.error('Usage: facts.mjs search <words> | list | add "<fact>" [--topic <word>]'); process.exit(2); }
