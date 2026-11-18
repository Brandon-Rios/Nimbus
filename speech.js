// Speech and languages: read aloud (Piper / Kokoro), voice dictation (whisper.cpp) and interface translation
// (Argos). Each helper server starts on first use and listens on 127.0.0.1 only. Moved out of server.js.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { q, parseBot, writeBotBrief, DATA_DIR, getSetting, setSetting } from './db.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function registerSpeech(route, { json, body }) {
  // ---------- read aloud (Piper, local text-to-speech) ----------
  // Turns a bot reply into speech on this server; nothing leaves the network.
  const PIPER_BIN = process.env.NIMBUS_PIPER_BIN || path.join(os.homedir(), 'opt/piper/piper');
  const PIPER_VOICE = process.env.NIMBUS_PIPER_VOICE || path.join(os.homedir(), 'opt/piper-voices/en_US-lessac-medium.onnx');
  // Markdown and links read badly, so speak plain text.
  const speakable = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' (code omitted) ').replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'a link').replace(/[*_#>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 6000);
  // Kokoro: natural-sounding voices, run as a local service (bin/kokoro-server.py) that keeps the model loaded.
  const KOKORO_PY = process.env.NIMBUS_KOKORO_PY || path.join(os.homedir(), 'opt/kokoro-py/bin/python');
  const KOKORO_DIR = process.env.NIMBUS_KOKORO_DIR || path.join(os.homedir(), 'opt/kokoro');
  const KOKORO_PORT = Number(process.env.NIMBUS_KOKORO_PORT || 8179);
  let kokoroProc = null, kokoroFails = 0;
  function startKokoro() {
    const model = path.join(KOKORO_DIR, 'kokoro-v1.0.onnx'), voices = path.join(KOKORO_DIR, 'voices-v1.0.bin');
    if (!fs.existsSync(KOKORO_PY) || !fs.existsSync(model) || !fs.existsSync(voices)) return;
    kokoroProc = spawn(KOKORO_PY, ['-I', path.join(HERE, 'bin/kokoro-server.py'), model, voices, String(KOKORO_PORT)], { stdio: 'ignore' });
    kokoroProc.on('exit', () => { kokoroProc = null; if (++kokoroFails <= 5) setTimeout(startKokoro, 5000 * kokoroFails); });
    setTimeout(() => { kokoroFails = 0; }, 60_000).unref();
  }
  startKokoro();
  process.on('exit', () => kokoroProc?.kill());
  const KOKORO_VOICES = { af_heart: 'Heart', af_bella: 'Bella', af_nicole: 'Nicole', af_sarah: 'Sarah', af_sky: 'Sky', af_nova: 'Nova', af_jessica: 'Jessica', af_river: 'River', af_aoede: 'Aoede', af_kore: 'Kore', af_alloy: 'Alloy',
    am_michael: 'Michael', am_adam: 'Adam', am_eric: 'Eric', am_liam: 'Liam', am_onyx: 'Onyx', am_echo: 'Echo', am_fenrir: 'Fenrir', am_puck: 'Puck',
    bf_emma: 'Emma', bf_isabella: 'Isabella', bf_alice: 'Alice', bf_lily: 'Lily', bm_george: 'George', bm_daniel: 'Daniel', bm_lewis: 'Lewis', bm_fable: 'Fable',
    ef_dora: 'Dora', em_alex: 'Alex', ff_siwis: 'Siwis', hf_alpha: 'Alpha', hf_beta: 'Beta', hm_omega: 'Omega', hm_psi: 'Psi', if_sara: 'Sara', im_nicola: 'Nicola',
    jf_alpha: 'Alpha', jf_gongitsune: 'Gongitsune', jf_nezumi: 'Nezumi', jf_tebukuro: 'Tebukuro', jm_kumo: 'Kumo', pf_dora: 'Dora', pm_alex: 'Alex',
    zf_xiaobei: 'Xiaobei', zf_xiaoni: 'Xiaoni', zf_xiaoxiao: 'Xiaoxiao', zf_xiaoyi: 'Xiaoyi', zm_yunjian: 'Yunjian', zm_yunxi: 'Yunxi', zm_yunxia: 'Yunxia', zm_yunyang: 'Yunyang' };
  const KOKORO_LANG = { a: 'American', b: 'British', e: 'Spanish', f: 'French', h: 'Hindi', i: 'Italian', j: 'Japanese', p: 'Portuguese', z: 'Chinese' };
  const kokoroVoices = () => kokoroProc ? Object.entries(KOKORO_VOICES).map(([v, n]) => ({ id: 'kokoro:' + v, name: `${n} (${KOKORO_LANG[v[0]]} ${v[1] === 'f' ? 'woman' : 'man'})`, group: 'ab'.includes(v[0]) ? 'Natural (Kokoro)' : 'Natural, other languages (Kokoro)' })) : [];

  // Voices: every Piper model in the voices folder; each bot can pick one (setting bot_voices = { botId: voiceId }).
  const VOICE_DIR = path.dirname(PIPER_VOICE);
  const ACCENT = { en_US: 'American', en_GB: 'British', de_DE: 'German', ru_RU: 'Russian', nl_NL: 'Dutch', pl_PL: 'Polish', uk_UA: 'Ukrainian', sv_SE: 'Swedish', tr_TR: 'Turkish', vi_VN: 'Vietnamese' };
  function listVoices() {
    try {
      return fs.readdirSync(VOICE_DIR).filter((f) => f.endsWith('.onnx')).map((f) => {
        const id = f.slice(0, -5), [lang, who = '', quality = ''] = id.split('-');
        const name = who.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^Hfc /, 'HFC ');
        return { id, name: `${name} (${ACCENT[lang] || lang}${quality === 'high' ? ', high quality' : ''})`, lang, group: lang.startsWith('en') ? 'Basic (Piper)' : 'Basic, other languages (Piper)' };
      }).sort((a, b) => a.lang.localeCompare(b.lang) || a.name.localeCompare(b.name));
    } catch { return []; }
  }
  function allVoices() { return [...kokoroVoices(), ...listVoices()];
  }
  const botVoices = () => JSON.parse(getSetting('bot_voices') || '{}');
  function voiceFile(id) {
    const f = path.join(VOICE_DIR, String(id || '').replace(/[^\w.-]/g, '') + '.onnx');
    return id && fs.existsSync(f) ? f : PIPER_VOICE;
  }
  route('GET', '/api/voices', (req, res) => json(res, 200, { voices: allVoices(), default: path.basename(PIPER_VOICE, '.onnx'), byBot: botVoices() }));
  route('PUT', '/api/bots/:id/voice', async (req, res, p) => {
    const { voice } = await body(req);
    const all = botVoices();
    if (voice && allVoices().some((v) => v.id === voice)) all[Number(p.id)] = voice; else delete all[Number(p.id)];
    setSetting('bot_voices', JSON.stringify(all));
    json(res, 200, { ok: true });
  });
  route('GET', '/api/speak', (req, res) => json(res, 200, { available: fs.existsSync(PIPER_BIN) && fs.existsSync(PIPER_VOICE) }));
  route('POST', '/api/speak', async (req, res) => {
    if (!fs.existsSync(PIPER_BIN) || !fs.existsSync(PIPER_VOICE)) return json(res, 503, { error: 'Read-aloud isn’t installed on the server' });
    const { messageId, text, voice, botId } = await body(req);
    const row = messageId ? q('SELECT body, author FROM messages WHERE id=?').get(Number(messageId)) : null;
    const src = row ? row.body : text;
    // Preview passes a voice; otherwise the bot who wrote the message (or the bot asked for) speaks in its own voice.
    const chosen = voice || botVoices()[Number(botId || row?.author)];
    const say = speakable(src);
    if (!say) return json(res, 400, { error: 'Nothing to read' });
    if (String(chosen).startsWith('kokoro:') && kokoroProc) {
      try {
        const r = await fetch(`http://127.0.0.1:${KOKORO_PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: say, voice: chosen.slice(7) }), signal: AbortSignal.timeout(120_000) });
        if (r.ok) { const wav = Buffer.from(await r.arrayBuffer()); res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' }); return res.end(wav); }
      } catch {} // Kokoro is still loading or failed: fall back to Piper below
    }
    const model = voiceFile(String(chosen || '').startsWith('kokoro:') ? '' : chosen);
    const p = spawn(PIPER_BIN, ['--model', model, '--output_file', '-'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const chunks = [];
    p.stdout.on('data', (c) => chunks.push(c));
    p.on('error', (e) => { if (!res.headersSent) json(res, 500, { error: e.message }); });
    p.on('close', (code) => {
      if (res.headersSent) return;
      if (code !== 0 || !chunks.length) return json(res, 500, { error: 'Speech failed' });
      const wav = Buffer.concat(chunks);
      res.writeHead(200, { 'content-type': 'audio/wav', 'content-length': wav.length, 'cache-control': 'no-store' });
      res.end(wav);
    });
    p.stdin.end(say);
  });

  // ---------- voice dictation (whisper.cpp) ----------
  // Nimbus runs whisper.cpp's server as a child process on localhost only. The browser records 16 kHz
  // WAV, so no audio conversion is needed here. Recordings are never written to disk.
  const WHISPER_BIN = process.env.NIMBUS_WHISPER_BIN || path.join(os.homedir(), 'opt/whisper.cpp/build/bin/whisper-server');
  const WHISPER_MODEL = process.env.NIMBUS_WHISPER_MODEL || path.join(os.homedir(), 'opt/whisper-models/ggml-small.en.bin');
  const WHISPER_PORT = Number(process.env.NIMBUS_WHISPER_PORT || 8178);
  // Speech language (setting speech_lang): '' = English (faster English-only model); 'auto' or a language code uses the multilingual model.
  const WHISPER_MULTI = process.env.NIMBUS_WHISPER_MULTI || path.join(path.dirname(WHISPER_MODEL), 'ggml-small.bin');
  const speechLang = () => getSetting('speech_lang') || '';
  const whisperModel = () => speechLang() && fs.existsSync(WHISPER_MULTI) ? WHISPER_MULTI : WHISPER_MODEL;
  let whisperProc = null, whisperFails = 0;
  function startWhisper() {
    if (!fs.existsSync(WHISPER_BIN) || !fs.existsSync(WHISPER_MODEL)) return;
    whisperProc = spawn(WHISPER_BIN, ['-m', whisperModel(), '--host', '127.0.0.1', '--port', String(WHISPER_PORT), '-t', String(Math.max(2, os.cpus().length - 2))], { stdio: 'ignore' });
    whisperProc.on('exit', () => {
      whisperProc = null;
      if (++whisperFails <= 5) setTimeout(startWhisper, 5000 * whisperFails); // crashed: retry with backoff
    });
    setTimeout(() => { whisperFails = 0; }, 60_000).unref();
  }
  startWhisper();
  process.on('exit', () => whisperProc?.kill());
  route('GET', '/api/transcribe', (req, res) => json(res, 200, { available: !!whisperProc }));
  // Language settings: what dictation listens for, and what language bots reply in (both shared by all devices).
  route('GET', '/api/language', (req, res) => json(res, 200, { speech: speechLang(), reply: getSetting('reply_lang') || '', multilingual: fs.existsSync(WHISPER_MULTI) }));
  route('PUT', '/api/language', async (req, res) => {
    const { speech, reply } = await body(req);
    if (speech !== undefined) {
      const next = /^(auto|[a-z]{2})$/.test(speech) && speech !== 'en' ? speech : '';
      if (next !== speechLang()) {
        const modelChanged = (!!next) !== (!!speechLang());
        setSetting('speech_lang', next);
        if (modelChanged && whisperProc) { whisperFails = -1; whisperProc.kill(); } // exits, then restarts with the other model
      }
    }
    if (reply !== undefined) { setSetting('reply_lang', String(reply || '').replace(/[^\p{L} ()-]/gu, '').slice(0, 40)); for (const b of q('SELECT * FROM bots').all()) writeBotBrief(parseBot(b)); }
    json(res, 200, { ok: true });
  });
  route('POST', '/api/transcribe', async (req, res) => {
    if (!whisperProc) return json(res, 503, { error: 'Dictation isn’t running on the server' });
    const { audio } = await body(req, 16e6); // ~5 minutes of 16 kHz mono WAV, base64
    const wav = Buffer.from(String(audio || ''), 'base64');
    if (wav.length < 1000 || wav.toString('ascii', 0, 4) !== 'RIFF') return json(res, 400, { error: 'Expected a WAV recording' });
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
    form.append('response_format', 'json');
    form.append('temperature', '0');
    if (speechLang()) form.append('language', speechLang());
    try {
      const r = await fetch(`http://127.0.0.1:${WHISPER_PORT}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(120_000) });
      const d = await r.json();
      if (!r.ok || d.error) throw new Error(d.error || `HTTP ${r.status}`);
      // Whisper marks silence and noise like "[BLANK_AUDIO]" or "(wind blowing)"; drop those.
      const text = String(d.text || '').replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
      json(res, 200, { text });
    } catch (e) { json(res, 502, { error: 'Transcription failed: ' + e.message }); }
  });

  // ---------- interface translation (bin/translate-server.py, Argos Translate, offline) ----------
  // Started on first use. Translations are cached per language in data/i18n/<lang>.json and shared by every device.
  const ARGOS_PY = process.env.NIMBUS_ARGOS_PY || path.join(os.homedir(), 'opt/argos-py/bin/python');
  const TRANSLATE_PORT = Number(process.env.NIMBUS_TRANSLATE_PORT || 8180);
  const I18N_LANGS = ['es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'sv', 'tr', 'ru', 'uk', 'ja', 'zh', 'ko', 'hi', 'vi', 'id'];
  let translateProc = null, translateReady = null;
  function startTranslate() {
    if (translateReady) return translateReady;
    if (!fs.existsSync(ARGOS_PY)) return Promise.reject(new Error('Translation isn’t installed on the server'));
    translateProc = spawn(ARGOS_PY, ['-I', path.join(HERE, 'bin/translate-server.py'), String(TRANSLATE_PORT)], { stdio: 'ignore' });
    translateProc.on('exit', () => { translateProc = null; translateReady = null; });
    translateReady = (async () => {
      for (let i = 0; i < 120; i++) { // loading the models takes a few seconds
        try { if ((await fetch(`http://127.0.0.1:${TRANSLATE_PORT}/`)).ok) return; } catch {}
        await new Promise((r) => setTimeout(r, 500));
      }
      throw new Error('Translation didn’t start');
    })();
    translateReady.catch(() => { translateReady = null; });
    return translateReady;
  }
  process.on('exit', () => translateProc?.kill());
  const i18nCache = new Map(), i18nFile = (l) => path.join(DATA_DIR, 'i18n', l + '.json');
  function i18nLoad(l) {
    if (!i18nCache.has(l)) { let d = {}; try { d = JSON.parse(fs.readFileSync(i18nFile(l), 'utf8')); } catch {} i18nCache.set(l, d); }
    return i18nCache.get(l);
  }
  let i18nSaveTimer = {};
  function i18nSave(l) {
    clearTimeout(i18nSaveTimer[l]);
    i18nSaveTimer[l] = setTimeout(() => { fs.mkdirSync(path.dirname(i18nFile(l)), { recursive: true }); fs.writeFileSync(i18nFile(l), JSON.stringify(i18nLoad(l))); }, 1000);
  }
  // Brand and product names stay as they are.
  const KEEP = ['Nimbus', 'Claude', 'Claude Code', 'Plugins', 'plugins', 'Connectors', '{#}', 'Bot', 'bot', 'Bots', 'bots', 'Haiku', 'Sonnet', 'Opus', 'Kokoro', 'Piper', 'GitHub', 'Google', 'Proxmox', 'Ctrl', 'Alt', 'Shift', 'Enter'];
  route('GET', '/api/i18n/:lang', (req, res, p) => I18N_LANGS.includes(p.lang) ? json(res, 200, { translations: i18nLoad(p.lang) }) : json(res, 404, { error: 'Unknown language' }));
  route('POST', '/api/i18n/:lang', async (req, res, p) => {
    if (!I18N_LANGS.includes(p.lang)) return json(res, 404, { error: 'Unknown language' });
    const { texts = [], keep: names = [] } = await body(req);
    const dict = i18nLoad(p.lang);
    // Names (bots, chats, projects) the page asked to keep, plus brand names; longest first so "Claude Code" beats "Claude".
    const keepRe = new RegExp(`(?<![\\p{L}])(${[...KEEP, ...(Array.isArray(names) ? names : []).map(String).filter((n) => n.length > 1 && n.length < 60).slice(0, 50)].sort((a, b) => b.length - a.length).map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\p{L}])`, 'gu');
    const todo = [...new Set((Array.isArray(texts) ? texts : []).map((t) => String(t).trim()).filter((t) => t && t.length < 400 && !(t in dict)))].slice(0, 150);
    if (todo.length && Object.keys(dict).length < 30000) {
      try {
        await startTranslate();
        // Protect brand names and shortcut keys with placeholders the translator leaves alone.
        const masked = todo.map((t) => { const keep = []; const m = t.replace(keepRe, (w) => `#${keep.push(w) - 1}#`); return { m, keep }; });
        const r = await fetch(`http://127.0.0.1:${TRANSLATE_PORT}/`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lang: p.lang, texts: masked.map((x) => x.m) }), signal: AbortSignal.timeout(120_000) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        todo.forEach((t, i) => {
          let out = String(d.texts[i] ?? t).replace(/#\s*(\d+)\s*#/g, (_, n) => masked[i].keep[n] ?? '').trim();
          if (!/[.!?。…]$/.test(t)) out = out.replace(/[.。]$/, ''); // the translator likes to add a full stop
          dict[t] = out;
        });
        i18nSave(p.lang);
      } catch (e) { return json(res, 503, { error: e.message }); }
    }
    json(res, 200, { translations: Object.fromEntries((Array.isArray(texts) ? texts : []).map((t) => [String(t).trim(), dict[String(t).trim()]]).filter(([, v]) => v !== undefined)) });
  });

}
