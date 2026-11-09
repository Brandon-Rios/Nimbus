#!/usr/bin/env python3
# Runs bash in a pseudo-terminal for Nimbus Code's terminal. stdin/stdout carry the terminal bytes;
# fd 3 takes resize messages, one JSON object per line: {"cols": 120, "rows": 30}.
import fcntl, json, os, pty, select, signal, struct, sys, termios

pid, fd = pty.fork()
if pid == 0:
    os.execvp('bash', ['bash', '--noprofile', '--norc', '-i'])

def resize(cols, rows):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
    os.kill(pid, signal.SIGWINCH)

resize(100, 30)
ctl = os.fdopen(3, 'rb', buffering=0)
ctl_buf = b''
inputs = [sys.stdin.fileno(), fd, 3]
while True:
    try:
        r, _, _ = select.select(inputs, [], [])
    except InterruptedError:
        continue
    if fd in r:
        try:
            data = os.read(fd, 65536)
        except OSError:
            break
        if not data:
            break
        os.write(1, data)
    if sys.stdin.fileno() in r:
        data = os.read(sys.stdin.fileno(), 65536)
        if not data:
            break
        os.write(fd, data)
    if 3 in r:
        data = os.read(3, 4096)
        if not data:
            inputs.remove(3)
            continue
        ctl_buf += data
        while b'\n' in ctl_buf:
            line, ctl_buf = ctl_buf.split(b'\n', 1)
            try:
                m = json.loads(line)
                resize(int(m['cols']), int(m['rows']))
            except Exception:
                pass
try:
    os.kill(pid, signal.SIGHUP)
except OSError:
    pass
