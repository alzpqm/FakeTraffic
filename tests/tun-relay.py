#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Test-only, nonpersistent TUN over UDP inside disconnected namespaces.
Forward packets unchanged: never repair a candidate's checksum to hide a bug.
"""
import fcntl, hashlib, json, os, select, signal, socket, struct, sys, time

name, local, peer, report_path, barrier_path = sys.argv[1:]
assert name in ('ftwan', 'ftpeer', 'ftout', 'ftserver')
unix = local.startswith('/')
if unix:
    assert os.path.dirname(local) == os.path.dirname(peer) == os.path.dirname(report_path) == os.path.dirname(barrier_path)
else: assert {local, peer} == {'203.0.113.1', '203.0.113.2'}
fd = os.open('/dev/net/tun', os.O_RDWR | os.O_NONBLOCK | os.O_CLOEXEC)
fcntl.ioctl(fd, 0x400454ca, struct.pack('16sH', name.encode(), 0x0001 | 0x1000 | 0x8000))
sock = socket.socket(socket.AF_UNIX if unix else socket.AF_INET, socket.SOCK_DGRAM)
sock.bind(local if unix else (local, 29000)); sock.setblocking(False)
destination = peer if unix else (peer, 29000)
counts = {'outbound': 0, 'inbound': 0, 'checksums_verified': 0, 'checksum_errors': 0}
fake_packets = []
counts['fake_capture_overflow'] = False
def capture_fake(packet):
    family = packet[0] >> 4
    offset = (packet[0] & 15) * 4 if family == 4 else 40
    ttl, proto = (packet[8], packet[9]) if family == 4 else (packet[7], packet[6])
    if ttl != 1 or proto not in (6, 17): return
    size = (packet[offset + 12] >> 4) * 4 if proto == 6 else 8
    payload = packet[offset + size:]
    if not payload: return
    if len(fake_packets) >= 512:
        counts['fake_capture_overflow'] = True; return
    kind = 'http' if payload.startswith(b'GET ') else 'tls' if payload.startswith(b'\x16\x03') else 'sip' if payload.startswith(b'INVITE ') else 'custom'
    tag = next((s.decode() for s in [b'a.example', b'b.example', b'FT-TCP-A', b'FT-UDP-A', b'new.example', b'FT-TCP-B', b'FT-UDP-B'] if s in payload), 'unknown')
    fake_packets.append({'family': family, 'protocol': proto, 'kind': kind, 'tag': tag,
        'ports': packet[offset:offset+4].hex(), 'tcp_seq_ack': packet[offset+4:offset+12].hex() if proto == 6 else '',
        'payload_sha256': hashlib.sha256(payload).hexdigest(), 'length': len(payload)})
running = True
def stop(signum, frame):
    global running
    running = False
signal.signal(signal.SIGTERM, stop); signal.signal(signal.SIGINT, stop)
def checksum(data):
    if len(data) & 1: data += b'\0'
    total = sum(struct.unpack('!' + 'H' * (len(data) // 2), data))
    while total >> 16: total = (total & 65535) + (total >> 16)
    return (~total) & 65535
def verify(packet):
    family = packet[0] >> 4
    if family == 4:
        length = struct.unpack_from('!H', packet, 2)[0]
        offset = (packet[0] & 15) * 4; proto = packet[9]
        if length != len(packet) or checksum(packet[:offset]): return False
        if proto not in (6, 17) or struct.unpack_from('!H', packet, 6)[0] & 0x3fff: return None
        transport = packet[offset:]
        if proto == 17 and transport[6:8] == b'\0\0': return True
        pseudo = packet[12:20] + struct.pack('!BBH', 0, proto, len(transport))
    elif family == 6:
        length = struct.unpack_from('!H', packet, 4)[0]; proto = packet[6]
        if length + 40 != len(packet): return False
        if proto not in (6, 17): return None
        transport = packet[40:]
        pseudo = packet[8:40] + struct.pack('!I3xB', len(transport), proto)
    else: return False
    return checksum(pseudo + transport) == 0
print('READY', flush=True)
deadline = time.monotonic() + 150
try:
    # Both TUN devices must be UP before either relay can inject. Early IPv6
    # multicast from the first UP otherwise writes into the other DOWN TUN.
    while running and not os.path.exists(barrier_path) and time.monotonic() < deadline:
        time.sleep(.02)
    while running and time.monotonic() < deadline:
        readable, _, _ = select.select([fd, sock], [], [], .1)
        if fd in readable:
            packet = os.read(fd, 65535)
            capture_fake(packet)
            result = verify(packet)
            if result is not None:
                counts['checksums_verified'] += 1
                if not result: counts['checksum_errors'] += 1
            sock.sendto(packet, destination); counts['outbound'] += 1
        if sock in readable:
            packet = sock.recv(65535)
            if os.write(fd, packet) != len(packet): raise RuntimeError('short TUN write')
            counts['inbound'] += 1
finally:
    os.close(fd); sock.close()
    if unix: os.unlink(local)
    counts['fake_packets'] = len(fake_packets)
    with open(report_path + '.packets.json', 'w') as stream: json.dump(fake_packets, stream)
    with open(report_path, 'w') as stream: json.dump(counts, stream)
