/* SPDX-License-Identifier: GPL-2.0-only
 * Offline faults in the native diagnostic endpoints; no BPF or network access.
 */
#include "../components/fakeflow/ebpf/user/lifecycle.c"
#include <assert.h>
static int scenario;
const char *ff_stat_names[FF_STATS_MAX]={"tcp_syn_seen"};
int libbpf_num_possible_cpus(void) { return 2; }
int bpf_object__find_map_fd_by_name(const struct bpf_object *obj,const char *name) {
    (void)obj;assert(!strcmp(name,"stats"));return 1;
}
__attribute__((noipa)) int bpf_map_lookup_elem(int fd,const void *key,void *value) {
    assert(fd==1);
    if(scenario==1 && *(const unsigned*)key==FF_STATS_MAX-1) {errno=EIO;return -1;}
    __u64 *v=value;v[0]=scenario==2?ULLONG_MAX:7;v[1]=scenario==2?1:11;return 0;
}
static char *snapshot(int metrics) {
    struct runtime r={};char *text=NULL;size_t size=0;
    FILE *out=open_memstream(&text,&size);assert(out);
    if(metrics)metrics_json(&r,out);else stats_json(&r,out);
    assert(!fclose(out));return text;
}
int main(void) {
    for(unsigned i=1;i<FF_STATS_MAX;i++)ff_stat_names[i]="other";
    char *text=snapshot(0);assert(strstr(text,"\"tcp_syn_seen\":18"));free(text);
    scenario=1;text=snapshot(0);assert(!strcmp(text,"{\"error\":\"MAP_READ_FAILED\"}\n"));free(text);
    text=snapshot(1);assert(strstr(text,"\"available\":false"));free(text);
    scenario=2;text=snapshot(0);assert(!strcmp(text,"{\"error\":\"COUNTER_OVERFLOW\"}\n"));free(text);
    text=snapshot(1);assert(strstr(text,"\"saturated\":true"));
    assert(strstr(text,"\"tcp_syn_seen\":\"18446744073709551615\""));free(text);
    puts("PASS: stats preserves numeric success, errors atomically; metrics remains explicit and saturating");
    return 0;
}
