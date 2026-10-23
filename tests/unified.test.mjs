// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { verifySources } from '../tools/verify-sources.mjs';
import { adapters } from '../tools/sync-unified-adapters.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const frontend = path.join(root, 'openwrt/luci-app-faketraffic/root');
const source = fs.readFileSync(path.join(frontend, 'www/luci-static/resources/view/faketraffic/config.js'), 'utf8');
const element = (tag, attrs, children) => ({ tag, attrs, children });
function harness({ readonly = false, values = {}, fail = false, result = { code: 0 } } = {}) {
  const maps = [], exec = [], polls = [], calls = [], notices = [];
  class Section {
    constructor(type, ...args) { this.type = type; this.args = args; this.fields = []; }
    tab() {}
    option(type, name) { const field = { type, name, value() {}, depends() {}, formvalue: id => values[id + '.' + name] }; this.fields.push(field); return field; }
    taboption(tab, type, name) { return this.option(type, name); }
  }
  class Map {
    constructor(config) { this.config = config; this.sections = []; this.readonly = readonly; this.parsed = 0; maps.push(this); }
    section(type, ...args) { const section = new Section(type, ...args); this.sections.push(section); return section; }
    render() { return Promise.resolve(element('form', {}, [])); }
    parse() { this.parsed++; return Promise.resolve(); }
    reset() { return Promise.resolve(); }
    lookupOption(name, id) { return [{ formvalue: () => values[id + '.' + name] }]; }
  }
  const form = { Map, TypedSection: 'TypedSection', NamedSection: 'NamedSection', GridSection: 'GridSection' };
  const L = { bind: (fn, context) => fn.bind(context), toArray: v => Array.isArray(v) ? v : [v] };
  const parts = {};
  for (const name of ['tcp', 'udp']) {
    const src = fs.readFileSync(path.join(frontend, 'www/luci-static/resources/faketraffic/' + name + '.js'), 'utf8');
    parts[name] = new Function('baseclass', 'form', 'widgets', 'L', '_', src)(
      { extend: o => o }, form, { DeviceSelect: 'DeviceSelect', NetworkSelect: 'NetworkSelect' }, L, s => s);
  }
  const view = new Function('view', 'form', 'rpc', 'fs', 'ui', 'poll', 'tcp', 'udp', 'L', 'E', '_', source)(
    { extend: o => o }, form,
    { declare: () => name => { calls.push(name); return fail ? Promise.reject(Error('denied')) : Promise.resolve({ faketraffic: { instances: { tcp: { running: true }, udp: { running: false } } } }); } },
    { exec: async (...args) => { exec.push(args); return result; } },
    { addNotification: (...args) => notices.push(args), hideTooltip() {} }, { add: fn => polls.push(fn) }, parts.tcp, parts.udp, L, element, s => s);
  return { view, maps, exec, polls, calls, notices };
}
test('one editable map includes complete TCP and UDP fields, with no legacy redirects', async () => {
  const h = harness();
  const rendered = JSON.stringify(await h.view.render(await h.view.load()));
  assert.equal(h.maps.length, 1);
  assert.equal(h.maps[0].config, 'faketraffic');
  assert.equal(h.maps[0].sections.length, 4);
  assert.deepEqual(h.calls, ['faketraffic']);
  assert.equal(h.polls.length, 1);
  assert.match(rendered, /TCP · Running/);
  assert.match(rendered, /UDP · Stopped/);
  assert.ok(!rendered.includes('href'));
  const fields = h.maps[0].sections.flatMap(s => s.fields.map(f => f.name));
  for (const name of ['enabled', 'payload', 'queue_number', 'queue_num', 'sip_profile', 'sip_uri', 'interface_mode', 'ttl']) assert.ok(fields.includes(name), name);
  assert.equal(h.view.handleSaveApply, undefined, 'Standard LuCI Save & Apply must remain enabled');
  assert.ok(h.view.buttons.every(b => b.disabled === false && b.attrs.disabled === undefined));
});
test('equal effective queues reject the complete form before parsing either engine', async () => {
  const h = harness({ values: { 'globals.enabled': '1', 'main.enabled': '1', 'advanced.queue_number': '-1', 'main.queue_num': '512' } });
  await h.view.render({});
  await assert.rejects(h.maps[0].parse(), /different NFQUEUE/);
  assert.equal(h.maps[0].parsed, 0);
});
test('valid separate queues use the single normal parse cycle', async () => {
  const h = harness({ values: { 'globals.enabled': '1', 'main.enabled': '1', 'advanced.queue_number': '-1', 'main.queue_num': '513' } });
  await h.view.render({}); await h.maps[0].parse(); assert.equal(h.maps[0].parsed, 1);
});
test('readonly sessions cannot run service actions', async () => {
  const h = harness({ readonly: true }); await h.view.render({}); await h.view.command('restart');
  assert.equal(h.exec.length, 0); assert.ok(h.view.buttons.every(b => b.disabled));
});
test('service actions only target the common init; failures restore controls', async () => {
  const h = harness({ result: { code: 1, stderr: 'blocked' } }); await h.view.render({}); await h.view.command('restart');
  assert.deepEqual(h.exec, [['/etc/init.d/faketraffic', ['restart']]]);
  assert.equal(h.view.busy, false); assert.equal(h.notices[0][2], 'error');
  await h.view.command('arbitrary'); assert.equal(h.exec.length, 1);
});
test('RPC failure remains unknown rather than falsely stopped/running', async () => {
  const h = harness({ fail: true }); const rendered = JSON.stringify(await h.view.render(await h.view.load()));
  assert.match(rendered, /TCP · Unknown/); assert.match(rendered, /UDP · Unknown/);
});
test('ACL only permits the unified config and three exact service commands', () => {
  const acl = JSON.parse(fs.readFileSync(path.join(frontend, 'usr/share/rpcd/acl.d/luci-app-faketraffic.json')))['luci-app-faketraffic'];
  assert.deepEqual(acl.read.uci, ['faketraffic']); assert.deepEqual(acl.write.uci, ['faketraffic']);
  assert.deepEqual(Object.keys(acl.write.file), ['start', 'restart', 'stop'].map(a => '/etc/init.d/faketraffic ' + a));
});
test('pinned sources and deterministic adapters are intact', () => {
  assert.equal(verifySources(root).files, 136);
  for (const [file, expected] of adapters()) assert.equal(fs.readFileSync(path.join(root, file), 'utf8'), expected);
});
test('source verifier still rejects modified, extra and missing imported files', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-provenance-'));
  try {
    const dir = path.join(temporary, 'components', 'fixture');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(temporary, 'sources.lock.json'), JSON.stringify({ components: [{ name: 'fixture', files: { 'main.c': 'invalid-hash' } }] }));
    fs.writeFileSync(path.join(dir, 'main.c'), 'changed');
    fs.writeFileSync(path.join(dir, 'extra.c'), 'unexpected');
    assert.throws(() => verifySources(temporary), /unreviewed source change/);
    fs.unlinkSync(path.join(dir, 'main.c'));
    assert.throws(() => verifySources(temporary), /missing source/);
  } finally { fs.rmSync(temporary, { recursive: true }); }
});
