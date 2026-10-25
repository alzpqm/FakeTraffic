// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../openwrt/luci-app-faketraffic/root/www/luci-static/resources/faketraffic/diagnostics.js', import.meta.url), 'utf8');
export const diagnostics = new Function('baseclass', '_', source)({ extend: value => value }, text => text);
test('uint64 parsing and subtraction stay exact without BigInt/Number rounding', () => {
  assert.equal(diagnostics.subtract('9007199254740993', '9007199254740992'), '1');
  assert.equal(diagnostics.subtract('18446744073709551615', '0'), '18446744073709551615');
  assert.equal(diagnostics.subtract('9', '10'), null);
  for (const value of [0, '01', '-1', '18446744073709551616', '1e3', '<script>']) assert.equal(diagnostics.decimal(value), null);
});
test('unavailable is never represented as zero or stopped', () => {
  assert.match(diagnostics.summary({ available: false, reason: 'STALE_SNAPSHOT' }), /unavailable.*STALE_SNAPSHOT/);
});
const sample = (instance, time, count) => ({ available: true, instance, snapshot: { sample_mono_ms: time, counters: { fake_send_accepted_total: count } } });
test('rate requires same live instance and increasing clock and count', () => {
  const before = sample('boot:pid:tick', '1000', '9007199254740992');
  const after = sample('boot:pid:tick', '6000', '9007199254740993');
  assert.match(diagnostics.summary(after, before), /per second: 0.20/);
  assert.match(diagnostics.summary(after, sample('restarted', '1000', '0')), /per second: —/);
  assert.match(diagnostics.summary(before, after), /per second: —/);
  assert.match(diagnostics.summary(after, after), /per second: —/);
  after.snapshot.saturated = true;
  assert.match(diagnostics.summary(after, before), /rates unavailable/);
});
test('preflight says saved-only and untested, never invents native readiness', () => {
  assert.match(diagnostics.preflight({ schema_version: 1, can_attempt: true, errors: [], warnings: [] }), /load\/attach is not tested/);
  assert.match(diagnostics.preflight({}), /unavailable/);
});
test('template counts distinguish live from saved lists, missing and invalid are unavailable', () => {
  const reply = observed();
  reply.diagnostics.ebpf.snapshot.tcp_template_count = 3;
  assert.match(diagnostics.protocol(reply, 'tcp').summary, /Active templates: 3/);
  for (const bad of [undefined, '3', 17, -1, 2.5]) {
    reply.diagnostics.ebpf.snapshot.tcp_template_count = bad;
    assert.match(diagnostics.protocol(reply, 'tcp').summary, /Active templates: Unavailable/);
  }
  assert.match(diagnostics.preflight({ schema_version:1, tcp_template_count:3, udp_template_count:2 }), /templates.*3 \/ 2/);
});
test('saved versus actual backend mismatch is explicit and sampled', () => {
  assert.match(diagnostics.backend({ configured_backend: 'ebpf', actual_backend: 'nfqueue', backend_mismatch: true }), /Warning:.*differ/);
  assert.match(diagnostics.backend({ configured_backend: 'ebpf', actual_backend: 'ebpf', backend_mismatch: false }), /Sampled state/);
  assert.match(diagnostics.backend({}), /unavailable/);
});

const observed = (overrides = {}) => ({
  faketraffic: { instances: { ebpf: { running: true }, tcp: { running: false }, udp: { running: false } } },
  diagnostics: { configured_backend: 'nfqueue', actual_backend: 'ebpf', ebpf: {
    available: true, instance: 'boot:pid:tick', snapshot: { backend: 'ebpf', tcp_enabled: true, udp_enabled: true,
      sample_mono_ms: '6000', counters: { tcp_syn_seen: '9007199254740993', tcp_synack_eligible: '12',
        udp_new_flow: '35', udp_early_seen: '5', fake_submit_ok: '50' } }
  } }, ...overrides
});

test('eBPF protocol panes use actual runtime flags and observations, not saved backend or aggregate sends', () => {
  const reply = observed();
  for (const name of ['tcp', 'udp']) {
    const result = diagnostics.protocol(reply, name);
    assert.equal(result.state, 'Running via eBPF');
    assert.match(result.summary, /No separate NFQUEUE process is expected/);
    assert.match(result.summary, /shared TCP\/UDP eBPF/);
    assert.match(result.summary, /not per-protocol delivery totals/);
    assert.doesNotMatch(result.summary, /NOT_RUNNING|50/);
    reply.diagnostics.ebpf.snapshot[name + '_enabled'] = false;
    assert.equal(diagnostics.protocol(reply, name).state, 'Disabled via eBPF');
  }
  assert.match(diagnostics.protocol(reply, 'tcp').summary, /TCP SYN observations: 9007199254740993/);
  assert.match(diagnostics.protocol(reply, 'udp').summary, /UDP new-flow observations: 35/);
});

test('partial or invalid eBPF metrics never fabricate disabled flags or zero counters', () => {
  const reply = observed();
  delete reply.diagnostics.ebpf.snapshot.udp_enabled;
  assert.match(diagnostics.protocol(reply, 'udp').state, /^Unknown/);
  assert.equal(diagnostics.protocol(reply, 'tcp').state, 'Running via eBPF');
  reply.diagnostics.ebpf.snapshot.udp_enabled = 'false';
  assert.match(diagnostics.protocol(reply, 'udp').state, /^Unknown/);
  reply.diagnostics.ebpf.snapshot.udp_enabled = true;
  delete reply.diagnostics.ebpf.snapshot.counters.udp_new_flow;
  assert.match(diagnostics.protocol(reply, 'udp').summary, /UDP new-flow observations: Unavailable/);
  for (const mutate of [
    r => { r.diagnostics.ebpf.available = false; },
    r => { r.diagnostics.ebpf.snapshot.backend = 'nfqueue'; },
    r => { delete r.diagnostics.ebpf.snapshot; },
    r => { delete r.diagnostics.actual_backend; },
    r => { r.faketraffic.instances.ebpf.running = false; },
    r => { r.failed = true; }
  ]) {
    const invalid = observed(); mutate(invalid);
    const result = diagnostics.protocol(invalid, 'udp');
    assert.match(result.state, /^Unknown/);
    assert.match(result.summary, /Counters unavailable/);
    assert.doesNotMatch(result.summary, /: 0\b|Disabled|Stopped/);
  }
});

test('backend conflicts stay unknown, NFQUEUE is not mislabeled from a saved eBPF selection', () => {
  for (const mutate of [
    r => { r.diagnostics.actual_backend = 'conflict'; },
    r => { r.faketraffic.instances.tcp.running = true; },
    r => { r.faketraffic.instances.udp.running = true; },
    r => { r.diagnostics.actual_backend = 'nfqueue'; }
  ]) {
    const reply = observed(); mutate(reply);
    for (const name of ['tcp', 'udp']) assert.match(diagnostics.protocol(reply, name).state, /Unknown \(backend conflict\)/);
  }
  const reply = observed();
  reply.faketraffic.instances.ebpf.running = false;
  reply.faketraffic.instances.tcp.running = true;
  reply.diagnostics.configured_backend = 'ebpf';
  reply.diagnostics.actual_backend = 'nfqueue';
  assert.equal(diagnostics.protocol(reply, 'tcp'), null);
});

test('eBPF rates stay shared and reset across backend transitions or restarts', () => {
  const current = observed().diagnostics.ebpf;
  const previous = structuredClone(current);
  previous.snapshot.sample_mono_ms = '1000';
  previous.snapshot.counters.fake_submit_ok = '49';
  assert.match(diagnostics.summary(current, previous), /per second: 0.20/);
  assert.match(diagnostics.summary(current, previous), /shared across TCP\/UDP, not per-protocol delivery totals/);
  previous.snapshot.backend = 'nfqueue';
  assert.match(diagnostics.summary(current, previous), /per second: —/);
  previous.snapshot.backend = 'ebpf'; previous.instance = 'new-instance';
  assert.match(diagnostics.summary(current, previous), /per second: —/);
});

test('compact cards retain uint64 and zero, never invent data or per-SIP aggregate totals', () => {
  const reply=observed();
  assert.equal(diagnostics.card(reply,'tcp').value,'9007199254740993');
  assert.equal(diagnostics.card(reply,'udp').value,'35');
  assert.equal(diagnostics.card(reply,'ebpf').value,'50');
  assert.equal(diagnostics.card(reply,'ebpf').state,'Shared TCP/UDP');
  reply.diagnostics.ebpf.snapshot.counters.udp_new_flow='0';
  assert.equal(diagnostics.card(reply,'udp').value,'0');
  delete reply.diagnostics.ebpf.snapshot.udp_enabled;
  assert.equal(diagnostics.card(reply,'udp').value,'—');
  assert.equal(diagnostics.card(reply,'ebpf').value,'—');
  assert.equal(diagnostics.card(reply,'udp').tone,'unknown');
  reply.diagnostics.actual_backend='conflict';
  assert.equal(diagnostics.card(reply,'tcp').value,'—');
  assert.equal(diagnostics.card({failed:true},'udp').tone,'unknown');
});

test('error notices surface cumulative errors but do not mislabel startup lease or skips', () => {
  const reply=observed(), counters=reply.diagnostics.ebpf.snapshot.counters;
  Object.assign(counters,{clone_failed:'0',lease_expired:'2',skip_gso:'999'});
  assert.equal(diagnostics.alerts(reply.diagnostics),'');
  counters.map_insert_failed='18446744073709551615';
  assert.match(diagnostics.alerts(reply.diagnostics),/map_insert_failed: 18446744073709551615/);
  assert.doesNotMatch(diagnostics.alerts(reply.diagnostics),/lease_expired|skip_gso/);
});
