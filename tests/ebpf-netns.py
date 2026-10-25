#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Explicit isolated-lab smoke test. No WAN, host routes or host firewall writes.

Run only in a user-authorized privileged Linux lab with already-built artifacts:
  python3 ebpf-netns.py --isolated-lab BINARY OBJECT EVIDENCE_DIRECTORY
  Optional: --l3-unix --tls --estimate (no veth dependency; emulated hop distance)
Evidence is private. This is not a throughput, DPI, PPPoE or offload benchmark.
"""
import json, os, pathlib, re, signal, subprocess, sys, time

assert len(sys.argv) >= 5 and sys.argv[1] == '--isolated-lab', 'explicit isolated-lab invocation required'
options = set(sys.argv[5:])
assert options <= {'--l3', '--l3-unix', '--tls', '--estimate', '--hot-start', '--multi'}
multi = '--multi' in options
l3 = bool(options & {'--l3', '--l3-unix'})
unix_relay = '--l3-unix' in options
tls = '--tls' in options
estimate = '--estimate' in options
hot_start = '--hot-start' in options
relay_specs = []
assert os.geteuid() == 0, 'isolated namespace creation requires authorized root'
binary, obj, evidence = map(lambda s: str(pathlib.Path(s).resolve()), sys.argv[2:5])
work = pathlib.Path(evidence)
assert work.is_dir() and work.stat().st_uid == 0 and work.stat().st_mode & 0o077 == 0
prefix = 'fte' + str(os.getpid())
left, transit, right = prefix + 'a', prefix + 'b', prefix + 'c'
owned, children, handles = [], [], []
report = {'scope': 'three_disconnected_namespaces_with_ttl_expiry_hop', 'link_mode': 'l3' if l3 else 'ethernet', 'wan_attached': False, 'tests': []}
report.update(tcp_payload='tls' if tls else 'http', estimate_hops=estimate, hot_start=hot_start)
report['multi_templates'] = multi
def interrupted(signum, frame):
    raise SystemExit('bounded test interrupted: ' + str(signum))
signal.signal(signal.SIGTERM, interrupted)
signal.signal(signal.SIGINT, interrupted)
signal.signal(signal.SIGALRM, interrupted)
signal.alarm(70)

def run(*args, check=True):
    result = subprocess.run(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
    if check and result.returncode:
        raise RuntimeError('command failed rc=' + str(result.returncode) + ': ' + result.stderr[-4000:])
    return result

def ns(name, *args, **kw):
    return run('ip', 'netns', 'exec', name, *args, **kw)

def start(name, args, log):
    handle = open(work / log, 'wb'); handles.append(handle)
    child = subprocess.Popen(['ip', 'netns', 'exec', name, *args], stdout=handle, stderr=subprocess.STDOUT)
    children.append(child); return child

def stop(child, sig=signal.SIGTERM):
    if child.poll() is None:
        child.send_signal(sig)
        try: child.wait(timeout=8)
        except subprocess.TimeoutExpired: child.kill(); child.wait(timeout=3)

def check(value, label):
    assert value, label
    report['tests'].append(label)

runtime = work / 'runtime'
config = work / 'lab.toml'
config.write_text('''version = 1
[[interfaces]]
name = "ftwan"
mode = "LINKMODE"
[tcp]
enabled = true
directions = ["active", "passive"]
payload = "http"
hostname = "www.example.com"
tfo = "strip-syn"
max_batches = 3
[udp]
enabled = true
trigger = "egress"
payload = "sip"
sip_uri = "sip:service@example.com"
initial_packets = 5
idle_timeout_seconds = 30
[injection]
ttl = 1
repeat = 1
estimate_hops = false
dynamic_percent = 0
max_packets_per_second = 100
burst = 200
allow_private = true
[runtime]
tcp_entries = 64
udp_entries = 64
lease_seconds = 10
'''.replace('LINKMODE', 'l3' if l3 else 'ethernet').replace('payload = "http"', 'payload = "tls"' if tls else 'payload = "http"').replace('estimate_hops = false', 'estimate_hops = true' if estimate else 'estimate_hops = false'))
if multi:
    assert unix_relay and not hot_start and not estimate, 'bounded multi fixture uses deterministic L3 unix relays'
    tcp_file, udp_file = work / 'tcp.bin', work / 'udp.bin'
    tcp_file.write_bytes(b'\0FT-TCP-A\xff'); udp_file.write_bytes(b'\0FT-UDP-A\xff')
    config.write_text(config.read_text().replace('version = 1', 'version = 2').replace('repeat = 1', 'repeat = 2')
        .replace('payload = "http"\nhostname = "www.example.com"\n', '')
        .replace('[udp]', '[[tcp.templates]]\npayload="http"\nhostname="a.example"\n[[tcp.templates]]\npayload="tls"\nhostname="b.example"\n[[tcp.templates]]\npayload="custom"\npayload_file="' + str(tcp_file) + '"\n[udp]')
        .replace('payload = "sip"\nsip_uri = "sip:service@example.com"\n', '')
        .replace('[injection]', '[[udp.templates]]\npayload="sip"\nsip_uri="sip:a@a.example"\n[[udp.templates]]\npayload="sip"\nsip_uri="sip:b@b.example"\n[[udp.templates]]\npayload="custom"\npayload_file="' + str(udp_file) + '"\n[injection]'))
server = work / 'peer.py'
# In the estimate fixture only, a peer initial TTL/hlim of 61 arrives as 60.
# The backend's 64-based heuristic then permits ttl=1. This exercises the branch,
# not real path-distance accuracy; relays still forward every packet unchanged.
server.write_text('''import socket, threading, time
def tcp(family, addr):
 s=socket.socket(family); s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 if EMULATED_DISTANCE:s.setsockopt(socket.IPPROTO_IP if family==socket.AF_INET else socket.IPPROTO_IPV6,socket.IP_TTL if family==socket.AF_INET else socket.IPV6_UNICAST_HOPS,61)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind((addr,18080));s.listen()
 while True:
  c,_=s.accept(); c.settimeout(2)
  try:
   if c.recv(128)==b"FT-LAB":c.sendall(b"FT-OK")
  except OSError:pass
  c.close()
def udp(family, addr):
 s=socket.socket(family,socket.SOCK_DGRAM)
 if EMULATED_DISTANCE:s.setsockopt(socket.IPPROTO_IP if family==socket.AF_INET else socket.IPPROTO_IPV6,socket.IP_TTL if family==socket.AF_INET else socket.IPV6_UNICAST_HOPS,61)
 if family==socket.AF_INET6:s.setsockopt(socket.IPPROTO_IPV6,socket.IPV6_V6ONLY,1)
 s.bind((addr,18081))
 while True:
  data,peer=s.recvfrom(4096)
  if data==b"FT-LAB":s.sendto(b"FT-OK",peer)
for family,addr in [(socket.AF_INET,"198.19.0.2"),(socket.AF_INET6,"2001:db8:2::2")]:
 for fn in [tcp,udp]:threading.Thread(target=fn,args=(family,addr),daemon=True).start()
print("READY",flush=True);time.sleep(90)
'''.replace('EMULATED_DISTANCE', str(estimate)))
probe = '''import socket,json
counts={}
for family,addr in [(socket.AF_INET,"198.19.0.2"),(socket.AF_INET6,"2001:db8:2::2")]:
 for kind,port in [(socket.SOCK_STREAM,18080),(socket.SOCK_DGRAM,18081)]:
  count=0
  for i in range(3):
   s=socket.socket(family,kind);s.settimeout(3);s.connect((addr,port));s.sendall(b"FT-LAB")
   assert s.recv(128)==b"FT-OK";count+=1;s.close()
  counts[str(family)+":"+str(kind)]=count
print(json.dumps(counts))
'''

try:
    for name in [left, transit, right]:
        run('ip', 'netns', 'add', name); owned.append(name)
        ns(name, 'sysctl', '-q', '-w', 'net.ipv6.conf.all.disable_ipv6=0', 'net.ipv6.conf.default.disable_ipv6=0', 'net.ipv6.conf.default.accept_dad=0')
        run('ip', '-n', name, 'link', 'set', 'lo', 'up')
    # Both ends are created inside owned namespaces; neither enters the host.
    if unix_relay:
        relay_script = pathlib.Path(__file__).with_name('tun-relay.py')
        for namespace, dev, label, local, peer in [(left, 'ftwan', 'left', 'a.sock', 'b.sock'), (transit, 'ftpeer', 'transit', 'b.sock', 'a.sock'), (transit, 'ftout', 'transit-out', 'c.sock', 'd.sock'), (right, 'ftserver', 'server', 'd.sock', 'c.sock')]:
            relay_specs.append(label)
            start(namespace, ['python3', '-u', str(relay_script), dev, str(work / local), str(work / peer), str(work / ('relay-' + label + '.json')), str(work / 'relays.go')], 'relay-' + label + '.log')
        for _ in range(100):
            if all('READY' in (work / ('relay-' + label + '.log')).read_text() for label in relay_specs): break
            time.sleep(.05)
        check(all('READY' in (work / ('relay-' + label + '.log')).read_text() for label in relay_specs), 'nonpersistent_l3_unix_relays_ready')
    elif l3:
        relay_script = pathlib.Path(__file__).with_name('tun-relay.py')
        assert relay_script.is_file(), 'L3 relay fixture missing'
        run('ip', '-n', left, 'link', 'add', 'ftcarrier', 'type', 'veth', 'peer', 'name', 'ftcarrier', 'netns', transit)
        for name, address in [(left, '203.0.113.1/30'), (transit, '203.0.113.2/30')]:
            run('ip', '-n', name, 'link', 'set', 'ftcarrier', 'up')
            run('ip', '-n', name, 'addr', 'add', address, 'dev', 'ftcarrier')
        relays = [start(left, ['python3', '-u', str(relay_script), 'ftwan', '203.0.113.1', '203.0.113.2', str(work / 'relay-left.json'), str(work / 'relays.go')], 'relay-left.log'),
            start(transit, ['python3', '-u', str(relay_script), 'ftpeer', '203.0.113.2', '203.0.113.1', str(work / 'relay-transit.json'), str(work / 'relays.go')], 'relay-transit.log')]
        for _ in range(100):
            if all('READY' in (work / ('relay-' + name + '.log')).read_text() for name in ['left', 'transit']): break
            time.sleep(.05)
        check(all(child.poll() is None for child in relays) and all('READY' in (work / ('relay-' + name + '.log')).read_text() for name in ['left', 'transit']), 'nonpersistent_l3_relays_ready')
        relay_specs = ['left', 'transit']
    else:
        run('ip', '-n', left, 'link', 'add', 'ftwan', 'type', 'veth', 'peer', 'name', 'ftpeer', 'netns', transit)
    if not unix_relay: run('ip', '-n', transit, 'link', 'add', 'ftout', 'type', 'veth', 'peer', 'name', 'ftserver', 'netns', right)
    for name, dev, ipv4, ipv6 in [(left, 'ftwan', '198.18.0.1/24', '2001:db8:1::1/64'), (transit, 'ftpeer', '198.18.0.2/24', '2001:db8:1::2/64'), (transit, 'ftout', '198.19.0.1/24', '2001:db8:2::1/64'), (right, 'ftserver', '198.19.0.2/24', '2001:db8:2::2/64')]:
        run('ip', '-n', name, 'link', 'set', dev, 'up')
        ns(name, 'sysctl', '-q', '-w', 'net.ipv6.conf.' + dev + '.disable_ipv6=0', 'net.ipv6.conf.' + dev + '.accept_dad=0')
        run('ip', '-n', name, 'addr', 'add', ipv4, 'dev', dev)
        run('ip', '-n', name, '-6', 'addr', 'add', ipv6, 'dev', dev, 'nodad')
    ns(transit, 'sysctl', '-q', '-w', 'net.ipv4.ip_forward=1', 'net.ipv6.conf.all.forwarding=1')
    for name, network, gateway in [(left, '198.19.0.0/24', '198.18.0.2'), (right, '198.18.0.0/24', '198.19.0.1')]:
        run('ip', '-n', name, 'route', 'add', network, 'via', gateway)
    for name, network, gateway in [(left, '2001:db8:2::/64', '2001:db8:1::2'), (right, '2001:db8:1::/64', '2001:db8:2::1')]:
        run('ip', '-n', name, '-6', 'route', 'add', network, 'via', gateway)
    if l3: (work / 'relays.go').touch()
    # A foreign-looking builder name must survive stop and SIGKILL. The kernel
    # allocates a different name for our nonpersistent FD-owned private device.
    ns(left, 'ip', 'link', 'add', 'ftl0' if l3 else 'ftb0', 'type', 'dummy')
    baseline_links = {link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)}
    ns(left, 'tc', 'qdisc', 'add', 'dev', 'ftwan', 'clsact')
    ns(left, 'tc', 'filter', 'add', 'dev', 'ftwan', 'ingress', 'pref', '100', 'matchall', 'action', 'pass')
    before = ns(left, 'tc', 'filter', 'show', 'dev', 'ftwan', 'ingress').stdout
    ns(left, binary, 'check', '--config', str(config))
    peer = start(right, ['python3', '-u', str(server)], 'peer.log')
    for _ in range(50):
        if 'READY' in (work / 'peer.log').read_text(): break
        time.sleep(.05)
    check(peer.poll() is None and 'READY' in (work / 'peer.log').read_text(), 'isolated_application_server')
    baseline = ns(left, 'python3', '-c', probe, check=False)
    report['baseline_probe_rc'] = baseline.returncode
    report['baseline_probe_stderr'] = baseline.stderr
    check(baseline.returncode == 0, 'ipv4_ipv6_application_baseline_before_bpf')
    if hot_start:
        # Fresh traffic crosses attach -> publish -> enable, unlike a quiet lab.
        # Safe startup lease bypasses must not be mistaken for later expiry.
        start(left, ['python3', '-c', 'import socket,time; s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.settimeout(.1); s.connect(("198.19.0.2",18081)); end=time.monotonic()+4\nwhile time.monotonic()<end:\n s.send(b"FT-LAB"); s.recv(128); time.sleep(.001)'], 'hot-start.log')
        time.sleep(.05)
    daemon = start(left, [binary, 'run', '--config', str(config), '--object', obj, '--runtime-dir', str(runtime)], 'backend.log')
    for _ in range(100):
        if daemon.poll() is not None or 'READY generation=' in (work / 'backend.log').read_text(): break
        time.sleep(.1)
    check(daemon.poll() is None and 'READY generation=' in (work / 'backend.log').read_text(), 'native_bpf_load_and_four_tcx_stages_ready')
    first = json.loads(ns(left, binary, 'metrics', '--runtime-dir', str(runtime)).stdout)
    report['initial_metrics'] = first
    check(first['available'] and len(first['snapshot']['counters']) == 26 and all(isinstance(v, str) and v.isdecimal() for v in first['snapshot']['counters'].values()), 'all_26_metrics_are_decimal_strings')
    records = [line.split() for line in (runtime / 'filters').read_text().splitlines()]
    report['checkpoint_records'] = records
    wan_index = str(next(link['ifindex'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout) if link['ifname'] == 'ftwan'))
    check(all(any(row[:3] == ['L', wan_index, stage] for row in records) for stage in ['ingress', 'egress']), 'checkpoint_records_actual_wan_tcx_links')
    fdinfo = []
    for path in pathlib.Path('/proc/' + str(daemon.pid) + '/fdinfo').iterdir():
        try: fdinfo.append(path.read_text())
        except FileNotFoundError: pass
    held_ids = {m.group(1) for text in fdinfo for m in re.finditer(r'^link_id:\s*(\d+)\s*$', text, re.M)}
    check({row[3] for row in records} <= held_ids, 'checkpoint_ids_match_actual_held_tcx_fds')
    checkpoint_meta = (runtime / 'filters').stat()
    time.sleep(4.3)  # Covers at least two native two-second refresh cycles.
    unchanged_meta = (runtime / 'filters').stat()
    check((checkpoint_meta.st_ino, checkpoint_meta.st_mtime_ns) == (unchanged_meta.st_ino, unchanged_meta.st_mtime_ns) and (runtime / 'filters').read_text().splitlines() == [' '.join(row) for row in records], 'steady_refresh_does_not_rewrite_checkpoint')
    capture = start(transit, ['tcpdump', '-U', '-n', '-i', 'ftpeer', '-c', '100', '-s', '512', '-w', str(work / 'lab.pcap')], 'capture.log')
    time.sleep(.2)
    probe_result = ns(left, 'python3', '-c', probe, check=False)
    (work / 'probe.stderr').write_text(probe_result.stderr)
    report['probe_rc'] = probe_result.returncode
    report['probe_stderr'] = probe_result.stderr
    report['metrics_after_probe'] = json.loads(ns(left, binary, 'metrics', '--runtime-dir', str(runtime)).stdout)
    check(probe_result.returncode == 0, 'application_probe_command_succeeded')
    report['probes'] = json.loads(probe_result.stdout)
    check(all(v == 3 for v in report['probes'].values()), 'ipv4_ipv6_tcp_udp_12_echo_probes')
    time.sleep(.3)
    last = json.loads(ns(left, binary, 'metrics', '--runtime-dir', str(runtime)).stdout)
    report['metrics'] = last
    values = last['snapshot']['counters']
    check(int(values['fake_submit_ok']) > 0 and int(values['fake_build_ok']) > 0, 'synthetic_flows_reach_clone_and_builder')
    check(int(values['clone_failed']) == 0 and int(values['builder_failed']) == 0, 'no_clone_or_builder_errors_in_bounded_probe')
    if multi:
        check(last['snapshot']['tcp_template_count'] == 3 and last['snapshot']['udp_template_count'] == 3, 'live_metrics_report_three_templates_each')
        generation = json.loads(ns(left, binary, 'status', '--runtime-dir', str(runtime)).stdout)['generation']
        invalid = work / 'invalid.toml'
        invalid.write_text(config.read_text().replace('hostname="a.example"', 'hostname="bad host"'))
        refused = ns(left, binary, 'reload', '--config', str(invalid), '--runtime-dir', str(runtime), check=False)
        check(refused.returncode != 0 and json.loads(ns(left, binary, 'status', '--runtime-dir', str(runtime)).stdout)['generation'] == generation, 'invalid_candidate_preserves_active_generation')
        # New text and binary data belong to the next generation, not old requests.
        tcp_file.write_bytes(b'\0FT-TCP-B\xff'); udp_file.write_bytes(b'\0FT-UDP-B\xff')
        candidate = work / 'candidate.toml'
        candidate.write_text(config.read_text().replace('a.example', 'new.example').replace('b.example', 'new.example'))
        for _ in range(3): ns(left, binary, 'reload', '--config', str(candidate), '--runtime-dir', str(runtime))
        check(json.loads(ns(left, binary, 'status', '--runtime-dir', str(runtime)).stdout)['generation'] == generation + 3, 'three_rapid_generations_publish_without_restart')
        check(ns(left, 'python3', '-c', probe, check=False).returncode == 0, 'business_probes_after_generation_switch')
        time.sleep(4.3)
        ns(left, binary, 'reload', '--config', str(candidate), '--runtime-dir', str(runtime))
        check(ns(left, 'python3', '-c', probe, check=False).returncode == 0, 'business_probes_after_generation_gc')
        last = json.loads(ns(left, binary, 'metrics', '--runtime-dir', str(runtime)).stdout)
        report['metrics_after_reload'] = last
        check(all(last['snapshot']['counters'][key] == '0' for key in ['clone_failed','builder_failed','map_insert_failed','request_expired']), 'no_clone_builder_map_expiry_errors_after_reload')
    ns(left, binary, 'stop', '--runtime-dir', str(runtime)); daemon.wait(timeout=8)
    check(daemon.returncode == 0 and not (runtime / 'filters').exists() and not (runtime / 'recovery-required').exists(), 'graceful_stop_removes_owned_checkpoint')
    check(ns(left, 'tc', 'filter', 'show', 'dev', 'ftwan', 'ingress').stdout == before, 'unrelated_classic_filter_preserved')
    check({link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)} == baseline_links, 'private_builder_removed_and_foreign_name_preserved')
    # Fail before loading: do not leave a false recovery marker behind.
    result = ns(left, binary, 'run', '--config', str(config), '--object', str(work / 'missing-object'), '--runtime-dir', str(runtime), check=False)
    check(result.returncode != 0 and not (runtime / 'recovery-required').exists(), 'load_failure_cleans_own_empty_checkpoint')
    legacy_object = os.environ.get('FAKETRAFFIC_TEST_LEGACY_OBJECT')
    if legacy_object:
        result = ns(left, binary, 'run', '--config', str(config), '--object', legacy_object, '--runtime-dir', str(runtime), check=False)
        check(result.returncode != 0 and 'incompatible daemon/object template ABI' in result.stderr and
            not (runtime / 'recovery-required').exists() and
            {link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)} == baseline_links,
            'old_object_rejected_before_load_attach_without_checkpoint_or_device_changes')
    failed_runtime = work / 'failed-runtime'
    failed_runtime.mkdir(mode=0o700)
    (failed_runtime / 'filters.tmp').mkdir(mode=0o700)  # private write-failure injection
    result = ns(left, binary, 'run', '--config', str(config), '--object', obj, '--runtime-dir', str(failed_runtime), check=False)
    check(result.returncode != 0 and 'READY generation=' not in result.stdout and not (failed_runtime / 'recovery-required').exists() and {link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)} == baseline_links, 'checkpoint_write_failure_exits_before_ready_and_cleans_owned_links')
    # SIGKILL drops link FDs automatically but deliberately requires operator review.
    daemon2 = start(left, [binary, 'run', '--config', str(config), '--object', obj, '--runtime-dir', str(runtime)], 'kill.log')
    for _ in range(100):
        if daemon2.poll() is not None or 'READY generation=' in (work / 'kill.log').read_text(): break
        time.sleep(.1)
    check(daemon2.poll() is None and 'READY generation=' in (work / 'kill.log').read_text(), 'second_native_start')
    stop(daemon2, signal.SIGKILL)
    for _ in range(50):
        if {link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)} == baseline_links: break
        time.sleep(.02)
    check({link['ifname'] for link in json.loads(ns(left, 'ip', '-j', 'link').stdout)} == baseline_links, 'sigkill_fd_owned_device_auto_removed')
    marker = runtime / 'recovery-required'
    check(marker.exists(), 'sigkill_retains_recovery_checkpoint')
    checkpoint = marker.stat().st_ino
    refused = ns(left, binary, 'run', '--config', str(config), '--object', obj, '--runtime-dir', str(runtime), check=False)
    check(refused.returncode != 0 and marker.exists() and marker.stat().st_ino == checkpoint, 'restart_refused_without_deleting_existing_checkpoint')
    check(ns(left, 'tc', 'filter', 'show', 'dev', 'ftwan', 'ingress').stdout == before, 'sigkill_preserves_unrelated_filter')
    report['pass'] = True
except BaseException as exc:
    report['pass'] = False; report['error'] = str(exc)
    raise
finally:
    report['namespace_diagnostics'] = {name: {kind: ns(name, 'ip', '-j', '-6', kind, check=False).stdout for kind in ['address', 'route', 'neigh']} for name in owned}
    for child in reversed(children): stop(child)
    if l3:
        report['relays'] = {name: json.loads((work / ('relay-' + name + '.json')).read_text()) for name in relay_specs if (work / ('relay-' + name + '.json')).exists()}
        if report.get('pass') and (len(report['relays']) != len(relay_specs) or any(value['checksum_errors'] or not value['checksums_verified'] for value in report['relays'].values())):
            report['pass'] = False; report['error'] = 'L3 checksum/direction validation failed'
        if report.get('pass') and multi:
            try:
                packets = json.loads((work / 'relay-left.json.packets.json').read_text())
                check(packets and len(packets) % 2 == 0 and not report['relays']['left']['fake_capture_overflow'], 'bounded_even_repeat_capture')
                check(all(packets[i] == packets[i+1] for i in range(0,len(packets),2)), 'each_trigger_repeats_identical_template_and_transport_tuple')
                for family in [4,6]:
                    for proto, expected in [(6, {'http','tls','custom'}), (17, {'sip','custom'})]:
                        subset = [p for p in packets if p['family']==family and p['protocol']==proto]
                        check({p['kind'] for p in subset} == expected, 'mixed_templates_seen_v' + str(family) + '_proto' + str(proto))
                for proto in [6,17]:
                    old = [p['tag'] for p in packets[::2] if p['protocol']==proto and p['tag'] in {'a.example','b.example','FT-TCP-A','FT-UDP-A'}]
                    cycle = ['a.example','b.example','FT-TCP-A' if proto==6 else 'FT-UDP-A']
                    check(old and all(tag == cycle[i%3] for i,tag in enumerate(old)), 'round_robin_actual_three_slots_proto' + str(proto))
                check({'new.example','FT-TCP-B','FT-UDP-B'} <= {p['tag'] for p in packets}, 'new_generation_payloads_reach_builder')
                report['captured_fake_packets'] = len(packets)
                check(len(packets) == int(report['metrics_after_reload']['snapshot']['counters']['fake_submit_ok']) == 72,
                    '36_triggers_repeat_two_emit_72_not_template_list_fanout')
            except BaseException as exc:
                report['pass'] = False; report['error'] = str(exc)
    for handle in handles: handle.close()
    cleanup_errors = []
    for name in reversed(owned):
        result = run('ip', 'netns', 'del', name, check=False)
        if result.returncode: cleanup_errors.append(name)
    remaining = run('ip', 'netns', 'list').stdout
    report['cleanup_confirmed'] = not cleanup_errors and not any(name in remaining.split() for name in owned)
    (work / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report), flush=True)
    signal.alarm(0)
    if not report['cleanup_confirmed']: raise RuntimeError('owned namespace cleanup not confirmed')
    if not report.get('pass'): raise RuntimeError(report.get('error', 'isolated test failed'))
