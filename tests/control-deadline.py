#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Unprivileged Unix control client tests, no network/device/service changes."""
import json, pathlib, socket, subprocess, sys, tempfile, threading, time

binary = str(pathlib.Path(sys.argv[1]).resolve())
def run_case(mode):
    with tempfile.TemporaryDirectory(prefix='ft-control-') as temporary:
        listener = socket.socket(socket.AF_UNIX)
        listener.bind(temporary + '/control.sock'); listener.listen(1)
        finished = threading.Event()
        def server():
            connection, _ = listener.accept()
            with connection:
                while connection.recv(128): pass
                try:
                    if mode == 'normal': connection.sendall(b'{"running":true}\n')
                    elif mode == 'error':
                        connection.sendall(b'ER'); time.sleep(.05); connection.sendall(b'ROR failed\n')
                    elif mode == 'large': connection.sendall(b'x' * 20000)
                    elif mode == 'empty': pass
                    elif mode == 'stall': finished.wait(5)
                    elif mode == 'trickle':
                        while not finished.wait(.3): connection.sendall(b'x')
                except (BrokenPipeError, ConnectionResetError): pass
        thread = threading.Thread(target=server, daemon=True); thread.start()
        start = time.monotonic()
        try:
            result = subprocess.run([binary, 'status', '--runtime-dir', temporary], capture_output=True, timeout=4)
            elapsed = time.monotonic() - start
            assert elapsed < 3.2, (mode, elapsed)
            assert len(result.stdout) <= 16384
            if mode == 'normal': assert result.returncode == 0 and json.loads(result.stdout)['running'] is True
            else: assert result.returncode != 0, (mode, result.stdout)
            if mode in ('stall', 'trickle'): assert elapsed >= 1.5
        finally:
            finished.set(); listener.close(); thread.join(timeout=1)
        return {'case': mode, 'elapsed_seconds': round(elapsed, 3), 'rc': result.returncode}
print(json.dumps([run_case(mode) for mode in ['normal', 'error', 'large', 'empty', 'stall', 'trickle']]))
