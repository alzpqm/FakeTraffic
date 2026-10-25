/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "attach.h"
#include <bpf/bpf.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <linux/netlink.h>
#include <linux/rtnetlink.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/resource.h>
#include <sys/random.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <time.h>
#include <unistd.h>

struct runtime {
    struct bpf_object *obj;
    struct ff_options options;
    struct { struct bpf_link *link; unsigned index; } attached[4];unsigned count;
    /* Unpinned TCX links detach on process exit, including SIGKILL. */
    struct bpf_link *ingress[FF_INTERFACES];
    struct bpf_link *egress[FF_INTERFACES];
    unsigned index[FF_INTERFACES], generation[FF_INTERFACES], epoch, config_gen;
    unsigned l2,l3;
    int tap,tun,server,lock,route;
    char tap_name[IF_NAMESIZE],tun_name[IF_NAMESIZE],state[1024],socket[108];
    char marker[1024];
    int marker_owned,state_owned,cleanup_uncertain;
};
static volatile sig_atomic_t quitting,reloading;
static void on_signal(int s) {if(s==SIGHUP) reloading=1;else quitting=1;}
static __u64 monotime(void) {
    struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);
    return (__u64)t.tv_sec*FF_NS+t.tv_nsec;
}
static int wait_socket(int fd,short events,__u64 deadline) {
    for(;;) {
        __u64 now=monotime();
        if(now>=deadline) {errno=ETIMEDOUT;return -1;}
        int timeout=(int)((deadline-now+999999)/1000000);
        struct pollfd p={fd,events,0};int result=poll(&p,1,timeout);
        if(result>0) {
            if(p.revents&(events|POLLHUP))return 0;
            errno=EIO;return -1;
        }
        if(result<0 && errno!=EINTR)return -1;
    }
}
static int map(struct runtime *r,const char *name) {return bpf_object__find_map_fd_by_name(r->obj,name);}
static int lease(struct runtime *r,int enabled) {
    unsigned zero=0;struct ff_lease_local {__u64 until;} v={enabled?monotime()+r->options.lease*FF_NS:0};
    return bpf_map_update_elem(map(r,"leases"),&zero,&v,BPF_ANY);
}
static void drain_requests(struct runtime *r) {
    int fd=map(r,"requests");__u64 key,deadline=monotime()+2*FF_NS;
    unsigned empty=0;
    while(monotime()<deadline && empty<2) {
        if(bpf_map_get_next_key(fd,NULL,&key) && errno==ENOENT)empty++;
        else empty=0;
        struct timespec pause={.tv_nsec=10000000};nanosleep(&pause,NULL);
    }
}
static int record_link(FILE *f,unsigned index,const char *stage,struct bpf_link *link) {
    if(!link)return 0;
    struct bpf_link_info info={};__u32 size=sizeof(info);
    if(bpf_link_get_info_by_fd(bpf_link__fd(link),&info,&size))return -1;
    return fprintf(f,"L %u %s %u\n",index,stage,info.id)<0?-1:0;
}
static int save_state(struct runtime *r) {
    char staging[1050];snprintf(staging,sizeof(staging),"%s.tmp",r->state);
    FILE *f=fopen(staging,"w");if(!f)return -1;
    int e=0;
    for(unsigned i=0;i<r->count;i++)if(record_link(f,r->attached[i].index,"private",r->attached[i].link))e=-1;
    for(unsigned i=0;i<FF_INTERFACES;i++) {
        if(record_link(f,r->index[i],"ingress",r->ingress[i]))e=-1;
        if(record_link(f,r->index[i],"egress",r->egress[i]))e=-1;
    }
    if(fflush(f))e=-1;
    if(!e)e=fsync(fileno(f));
    if(fclose(f))e=-1;
    if(!e)e=rename(staging,r->state);
    if(!e)r->state_owned=1;
    return e;
}
static int attach_one(struct runtime *r,unsigned index,const char *name) {
    if(r->count>=sizeof(r->attached)/sizeof(r->attached[0]))return -1;
    struct bpf_tcx_opts opts={.sz=sizeof(opts),.flags=BPF_F_BEFORE};
    struct bpf_link *link=bpf_program__attach_tcx(bpf_object__find_program_by_name(r->obj,name),index,&opts);
    if(!link || libbpf_get_error(link))return -1;
    r->attached[r->count].link=link;r->attached[r->count].index=index;
    r->count++;return save_state(r);
}
static int forget_index(struct runtime *r,unsigned idx) {
    if(!idx)return 0;
    bpf_map_delete_elem(map(r,"interfaces"),&idx);
    for(unsigned i=0;i<r->options.device_count;i++) if(r->index[i]==idx) {
        if(r->ingress[i] && bpf_link__destroy(r->ingress[i]))r->cleanup_uncertain=1;
        r->ingress[i]=NULL;
        if(r->egress[i] && bpf_link__destroy(r->egress[i]))r->cleanup_uncertain=1;
        r->egress[i]=NULL;
    }
    for(unsigned i=0;i<r->count;) {
        if(r->attached[i].index==idx) {
            if(bpf_link__destroy(r->attached[i].link))r->cleanup_uncertain=1;
            r->attached[i]=r->attached[--r->count];
        } else i++;
    }
    if(save_state(r)) {fprintf(stderr,"ownership checkpoint update failed\n");return -1;}
    return r->cleanup_uncertain?-1:0;
}
static int refresh(struct runtime *r,int initial) {
    int changed=0;
    for(unsigned i=0;i<r->options.device_count;i++) {
        struct ff_device *d=&r->options.devices[i];unsigned idx=0,mtu=0;
        int exists=!ff_link(d->name,d->mode,&idx,&mtu);
        if(!exists || idx!=r->index[i]) {
            if(forget_index(r,r->index[i]))return -1;
            r->index[i]=0;
        }
        if(!exists) {if(initial)return -1;continue;}
        if(!r->index[i]) {
            struct bpf_tcx_opts opts={.sz=sizeof(opts),.flags=BPF_F_BEFORE};
            struct bpf_link *link=bpf_program__attach_tcx(
                bpf_object__find_program_by_name(r->obj,"ff_ingress"),idx,&opts);
            if(!link || libbpf_get_error(link)) {
                fprintf(stderr,"%s: TCX ingress prepend failed (Linux 6.6+ required)\n",d->name);
                return -1;
            }
            r->ingress[i]=link;r->index[i]=idx;
            link=bpf_program__attach_tcx(bpf_object__find_program_by_name(r->obj,"ff_egress"),idx,&opts);
            if(!link || libbpf_get_error(link)) {
                forget_index(r,idx);return -1;
            }
            r->egress[i]=link;
            r->index[i]=idx;r->generation[i]=++r->epoch;
            changed=1;
        }
        struct ff_interface iface={.generation=r->generation[i],.slot=i,.mode=d->mode,
            .mtu=mtu,.builder=d->mode==FF_L3?r->l3:r->l2};
        if(bpf_map_update_elem(map(r,"interfaces"),&idx,&iface,BPF_ANY))return -1;
    }
    /* Record newly attached target links before startup publishes/enables the
     * lease. Quiet periodic refreshes must not rewrite the checkpoint. */
    if(changed && save_state(r)) {fprintf(stderr,"ownership checkpoint update failed\n");return -1;}
    return 0;
}
static int same_layout(struct ff_options *a,struct ff_options *b) {
    return a->device_count==b->device_count && !memcmp(a->devices,b->devices,sizeof(a->devices)) &&
        a->tcp_entries==b->tcp_entries && a->udp_entries==b->udp_entries;
}
/* The BPF value has a top-level spinlock followed by two cursors. Userspace
 * only inserts fresh zeroed values, never rewrites a live cursor. */
struct rotation_value { __u32 lock,tcp,udp; };
static void remove_generation(struct runtime *r,unsigned gen) {
    for(unsigned protocol=0;protocol<2;protocol++) for(unsigned slot=0;slot<FF_TEMPLATE_MAX;slot++) {
        struct ff_template_key key={gen,protocol,slot};
        bpf_map_delete_elem(map(r,"templates"),&key);
    }
    bpf_map_delete_elem(map(r,"rotations"),&gen);
    bpf_map_delete_elem(map(r,"configs"),&gen);
}
static int publish(struct runtime *r,struct ff_options *o) {
    unsigned gen=r->config_gen+1,zero=0;
    struct rotation_value rotation={};
    if(!gen) return -1;
    o->kernel.generation=gen;
    for(unsigned protocol=0;protocol<2;protocol++) {
        unsigned count=protocol?o->kernel.udp_template_count:o->kernel.tcp_template_count;
        struct ff_payload *payloads=protocol?o->udp:o->tcp;
        for(unsigned slot=0;slot<count;slot++) {
            struct ff_template_key key={gen,protocol,slot};
            if(bpf_map_update_elem(map(r,"templates"),&key,&payloads[slot].value,BPF_NOEXIST))goto fail;
        }
    }
    /* Publication point is last: readers cannot see a partially staged set. */
    if(bpf_map_update_elem(map(r,"rotations"),&gen,&rotation,BPF_NOEXIST) ||
       bpf_map_update_elem(map(r,"configs"),&gen,&o->kernel,BPF_NOEXIST) ||
       bpf_map_update_elem(map(r,"active_config"),&zero,&gen,BPF_ANY))goto fail;
    r->config_gen=gen;r->options=*o;return 0;
fail:
    remove_generation(r,gen);return -1;
}
static void reap_configs(struct runtime *r) {
    /* Retain the current and previous generation. Called after >=2 seconds
     * without a reload, longer than the one-second request lifetime. */
    unsigned key=0,next;
    int fd=map(r,"configs");
    while(!bpf_map_get_next_key(fd,key?&key:NULL,&next)) {
        key=next;
        if(key<r->config_gen && r->config_gen-key>1) {
            remove_generation(r,key);key=0;
        }
    }
}
static int reload(struct runtime *r,const char *path,char *result,size_t size) {
    struct ff_options next;
    if(ff_config_read(path,&next,result,size))return -1;
    if(!same_layout(&r->options,&next)) {
        snprintf(result,size,"interface layout and map capacities require restart");return -1;
    }
    if(publish(r,&next)) {snprintf(result,size,"map publication failed; active config preserved");return -1;}
    snprintf(result,size,"configuration generation %u active",r->config_gen);return 0;
}
static void stats_json(struct runtime *r,FILE *out) {
    int n=libbpf_num_possible_cpus();if(n<=0){fputs("{\"error\":\"CPU query failed\"}\n",out);return;}
    __u64 *values=calloc(n,sizeof(*values));if(!values){fputs("{\"error\":\"allocation failed\"}\n",out);return;}
    unsigned long long totals[FF_STATS_MAX]={};
    for(unsigned k=0;k<FF_STATS_MAX;k++) {
        if(bpf_map_lookup_elem(map(r,"stats"),&k,values)) {
            free(values);fputs("{\"error\":\"MAP_READ_FAILED\"}\n",out);return;
        }
        for(int i=0;i<n;i++) {
            if(ULLONG_MAX-totals[k]<values[i]) {
                free(values);fputs("{\"error\":\"COUNTER_OVERFLOW\"}\n",out);return;
            }
            totals[k]+=values[i];
        }
    }
    /* Preserve the successful numeric ABI; never publish partial or false zeros. */
    fputc('{',out);
    for(unsigned k=0;k<FF_STATS_MAX;k++)
        fprintf(out,"%s\"%s\":%llu",k?",":"",ff_stat_names[k],totals[k]);
    fputs("}\n",out);free(values);
}
/* Separate from upstream numeric stats ABI: uint64 strings, never read-error=0. */
static void metrics_json(struct runtime *r,FILE *out) {
    int n=libbpf_num_possible_cpus(),saturated=0;
    if(n<=0 || n>65536) {fputs("{\"available\":false,\"reason\":\"CPU_QUERY_FAILED\"}\n",out);return;}
    __u64 *values=calloc((size_t)n,sizeof(*values)),totals[FF_STATS_MAX]={};
    if(!values) {fputs("{\"available\":false,\"reason\":\"ALLOCATION_FAILED\"}\n",out);return;}
    for(unsigned k=0;k<FF_STATS_MAX;k++) {
        if(bpf_map_lookup_elem(map(r,"stats"),&k,values)) {
            free(values);fputs("{\"available\":false,\"reason\":\"MAP_READ_FAILED\"}\n",out);return;
        }
        for(int i=0;i<n;i++) {
            if(ULLONG_MAX-totals[k]<values[i]) {totals[k]=ULLONG_MAX;saturated=1;}
            else totals[k]+=values[i];
        }
    }
    free(values);
    fprintf(out,"{\"available\":true,\"pid\":\"%ld\",\"snapshot\":{\"backend\":\"ebpf\",\"sample_mono_ms\":\"%llu\",\"tcp_enabled\":%s,\"udp_enabled\":%s,\"tcp_template_count\":%u,\"udp_template_count\":%u,\"template_limit\":%u,\"saturated\":%s,\"counter_semantics\":\"non_exclusive\",\"counters\":{",
        (long)getpid(),(unsigned long long)(monotime()/1000000),r->options.kernel.tcp_enabled?"true":"false",r->options.kernel.udp_enabled?"true":"false",r->options.kernel.tcp_template_count,r->options.kernel.udp_template_count,FF_TEMPLATE_MAX,saturated?"true":"false");
    for(unsigned k=0;k<FF_STATS_MAX;k++)fprintf(out,"%s\"%s\":\"%llu\"",k?",":"",ff_stat_names[k],(unsigned long long)totals[k]);
    fputs("}}}\n",out);
}
static int control_socket(struct runtime *r,const char *runtime) {
    if(snprintf(r->socket,sizeof(r->socket),"%s/control.sock",runtime)>=(int)sizeof(r->socket))return -1;
    r->server=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);if(r->server<0)return -1;
    struct sockaddr_un addr={.sun_family=AF_UNIX};strcpy(addr.sun_path,r->socket);
    unlink(r->socket);
    if(bind(r->server,(struct sockaddr*)&addr,sizeof(addr)) || listen(r->server,8)) return -1;
    return 0;
}
static int route_socket(void) {
    int fd=socket(AF_NETLINK,SOCK_RAW|SOCK_CLOEXEC|SOCK_NONBLOCK,NETLINK_ROUTE);if(fd<0)return -1;
    struct sockaddr_nl addr={.nl_family=AF_NETLINK,.nl_groups=RTMGRP_LINK};
    if(bind(fd,(struct sockaddr*)&addr,sizeof(addr))) {close(fd);return -1;}
    return fd;
}
static int link_events(struct runtime *r) {
    char buffer[16384];ssize_t n;
    while((n=recv(r->route,buffer,sizeof(buffer),0))>0) {
        for(struct nlmsghdr *h=(void*)buffer;NLMSG_OK(h,(unsigned)n);h=NLMSG_NEXT(h,n)) {
            if(h->nlmsg_type==RTM_DELLINK && h->nlmsg_len>=NLMSG_LENGTH(sizeof(struct ifinfomsg))) {
                struct ifinfomsg *info=NLMSG_DATA(h);
                for(unsigned i=0;i<r->options.device_count;i++) if(r->index[i]==(unsigned)info->ifi_index) {
                    if(forget_index(r,r->index[i]))return -1;
                    r->index[i]=0;
                }
            }
        }
    }
    if(n<0 && errno!=EAGAIN && errno!=EWOULDBLOCK) {
        /* A lost link event could hide ifindex reuse. Invalidate all epochs. */
        for(unsigned i=0;i<r->options.device_count;i++) {
            if(forget_index(r,r->index[i]))return -1;
            r->index[i]=0;
        }
    }
    return 0;
}
static int map_shape(struct bpf_object *object,const char *name,unsigned type,unsigned key,unsigned value,unsigned max) {
    struct bpf_map *m=bpf_object__find_map_by_name(object,name);
    return m && bpf_map__type(m)==type && bpf_map__key_size(m)==key &&
        bpf_map__value_size(m)==value && bpf_map__max_entries(m)==max;
}
static int compatible_object(struct bpf_object *object) {
    return map_shape(object,"configs",BPF_MAP_TYPE_HASH,4,sizeof(struct ff_config),FF_CONFIG_MAX) &&
        map_shape(object,"templates",BPF_MAP_TYPE_HASH,sizeof(struct ff_template_key),sizeof(struct ff_template),FF_CONFIG_MAX*2*FF_TEMPLATE_MAX) &&
        map_shape(object,"rotations",BPF_MAP_TYPE_HASH,4,sizeof(struct rotation_value),FF_CONFIG_MAX) &&
        bpf_object__find_map_by_name(object,"tcp_flows") && bpf_object__find_map_by_name(object,"udp_flows") &&
        bpf_object__find_program_by_name(object,"ff_ingress") && bpf_object__find_program_by_name(object,"ff_egress") &&
        bpf_object__find_program_by_name(object,"ff_builder") && bpf_object__find_program_by_name(object,"ff_drop");
}
int ff_run(const char *path,const char *object,const char *runtime) {
    struct runtime r={.tap=-1,.tun=-1,.server=-1,.lock=-1,.route=-1};
    char error[1024],lockpath[1024],config_path[1024];int rc=1,cleanup_failed=0;__u64 last_reload=0;
    if(snprintf(config_path,sizeof(config_path),"%s",path)>=(int)sizeof(config_path))return 1;
    if(geteuid()) {fprintf(stderr,"run requires root\n");return 1;}
    if(ff_config_read(path,&r.options,error,sizeof(error))) {fprintf(stderr,"%s\n",error);return 1;}
    /* Reject ambiguous logical/physical PPPoE duplication conservatively. */
    unsigned l3=0,pppoe=0;
    for(unsigned i=0;i<r.options.device_count;i++) {l3+=r.options.devices[i].mode==FF_L3;pppoe+=r.options.devices[i].mode==FF_PPPOE;}
    if(l3 && pppoe) {fprintf(stderr,"Do not combine l3 and physical pppoe paths in one instance\n");return 1;}
    if(mkdir(runtime,0700) && errno!=EEXIST) {perror(runtime);return 1;}
    struct stat st;
    if(lstat(runtime,&st) || !S_ISDIR(st.st_mode) || st.st_uid!=geteuid() || (st.st_mode&0077)) {
        fprintf(stderr,"runtime directory must be owned by root with mode 0700\n");return 1;
    }
    if(snprintf(lockpath,sizeof(lockpath),"%s/lock",runtime)>=(int)sizeof(lockpath) ||
       snprintf(r.state,sizeof(r.state),"%s/filters",runtime)>=(int)sizeof(r.state))return 1;
    r.lock=open(lockpath,O_CREAT|O_RDWR|O_CLOEXEC|O_NOFOLLOW,0600);
    if(r.lock<0 || flock(r.lock,LOCK_EX|LOCK_NB)) {fprintf(stderr,"another instance owns this runtime directory\n");goto out;}
    if(snprintf(r.marker,sizeof(r.marker),"%s/recovery-required",runtime)>=(int)sizeof(r.marker))goto out;
    int marker=open(r.marker,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW|O_CLOEXEC,0600);
    if(marker<0) {fprintf(stderr,"recovery checkpoint exists or cannot be created; not starting\n");goto out;}
    close(marker);r.marker_owned=1;
    if(!access(r.state,F_OK)) {fprintf(stderr,"previous ownership state remains; manual recovery required\n");goto out;}
    if(ff_check(&r.options))goto out;
    struct rlimit limit={RLIM_INFINITY,RLIM_INFINITY};
    if(setrlimit(RLIMIT_MEMLOCK,&limit)) fprintf(stderr,"memlock limit unchanged: %s\n",strerror(errno));
    r.obj=bpf_object__open_file(object,NULL);
    if(libbpf_get_error(r.obj)) {r.obj=NULL;goto out;}
    if(!compatible_object(r.obj)) {fprintf(stderr,"incompatible daemon/object template ABI; refusing before load/attach\n");goto out;}
    bpf_map__set_max_entries(bpf_object__find_map_by_name(r.obj,"tcp_flows"),r.options.tcp_entries);
    bpf_map__set_max_entries(bpf_object__find_map_by_name(r.obj,"udp_flows"),r.options.udp_entries);
    bpf_program__set_expected_attach_type(bpf_object__find_program_by_name(r.obj,"ff_ingress"),BPF_TCX_INGRESS);
    bpf_program__set_expected_attach_type(bpf_object__find_program_by_name(r.obj,"ff_egress"),BPF_TCX_EGRESS);
    bpf_program__set_expected_attach_type(bpf_object__find_program_by_name(r.obj,"ff_builder"),BPF_TCX_EGRESS);
    bpf_program__set_expected_attach_type(bpf_object__find_program_by_name(r.obj,"ff_drop"),BPF_TCX_EGRESS);
    if(bpf_object__load(r.obj))goto out;
    __u64 seed;unsigned zero=0;
    if(getrandom(&seed,sizeof(seed),0)!=(ssize_t)sizeof(seed) ||
       bpf_map_update_elem(map(&r,"sequence"),&zero,&seed,BPF_ANY))goto out;
    /* Disable modifications until every private and WAN filter is ready. */
    if(lease(&r,0))goto out;
    if(l3<r.options.device_count) {
        r.tap=ff_tap(r.tap_name,sizeof(r.tap_name));if(r.tap<0)goto out;
        r.l2=if_nametoindex(r.tap_name);if(!r.l2)goto out;
    }
    if(l3) {r.tun=ff_tun(r.tun_name,sizeof(r.tun_name));if(r.tun<0)goto out;r.l3=if_nametoindex(r.tun_name);}
    for(unsigned i=0;i<2;i++) {
        unsigned idx=i?r.l3:r.l2;const char *name=i?r.tun_name:r.tap_name;
        if(!idx)continue;
        /* Prepend drop first, then builder: builder executes before the guard. */
        if(attach_one(&r,idx,"ff_drop") || attach_one(&r,idx,"ff_builder"))goto out;
        char ipv6path[128];snprintf(ipv6path,sizeof(ipv6path),"/proc/sys/net/ipv6/conf/%s/disable_ipv6",name);
        int ipv6fd=open(ipv6path,O_WRONLY|O_CLOEXEC);
        if(ipv6fd>=0) {int e=write(ipv6fd,"1\n",2)!=2;close(ipv6fd);if(e)goto out;}
        else if(errno!=ENOENT)goto out;
        const char *up[]={"ip","link","set","dev",name,"up",NULL};if(ff_command(up))goto out;
    }
    r.route=route_socket();if(r.route<0)goto out;
    if(refresh(&r,1) || publish(&r,&r.options) || control_socket(&r,runtime) || lease(&r,1))goto out;
    struct sigaction action={.sa_handler=on_signal};sigemptyset(&action.sa_mask);
    sigaction(SIGINT,&action,NULL);sigaction(SIGTERM,&action,NULL);sigaction(SIGHUP,&action,NULL);signal(SIGPIPE,SIG_IGN);
    printf("READY generation=%u\n",r.config_gen);fflush(stdout);
    __u64 next_lease=0;
    while(!quitting) {
        __u64 now=monotime();
        if(now>=next_lease) {
            if(refresh(&r,0) || lease(&r,1)) {fprintf(stderr,"interface refresh or lease failed\n");goto out;}
            if(now-last_reload>2*FF_NS)reap_configs(&r);
            next_lease=now+2*FF_NS;
        }
        if(reloading) {reloading=0;int e=reload(&r,config_path,error,sizeof(error));last_reload=now;fprintf(stderr,"reload %s: %s\n",e?"failed":"ok",error);}
        struct pollfd fds[4]={{r.server,POLLIN,0},{r.route,POLLIN,0},{r.tap,POLLIN,0},{r.tun,POLLIN,0}};
        int n=poll(fds,4,200);if(n<0 && errno!=EINTR)goto out;
        if((fds[2].revents|fds[3].revents)&(POLLIN|POLLERR|POLLHUP|POLLNVAL)) {
            fprintf(stderr,"private builder guard invariant failed; stopping\n");goto out;
        }
        if((fds[1].revents&POLLIN) && link_events(&r))goto out;
        if(fds[0].revents&POLLIN) {
            int client=accept4(r.server,NULL,NULL,SOCK_CLOEXEC|SOCK_NONBLOCK);if(client<0)continue;
            struct ucred peer;socklen_t len=sizeof(peer);
            if(getsockopt(client,SOL_SOCKET,SO_PEERCRED,&peer,&len) || peer.uid!=geteuid()) {close(client);continue;}
            char command[1200]={};ssize_t got=0,part;int complete=0;
            __u64 request_deadline=monotime()+FF_NS;
            while(got<(ssize_t)sizeof(command)-1) {
                if(wait_socket(client,POLLIN,request_deadline))break;
                part=read(client,command+got,sizeof(command)-1-got);
                if(!part) {complete=1;break;}
                if(part<0) {if(errno==EINTR || errno==EAGAIN)continue;break;}
                got+=part;
            }
            FILE *out=fdopen(client,"w");if(!out){close(client);continue;}
            if(got<=0 || !complete) {fclose(out);continue;}
            command[strcspn(command,"\r\n")]=0;
            if(!strcmp(command,"stats"))stats_json(&r,out);
            else if(!strcmp(command,"metrics"))metrics_json(&r,out);
            else if(!strcmp(command,"status"))fprintf(out,"{\"running\":true,\"generation\":%u,\"interfaces\":%u}\n",r.config_gen,r.options.device_count);
            else if(!strcmp(command,"stop")) {quitting=1;fputs("OK stopping\n",out);}
            else if(!strcmp(command,"reload") || !strncmp(command,"reload ",7)) {
                const char *selected=command[6]==' '?command+7:config_path;
                int e;
                if(strlen(selected)>=sizeof(config_path)) {snprintf(error,sizeof(error),"configuration path too long");e=-1;}
                else {e=reload(&r,selected,error,sizeof(error));if(!e && selected!=config_path)strcpy(config_path,selected);}
                last_reload=monotime();fprintf(out,"%s %s\n",e?"ERROR":"OK",error);
            }
            else fputs("ERROR unknown command\n",out);
            fclose(out);
        }
    }
    rc=0;
out:
    cleanup_failed=r.cleanup_uncertain;
    if(r.obj && map(&r,"leases")>=0) {lease(&r,0);drain_requests(&r);}
    for(unsigned i=0;i<FF_INTERFACES;i++) {
        if(r.ingress[i] && bpf_link__destroy(r.ingress[i]))cleanup_failed=1;
        if(r.egress[i] && bpf_link__destroy(r.egress[i]))cleanup_failed=1;
    }
    for(unsigned i=r.count;i>0;i--)if(bpf_link__destroy(r.attached[i-1].link))cleanup_failed=1;
    if(r.tun>=0)close(r.tun);
    if(r.tap>=0)close(r.tap);
    if(r.server>=0) {close(r.server);unlink(r.socket);}
    if(r.route>=0)close(r.route);
    if(r.obj)bpf_object__close(r.obj);
    if(r.state_owned && !cleanup_failed && unlink(r.state) && errno!=ENOENT)cleanup_failed=1;
    if(r.marker_owned && !cleanup_failed && unlink(r.marker) && errno!=ENOENT)cleanup_failed=1;
    if(r.lock>=0)close(r.lock);
    if(cleanup_failed) {fprintf(stderr,"owned cleanup unconfirmed; recovery checkpoint retained\n");rc=1;}
    return rc;
}
int ff_client(const char *runtime,const char *command) {
    struct sockaddr_un addr={.sun_family=AF_UNIX};
    if(snprintf(addr.sun_path,sizeof(addr.sun_path),"%s/control.sock",runtime)>=(int)sizeof(addr.sun_path))return 1;
    int fd=socket(AF_UNIX,SOCK_STREAM|SOCK_CLOEXEC|SOCK_NONBLOCK,0);if(fd<0)return 1;
    __u64 deadline=monotime()+2*FF_NS;int rc=1,error=connect(fd,(struct sockaddr*)&addr,sizeof(addr));
    if(error) {
        if(errno!=EINPROGRESS && errno!=EAGAIN)goto done;
        if(wait_socket(fd,POLLOUT,deadline))goto done;
        socklen_t size=sizeof(error);
        if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&size) || error)goto done;
    }
    size_t sent=0,length=strlen(command),received=0,prefix_len=0;
    char buffer[8192],prefix[9];ssize_t n;
    while(sent<length) {
        if(wait_socket(fd,POLLOUT,deadline))goto done;
        n=send(fd,command+sent,length-sent,MSG_NOSIGNAL);
        if(n<0 && (errno==EINTR || errno==EAGAIN))continue;
        if(n<=0)goto done;
        sent+=(size_t)n;
    }
    if(shutdown(fd,SHUT_WR))goto done;
    rc=0;
    for(;;) {
        if(wait_socket(fd,POLLIN,deadline)) {rc=1;break;}
        n=read(fd,buffer,sizeof(buffer));
        if(n<0 && (errno==EINTR || errno==EAGAIN))continue;
        if(!n) {if(!received)rc=1;break;}
        if(n<0 || received+(size_t)n>16384) {rc=1;break;}
        received+=(size_t)n;
        for(ssize_t i=0;i<n && prefix_len<sizeof(prefix);i++)prefix[prefix_len++]=buffer[i];
        if((prefix_len>=5 && !memcmp(prefix,"ERROR",5)) ||
           (prefix_len>=9 && !memcmp(prefix,"{\"error\":",9)))rc=1;
        if(fwrite(buffer,1,(size_t)n,stdout)!=(size_t)n) {rc=1;break;}
    }
done:
    close(fd);return rc;
}
