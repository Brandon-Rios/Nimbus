#!/usr/bin/env node
// For bots: threads and projects in Nimbus. Only make them when the user asks.
//   node thread.mjs list
//   node thread.mjs new "<title>" [--project "<name or #id>"] [--note "<first message from you>"]
//   node thread.mjs project "<name>" [--instructions "<text>"] [--shared "<bot>,<bot>"] [--move]
//   node thread.mjs move "<project name or #id>"      (move the current thread into a project; "" = out)
const { NIMBUS_URL, NIMBUS_HOOK_TOKEN, NIMBUS_RUN_ID } = process.env;
if (!NIMBUS_URL || !NIMBUS_HOOK_TOKEN || !NIMBUS_RUN_ID) { console.error('Run this from inside a Nimbus bot run.'); process.exit(2); }
const [cmd, ...rest] = process.argv.slice(2);
const opt = (name) => { const i = rest.indexOf('--' + name); if (i < 0) return undefined; const v = rest[i + 1]; rest.splice(i, v === undefined || v.startsWith('--') ? 1 : 2); return v === undefined || v.startsWith('--') ? true : v; };
let body;
if (cmd === 'list') body = { action: 'list' };
else if (cmd === 'new') { const project = opt('project'), note = opt('note'); body = { action: 'thread', title: rest[0] || '', project, note }; }
else if (cmd === 'project') {
  const instructions = opt('instructions'), shared = opt('shared'), move = opt('move');
  body = { action: 'project', name: rest[0], instructions, shared: shared !== undefined, with: typeof shared === 'string' ? shared.split(',').map((s) => s.trim()).filter(Boolean) : [], move: !!move };
} else if (cmd === 'move') body = { action: 'move', project: rest[0] || null };
else { console.error('Usage: thread.mjs list | new "<title>" [--project P] [--note T] | project "<name>" [--instructions T] [--shared "bot,bot"] [--move] | move "<project>"'); process.exit(2); }
const res = await fetch(`${NIMBUS_URL}/api/hook/threads`, { method: 'POST', headers: { 'x-nimbus-hook': NIMBUS_HOOK_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ runId: Number(NIMBUS_RUN_ID), ...body }) });
const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
if (!res.ok || d.error) { console.error(d.error || `HTTP ${res.status}`); process.exit(1); }
if (cmd === 'list') {
  console.log('Projects:'); for (const p of d.projects) console.log(`  #${p.id} ${p.name}${p.shared ? ' (shared)' : ''}  files: ${p.folder}`);
  if (!d.projects.length) console.log('  (none)');
  console.log('Threads:'); for (const t of d.threads) console.log(`  ${t.key} ${t.title}${t.kind && t.kind !== 'chat' ? ' (built-in)' : ''}${t.project ? ` [project #${t.project}]` : ''}${t.key === d.current ? '  ← this one' : ''}`);
} else if (cmd === 'new') console.log(`Made thread ${d.key}. The user sees it in the sidebar.`);
else if (cmd === 'project') console.log(`Made project #${d.id}. Its files folder: ${d.folder}`);
else console.log('Moved.');
