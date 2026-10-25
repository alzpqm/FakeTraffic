// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = path => fs.readFileSync(new URL('../' + path, import.meta.url), 'utf8').replaceAll('\r', '');
const packages = ['faketraffic', 'luci-app-faketraffic', 'faketraffic-ebpf'];

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
  const files = [...readme.matchAll(/\.\/([a-z][a-z0-9.-]*\.apk)/g)].map(match => match[1]);
  const expected = packages.map(name => name + '-' + version + '.apk').sort();
  assert.deepEqual([...new Set(files)].sort(), expected, 'no missing or stale APK examples');
});

test('README installs optional eBPF with its exact core and LuCI dependencies in one transaction', () => {
  const readme = read('README.md');
  const commands = [...readme.matchAll(/^```sh\n([\s\S]*?)^```/gm)]
    .flatMap(match => match[1].replace(/\\\n\s*/g, ' ').split('\n'))
    .filter(line => /^apk add /.test(line));
  assert.equal(commands.length, 2, 'one complete command per installation choice');
  const names = command => [...command.matchAll(/\.\/(faketraffic(?:-ebpf)?|luci-app-faketraffic)-[0-9][\w.-]*\.apk/g)]
    .map(match => match[1]).sort();
  const nfqueue = commands.find(command => !command.includes('/faketraffic-ebpf-'));
  const ebpf = commands.find(command => command.includes('/faketraffic-ebpf-'));
  assert.ok(nfqueue && ebpf);
  assert.deepEqual(names(nfqueue), ['faketraffic', 'luci-app-faketraffic']);
  assert.deepEqual(names(ebpf), [...packages].sort());
  assert.ok(!/docs\/handoff-/.test(readme), 'private operation reports are not README links');
});
