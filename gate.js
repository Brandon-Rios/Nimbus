// The tool-call gate: decides whether a bot may run a tool right now. Every Claude Code tool call goes
// through hooks/approval-hook.js -> POST /api/hook/pretool -> gate.decide(). Steps, in this order:
//   1. guard      Nimbus's private data and code (non-trusted bots)        -> deny
//   2. journal    note the file before an edit (so it can be undone)
//   3. rules      bot's "Ask first" rules minus "Always allow" / @self-email -> allow if not gated
//   4. plan       a command from a plan you approved in this chat           -> allow
//   5. auto       Settings -> Auto-approve (rules or Haiku)                  -> allow
//   6. stopped?   the run ended while we checked                            -> deny
//   7. ask        an approval card in the chat                              -> ask
// No imports from the rest of Nimbus: the server passes its parts in (createGate), so tests can pass fakes.
import path from 'node:path';

const globToRe = (glob) => new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'is');
const toolArg = (input = {}) => String(input.command ?? input.file_path ?? input.url ?? JSON.stringify(input));

export function ruleMatches(rule, tool, input) {
  const m = rule.match(/^([^(]+)\((.*)\)$/s);
  if (m) return globToRe(m[1].trim()).test(tool) && globToRe(m[2]).test(toolArg(input));
  return globToRe(rule.trim()).test(tool);
}
// "@self-email" in a bot's Always-allow rules lets it send email only to the Nimbus owner's own
// addresses (NIMBUS_ALLOWED_EMAILS) without asking; mail to anyone else still waits for approval.
export function isSelfEmail(tool, input = {}, allowed = []) {
  if (!/Gmail__(send_message|create_draft)$/i.test(tool)) return false;
  const list = (v) => (Array.isArray(v) ? v : v ? String(v).split(',') : []).map((x) => String(x).replace(/^.*<|>.*$/g, '').trim().toLowerCase()).filter(Boolean);
  const all = [...list(input.to), ...list(input.cc), ...list(input.bcc)];
  return all.length > 0 && all.every((e) => allowed.includes(e));
}
export function commandPrefix(cmd) {
  const words = cmd.split(/\s+/);
  const keep = [];
  for (const w of words) { if (keep.length >= 2 || /^[-'"$|;&><]/.test(w)) break; keep.push(w); }
  return (keep.join(' ') || words[0]) + ' ';
}
// The rule "Always allow" saves: the exact command, or a prefix pattern of its first words.
export function rememberRule(tool, input, kind) {
  if (tool !== 'Bash') return tool;
  const cmd = String(input.command || '').trim();
  if (kind !== 'pattern') return `Bash(${cmd})`;
  return `Bash(${commandPrefix(cmd)}*)`;
}

// Guard for bots that don't manage Nimbus: no reading its secrets (data/: keys, tokens, the database, other
// bots' folders; .env; .git) and no writing its files. A bot's own folder and chat uploads stay open, and
// Nimbus's helper tools (bin/) still run. The shell check is a text match, not a sandbox; the sandbox
// (sandbox.js) is the real wall. Returns a reason to deny, or null.
export function guardNimbus(tool, input, { nimbusDir, ownDir, trusted }) {
  if (trusted) return null;
  const NIMBUS_DIR = path.resolve(nimbusDir);
  const own = path.resolve(ownDir) + path.sep;
  const inNimbus = (r) => (r === NIMBUS_DIR || r.startsWith(NIMBUS_DIR + path.sep)) && !(r + path.sep).startsWith(own);
  const secretPath = (r) => {
    if (!inNimbus(r)) return false;
    const rel = path.relative(NIMBUS_DIR, r);
    return rel === 'data' || /^\.env/.test(rel) || /^\.git(\/|$)/.test(rel)
      || (rel.startsWith('data' + path.sep) && !/^data[\\/](uploads|shared)[\\/]/.test(rel));
  };
  const nimbusCode = (r) => inNimbus(r) && !/^data[\\/]shared[\\/]/.test(path.relative(NIMBUS_DIR, r));
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const f = input?.file_path || input?.notebook_path;
    return f && nimbusCode(path.resolve(own, String(f))) ? `writing ${f} is blocked` : null;
  }
  if (/^(Read|Grep|Glob|NotebookRead|LS)$/.test(tool)) {
    const f = input?.file_path || input?.notebook_path || input?.path;
    return f && secretPath(path.resolve(own, String(f))) ? `reading ${f} is blocked` : null;
  }
  if (tool === 'Bash') {
    const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const c = String(input?.command || '').replace(new RegExp(esc(own.slice(0, -1)) + '(?=/|["\'\\s;&|)]|$)', 'g'), 'BOT_DIR')
      .replace(new RegExp(esc(path.join(NIMBUS_DIR, 'data')) + '/(uploads|shared)/', 'g'), 'OPEN/');
    const d = esc(NIMBUS_DIR);
    if (new RegExp(`${d}/(data|\\.env|\\.git)\\b`).test(c) || /(~|\$HOME|\/home\/[^/\s]+)\/nimbus\/(data|\.env)\b/.test(c) || /\b(secret\.key|admin\.token|nimbus\.db)\b/.test(c))
      return 'that command reads Nimbus’s private data';
  }
  return null;
}

// Does this call need the user (before plan / auto-approve)? bot: { approval_rules, allow_rules }.
export function isGated(bot, tool, input, allowedEmails = []) {
  return bot.approval_rules.some((r) => ruleMatches(r, tool, input)) && !bot.allow_rules.some((r) => ruleMatches(r, tool, input))
    && !(bot.allow_rules.includes('@self-email') && isSelfEmail(tool, input, allowedEmails));
}

// parts: { nimbusDir, ownDir(botId), trusted(botId), allowedEmails, journal(run, tool, input), planAllows(thread, tool, input),
//   autoApprove(bot, run, tool, input) -> {allow, why}, runStatus(runId), ask({ bot, run, tool, input, why, pattern }) -> approvalId }
// decide() returns { decision: 'allow' } | { decision: 'deny', reason } | { decision: 'ask', approvalId }.
export function createGate(parts) {
  async function decide(bot, run, tool, input) {
    const guard = guardNimbus(tool, input, { nimbusDir: parts.nimbusDir, ownDir: parts.ownDir(bot.id), trusted: parts.trusted(bot.id) });
    if (guard) return { decision: 'deny', reason: `Nimbus: ${guard}. Bots can't read Nimbus's private data or change its files. Don't retry; tell the user if you need it.` };
    parts.journal(run, tool, input);
    if (!isGated(bot, tool, input, parts.allowedEmails)) return { decision: 'allow' };
    if (parts.planAllows(run.thread, tool, input)) return { decision: 'allow' }; // part of a plan you approved
    const auto = await Promise.resolve().then(() => parts.autoApprove(bot, run, tool, input)).catch(() => ({ allow: false }));
    if (auto.allow) return { decision: 'allow' };
    // The check can take seconds; if the run was stopped meanwhile, don't leave a card nobody can answer.
    if (parts.runStatus(run.id) !== 'running') return { decision: 'deny', reason: 'The task was stopped.' };
    const pattern = tool === 'Bash' ? commandPrefix(String(input?.command || '')).trim() + ' …' : null;
    return { decision: 'ask', approvalId: parts.ask({ bot, run, tool, input, why: auto.why, pattern }) };
  }
  return { decide };
}
