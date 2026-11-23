#!/usr/bin/env node
// For bots: side-panel widgets in Nimbus. You propose one; the user pins it. Its data comes from a JSON file in
// your folder or from one of your approved API tools.
//   node widget.mjs list
//   node widget.mjs propose <spec.json>     spec: {"title":"Shopping list","kind":"list|stat","refresh":300,
//                                            "source":{"type":"file","path":"widgets/list.json"}} or
//                                            "source":{"type":"tool","name":"<api tool>","args":"..."}
//   node widget.mjs remove <id>
// Data files: stat → {"value": 6, "total": 10, "label": "items left", "sub": "Tacos Thursday"}
//             list → {"items": [{"text": "Oat milk", "note": "Dairy", "done": false}]}
const { NIMBUS_URL, NIMBUS_HOOK_TOKEN, NIMBUS_RUN_ID } = process.env;
if (!NIMBUS_URL || !NIMBUS_HOOK_TOKEN || !NIMBUS_RUN_ID) { console.error('Run this from inside a Nimbus bot run.'); process.exit(2); }
import fs from 'node:fs';
const [cmd, arg] = process.argv.slice(2);
let body;
if (cmd === 'list') body = { action: 'list' };
else if (cmd === 'remove' && arg) body = { action: 'remove', id: Number(arg) };
else if (cmd === 'propose' && arg) {
  try { body = { action: 'propose', widget: JSON.parse(fs.readFileSync(arg, 'utf8')) }; }
  catch (e) { console.error(`Couldn’t read ${arg}: ${e.message}`); process.exit(2); }
} else { console.error('Usage: widget.mjs list | propose <spec.json> | remove <id>'); process.exit(2); }
const res = await fetch(`${NIMBUS_URL}/api/hook/widgets`, { method: 'POST', headers: { 'x-nimbus-hook': NIMBUS_HOOK_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ runId: Number(NIMBUS_RUN_ID), ...body }) });
const d = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
if (!res.ok || d.error) { console.error(d.error || `HTTP ${res.status}`); process.exit(1); }
if (cmd === 'list') { for (const w of d.widgets) console.log(`#${w.id} [${w.status}] ${w.title} (${w.kind})${w.last_error ? ` — error: ${w.last_error}` : ''}`); if (!d.widgets.length) console.log('(none)'); }
else if (cmd === 'propose') console.log(d.updated ? `Updated widget #${d.id}.` : `Proposed widget #${d.id}. The user can pin it in the Widgets panel.`);
else console.log('Removed.');
