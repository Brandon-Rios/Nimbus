// Voice mode: a hands-free spoken conversation with a bot, like the Claude app's voice chat.
// The mic stays open; when you stop talking (about a second of quiet) the clip goes to whisper on the
// server, the text is sent to the bot as a normal message (marked as voice, so it answers briefly), and
// each reply is read aloud with Piper. Talk over it to interrupt. Everything stays in the chat thread.
import { toWav, base64 } from './dictation.js';

const START_LEVEL = 0.025, BARGE_LEVEL = 0.06, QUIET_MS = 1000, MIN_SPEECH_MS = 300, MAX_CLIP_MS = 60000;
let V = null;

const MODES = [['fast', 'Fast (Haiku)'], ['bot', 'Bot’s own model']];
const mode = () => localStorage.voiceMode === 'bot' ? 'bot' : 'fast';

export function voiceActive() { return !!V; }

// The bot's own pixel character, big, with an animated mouth (follows the spoken audio) and eyelids.
// Matches critter() in app.js: 14x14 grid, eyes at x 3.8 / 8.9 y 6, mouth around x 6.1-7.9 y 7.6-8.4.
function character(c) {
  if (!c) return '<div class="voice-orb"><span></span></div>';
  const ink = '#16204a', col = c.color || '#f4f6ff', rect = (x, y, w, h, f, cls = '') => `<rect ${cls ? `class="${cls}" ` : ''}x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
  const mouthY = c.face === 'mustache' ? 8.3 : 7.6;
  const cover = c.face === 'mustache' ? '' : rect(5.9, 7.5, 2.2, 1.6, col, 'vc-cover');
  const lids = c.glasses && c.glasses !== 'none' ? '' : `<g class="vc-lids">${rect(3.7, 5.9, 1.5, 1.7, col)}${rect(8.8, 5.9, 1.5, 1.7, col)}${rect(3.7, 6.6, 1.5, 0.4, ink)}${rect(8.8, 6.6, 1.5, 0.4, ink)}</g>`;
  return `<div class="voice-char"><div class="vc-body"><svg viewBox="0 0 14 14" shape-rendering="crispEdges" aria-hidden="true">${c.svg}
    <g class="vc-mouth">${cover}${rect(6.2, mouthY, 1.6, 0.4, ink, 'vc-m')}${rect(6.5, mouthY + 0.2, 1, 0.2, '#e2475f', 'vc-t')}</g>${lids}</svg></div>
    <div class="vc-dots"><i></i><i></i><i></i></div><div class="vc-shadow"></div></div>`;
}

// opts: { api, thread, botName, avatarHtml, character: { svg, color, face, glasses }, toast }
export async function startVoice(opts) {
  if (V) return;
  if (!window.isSecureContext) return opts.toast('Voice needs the HTTPS address (port 8443)');
  if (!navigator.mediaDevices?.getUserMedia) return opts.toast('This browser can’t record audio');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (err) { return opts.toast(err.name === 'NotAllowedError' ? 'Microphone access was blocked. Allow it in your browser’s site settings.' : err.message); }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const el = document.createElement('div');
  el.className = 'voice-view';
  el.innerHTML = `
    <div class="voice-top"><span class="voice-name">${opts.avatarHtml || ''}<b></b></span>
      <select class="voice-mode" aria-label="Voice model">${MODES.map(([v, l]) => `<option value="${v}" ${mode() === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    ${character(opts.character)}
    <div class="voice-state">Listening…</div>
    <div class="voice-said"></div>
    <div class="voice-btns">
      <button class="voice-btn" data-v="mute" aria-label="Mute microphone">🎙</button>
      <button class="voice-btn end" data-v="end" aria-label="End voice chat">✕</button>
    </div>`;
  el.querySelector('.voice-name b').textContent = opts.botName;
  document.body.append(el);
  V = { ...opts, stream, ctx, node, el, state: 'listening', muted: false, chunks: [], speaking: false, lastLoud: 0, speechStart: 0,
    loudRun: 0, audio: null, queue: [], thinkTimer: null, lastLevel: 0 };
  el.querySelector('.voice-mode').onchange = (e) => { localStorage.voiceMode = e.target.value; };
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'end') stopVoice();
    if (b.dataset.v === 'mute') { V.muted = !V.muted; b.classList.toggle('off', V.muted); setState(V.state); }
  });
  node.onaudioprocess = (e) => onAudio(e.inputBuffer.getChannelData(0));
  src.connect(node); node.connect(ctx.destination);
  V.keydown = (e) => { if (e.key === 'Escape') stopVoice(); };
  document.addEventListener('keydown', V.keydown);
  setState('listening');
  // Mouth: opens with the loudness of the reply while it plays.
  const m = el.querySelector('.vc-m'), t = el.querySelector('.vc-t'), buf = new Uint8Array(512);
  const tick = () => {
    if (!V || V.el !== el) return;
    let open = 0;
    if (V.state === 'speaking' && V.analyser) {
      V.analyser.getByteTimeDomainData(buf);
      let sum = 0; for (const v of buf) sum += (v - 128) ** 2;
      open = Math.min(1, Math.sqrt(sum / buf.length) / 28);
    }
    V.mouth = (V.mouth || 0) * 0.5 + open * 0.5;
    el.style.setProperty('--talk', V.mouth.toFixed(3));
    if (m) { const h = 0.4 + V.mouth * 1.3; m.setAttribute('height', h.toFixed(2)); t.setAttribute('y', (Number(m.getAttribute('y')) + h - 0.3).toFixed(2)); t.style.opacity = V.mouth > 0.25 ? 1 : 0; }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

export function stopVoice() {
  if (!V) return;
  const v = V; V = null;
  clearTimeout(v.thinkTimer);
  v.audio?.pause();
  v.node.disconnect(); v.stream.getTracks().forEach((t) => t.stop()); v.ctx.close();
  document.removeEventListener('keydown', v.keydown);
  v.el.remove();
}

function setState(s, said) {
  if (!V) return;
  V.state = s;
  V.el.dataset.state = s;
  V.el.querySelector('.voice-state').textContent = V.muted && s === 'listening' ? 'Muted' : { listening: 'Listening…', hearing: 'Listening…', sending: 'Sending…', thinking: 'Thinking…', speaking: 'Speaking — talk to interrupt' }[s];
  if (said !== undefined) V.el.querySelector('.voice-said').textContent = said;
}

function onAudio(d) {
  if (!V) return;
  let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i] * d[i];
  const level = Math.sqrt(sum / (d.length / 4)), now = performance.now();
  V.lastLevel = V.lastLevel * 0.7 + level * 0.3;
  V.el.style.setProperty('--level', Math.min(1, V.lastLevel * 12).toFixed(3));
  if (V.muted) return;
  if (V.state === 'speaking') {
    // Barge-in: a sustained loud voice over the playback stops it and starts listening.
    V.loudRun = level > BARGE_LEVEL ? V.loudRun + d.length / V.ctx.sampleRate * 1000 : 0;
    if (V.loudRun > 250) { V.audio?.pause(); V.queue = []; V.loudRun = 0; beginClip(now); }
    return;
  }
  if (V.state === 'listening') {
    if (level > START_LEVEL) beginClip(now);
    else { V.pre = (V.pre || []).concat([new Float32Array(d)]).slice(-4); } // keep a little audio from before you spoke
    return;
  }
  if (V.state !== 'hearing') return;
  V.chunks.push(new Float32Array(d));
  if (level > START_LEVEL) V.lastLoud = now;
  if (now - V.lastLoud > QUIET_MS || now - V.speechStart > MAX_CLIP_MS) endClip();
}

function beginClip(now) {
  V.chunks = V.pre || []; V.pre = [];
  V.speechStart = V.lastLoud = now;
  setState('hearing', '');
}

async function endClip() {
  const v = V, chunks = v.chunks; v.chunks = [];
  if (v.lastLoud - v.speechStart < MIN_SPEECH_MS) return setState('listening'); // a cough or a click
  setState('sending');
  try {
    const { text } = await v.api('/api/transcribe', { method: 'POST', body: { audio: base64(toWav(chunks, v.ctx.sampleRate)) } });
    if (V !== v) return;
    const said = String(text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, '').trim(); // whisper marks noise like [BLANK_AUDIO]
    if (!said) return setState('listening', '');
    setState('thinking', said);
    v.since = Date.now();
    await v.api(`/api/threads/${encodeURIComponent(v.thread)}/messages`, { method: 'POST', body: { text: said, voice: mode() } });
    clearTimeout(v.thinkTimer);
    v.thinkTimer = setTimeout(() => { if (V === v && V.state === 'thinking') setState('listening', 'No reply yet. It will show in the chat when it’s ready.'); }, 180000);
  } catch (err) {
    if (V === v) { v.toast(err.message); setState('listening'); }
  }
}

// Called by the app for every new chat message.
export function voiceMessage(m) {
  if (!V || m.thread !== V.thread || m.author === 'user' || m.kind !== 'text' || !m.body?.trim()) return;
  if (V.state !== 'thinking' && V.state !== 'speaking') return; // you're already talking again
  clearTimeout(V.thinkTimer);
  V.queue.push(m.id);
  if (V.state !== 'speaking') playNext();
}

async function playNext() {
  const v = V; if (!v) return;
  const id = v.queue.shift();
  if (!id) return setState('listening');
  setState('speaking');
  try {
    const r = await fetch('/api/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messageId: id }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Speech failed');
    const url = URL.createObjectURL(await r.blob());
    if (V !== v || v.state !== 'speaking') return URL.revokeObjectURL(url);
    const a = v.audio = new Audio(url);
    try { const srcNode = v.ctx.createMediaElementSource(a), an = v.ctx.createAnalyser(); an.fftSize = 1024; srcNode.connect(an); an.connect(v.ctx.destination); v.analyser = an; } catch { v.analyser = null; }
    const done = () => { URL.revokeObjectURL(url); if (V === v && v.audio === a && v.state === 'speaking') playNext(); };
    a.onended = done; a.onerror = done;
    await a.play();
  } catch (err) {
    if (V === v) { v.toast(err.message); playNext(); }
  }
}
