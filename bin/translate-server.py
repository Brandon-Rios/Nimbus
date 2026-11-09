# Offline translation for the Nimbus interface (Argos Translate, runs on the CPU, nothing leaves the server).
# Started by server.js: translate-server.py <port>. POST {"lang": "es", "texts": [...]} -> {"texts": [...]}.
import html, json, sys
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import argostranslate.translate as tr

port = int(sys.argv[1])
langs = {l.code: l for l in tr.get_installed_languages()}
cache = {}
pool = ThreadPoolExecutor(8)

def translator(code):
    if code not in cache: cache[code] = langs['en'].get_translation(langs[code])
    return cache[code]

import re
PREFIX = 'In the app menu, click: '
def translate(t, text):
    # Short labels ("Save", "Search") translate badly alone; give them menu context, then cut the label back out.
    if len(text.split()) > 3 or len(text) > 30 or '#' in text: return t.translate(text)
    out = t.translate(PREFIX + text)
    m = re.search(r'[「\[]([^」\]]+)[」\]]', out) or re.search(r'[:：]\s*(.+?)\s*[。.]?$', out)
    got = m.group(1).strip() if m else ''
    if not got or len(got) > len(text) * 4 + 10 or got.lower() == text.lower(): return t.translate(text)
    got = got.rstrip('.。…') + ('…' if text.endswith('…') else '')
    return got[0].upper() + got[1:] if text[0].isupper() else got

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def send(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code); self.send_header('content-type', 'application/json'); self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_GET(self):
        self.send(200, {'langs': sorted(c for c in langs if c != 'en')})
    def do_POST(self):
        try:
            req = json.loads(self.rfile.read(int(self.headers.get('content-length') or 0)) or b'{}')
            t = translator(req['lang'])
            self.send(200, {'texts': list(pool.map(lambda x: html.unescape(translate(t, str(x))), req.get('texts', [])[:200]))})
        except Exception as e:
            self.send(500, {'error': str(e)})

ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
