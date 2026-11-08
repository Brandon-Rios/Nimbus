// Threads and projects. A bot's chats are threads: its original chat stays "General" (key bot:<id>), new ones
// are t:<id>. Every bot also has two built-in threads: Inbox (requests from other bots, read-only for you) and
// Routines (scheduled runs). Threads can sit in a project: a bot's own (owner_bot_id) or shared by several bots
// (project_members). Projects add instructions and a folder; the bot reads them when a thread's conversation starts.
import fs from 'node:fs';
import path from 'node:path';
import { db, q, botDir, DATA_DIR } from './db.js';

db.exec(`
CREATE TABLE IF NOT EXISTS threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id INTEGER NOT NULL, project_id INTEGER, title TEXT DEFAULT '',
  kind TEXT DEFAULT 'chat', archived INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS threads_bot ON threads(bot_id);
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, instructions TEXT DEFAULT '', owner_bot_id INTEGER,
  archived INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch())
);
CREATE TABLE IF NOT EXISTS project_members (project_id INTEGER, bot_id INTEGER, PRIMARY KEY (project_id, bot_id));
`);
if (!q('PRAGMA table_info(rooms)').all().some((c) => c.name === 'project_id')) db.exec('ALTER TABLE rooms ADD COLUMN project_id INTEGER');

export const BUILT_IN = { inbox: 'Inbox', routines: 'Routines' };
const tid = (key) => (/^t:\d+$/.test(String(key)) ? Number(String(key).slice(2)) : null);
export const threadRow = (key) => { const id = tid(key); return id ? q('SELECT * FROM threads WHERE id=?').get(id) || null : null; };

// The bot a 1:1 thread belongs to (null for group chats and unknown keys).
export function threadBot(key) {
  if (/^bot:\d+$/.test(String(key))) return Number(String(key).slice(4));
  return threadRow(key)?.bot_id ?? null;
}

// A bot's Inbox or Routines thread, made the first time it's needed.
export function builtIn(botId, kind) {
  const r = q('SELECT id FROM threads WHERE bot_id=? AND kind=?').get(Number(botId), kind);
  if (r) return 't:' + r.id;
  return 't:' + Number(q('INSERT INTO threads (bot_id, kind, title) VALUES (?,?,?)').run(Number(botId), kind, BUILT_IN[kind]).lastInsertRowid);
}

export function createThread({ botId, title = '', projectId = null }) {
  if (!q('SELECT 1 FROM bots WHERE id=?').get(Number(botId))) throw new Error('No such bot');
  if (projectId != null && !canUseProject(Number(projectId), Number(botId))) throw new Error('That bot isn’t in this project');
  const r = q('INSERT INTO threads (bot_id, project_id, title) VALUES (?,?,?)').run(Number(botId), projectId == null ? null : Number(projectId), String(title).trim().slice(0, 80));
  return 't:' + Number(r.lastInsertRowid);
}
export function updateThread(id, { title, projectId, archived }) {
  const t = q('SELECT * FROM threads WHERE id=?').get(Number(id));
  if (!t) throw new Error('No such thread');
  if (t.kind !== 'chat') throw new Error('Built-in threads can’t be changed');
  if (projectId !== undefined && projectId !== null && !canUseProject(Number(projectId), t.bot_id)) throw new Error('That bot isn’t in this project');
  q('UPDATE threads SET title=?, project_id=?, archived=? WHERE id=?').run(
    title === undefined ? t.title : String(title).trim().slice(0, 80),
    projectId === undefined ? t.project_id : projectId === null ? null : Number(projectId),
    archived === undefined ? t.archived : archived ? 1 : 0, t.id);
}
export function deleteThread(id) {
  const t = q('SELECT * FROM threads WHERE id=?').get(Number(id));
  if (!t) return;
  if (t.kind !== 'chat') throw new Error('Built-in threads can’t be deleted');
  if (q("SELECT 1 FROM runs WHERE thread=? AND status IN ('running','queued')").get('t:' + t.id)) throw new Error('The bot is working in this thread. Stop it first.');
  q('DELETE FROM messages WHERE thread=?').run('t:' + t.id);
  q('DELETE FROM sessions WHERE thread=?').run('t:' + t.id);
  q('DELETE FROM threads WHERE id=?').run(t.id);
}
// Name a new thread from its first message, locally (no extra Claude call).
export function autoTitle(key, text) {
  const t = threadRow(key);
  if (!t || t.kind !== 'chat' || t.title) return;
  const words = String(text).replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/[#*_`>\[\]()]/g, ' ').trim().split(/\s+/).filter(Boolean);
  let title = words.slice(0, 7).join(' ');
  if (title.length > 48) title = title.slice(0, 47).replace(/\s+\S*$/, '') + '…';
  else if (words.length > 7) title += '…';
  q('UPDATE threads SET title=? WHERE id=?').run(title || 'New thread', t.id);
}
export function removeBotThreads(botId) {
  for (const t of q('SELECT id FROM threads WHERE bot_id=?').all(Number(botId))) { q('DELETE FROM messages WHERE thread=?').run('t:' + t.id); q('DELETE FROM sessions WHERE thread=?').run('t:' + t.id); }
  q('DELETE FROM threads WHERE bot_id=?').run(Number(botId));
  q('DELETE FROM project_members WHERE bot_id=?').run(Number(botId));
  for (const p of q('SELECT id FROM projects WHERE owner_bot_id=?').all(Number(botId))) deleteProject(p.id);
}

// ---------- projects ----------
export const projectMembers = (id) => q('SELECT bot_id FROM project_members WHERE project_id=? ORDER BY bot_id').all(Number(id)).map((r) => r.bot_id);
export function canUseProject(projectId, botId) {
  const p = q('SELECT * FROM projects WHERE id=?').get(Number(projectId));
  if (!p) return false;
  return p.owner_bot_id != null ? p.owner_bot_id === Number(botId) : projectMembers(p.id).includes(Number(botId));
}
export function createProject({ name, instructions = '', ownerBotId = null, members = [] }) {
  name = String(name || '').trim().slice(0, 60);
  if (!name) throw new Error('Give the project a name');
  const r = q('INSERT INTO projects (name, instructions, owner_bot_id) VALUES (?,?,?)').run(name, String(instructions).slice(0, 8000), ownerBotId == null ? null : Number(ownerBotId));
  const id = Number(r.lastInsertRowid);
  if (ownerBotId == null) setMembers(id, members);
  projectFolder(id);
  return id;
}
function setMembers(id, members) {
  const ids = [...new Set((members || []).map(Number).filter((b) => q('SELECT 1 FROM bots WHERE id=?').get(b)))];
  if (ids.length < 1) throw new Error('Pick at least one bot for a shared project');
  q('DELETE FROM project_members WHERE project_id=?').run(id);
  for (const b of ids) q('INSERT INTO project_members (project_id, bot_id) VALUES (?,?)').run(id, b);
  // Threads of bots that left the project fall back to no project.
  q(`UPDATE threads SET project_id=NULL WHERE project_id=? AND bot_id NOT IN (${ids.join(',')})`).run(id);
}
export function updateProject(id, { name, instructions, members, archived }) {
  const p = q('SELECT * FROM projects WHERE id=?').get(Number(id));
  if (!p) throw new Error('No such project');
  q('UPDATE projects SET name=?, instructions=?, archived=? WHERE id=?').run(
    name === undefined ? p.name : String(name).trim().slice(0, 60) || p.name,
    instructions === undefined ? p.instructions : String(instructions).slice(0, 8000),
    archived === undefined ? p.archived : archived ? 1 : 0, p.id);
  if (p.owner_bot_id == null && Array.isArray(members)) setMembers(p.id, members);
}
// Deleting a project keeps its threads (they move out of the project) and its files.
export function deleteProject(id) {
  q('UPDATE threads SET project_id=NULL WHERE project_id=?').run(Number(id));
  q('UPDATE rooms SET project_id=NULL WHERE project_id=?').run(Number(id));
  q('DELETE FROM project_members WHERE project_id=?').run(Number(id));
  q('DELETE FROM projects WHERE id=?').run(Number(id));
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'project';
// Own projects keep files in the bot's folder; shared ones in data/shared, which every bot can reach.
export function projectFolder(id) {
  const p = q('SELECT * FROM projects WHERE id=?').get(Number(id));
  if (!p) return null;
  const dir = p.owner_bot_id != null
    ? path.join(botDir(p.owner_bot_id), 'projects', `${slug(p.name)}-${p.id}`)
    : path.join(DATA_DIR, 'shared', 'projects', `${slug(p.name)}-${p.id}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function listAll() {
  const threads = q('SELECT * FROM threads ORDER BY id').all();
  const projects = q('SELECT * FROM projects ORDER BY id').all().map((p) => ({ ...p, members: p.owner_bot_id == null ? projectMembers(p.id) : [p.owner_bot_id] }));
  return { threads, projects };
}

// What the bot is told when a conversation in a thread starts (kept short: it's paid for on every new session).
export function threadContext(key, botId) {
  const t = threadRow(key);
  if (!t) return '';
  if (t.kind === 'inbox') return '(This is your Inbox thread: requests from other Nimbus bots. The user reads it but doesn’t write here.)\n\n';
  if (t.kind !== 'chat') return '';
  if (!t.project_id) return t.title ? `(Thread: "${t.title}". Other threads with the user are separate conversations.)\n\n` : '';
  const p = q('SELECT * FROM projects WHERE id=?').get(t.project_id);
  if (!p) return '';
  const others = p.owner_bot_id == null ? projectMembers(p.id).filter((b) => b !== Number(botId)).map((b) => q('SELECT name FROM bots WHERE id=?').get(b)?.name).filter(Boolean) : [];
  return `(Project "${p.name}"${p.owner_bot_id == null ? ', shared' : ''}${t.title ? `, thread "${t.title}"` : ''}. Project files: ${projectFolder(p.id)}`
    + (others.length ? `. Other bots in it: ${others.join(', ')}` : '') + ')\n'
    + (p.instructions.trim() ? `Project instructions:\n${p.instructions.trim()}\n` : '') + '\n';
}
