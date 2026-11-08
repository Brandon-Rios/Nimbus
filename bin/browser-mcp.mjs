#!/usr/bin/env node
// MCP server for the Browser plugin: Playwright MCP attached to the bot's own long-lived browser
// (see browser.js), so you can watch the bot's page live in the chat's Browser pane.
// Started by Claude Code inside a Nimbus run (uses the run's NIMBUS_RUN_ID / NIMBUS_HOOK_TOKEN).
import { spawn } from 'node:child_process';
const { NIMBUS_RUN_ID: runId, NIMBUS_HOOK_TOKEN: token, NIMBUS_URL: base = 'http://127.0.0.1:8787' } = process.env;
const pw = ['-y', '@playwright/mcp@latest'];
let extra = ['--isolated']; // outside a Nimbus run (or if the shared browser fails): a private throwaway browser
if (runId && token) {
  try {
    const res = await fetch(`${base}/api/hook/browser`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-nimbus-hook': token },
      body: JSON.stringify({ runId: Number(runId) })
    });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.status);
    extra = ['--cdp-endpoint', `http://127.0.0.1:${out.port}`];
  } catch (e) { console.error('Nimbus browser unavailable, using a private one: ' + e.message); }
}
// npx is a .cmd shim on Windows, so it goes through the shell there.
const child = spawn('npx', [...pw, ...extra], { stdio: 'inherit', shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => child.kill(sig));
