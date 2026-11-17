// Nimbus smoke tests: start a throwaway server on an empty data folder and check the core API (login, lockout,
// hooks, chats, uploads, file delete, redact, skills, settings, security headers). No Claude calls, so no usage.
// Run: npm test   (uses port 8795 and a temp folder, both removed afterwards)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PORT = 8795, BASE = `http://127.0.0.1:${PORT}`, PW = 'pw-test-' + process.pid, HOOK = 'hook-test-' + process.pid;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbus-test-'));
const srv = spawn(process.execPath, ['--no-warnings', 'server.js'], {
  cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
  env: { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(PORT), NIMBUS_HTTPS_PORT: '0', NIMBUS_DATA: DATA, NIMBUS_PASSWORD: PW, NIMBUS_HOOK_TOKEN: HOOK, NIMBUS_TRUSTED_PROXIES: '' },
});
let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });

let cookie = '', pass = 0; const failed = [];
async function req(method, p, body, headers = {}) {
  const r = await fetch(BASE + p, { method, redirect: 'manual', headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, json, text, headers: r.headers };
}
async function test(name, fn) {
  try { await fn(); pass++; console.log('  ok  ', name); } catch (e) { failed.push(name); console.log('  FAIL', name, '-', e.message); }
}
const eq = (a, b, what = '') => { if (a !== b) throw new Error(`${what} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what); };
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const upload = async (name = 'a.png', data = PNG, type = 'image/png') => (await req('POST', '/api/uploads', { name, type, data })).json;

async function main() {
  for (let i = 0; i < 60 && !/Nimbus running/.test(log); i++) await new Promise((r) => setTimeout(r, 250));
  if (!/Nimbus running/.test(log)) throw new Error('server did not start:\n' + log);
  const { db } = await import('node:sqlite').then((m) => ({ db: new m.DatabaseSync(path.join(DATA, 'nimbus.db')) }));

  console.log('Login');
  await test('API needs a login', async () => eq((await req('GET', '/api/state')).status, 401));
  await test('wrong password is refused', async () => eq((await req('POST', '/api/login', { password: 'nope' })).status, 401));
  await test('right password signs in (HttpOnly cookie)', async () => {
    const r = await req('POST', '/api/login', { password: PW });
    eq(r.status, 200); const c = r.headers.get('set-cookie') || ''; ok(/HttpOnly/.test(c) && /SameSite=Lax/.test(c), 'cookie flags'); cookie = c.split(';')[0];
  });
  await test('state loads', async () => { const r = await req('GET', '/api/state'); eq(r.status, 200); ok(Array.isArray(r.json.bots), 'bots list'); });
  await test('changes must be JSON (blocks cross-site forms)', async () => eq((await req('POST', '/api/bots', undefined, { 'content-type': 'application/x-www-form-urlencoded' })).status, 415));
  await test('lockout after 8 wrong tries, per address', async () => {
    for (let i = 0; i < 8; i++) await req('POST', '/api/login', { password: 'bad' }, { 'x-forwarded-for': '10.9.9.9' });
    eq((await req('POST', '/api/login', { password: PW }, { 'x-forwarded-for': '10.9.9.9' })).status, 429, 'locked device');
    eq((await req('POST', '/api/login', { password: PW }, { 'x-forwarded-for': '10.9.9.8' })).status, 200, 'other device');
  });
  await test('a made-up X-Forwarded-For hop can’t dodge the lockout', async () =>
    eq((await req('POST', '/api/login', { password: PW }, { 'x-forwarded-for': '1.1.1.1, 10.9.9.9' })).status, 429));

  console.log('Security');
  await test('app pages only run Nimbus scripts (CSP)', async () => { const r = await req('GET', '/'); ok(/script-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'csp header'); });
  await test('static files can’t escape public/', async () => { const r = await req('GET', '/../server.js'); ok(!/registerFiles/.test(r.text), 'leaked server.js'); });
  await test('hooks refuse a wrong token', async () => eq((await req('POST', '/api/hook/pretool', {}, { 'x-nimbus-hook': 'wrong' })).status, 403));
  await test('skills hook needs a running bot', async () => {
    eq((await req('GET', '/api/hook/skill?run=999', undefined, { 'x-nimbus-hook': HOOK })).status, 403, 'no run');
    const bot = (await req('POST', '/api/bots', { name: 'Hook Bot' })).json.id;
    const run = Number(db.prepare("INSERT INTO runs (bot_id, thread, status) VALUES (?, ?, 'running')").run(bot, 'bot:' + bot).lastInsertRowid);
    eq((await req('GET', `/api/hook/skill?run=${run}`, undefined, { 'x-nimbus-hook': HOOK })).status, 200, 'running run');
    const s = await req('POST', `/api/hook/skill?run=${run}`, { name: 'test-skill', description: 'Use in tests', body: 'Step 1' }, { 'x-nimbus-hook': HOOK });
    eq(s.status, 200, 'save');
    const list = (await req('GET', '/api/extras/skills')).json.items; ok(list.find((x) => x.name === 'test-skill')?.pending, 'bot skill waits for OK');
    ok(fs.existsSync(path.join(DATA, 'bots', String(bot), '.claude', 'skills', 'test-skill')), 'author has it');
    const other = (await req('POST', '/api/bots', { name: 'Other Bot' })).json.id;
    await req('POST', '/api/extras/skills/test-skill/approve', {});
    ok(fs.existsSync(path.join(DATA, 'bots', String(other), '.claude', 'skills', 'test-skill')), 'shared after OK');
    db.prepare("UPDATE runs SET status='done' WHERE id=?").run(run);
    eq((await req('GET', `/api/hook/skill?run=${run}`, undefined, { 'x-nimbus-hook': HOOK })).status, 403, 'finished run');
  });
  await test('bot web pages are served sandboxed', async () => {
    const f = await upload('page.html', Buffer.from('<script>1</script>').toString('base64'), 'text/html');
    const r = await req('GET', `/api/files/${f.id}/page.html?sandbox`); ok(/sandbox allow-scripts/.test(r.headers.get('content-security-policy') || ''), 'sandbox csp');
    const plain = await req('GET', `/api/files/${f.id}/page.html`); eq(plain.headers.get('content-type'), 'application/octet-stream', 'download type');
  });

  console.log('Bots and chats');
  let botId;
  await test('create, rename and delete a bot', async () => {
    const b = (await req('POST', '/api/bots', { name: 'Test Bot', role: 'tests' })).json; botId = b.id; ok(botId, 'id');
    eq((await req('PATCH', `/api/bots/${botId}`, { name: 'Renamed' })).json.name, 'Renamed');
    const tmp = (await req('POST', '/api/bots', { name: 'Throwaway' })).json.id;
    eq((await req("DELETE", `/api/bots/${tmp}`, {})).status, 200);
  });
  await test('unknown routes give 404 JSON', async () => eq((await req('GET', '/api/nope')).status, 404));
  await test('bad JSON gives a plain 400', async () => {
    const r = await fetch(BASE + '/api/bots', { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: '{bad' });
    eq(r.status, 400);
  });

  console.log('Files');
  const addMsg = (files, body = '') => Number(db.prepare("INSERT INTO messages (thread, author, kind, body, files) VALUES (?, 'user', 'text', ?, ?)").run('bot:' + botId, body, JSON.stringify(files)).lastInsertRowid);
  await test('upload and download an image', async () => {
    const f = await upload(); const r = await fetch(`${BASE}/api/files/${f.id}/a.png`, { headers: { cookie } });
    eq(r.status, 200); eq(r.headers.get('content-type'), 'image/png');
  });
  await test('delete one image: message with text stays', async () => {
    const f = await upload(); const id = addMsg([f], 'look');
    eq((await req('DELETE', `/api/messages/${id}/files/${f.id}`, {})).status, 200);
    ok(!fs.existsSync(path.join(DATA, 'uploads', f.id)), 'file removed');
    eq(JSON.parse(db.prepare('SELECT files FROM messages WHERE id=?').get(id).files).length, 0, 'files left');
  });
  await test('delete the only image: empty message goes too', async () => {
    const f = await upload(); const id = addMsg([f]);
    await req('DELETE', `/api/messages/${id}/files/all`, {});
    eq(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE id=?').get(id).n, 0);
  });
  await test('deleting a newer same-name image keeps the older one', async () => {
    const a = await upload(), b = await upload();
    const doc = Number(db.prepare("INSERT INTO file_docs (thread, name, latest) VALUES (?, 'image.png', ?)").run('bot:' + botId, b.id).lastInsertRowid);
    db.prepare('INSERT INTO file_versions (doc_id, upload_id, version) VALUES (?,?,1), (?,?,2)').run(doc, a.id, doc, b.id);
    const id = addMsg([b]);
    await req('DELETE', `/api/messages/${id}/files/${b.id}`, {});
    eq(db.prepare('SELECT latest FROM file_docs WHERE id=?').get(doc)?.latest, a.id, 'points at older');
    ok(fs.existsSync(path.join(DATA, 'uploads', a.id)), 'older kept');
  });
  await test('can’t delete files a bot sent', async () => {
    const f = await upload(); const id = Number(db.prepare("INSERT INTO messages (thread, author, kind, body, files) VALUES (?, ?, 'text', '', ?)").run('bot:' + botId, String(botId), JSON.stringify([f])).lastInsertRowid);
    eq((await req('DELETE', `/api/messages/${id}/files/${f.id}`, {})).status, 403);
  });
  await test('can’t delete while the bot hasn’t started on it', async () => {
    const f = await upload(); const id = addMsg([f]); db.prepare('UPDATE messages SET queued=1 WHERE id=?').run(id);
    eq((await req('DELETE', `/api/messages/${id}/files/${f.id}`, {})).status, 409);
  });
  await test('redact replaces text everywhere', async () => {
    const id = Number(db.prepare("INSERT INTO messages (thread, author, kind, body) VALUES (?, 'user', 'text', 'my code is hunter2-secret ok')").run('bot:' + botId).lastInsertRowid);
    eq((await req('POST', `/api/messages/${id}/redact`, { text: 'hunter2-secret' })).status, 200);
    ok(!/hunter2/.test(db.prepare('SELECT body FROM messages WHERE id=?').get(id).body), 'still there');
  });

  console.log('Settings');
  await test('settings validate input', async () => eq((await req('PUT', '/api/settings', { thread_limit: '9' })).status, 400));
  await test('settings save all or nothing', async () => {
    eq((await req('PUT', '/api/settings', { usage_guard_pct: '20', thread_limit: '9' })).status, 400);
    ok((await req('GET', '/api/settings')).json.usage_guard_pct !== '20', 'earlier field was saved anyway');
  });
  await test('memory edit refuses to overwrite a newer version', async () => {
    const m = (await req('GET', `/api/bots/${botId}/memory`)).json;
    fs.appendFileSync(path.join(DATA, 'bots', String(botId), 'MEMORY.md'), '- bot learned this meanwhile\n');
    eq((await req('PUT', `/api/bots/${botId}/memory`, { text: 'mine', hash: m.hash })).status, 409);
    ok(fs.readFileSync(path.join(DATA, 'bots', String(botId), 'MEMORY.md'), 'utf8').includes('meanwhile'), 'bot line kept');
    const m2 = (await req('GET', `/api/bots/${botId}/memory`)).json;
    eq((await req('PUT', `/api/bots/${botId}/memory`, { text: m2.text + '- mine\n', hash: m2.hash })).status, 200);
  });
  await test('trusted proxy: real device address is used', async () => {
    eq((await req('PUT', '/api/settings', { trusted_proxies: '127.0.0.1' })).status, 200);
    for (let i = 0; i < 8; i++) await req('POST', '/api/login', { password: 'bad' }, { 'x-forwarded-for': '10.7.7.7' });
    eq((await req('POST', '/api/login', { password: PW }, { 'x-forwarded-for': '10.7.7.6' })).status, 200, 'other device still in');
  });
  await test('secret settings are never sent back', async () => {
    await req('PUT', '/api/settings', { pve_token_secret: 'abc-secret' });
    eq((await req('GET', '/api/settings')).json.pve_token_secret, '__saved__');
  });
  await test('sign out ends the session', async () => {
    await req('POST', '/api/logout', {}); eq((await req('GET', '/api/state')).status, 401);
  });
}

main().catch((e) => { failed.push('setup'); console.error(e.message); }).finally(() => {
  srv.kill(); fs.rmSync(DATA, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${failed.length} failed${failed.length ? ': ' + failed.join(', ') : ''}`);
  if (/unhandled rejection|uncaught/i.test(log)) console.log('Server log had errors:\n' + log.split('\n').filter((l) => /unhandled|uncaught|Error/.test(l)).slice(0, 10).join('\n'));
  process.exit(failed.length ? 1 : 0);
});
