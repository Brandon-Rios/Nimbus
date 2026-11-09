# Kokoro text-to-speech on localhost for Nimbus (natural voices, runs on the CPU).
# Started by server.js: kokoro-server.py <model.onnx> <voices.bin> <port>. POST {"text","voice"} -> audio/wav.
import io, json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import onnxruntime as ort, soundfile as sf
from kokoro_onnx import Kokoro

model, voices, port = sys.argv[1], sys.argv[2], int(sys.argv[3])
opts = ort.SessionOptions()
opts.intra_op_num_threads = max(2, min(8, (os.cpu_count() or 4) - 2))
opts.log_severity_level = 3
k = Kokoro.from_session(ort.InferenceSession(model, opts, providers=['CPUExecutionProvider']), voices)
# Voice prefix -> language: a American, b British, e Spanish, f French, h Hindi, i Italian, j Japanese, p Portuguese, z Chinese.
LANG = {'a': 'en-us', 'b': 'en-gb', 'e': 'es', 'f': 'fr-fr', 'h': 'hi', 'i': 'it', 'j': 'ja', 'p': 'pt-br', 'z': 'cmn'}
ENGLISH = sorted(v for v in k.get_voices() if v[0] in LANG)

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, body, ctype='application/json'):
        self.send_response(code); self.send_header('content-type', ctype); self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        self.send(200, json.dumps({'voices': ENGLISH}).encode())
    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
            voice = req.get('voice') if req.get('voice') in ENGLISH else 'af_heart'
            audio, rate = k.create(str(req.get('text') or '')[:6000], voice=voice, speed=float(req.get('speed') or 1.0), lang=LANG[voice[0]])
            buf = io.BytesIO(); sf.write(buf, audio, rate, format='WAV', subtype='PCM_16')
            self.send(200, buf.getvalue(), 'audio/wav')
        except Exception as e:
            self.send(500, json.dumps({'error': str(e)}).encode())

ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
