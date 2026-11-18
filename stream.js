// Claude Code's stream-json output -> a run's trace. Pure: no database, no processes, so a saved stream
// can be replayed in a test (test/stream.mjs). runner.js feeds it stdout chunks and saves the trace on change.
//   const r = createStreamReader(trace, { onChange, stepExtra, onToolDone })
//   r.feed(chunk) ... r.result -> { sessionId, finalText, isError, cost, compacted }
// trace: { steps: [], context?, compacted?, lastThought?, tokens?, contextWindow? } (mutated in place).
// stepExtra(block) adds fields to a new tool step (diffs, commands); onToolDone(step, block) runs when its result arrives.

export function summarizeTool(name, input = {}) {
  const arg = input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.url ?? input.query ?? input.description;
  const s = arg != null ? String(arg) : JSON.stringify(input);
  const short = s.length > 90 ? s.slice(0, 87) + '…' : s;
  return `${name}(${short.replace(/\s+/g, ' ')})`;
}
export const toolText = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((x) => x.text || '').join('\n') : '');

export function createStreamReader(trace, { onChange = () => {}, stepExtra = () => null, onToolDone = () => {} } = {}) {
  const toolsById = new Map();
  const result = { sessionId: null, finalText: null, isError: false, cost: 0, compacted: null };
  let buf = '';
  function event(ev) {
    if (ev.session_id) result.sessionId = ev.session_id;
    // Claude Code compacted the history (asked with /compact, or on its own near the limit).
    if (ev.type === 'system' && ev.subtype === 'compact_boundary') {
      const m = ev.compact_metadata || {};
      result.compacted = { pre: m.pre_tokens || 0, post: m.post_tokens || 0, trigger: m.trigger || 'auto' };
      trace.context = result.compacted.post; trace.compacted = result.compacted;
      onChange();
    }
    if (ev.type === 'assistant' && ev.message?.content) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_use') {
          const step = { id: block.id, tool: block.name, text: summarizeTool(block.name, block.input), state: 'running' };
          Object.assign(step, stepExtra(block) || {});
          toolsById.set(block.id, step);
          trace.steps.push(step);
          onChange();
        } else if (block.type === 'text' && block.text?.trim()) {
          trace.lastThought = block.text.trim().slice(0, 300);
        }
      }
    }
    // Context in use = what the latest model call read: fresh input plus cached prompt.
    if (ev.type === 'assistant' && ev.message?.usage) {
      const u = ev.message.usage;
      const ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      if (ctx && ctx !== trace.context) { trace.context = ctx; onChange(); }
    }
    if (ev.type === 'user' && Array.isArray(ev.message?.content)) {
      for (const block of ev.message.content) {
        if (block.type === 'tool_result' && toolsById.has(block.tool_use_id)) {
          const step = toolsById.get(block.tool_use_id);
          const denied = block.is_error && /Nimbus: rejected/.test(JSON.stringify(block.content));
          step.state = denied ? 'rejected' : block.is_error ? 'error' : 'done';
          onToolDone(step, block);
          onChange();
        }
      }
    } else if (ev.type === 'result') {
      result.finalText = ev.result ?? '';
      result.isError = !!ev.is_error;
      result.cost = ev.total_cost_usd || 0;
      const u = ev.usage || {};
      trace.tokens = { in: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), out: u.output_tokens || 0 };
      const win = Math.max(0, ...Object.values(ev.modelUsage || {}).map((m) => m.contextWindow || 0));
      if (win) trace.contextWindow = win;
    }
  }
  function feed(chunk) {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { continue; }
      event(ev);
    }
  }
  return { feed, result };
}
