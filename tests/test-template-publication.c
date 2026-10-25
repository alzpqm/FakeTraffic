/* SPDX-License-Identifier: GPL-2.0-only
 * Unit fault injection only: no kernel maps, privileges or network operations.
 * Link with -ffunction-sections -Wl,--gc-sections to retain publication/GC only.
 */
#include "../components/fakeflow/ebpf/user/lifecycle.c"
#include <assert.h>
static struct { int present; struct ff_template value; } templates[32][2][FF_TEMPLATE_MAX];
static struct ff_config configs[32];
static unsigned rotations[32],active,calls,fail_at;
int bpf_object__find_map_fd_by_name(const struct bpf_object *obj,const char *name) {
    (void)obj;
    if(!strcmp(name,"templates"))return 1;
    if(!strcmp(name,"configs"))return 2;
    if(!strcmp(name,"rotations"))return 3;
    assert(!strcmp(name,"active_config"));return 4;
}
/* Keep the stub opaque like the real library call: IPA otherwise assumes its
 * test-only map IDs apply to unrelated (discarded) lifecycle functions. */
__attribute__((noipa)) int bpf_map_update_elem(int fd,const void *key,const void *value,__u64 flags) {
    (void)flags;
    if(++calls==fail_at) {errno=ENOSPC;return -1;}
    unsigned gen=*(const unsigned*)key;assert(gen<32);
    if(fd==1) {
        const struct ff_template_key *k=key;
        assert(k->protocol<2 && k->slot<FF_TEMPLATE_MAX);
        assert(!templates[gen][k->protocol][k->slot].present);
        templates[gen][k->protocol][k->slot].present=1;
        templates[gen][k->protocol][k->slot].value=*(const struct ff_template*)value;
    } else if(fd==2 || fd==3) {
        unsigned count=0;for(unsigned i=0;i<32;i++)count+=fd==2?!!configs[i].generation:!!rotations[i];
        if(count==FF_CONFIG_MAX) {errno=ENOSPC;return -1;}
        if(fd==2)configs[gen]=*(const struct ff_config*)value;
        else {const struct rotation_value *r=value;assert(!r->lock && !r->tcp && !r->udp);rotations[gen]=1;}
    } else {assert(fd==4 && !gen);active=*(const unsigned*)value;}
    return 0;
}
int bpf_map_delete_elem(int fd,const void *key) {
    unsigned gen=*(const unsigned*)key;assert(gen<32);
    if(fd==1) {const struct ff_template_key *k=key;templates[gen][k->protocol][k->slot].present=0;}
    else if(fd==2)memset(&configs[gen],0,sizeof(configs[gen]));
    else {assert(fd==3);rotations[gen]=0;}
    return 0;
}
int bpf_map_get_next_key(int fd,const void *key,void *next) {
    assert(fd==2);unsigned start=key?*(const unsigned*)key+1:1;
    for(unsigned i=start;i<32;i++)if(configs[i].generation){*(unsigned*)next=i;return 0;}
    errno=ENOENT;return -1;
}
static void absent(unsigned gen) {
    assert(!configs[gen].generation && !rotations[gen]);
    for(unsigned p=0;p<2;p++)for(unsigned s=0;s<FF_TEMPLATE_MAX;s++)assert(!templates[gen][p][s].present);
}
int main(void) {
    struct runtime r={};struct ff_options next={};
    next.kernel.tcp_template_count=next.kernel.udp_template_count=3;
    for(unsigned s=0;s<3;s++) {next.tcp[s].value.len=next.udp[s].value.len=1;next.tcp[s].value.data[0]=s+1;next.udp[s].value.data[0]=s+11;}
    assert(!publish(&r,&next) && active==1);
    for(unsigned fail=1;fail<=9;fail++) {
        calls=0;fail_at=fail;
        assert(publish(&r,&next) && active==1 && r.config_gen==1);
        assert(r.options.kernel.generation==1 && configs[1].generation==1 && rotations[1]);
        for(unsigned s=0;s<3;s++)assert(templates[1][0][s].value.data[0]==s+1 && templates[1][1][s].value.data[0]==s+11);
        absent(2);
    }
    fail_at=0;
    while(r.config_gen<FF_CONFIG_MAX)assert(!publish(&r,&next));
    assert(publish(&r,&next) && active==FF_CONFIG_MAX);absent(FF_CONFIG_MAX+1);
    reap_configs(&r);
    for(unsigned gen=1;gen<FF_CONFIG_MAX-1;gen++)absent(gen);
    assert(rotations[FF_CONFIG_MAX-1] && rotations[FF_CONFIG_MAX]);
    assert(!publish(&r,&next) && active==FF_CONFIG_MAX+1);
    puts("PASS: all 9 staging/publication failures preserve old generation; bounded reload saturation; full multi-slot GC retains current/previous");
    return 0;
}
