// SPDX-License-Identifier: GPL-3.0-or-later
// Executes an exact wrapper with only its fixed paths redirected into a fixture.
// No production path, root, network, nft mutation or actual engine is used.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
const root = new URL('..', import.meta.url);
const source = fs.readFileSync(new URL('openwrt/faketraffic/files/usr/libexec/faketraffic/lock-run', root), 'utf8');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
test('NFQUEUE lifetime shared locks coexist and exclude BPF until both exit', { skip: process.platform !== 'linux' }, async () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-lock-'));
  const children = [];
  try {
    fs.chmodSync(temporary, 0o700);
    const bin = path.join(temporary, 'bin'); fs.mkdirSync(bin);
    const script = path.join(temporary, 'lock-run');
    // Only relax root identity inside the test fixture; keep lock/exec logic.
    fs.writeFileSync(script, source.replaceAll('/var/run/faketraffic', temporary)
      .replaceAll('/usr/libexec/faketraffic', bin).replace('= 0 ] || exit 1', '= ' + process.getuid() + ' ] || exit 1'));
    for (const name of ['fakehttp', 'fakesip', 'ebpf'])
      fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nprintf ready > "$1"\nexec sleep 10\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'pidof'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    fs.writeFileSync(path.join(bin, 'nft'), '#!/bin/sh\nprintf "%s" "${FT_TABLES:-}"\n', { mode: 0o755 });
    const env = { ...process.env, PATH: bin + ':' + process.env.PATH };
    const run = (kind, name) => spawnSync('sh', [script, kind, path.join(temporary, name)], { env, encoding: 'utf8' });
    const start = (kind, name) => {
      const child = spawn('sh', [script, kind, path.join(temporary, name)], { env, stdio: 'ignore' }); children.push(child); return child;
    };
    const ready = async name => {
      for (let i = 0; i < 100 && !fs.existsSync(path.join(temporary, name)); i++) await pause(10);
      assert.ok(fs.existsSync(path.join(temporary, name)), name);
    };
    const stop = async child => { child.kill('SIGTERM'); if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => child.once('exit', resolve)); };
    const tcp = start('tcp', 'tcp'); await ready('tcp');
    const udp = start('udp', 'udp'); await ready('udp');
    assert.notEqual(run('ebpf', 'blocked').status, 0);
    assert.ok(!fs.existsSync(path.join(temporary, 'blocked')));
    await stop(tcp); assert.notEqual(run('ebpf', 'still-blocked').status, 0);
    await stop(udp);
    const ebpf = start('ebpf', 'bpf'); await ready('bpf');
    assert.notEqual(run('tcp', 'blocked-tcp').status, 0);
    await stop(ebpf);
    fs.mkdirSync(path.join(temporary, 'ebpf-runtime'));
    const marker = path.join(temporary, 'ebpf-runtime/recovery-required'); fs.writeFileSync(marker, '');
    for (const kind of ['tcp', 'udp', 'ebpf']) assert.match(run(kind, 'marker-block').stderr, /RECOVERY_REQUIRED/);
    fs.unlinkSync(marker);
    const filters = path.join(temporary, 'ebpf-runtime/filters'); fs.writeFileSync(filters, 'owned-state');
    assert.match(run('tcp', 'state-block').stderr, /RECOVERY_REQUIRED/);
    fs.unlinkSync(filters);
    fs.symlinkSync('absent', marker);
    assert.match(run('tcp', 'symlink-block').stderr, /RECOVERY_REQUIRED/);
    fs.unlinkSync(marker);
    const result = spawnSync('sh', [script, 'ebpf', path.join(temporary, 'table-block')], { env: { ...env, FT_TABLES: 'table ip fakehttp\n' }, encoding: 'utf8' });
    assert.match(result.stderr, /NFQUEUE tables remain/);
    assert.ok(!fs.existsSync(path.join(temporary, 'table-block')));
  } finally {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
