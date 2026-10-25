#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Compare independent source snippets; no packet, root, map or BPF operations.

Each engine is compiled separately; no GPL-2.0 code is linked to a GPL-3.0 engine.
"""
import os
import pathlib
import re
import shlex
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parents[1]

def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return result.stdout

def function(text, name):
    found = re.search(r'^static (?:int|uint8_t) ' + name + r'\([^\n]+\)\n\{.*?^\}', text, re.M | re.S)
    assert found, name
    return found.group()

loop = r'''
int main(void) {
    unsigned percentages[]={0,25,50,99}, bases[]={1,3,8,31,64};
    for(unsigned remote=1;remote<=255;remote++)
        for(unsigned p=0;p<4;p++) for(unsigned b=0;b<5;b++) {
            unsigned selected=0;
            int allowed=decision(remote,percentages[p],bases[b],&selected);
            printf("%u %u %u %d %u\n",remote,percentages[p],bases[b],allowed,selected);
        }
    return 0;
}
'''
results = []
with tempfile.TemporaryDirectory(prefix='faketraffic-hop-') as directory:
    work = pathlib.Path(directory)
    for engine in ['fakehttp', 'fakesip', 'fakeflow']:
        header = '#include <stdint.h>\n#include <stdio.h>\n'
        if engine != 'fakeflow':
            text = (ROOT / 'components' / engine / 'src/rawsend.c').read_text()
            code = header + 'static struct { int ttl,dynamic_pct; } g_ctx;\n'
            code += function(text, 'hop_estimate') + '\n' + function(text, 'calc_snd_ttl')
            code += r'''
static int decision(unsigned remote,unsigned percent,unsigned base,unsigned *selected) {
    g_ctx.ttl=base;g_ctx.dynamic_pct=percent;
    int hops=hop_estimate(remote);
    if(hops<=(int)base)return 0;
    *selected=calc_snd_ttl(hops);return 1;
}
'''
        else:
            text = (ROOT / 'components/fakeflow/ebpf/bpf/observer.bpf.c').read_text()
            start = text.index('    __u64 now=bpf_ktime_get_ns();')
            end = text.index('    if(!reserve', start)
            code = header + r'''
typedef uint64_t __u64;typedef uint32_t __u32;
struct config { unsigned ttl,estimate_hops,percent; };
#define bpf_ktime_get_ns() 0
#define stat(id) ((void)0)
static int decision(unsigned remote_ttl,unsigned percent,unsigned base,unsigned *selected) {
    struct config config={base,1,percent},*c=&config;
''' + text[start:end] + '\n(void)now;(void)z;*selected=ttl;return 1;\n}\n'
        cfile, binary = work / (engine + '.c'), work / engine
        cfile.write_text(code + loop, newline='\n')
        run(shlex.split(os.environ.get('CC', 'cc')) +
            ['-std=c99', '-Wall', '-Wextra', '-Werror', str(cfile), '-o', str(binary)])
        results.append([tuple(map(int, line.split())) for line in run([str(binary)]).splitlines()])
assert results[0] == results[1] == results[2], 'hop gate / dynamic TTL differ between engines'
for remote, percent, base, allowed, selected in results[0]:
    initial = next(value for value in [32, 64, 128, 255] if value >= remote)
    hops = initial - remote
    assert allowed == (base < hops)
    if allowed:
        assert selected == max(base, hops * percent // 100) and selected < hops
print('PASS: 5100 TTL/dynamic/gate vectors agree across three separately compiled engines')
