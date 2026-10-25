// SPDX-License-Identifier: GPL-3.0-or-later
// Uses a real jsonfilter binary supplied by the lab. Fixed paths only are
// redirected; no system /var/run, ubus, UCI or network state is written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('real-jsonfilter status distinguishes live, unavailable, stale and mismatched snapshots', {
  skip: process.platform !== 'linux' || !process.env.FT_JSONFILTER || process.getuid() !== 0
}, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-status-'));
  fs.chmodSync(temporary, 0o700);
  try {
    const bin = path.join(temporary, 'bin'); fs.mkdirSync(bin);
    const stats = path.join(temporary, 'tcp.stats');
    const script = path.join(temporary, 'status');
    const source = fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/status', import.meta.url), 'utf8');
    fs.writeFileSync(script, source.replaceAll('/var/run/faketraffic', temporary).replaceAll('/usr/libexec/faketraffic', bin));
    fs.writeFileSync(path.join(bin, 'ubus'), '#!/bin/sh\n[ "${FT_BUS_FAIL:-0}" = 0 ] || exit 1\nprintf "%s" "$FT_SERVICE"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'uci'), '#!/bin/sh\nprintf ebpf\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'jsonfilter'), '#!/bin/sh\nexec "$FT_JSONFILTER" "$@"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'readlink'), '#!/bin/sh\nprintf "%s" "$FT_EXE"\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'ebpf'), '#!/bin/sh\nprintf "%s" "$FT_METRICS"\n', { mode: 0o755 });
    const ticks = fs.readFileSync('/proc/self/stat', 'utf8').replace(/^.*\) /, '').split(' ')[19];
    const snapshot = () => ({ schema_version: 1, backend: 'nfqueue', engine: 'tcp', pid: String(process.pid),
      start_ticks: ticks, boot_id: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
      sample_mono_ms: String(Math.floor(os.uptime() * 1000)), queue_bound: false, queue_number: 513,
      counters: { fake_send_accepted_total: '18446744073709551615' } });
    const service = { faketraffic: { instances: { tcp: { pid: process.pid, running: true } } } };
    const run = (extra = {}) => {
      const result = spawnSync('sh', [script], { encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH,
        FT_SERVICE: JSON.stringify(service), FT_EXE: bin + '/fakehttp', ...extra } });
      assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
    };
    const save = value => fs.writeFileSync(stats, JSON.stringify(value));
    save(snapshot()); let result = run();
    assert.equal(result.tcp.available, true);
    assert.equal(result.tcp.snapshot.counters.fake_send_accepted_total, '18446744073709551615');
    assert.equal(result.tcp.queue.reason, 'QUEUE_NOT_BOUND');
    assert.equal(result.actual_backend, 'nfqueue'); assert.equal(result.backend_mismatch, true);
    assert.equal(result.udp.reason, 'NOT_RUNNING');
    fs.mkdirSync(path.join(temporary, 'ebpf-runtime'));
    const checkpoint = path.join(temporary, 'ebpf-runtime/recovery-required');
    fs.symlinkSync('absent', checkpoint); assert.equal(run().recovery_required, true); fs.unlinkSync(checkpoint);
    save({ ...snapshot(), sample_mono_ms: String(Math.floor(os.uptime() * 1000) - 20000) });
    assert.equal(run().tcp.reason, 'STALE_SNAPSHOT');
    save({ ...snapshot(), start_ticks: String(Number(ticks) + 1) }); assert.equal(run().tcp.reason, 'INSTANCE_MISMATCH');
    save({ ...snapshot(), boot_id: 'wrong-boot' }); assert.equal(run().tcp.reason, 'INSTANCE_MISMATCH');
    save({ ...snapshot(), engine: 'udp' }); assert.equal(run().tcp.reason, 'INVALID_SNAPSHOT');
    save(snapshot()); fs.chmodSync(temporary, 0o755); assert.equal(run().tcp.reason, 'UNSAFE_SNAPSHOT_DIRECTORY'); fs.chmodSync(temporary, 0o700);
    fs.unlinkSync(stats); assert.equal(run().tcp.reason, 'NO_SNAPSHOT');
    fs.symlinkSync('/dev/null', stats); assert.equal(run().tcp.reason, 'NO_SNAPSHOT'); fs.unlinkSync(stats);
    save(snapshot()); result = run({ FT_BUS_FAIL: '1' }); assert.equal(result.tcp.reason, 'SERVICE_QUERY_FAILED'); assert.equal(result.actual_backend, 'unknown');
    const metrics = { available: true, pid: String(process.pid), snapshot: { backend: 'ebpf', sample_mono_ms: snapshot().sample_mono_ms, counters: { fake_submit_ok: '12' } } };
    result = run({ FT_SERVICE: JSON.stringify({ faketraffic: { instances: { ebpf: { pid: process.pid, running: true } } } }),
      FT_EXE: bin + '/ebpf', FT_METRICS: JSON.stringify(metrics) });
    assert.equal(result.ebpf.available, true); assert.equal(result.actual_backend, 'ebpf'); assert.equal(result.backend_mismatch, false);
    fs.writeFileSync(checkpoint, '');
    result = run({ FT_SERVICE: JSON.stringify({ faketraffic: { instances: { ebpf: { pid: process.pid, running: true } } } }),
      FT_EXE: bin + '/ebpf', FT_METRICS: JSON.stringify(metrics) });
    assert.equal(result.recovery_required, false, 'a live owner checkpoint is not an abnormal-exit alarm');
    const core = path.join(temporary, 'preflight-core.sh');
    fs.writeFileSync(core, fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/preflight-core.sh', import.meta.url), 'utf8')
      .replaceAll('/var/run/faketraffic', temporary).replaceAll('/usr/libexec/faketraffic', bin));
    const environmentCheck = (active, exe) => spawnSync('sh', ['-c', '. "$FT_CORE"; ft_errors= ft_warnings= ft_mode=ethernet ft_devices=; ft_environment; printf "%s|%s" "$ft_errors" "$ft_warnings"'], {
      encoding: 'utf8', env: { ...process.env, PATH: bin + ':' + process.env.PATH, FT_CORE: core, FT_EXE: exe,
        FT_SERVICE: JSON.stringify({ faketraffic: { instances: active ? { ebpf: { pid: process.pid, running: true } } : {} } }) }
    }).stdout;
    assert.match(environmentCheck(false, ''), /RECOVERY_REQUIRED/);
    assert.match(environmentCheck(true, '/unrelated'), /RECOVERY_REQUIRED/);
    assert.ok(!environmentCheck(true, bin + '/ebpf').includes('RECOVERY_REQUIRED'));
    assert.match(environmentCheck(true, bin + '/ebpf'), /BACKEND_STOP_REQUIRED/);
    fs.unlinkSync(checkpoint);
    result = run({ FT_METRICS: '{"available":false}', FT_EXE: bin + '/ebpf', FT_SERVICE: JSON.stringify({ faketraffic: { instances: { ebpf: { pid: process.pid, running: true } } } }) });
    assert.equal(result.ebpf.reason, 'METRICS_QUERY_FAILED');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});
