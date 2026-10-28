// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const manager = fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/runtime-manager.sh', import.meta.url), 'utf8');
const script = manager + `
config_load() { :; }
config_get() {
  local candidate_key="$2.$3" candidate_value="\${4:-}"
  case "$candidate_key" in
    globals.backend) candidate_value=nfqueue;;
    globals.enabled|main.enabled) candidate_value=1;;
  esac
  if [ "$candidate_key" = "$CASE_KEY" ]; then candidate_value=$CASE_VALUE; fi
  if [ "$candidate_key" = "$PAIR_KEY" ]; then candidate_value=$PAIR_VALUE; fi
  eval "$1=\\$candidate_value"
}
config_get_bool() { config_get "$@"; }
logger() { :; }
stop() { echo stop; }
wait_own_stopped() { echo wait; }
start() { echo start; }
reload_backend
`;
const run = (key, value, pair = ['', '']) => spawnSync('sh', ['-s'], {
  input: script, encoding: 'utf8', timeout: 5000,
  env: { ...process.env, CASE_KEY: key, CASE_VALUE: value, PAIR_KEY: pair[0], PAIR_VALUE: pair[1] }
});

test('invalid numeric NFQUEUE candidates preserve the running owner', { skip: process.platform !== 'linux' }, () => {
  for (const [key, value] of [
    ['main.queue_num', '0'], ['main.queue_num', '000'],
    ['advanced.ttl', '256'], ['main.ttl', '0'], ['main.ttl', '256'],
    ['advanced.repeat', '11'], ['main.repeat', '11'],
    ['advanced.pct', '100'], ['main.dynamic_pct', '100'], ['main.dynamic_pct', '00'],
    ['main.ttl', '0x100'], ['main.repeat', '0x100000001'],
    ['main.ttl', '18446744073709551619'], ['main.ttl', '1+2'], ['main.ttl', '-3']
  ]) {
    const result = run(key, value);
    assert.notEqual(result.status, 0, `${key}=${value} must be rejected`);
    assert.equal(result.stdout, '', `${key}=${value} must not stop/start an owner`);
  }
});

test('contradictory hop options and unusable UDP flags are rejected before stop', { skip: process.platform !== 'linux' }, () => {
  for (const [key, value, pair] of [
    ['advanced.pct', '50', ['advanced.disable_estimation', '1']],
    ['main.dynamic_pct', '50', ['main.no_hop_estimate', '1']],
    ['main.inbound', '0', ['main.outbound', '0']],
    ['main.ipv4', '0', ['main.ipv6', '0']]
  ]) {
    const result = run(key, value, pair);
    assert.notEqual(result.status, 0, key);
    assert.equal(result.stdout, '', key + ' must preserve the old owner');
  }
});

test('supported defaults, boundaries and native UDP hexadecimal values still reload', { skip: process.platform !== 'linux' }, () => {
  for (const [key, value, pair] of [
    ['', ''], ['advanced.queue_number', '0'], ['main.queue_num', '1'],
    ['advanced.ttl', '-1'], ['advanced.repeat', '0'], ['advanced.pct', '0'],
    ['main.ttl', '255'], ['main.ttl', '003'], ['main.ttl', '0X03'],
    ['main.repeat', '0xa'], ['main.dynamic_pct', '0x63'], ['main.ttl', ''],
    ['main.dynamic_pct', '0', ['main.no_hop_estimate', '1']],
    ['main.outbound', '0', ['main.inbound', '1']],
    ['main.ipv4', '0'], ['main.ipv6', '0'],
    ['main.ttl', 'bad', ['main.enabled', '0']],
    ['advanced.ttl', 'bad', ['globals.enabled', '0']]
  ]) {
    const result = run(key, value, pair);
    assert.equal(result.status, 0, `${key}=${value}: ${result.stderr}`);
    assert.equal(result.stdout, 'stop\nwait\nstart\n');
  }
});
