"""IPv6 options acceptance test; run via linux-ipv6-options-test.sh."""
import json
import os
import pathlib
import select
import socket
import subprocess
import sys
import tempfile
import time


def ancillary(mode):
    if mode == 'plain':
        return []
    option = socket.IPV6_DSTOPTS if mode == 'destopts' else socket.IPV6_HOPOPTS
    # UDP next-header; eight-byte extension with one PadN option, no action.
    return [(socket.IPPROTO_IPV6, option, bytes([17, 0, 1, 4, 0, 0, 0, 0]))]


def peer(mode):
    counts = dict(original=0, fake=0, other=0)
    with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as sock:
        sock.bind(('2001:db8::2', 0))
        print(json.dumps({'port': sock.getsockname()[1]}), flush=True)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            sock.settimeout(max(0.01, deadline - time.monotonic()))
            try:
                message, remote = sock.recvfrom(4096)
            except socket.timeout:
                break
            if message == b'ORIGINAL':
                counts['original'] += 1
                sock.sendmsg([b'REPLY'], ancillary(mode), 0, remote)
            elif message.startswith(b'INVITE '):
                counts['fake'] += 1
            else:
                counts['other'] += 1
    print(json.dumps(counts), flush=True)


def probe(binary, direction, mode):
    with tempfile.TemporaryFile(mode='w+') as logfile:
        process = subprocess.Popen([binary, '-a', '-6', '-g', '-s', direction,
                                    '-n', '6514', '-r', '1'],
                                   stdout=logfile, stderr=logfile)
        remote = None
        try:
            for attempt in range(300):
                logfile.seek(0)
                if 'listening on' in logfile.read():
                    break
                assert process.poll() is None, 'FakeSIP failed during startup'
                time.sleep(0.01)
            else:
                raise AssertionError('FakeSIP startup timeout')
            if os.environ.get('FS_TEST_NSENTER'):
                enter = [sys.executable, os.environ['FS_TEST_NSENTER'], '--enter',
                         os.environ['FS_AUDIT_PEER']]
            else:
                enter = ['nsenter', '-t', os.environ['FS_AUDIT_PEER'], '-n']
            remote = subprocess.Popen([*enter, sys.executable, __file__, '--peer', mode],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                      text=True)
            assert select.select([remote.stdout], [], [], 3)[0], 'peer startup timeout'
            port = json.loads(remote.stdout.readline())['port']
            with socket.socket(socket.AF_INET6, socket.SOCK_DGRAM) as sock:
                sock.bind(('2001:db8::1', 0))
                sock.settimeout(2)
                sock.sendmsg([b'ORIGINAL'], ancillary(mode), 0, ('2001:db8::2', port))
                reply, _ = sock.recvfrom(4096)
                assert reply == b'REPLY', 'original reply was changed or missing'
            output, errors = remote.communicate(timeout=4)
            assert remote.returncode == 0, errors
            counts = json.loads(output)
            assert counts['original'] == 1 and counts['other'] == 0, counts
            queue = [list(map(int, line.split())) for line in
                     pathlib.Path('/proc/net/netfilter/nfnetlink_queue').read_text().splitlines()
                     if line.split()[0] == '6514'][0]
            process.terminate()
            status = process.wait(timeout=2)
            logfile.seek(0)
            logs = logfile.read()
            assert status == 0 and 'exiting normally' in logs, logs
            assert 'AddressSanitizer' not in logs and 'runtime error:' not in logs, logs
            assert queue[2] == queue[5] == queue[6] == 0, queue
            result = dict(mode=mode, direction=direction, **counts,
                          reply=1, queue_packets=queue[7],
                          parser_rejections=logs.count('not a UDP packet'),
                          exit=status)
            print(json.dumps(result), flush=True)
            assert counts['fake'] == 1, result
            assert result['parser_rejections'] == 0 and 'ERROR:' not in logs, logs
        finally:
            for child in (remote, process):
                if child is not None and child.poll() is None:
                    child.kill()
                    child.wait(timeout=2)


if __name__ == '__main__':
    assert os.environ.get('FS_AUDIT_ISOLATED') == '1', 'use namespace wrapper'
    if sys.argv[1] == '--peer':
        peer(sys.argv[2])
    else:
        for direction in ('-0', '-1'):
            for mode in ('plain', 'destopts', 'hopopts'):
                probe(sys.argv[1], direction, mode)
        print('PASS: ordinary and extended IPv6 UDP each receive one decoy')
