// SPDX-License-Identifier: GPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
test('reload validates first, preserves old owner on rejection, and waits before start', { skip: process.platform !== 'linux' }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'faketraffic-manager-'));
  try {
    const source = fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/runtime-manager.sh', import.meta.url), 'utf8')
      .replaceAll('/usr/libexec/faketraffic/preflight', 'test_preflight');
    const script = path.join(temporary, 'test.sh');
    fs.writeFileSync(script, source + `
config_load() { return 0; }
config_get() { eval "$1=ebpf"; }
config_get_bool() { eval "$1=1"; }
test_preflight() { echo preflight; return "$PREFLIGHT"; }
stop() { echo stop; return "$STOP"; }
wait_own_stopped() { echo wait; return "$WAIT"; }
start() { echo start; }
reload_backend
`);
    const run = values => spawnSync('sh', [script], { encoding: 'utf8', env: { ...process.env, PREFLIGHT: '0', STOP: '0', WAIT: '0', ...values } });
    let result = run({ PREFLIGHT: '1' }); assert.notEqual(result.status, 0); assert.equal(result.stdout, 'preflight\n');
    result = run({ STOP: '1' }); assert.notEqual(result.status, 0); assert.equal(result.stdout, 'preflight\nstop\n');
    result = run({ WAIT: '1' }); assert.notEqual(result.status, 0); assert.equal(result.stdout, 'preflight\nstop\nwait\n');
    result = run({}); assert.equal(result.status, 0); assert.equal(result.stdout, 'preflight\nstop\nwait\nstart\n');
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});

test('restart delegates through the same validated reload path with arguments preserved', { skip: process.platform !== 'linux' }, () => {
  const source=fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/runtime-manager.sh',import.meta.url),'utf8');
  const result=spawnSync('sh',['-s'],{encoding:'utf8',input:source+'\nreload() { printf "reload:%s\\n" "$1"; return 7; }\nrestart sentinel\n'});
  assert.equal(result.stdout,'reload:sentinel\n'); assert.equal(result.status,7);
});

test('NFQUEUE candidate rejection never stops an existing owner', { skip: process.platform !== 'linux' }, () => {
  const source=fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/runtime-manager.sh',import.meta.url),'utf8');
  const script=source+`
config_load() { :; }
config_get_bool() {
  case "$2.$3" in globals.enabled) eval "$1=$TCP";; main.enabled) eval "$1=$UDP";; *) config_get "$@";; esac
}
config_get() {
  local value="\${4:-}"
  case "$2.$3" in globals.backend) value=nfqueue;; advanced.queue_number) value=$TQ;; main.queue_num) value=$UQ;; esac
  eval "$1=\\$value"
}
logger() { :; }
stop() { echo stop; }
wait_own_stopped() { echo wait; }
start() { echo start; }
reload_backend
`;
  const run=values=>spawnSync('sh',['-s'],{encoding:'utf8',input:script,
    env:{...process.env,TCP:'1',UDP:'1',TQ:'512',UQ:'513',...values}});
  for(const values of [{UQ:'512'},{TQ:'-1',UQ:'512'},{UQ:'0512'},
      {TQ:'65536'},{UQ:'65536'},{UQ:'0'},{UQ:'-1'},{UQ:'bad'},{UQ:''},{UQ:'9999999999999999999999999'}]) {
    const result=run(values);
    assert.notEqual(result.status,0,JSON.stringify(values));
    assert.equal(result.stdout,'','rejected candidate must preserve old owner');
  }
  for(const values of [{},{TQ:'-1'},{TQ:'0',UQ:'65535'},{TQ:'65535',UQ:'1'},
      {TCP:'0',TQ:'bad'},{UDP:'0',UQ:'512'},{TCP:'0',UDP:'0',TQ:'bad',UQ:'bad'}]) {
    const result=run(values);
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout,'stop\nwait\nstart\n');
  }
});

test('installed rc.common dispatch cannot stop a valid owner for a rejected restart', {
  skip: process.platform !== 'linux' || !process.env.FT_RC_COMMON
}, () => {
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'faketraffic-rc-common-'));
  try {
    const write=(name,text)=>{const file=path.join(temporary,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,text);return file;};
    const manager=fs.readFileSync(new URL('../openwrt/faketraffic/files/usr/libexec/faketraffic/runtime-manager.sh',import.meta.url),'utf8')
      .replaceAll('/usr/libexec/faketraffic/preflight','test_preflight');
    const managerFile=write('manager.sh',manager);
    write('lib/functions.sh',`list_contains() { return 0; }
config_load() { :; }
config_get() { eval "$1=ebpf"; }
config_get_bool() { eval "$1=1"; }
test_preflight() { echo preflight; return "$PREFLIGHT"; }
`);
    write('lib/functions/service.sh','');
    write('lib/functions/procd.sh',`procd_lock() { echo lock; }
procd_open_service() { :; }
procd_close_service() { :; }
procd_kill() { echo stop; }
`);
    const init=write('init',`USE_PROCD=1
. "${managerFile}"
reload_service() { reload_backend; }
wait_own_stopped() { echo wait; }
start_service() { echo start; }
`);
    const run=p=>spawnSync('sh',[process.env.FT_RC_COMMON,init,'restart'],{encoding:'utf8',env:{...process.env,IPKG_INSTROOT:temporary,PREFLIGHT:p}});
    let result=run('1');assert.equal(result.status,1);assert.equal(result.stdout,'lock\npreflight\n');
    result=run('0');assert.equal(result.status,0);assert.equal(result.stdout,'lock\npreflight\nlock\nstop\nwait\nstart\n');
    // Negative control: actual vendor default must demonstrate stop-before-start.
    fs.writeFileSync(managerFile,manager.replace(/restart\(\) \{\n    reload "\$@"\n\}/,''));
    result=run('1');assert.match(result.stdout,/^lock\nstop\nstart\n$/);
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});
