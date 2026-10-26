// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('\r', '');
const packages = ['faketraffic', 'luci-app-faketraffic', 'faketraffic-ebpf'];
const installBlocks = () => [...read('README.md').matchAll(/^```sh\n([\s\S]*?)^```/gm)]
  .map(match => match[1]).filter(block => /^set -- .*\.apk$/m.test(block));
const fileNames = block => block.match(/^set -- (.+)$/m)[1].split(/\s+/);
const manifestPin = block => block.match(/'([a-f0-9]{64})' > "\$work\/manifest\.sha256"/)?.[1];

test('README release and APK examples match the coordinated package versions', () => {
  const versions = packages.map(name => {
    const recipe = read('openwrt/' + name + '/Makefile');
    const version = recipe.match(/^PKG_VERSION:=(\S+)$/m)?.[1];
    const release = recipe.match(/^PKG_RELEASE:=(\S+)$/m)?.[1];
    assert.ok(version && release, name);
    return version + '-r' + release;
  });
  assert.equal(new Set(versions).size, 1, 'product package versions must match');
  const version = versions[0], readme = read('README.md');
  assert.ok(readme.includes('https://github.com/alzpqm/FakeTraffic/releases/tag/v' + version));
  const files = installBlocks().flatMap(fileNames);
  const expected = packages.map(name => name + '-' + version + '.apk').sort();
  assert.deepEqual([...new Set(files)].sort(), expected, 'no missing or stale APK examples');
});

test('README installs optional eBPF with its exact core and LuCI dependencies in one transaction', () => {
  const readme = read('README.md');
  const commands = installBlocks();
  assert.equal(commands.length, 2, 'one complete command per installation choice');
  const names = block => fileNames(block).map(name => name.replace(/-[0-9][\w.-]*\.apk$/, '')).sort();
  const nfqueue = commands.find(block => fileNames(block).length === 2);
  const ebpf = commands.find(block => fileNames(block).length === 3);
  assert.ok(nfqueue && ebpf);
  assert.deepEqual(names(nfqueue), ['faketraffic', 'luci-app-faketraffic']);
  assert.deepEqual(names(ebpf), [...packages].sort());
  for (const block of commands) {
    assert.ok(manifestPin(block), 'manifest must be pinned, not just downloaded beside the APK');
    assert.equal((block.match(/apk add /g) || []).length, 1);
    assert.ok(block.includes('(cd "$work" && apk add --allow-untrusted "$@")'));
    assert.ok(block.indexOf('sha256sum -c manifest.sha256') < block.indexOf('"$base/$name"'));
    assert.ok(block.indexOf('sha256sum -c packages.sha256') < block.indexOf('apk update'));
    assert.ok(!/--force-overwrite|--clean-protected|--no-chown|apk verify|opkg|\/etc\/apk\/keys/.test(block));
  }
  assert.ok(!/docs\/handoff-/.test(readme), 'private operation reports are not README links');
});

test('copy/paste installers verify before APK mutation and always clean their own temporary files', {
  skip: process.platform !== 'linux'
}, () => {
  const digest = data => crypto.createHash('sha256').update(data).digest('hex');
  for (const block of installBlocks()) for (const scenario of
    ['success', 'manifest-corrupt', 'payload-corrupt', 'missing-entry', 'duplicate-entry', 'download-fails', 'update-fails', 'already-ebpf']) {
    if (scenario === 'already-ebpf' && fileNames(block).length === 3) continue;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-docs-'));
    try {
      const bin = path.join(temporary, 'bin'), assets = path.join(temporary, 'assets'), log = path.join(temporary, 'events');
      fs.mkdirSync(bin);fs.mkdirSync(assets);
      const files = fileNames(block), first = files[0];
      let manifest = files.map(name => {
        const data = Buffer.from('offline fixture ' + name);
        fs.writeFileSync(path.join(assets, name), data);
        return digest(data) + '  ./' + name + '\n';
      }).join('');
      if (scenario === 'missing-entry') manifest = manifest.split('\n').slice(1).join('\n');
      if (scenario === 'duplicate-entry') manifest += manifest.split('\n')[0] + '\n';
      const pin = digest(manifest);
      fs.writeFileSync(path.join(assets, 'SHA256SUMS'), scenario === 'manifest-corrupt' ? manifest + 'corrupt' : manifest);
      if (scenario === 'payload-corrupt') fs.appendFileSync(path.join(assets, first), 'corrupt');
      const write = (name, text) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\nset -eu\n' + text, { mode: 0o755 });
      write('mktemp', 'exec /usr/bin/mktemp -d "$FT_ROOT/work.XXXXXX"\n');
      write('curl', `
name= destination=
while [ "$#" -gt 0 ]; do
  case "$1" in -o) shift; destination=$1;; https://*) name=\${1##*/};; esac
  shift
done
printf 'curl:%s\\n' "$name" >> "$FT_LOG"
[ "$name" != "\${FT_FAIL_DOWNLOAD:-}" ] || exit 22
cp "$FT_ROOT/assets/$name" "$destination"
`);
      write('apk', `
printf 'apk:%s\\n' "$*" >> "$FT_LOG"
case "$1" in
  info) [ "$FT_SCENARIO" = already-ebpf ];;
  update) [ "$FT_SCENARIO" != update-fails ];;
  add) exit 0;;
  *) exit 99;;
esac
`);
      // Replace only the expected manifest hash in memory for hermetic fixtures.
      // The published README pin is checked separately against release assets.
      const result = spawnSync('sh', ['-s'], { input: block.replace(manifestPin(block), pin),
        encoding: 'utf8', timeout: 10000, env: { ...process.env, PATH: bin + ':' + process.env.PATH,
          FT_ROOT: temporary, FT_LOG: log, FT_SCENARIO: scenario,
          FT_FAIL_DOWNLOAD: scenario === 'download-fails' ? first : '' } });
      const events = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
      const context = scenario + ': ' + result.stderr;
      if (scenario === 'success') {
        assert.equal(result.status, 0, context);
        assert.ok(events.includes('apk:add --allow-untrusted ' + files.join(' ') + '\n'));
        assert.equal((events.match(/apk:add /g) || []).length, 1);
      } else {
        assert.notEqual(result.status, 0, context);
        assert.ok(!events.includes('apk:add '), context);
        if (scenario !== 'update-fails') assert.ok(!events.includes('apk:update'), context);
      }
      assert.ok(!fs.readdirSync(temporary).some(name => name.startsWith('work.')), 'temporary cleanup');
    } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
  }
});
