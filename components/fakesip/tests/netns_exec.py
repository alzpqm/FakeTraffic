"""Bounded private-network runner, also usable on OpenWrt without util-linux."""
import ctypes
import os
import pathlib
import subprocess
import sys
import time

NETNS = 0x40000000  # Linux CLONE_NEWNET


def namespace_call(name, *args):
    function = getattr(ctypes.CDLL(None, use_errno=True), name)
    if function(*args) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def enter_command(pid, *command):
    return [sys.executable, __file__, '--enter', str(pid), *command]


def main():
    if sys.argv[1] == '--enter':
        fd = os.open('/proc/' + str(int(sys.argv[2])) + '/ns/net', os.O_RDONLY)
        try:
            namespace_call('setns', fd, NETNS)
        finally:
            os.close(fd)
        os.execvp(sys.argv[3], sys.argv[3:])
    if sys.argv[1] == '--hold':
        namespace_call('unshare', NETNS)
        time.sleep(32)
        return
    binary = str(pathlib.Path(sys.argv[1]).resolve(strict=True))
    namespace_call('unshare', NETNS)  # No network command precedes isolation.
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True, timeout=3)
    peer = subprocess.Popen([sys.executable, __file__, '--hold'])
    try:
        for _ in range(200):
            if peer.poll() is not None:
                raise RuntimeError('peer namespace failed')
            if os.readlink(f'/proc/{peer.pid}/ns/net') != os.readlink('/proc/self/ns/net'):
                break
            time.sleep(0.01)
        else:
            raise TimeoutError('peer namespace startup')
        commands = [
            ['ip', 'link', 'add', 'fs-audit', 'type', 'veth', 'peer', 'name', 'fs-peer'],
            ['ip', 'link', 'set', 'fs-peer', 'netns', str(peer.pid)],
            ['ip', 'link', 'set', 'fs-audit', 'up'],
            ['ip', '-6', 'addr', 'add', '2001:db8::1/64', 'dev', 'fs-audit', 'nodad'],
            enter_command(peer.pid, 'ip', 'link', 'set', 'lo', 'up'),
            enter_command(peer.pid, 'ip', 'link', 'set', 'fs-peer', 'up'),
            enter_command(peer.pid, 'ip', '-6', 'addr', 'add', '2001:db8::2/64',
                          'dev', 'fs-peer', 'nodad'),
        ]
        for command in commands:
            subprocess.run(command, check=True, timeout=3)
        environment = dict(os.environ, FS_AUDIT_ISOLATED='1',
                           FS_AUDIT_PEER=str(peer.pid), FS_TEST_NSENTER=__file__)
        subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name(
            'test_ipv6_options.py')), binary], env=environment, check=True, timeout=25)
    finally:
        if peer.poll() is None:
            peer.terminate()
        peer.wait(timeout=3)


if __name__ == '__main__':
    main()
