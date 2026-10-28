// SPDX-License-Identifier: GPL-3.0-or-later
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { verifySources } from '../tools/verify-sources.mjs';
import { adapters } from '../tools/sync-unified-adapters.mjs';
const diagnosticsSource = fs.readFileSync(new URL('../openwrt/luci-app-faketraffic/root/www/luci-static/resources/faketraffic/diagnostics.js', import.meta.url), 'utf8');
const diagnostics = new Function('baseclass', '_', diagnosticsSource)({ extend: value => value }, text => text);
const root = fileURLToPath(new URL('..', import.meta.url));
const frontend = path.join(root, 'openwrt/luci-app-faketraffic/root');
const source = fs.readFileSync(path.join(frontend, 'www/luci-static/resources/view/faketraffic/config.js'), 'utf8');
const element = (tag, attrs, children) => ({ tag, attrs, children, setAttribute(key, value) { this.attrs[key] = value; } });
function harness({ readonly = false, values = {}, fail = false, result = { code: 0 }, preflight = {} } = {}) {
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
  const L = { bind: (fn, context) => fn.bind(context), toArray: v => Array.isArray(v) ? v : [v], resource: v => '/luci-static/resources/' + v };
  const parts = {};
  for (const name of ['tcp', 'udp']) {
    const src = fs.readFileSync(path.join(frontend, 'www/luci-static/resources/faketraffic/' + name + '.js'), 'utf8');
    parts[name] = new Function('baseclass', 'form', 'widgets', 'L', '_', src)(
      { extend: o => o }, form, { DeviceSelect: 'DeviceSelect', NetworkSelect: 'NetworkSelect' }, L, s => s);
  }
  const view = new Function('view', 'form', 'rpc', 'fs', 'ui', 'poll', 'tcp', 'udp', 'diagnostics', 'L', 'E', '_', source)(
    { extend: o => o }, form,
    { declare: definition => name => {
      if (definition.object === 'service') { calls.push(name); return fail ? Promise.reject(Error('denied')) : Promise.resolve({ faketraffic: { instances: { tcp: { running: true }, udp: { running: false } } } }); }
      return Promise.resolve(definition.method === 'preflight' ? preflight : {});
    } },
    { exec: async (...args) => { exec.push(args); return result; } },
    { addNotification: (...args) => notices.push(args), hideTooltip() {} }, { add: fn => polls.push(fn) }, parts.tcp, parts.udp, diagnostics, L, element, s => s);
  return { view, maps, exec, polls, calls, notices };
}
test('one editable map includes complete TCP and UDP fields, with no legacy redirects', async () => {
  const h = harness();
  const rendered = JSON.stringify(await h.view.render(await h.view.load()));
  assert.equal(h.maps.length, 1);
  assert.equal(h.maps[0].config, 'faketraffic');
  assert.equal(h.maps[0].sections.length, 5);
  assert.deepEqual(h.calls, ['faketraffic']);
  assert.equal(h.polls.length, 1);
  assert.match(rendered, /TCP · Running/);
  assert.match(rendered, /UDP · Stopped/);
  assert.match(rendered, /\/luci-static\/resources\/faketraffic\/dashboard.css/);
  assert.doesNotMatch(rendered, /\/admin\/services\/(fakehttp|fakesip)/);
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

test('TCP hop conflicts are rejected before saved form values change', async () => {
  const values = { 'globals.enabled': '1', 'advanced.disable_estimation': '1', 'advanced.pct': '50' };
  const h = harness({ values });
  await h.view.render({});
  await assert.rejects(h.maps[0].parse(), /Disable dynamic TTL/);
  assert.equal(h.maps[0].parsed, 0);
  values['advanced.pct'] = '-1';
  await h.maps[0].parse();
  assert.equal(h.maps[0].parsed, 1);
  values['advanced.pct'] = '50'; values['globals.enabled'] = '0';
  await h.maps[0].parse();
  assert.equal(h.maps[0].parsed, 2, 'disabled protocol does not block saving');
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

const ebpfReply = () => ({
  faketraffic: { instances: { ebpf: { running: true }, tcp: { running: false }, udp: { running: false } } },
  diagnostics: { configured_backend: 'nfqueue', actual_backend: 'ebpf', backend_mismatch: true,
    tcp: { available: false, reason: 'NOT_RUNNING' }, udp: { available: false, reason: 'NOT_RUNNING' },
    ebpf: { available: true, instance: 'boot:pid:tick', snapshot: { backend: 'ebpf', tcp_enabled: true,
      udp_enabled: true, sample_mono_ms: '1000', counters: { udp_new_flow: '35', fake_submit_ok: '50' } } } }
});

test('live eBPF state overrides inactive legacy instance objects and unsaved/saved form selections', async () => {
  const h = harness({ values: { 'globals.backend': 'nfqueue', 'main.enabled': '0' } });
  const reply = ebpfReply();
  const rendered = JSON.stringify(await h.view.render(reply));
  assert.match(rendered, /TCP · Running via eBPF/); assert.match(rendered, /UDP · Running via eBPF/);
  assert.match(rendered, /eBPF shared TCP\/UDP counters/);
  assert.match(h.view.counterNodes.udp.textContent, /UDP new-flow observations: 35/);
  assert.doesNotMatch(h.view.counterNodes.udp.textContent, /NOT_RUNNING/);
  assert.match(h.view.backendNode.textContent, /Warning: saved and running backends differ/);
  assert.equal(h.view.previousCounters.udp, null);
  reply.diagnostics.ebpf.snapshot.udp_enabled = false;
  h.view.load = async () => reply;
  await h.polls[0]();
  assert.equal(h.view.statusNodes.udp.textContent, 'UDP · Disabled via eBPF');
});

test('missing eBPF flags and concurrent old instances remain unknown on refresh', async () => {
  const h = harness(); const reply = ebpfReply();
  await h.view.render(reply);
  delete reply.diagnostics.ebpf.snapshot.udp_enabled;
  h.view.load = async () => reply;
  await h.view.refresh();
  assert.match(h.view.statusNodes.udp.textContent, /Unknown/);
  assert.match(h.view.counterNodes.udp.textContent, /unavailable/);
  reply.faketraffic.instances.tcp.running = true;
  await h.view.refresh();
  for (const name of ['tcp', 'udp']) {
    assert.match(h.view.statusNodes[name].textContent, /Unknown \(backend conflict\)/);
    assert.match(h.view.counterNodes[name].textContent, /BACKEND_CONFLICT/);
  }
});

test('polling a backend switch clears legacy rates and retains NFQUEUE counters when actually running', async () => {
  const h = harness(); const reply = ebpfReply();
  const nfq = structuredClone(reply);
  nfq.faketraffic.instances.ebpf.running = false;
  nfq.faketraffic.instances.udp.running = true;
  nfq.diagnostics.actual_backend = 'nfqueue'; nfq.diagnostics.configured_backend = 'ebpf';
  nfq.diagnostics.udp = { available: true, instance: 'nfq:pid:tick', snapshot: {
    backend: 'nfqueue', sample_mono_ms: '1000', counters: { fake_send_accepted_total: '10' }
  } };
  await h.view.render(nfq);
  assert.match(h.view.counterNodes.udp.textContent, /Socket accepted: 10/);
  h.view.load = async () => reply; await h.view.refresh();
  assert.equal(h.view.previousCounters.udp, null);
  h.view.load = async () => nfq; await h.view.refresh();
  assert.equal(h.view.statusNodes.udp.textContent, 'UDP · Running');
  assert.match(h.view.counterNodes.udp.textContent, /Socket accepted: 10/);
  assert.match(h.view.counterNodes.udp.textContent, /per second: —/);
  assert.doesNotMatch(h.view.counterNodes.udp.textContent, /via eBPF/);
});

test('dashboard keeps blocked saved settings, recovery and cumulative errors outside collapsed details', async () => {
  const h = harness({ preflight: { schema_version: 1, can_attempt: false, errors: ['TCP_TEMPLATE_LIMIT_EXCEEDED'], warnings: [] } });
  const reply = ebpfReply(); reply.diagnostics.recovery_required = true;
  reply.diagnostics.ebpf.snapshot.counters.clone_failed = '2';
  await h.view.render(reply);
  assert.match(h.view.preflightWarning.textContent, /Saved settings are blocked.*TCP_TEMPLATE_LIMIT_EXCEEDED/);
  assert.match(h.view.preflightWarning.textContent, /1–16 templates per enabled protocol/);
  assert.match(h.view.preflightWarning.attrs.class, /warning/);
  assert.match(h.view.backendNode.attrs.class, /warning/);
  assert.match(h.view.errorWarning.textContent, /clone_failed: 2/);
  assert.equal(h.view.errorWarning.hidden, false);
  assert.equal(h.exec.length, 0);
});

test('polls update text without replacing dashboard nodes, details state or unsaved form values', async () => {
  const h = harness({ values: { 'main.enabled': '0' } }); const reply = ebpfReply();
  const dashboard = await h.view.render(reply);
  const nodes = [h.view.metricNodes.udp, h.view.counterNodes.udp, h.view.cardStates.udp];
  const details = dashboard.children[1].children.find(n => n.attrs?.class === 'ft-grid').children[1].children.at(-1);
  details.open = true;
  h.view.load = async () => reply;
  await h.polls[0](); await h.polls[0]();
  assert.deepEqual([h.view.metricNodes.udp,h.view.counterNodes.udp,h.view.cardStates.udp],nodes);
  assert.equal(details.open,true);
  assert.equal(h.maps[0].lookupOption('enabled','main')[0].formvalue(),'0');
  assert.equal(h.view.metricNodes.udp.textContent,'35');
});
test('ACL only permits own read-only diagnostics, unified config and three exact service commands', () => {
  const acl = JSON.parse(fs.readFileSync(path.join(frontend, 'usr/share/rpcd/acl.d/luci-app-faketraffic.json')))['luci-app-faketraffic'];
  assert.deepEqual(acl.read.uci, ['faketraffic']); assert.deepEqual(acl.write.uci, ['faketraffic']);
  assert.deepEqual(acl.read.ubus.faketraffic, ['status', 'preflight']);
  assert.deepEqual(Object.keys(acl.write.file), ['start', 'restart', 'stop'].map(a => '/etc/init.d/faketraffic ' + a));
});
test('pinned sources and deterministic adapters are intact', () => {
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'sources.lock.json')));
  assert.equal(lock.components.filter(c => c.name !== 'fakeflow').reduce((n, c) => n + Object.keys(c.files).length, 0), 136);
  assert.ok(verifySources(root).reviewedOverrides > 0);
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
test('reviewed override must match its immutable base, current hash and explanation', () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-overlay-'));
  try {
    const hash = value => crypto.createHash('sha256').update(value).digest('hex');
    fs.mkdirSync(path.join(temporary, 'components/fixture'), { recursive: true });
    fs.writeFileSync(path.join(temporary, 'components/fixture/main.c'), 'patched');
    fs.writeFileSync(path.join(temporary, 'sources.lock.json'), JSON.stringify({ components: [{ name: 'fixture', files: { 'main.c': hash('base') } }] }));
    const manifest = { schemaVersion: 1, patchSet: 'reviewed-test', description: 'Fixture only', files: {
      'fixture/main.c': { baseSHA256: hash('base'), sha256: hash('patched'), reason: 'Reviewed fixture' }
    } };
    const save = () => fs.writeFileSync(path.join(temporary, 'source-overrides.lock.json'), JSON.stringify(manifest));
    save(); assert.equal(verifySources(temporary).reviewedOverrides, 1);
    manifest.files['fixture/main.c'].baseSHA256 = hash('invented'); save(); assert.throws(() => verifySources(temporary), /invalid or unreviewed/);
    manifest.files['fixture/main.c'].baseSHA256 = hash('base');
    manifest.files['fixture/main.c'].sha256 = hash('wrong'); save(); assert.throws(() => verifySources(temporary), /invalid or unreviewed/);
    manifest.files['fixture/main.c'].sha256 = hash('patched');
    manifest.files['fixture/main.c'].reason = ''; save(); assert.throws(() => verifySources(temporary), /invalid or unreviewed/);
  } finally { fs.rmSync(temporary, { recursive: true }); }
});
