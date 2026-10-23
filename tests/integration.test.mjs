// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifySources } from '../tools/verify-sources.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const frontend = path.join(root, 'openwrt/luci-app-faketraffic/root');
const source = fs.readFileSync(path.join(frontend, 'www/luci-static/resources/view/faketraffic.js'), 'utf8');
const E = (tag, attrs, children) => ({ tag, attrs, children });
function page(responses) {
  const calls = [];
  const rpc = { declare(spec) {
    assert.deepEqual(spec, { object: 'service', method: 'list', params: ['name'], expect: { '': {} } });
    return name => { calls.push(name); return responses(name); };
  } };
  return { view: new Function('view', 'rpc', 'E', 'L', source)(
    { extend: value => value }, rpc, E, { url: (...parts) => '/cgi-bin/luci/' + parts.join('/') }), calls };
}
test('overview queries each existing service once and links to preserved configuration routes', async () => {
  const p = page(name => Promise.resolve({ [name]: { instances: { main: { running: true } } } }));
  const rendered = JSON.stringify(p.view.render(await p.view.load()));
  assert.deepEqual(p.calls, ['fakehttp', 'fakesip']);
  for (const name of p.calls) assert.ok(rendered.includes('/cgi-bin/luci/admin/services/' + name));
  assert.equal((rendered.match(/Running/g) || []).length, 2);
  assert.equal(p.view.handleSaveApply, null);
  assert.equal(p.view.handleSave, null);
  assert.equal(p.view.handleReset, null);
});
test('one failed RPC does not hide the other engine; stopped differs from unavailable', async () => {
  const p = page(name => name === 'fakehttp' ? Promise.reject(new Error('denied')) : Promise.resolve({}));
  const rendered = JSON.stringify(p.view.render(await p.view.load()));
  assert.ok(rendered.includes('Status unavailable'));
  assert.ok(rendered.includes('Not running'));
});
test('new package files do not overlap either installed component and ACL grants no mutation', () => {
  const acl = JSON.parse(fs.readFileSync(path.join(frontend, 'usr/share/rpcd/acl.d/luci-app-faketraffic.json')));
  assert.deepEqual(acl['luci-app-faketraffic'].read, { ubus: { service: ['list'] } });
  assert.equal(acl['luci-app-faketraffic'].write, undefined);
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'sources.lock.json')));
  function walk(dir, rel = '') {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
      e.isDirectory() ? walk(path.join(dir, e.name), rel + e.name + '/') : [rel + e.name]);
  }
  for (const file of walk(frontend)) {
    assert.ok(!file.startsWith('etc/'));
    for (const component of lock.components)
      assert.ok(!Object.keys(component.files).some(old => old.endsWith('/root/' + file)));
  }
});
test('source lock rejects tampering, extra files and missing files', () => {
  assert.equal(verifySources(root).components, 2);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-provenance-'));
  try {
    const dir = path.join(temporary, 'components', 'fixture');
    fs.mkdirSync(dir, { recursive: true });
    const lock = { components: [{ name: 'fixture', files: { 'main.c': 'invalid-hash' } }] };
    fs.writeFileSync(path.join(temporary, 'sources.lock.json'), JSON.stringify(lock));
    fs.writeFileSync(path.join(dir, 'main.c'), 'changed');
    fs.writeFileSync(path.join(dir, 'extra.c'), 'unexpected');
    assert.throws(() => verifySources(temporary), /unreviewed source change/);
    fs.unlinkSync(path.join(dir, 'main.c'));
    assert.throws(() => verifySources(temporary), /missing source/);
  } finally { fs.rmSync(temporary, { recursive: true }); }
});
