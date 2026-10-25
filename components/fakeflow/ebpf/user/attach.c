/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "attach.h"
#include <bpf/bpf.h>
#include <linux/if_tun.h>
#include <linux/if_arp.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <stdlib.h>
int ff_command(const char *const args[]) {
    pid_t p=fork();if(p<0)return -1;
    if(!p) {execvp(args[0],(char *const*)args);_exit(127);}
    int s;while(waitpid(p,&s,0)<0) if(errno!=EINTR)return -1;
    return WIFEXITED(s)&&!WEXITSTATUS(s)?0:-1;
}
int ff_link(const char *name,unsigned mode,unsigned *index,unsigned *mtu) {
    struct ifreq r={};snprintf(r.ifr_name,sizeof(r.ifr_name),"%s",name);
    *index=if_nametoindex(name);if(!*index) return -1;
    int fd=socket(AF_INET,SOCK_DGRAM|SOCK_CLOEXEC,0);if(fd<0)return -1;
    int e=ioctl(fd,SIOCGIFHWADDR,&r);
    unsigned type=r.ifr_hwaddr.sa_family;
    if(!e && ((mode!=FF_L3 && type!=ARPHRD_ETHER) ||
        (mode==FF_L3 && type!=ARPHRD_PPP && type!=ARPHRD_NONE))) e=-1;
    if(!e) e=ioctl(fd,SIOCGIFMTU,&r);
    if(!e) {
        if(mode==FF_PPPOE && r.ifr_mtu<=8)e=-1;
        else *mtu=r.ifr_mtu-(mode==FF_PPPOE?8:0);
    }
    close(fd);return e;
}
static int private_device(char *name,size_t cap,int tap) {
    if(cap<IF_NAMESIZE) {errno=EINVAL;return -1;}
    int fd=open("/dev/net/tun",O_RDWR|O_CLOEXEC|O_NONBLOCK);if(fd<0)return -1;
    /* Kernel-assigned names and exclusive creation. Never attach a caller's
     * pre-existing device and never make it persistent. The owning FD closes
     * on exit/SIGKILL; no name-based delete or ownership-query race exists. */
    struct ifreq r={};r.ifr_flags=(tap?IFF_TAP:IFF_TUN)|IFF_NO_PI|IFF_TUN_EXCL;
    snprintf(r.ifr_name,sizeof(r.ifr_name),"%s",tap?"ftb%d":"ftl%d");
    if(ioctl(fd,TUNSETIFF,&r)) {close(fd);return -1;}
    snprintf(name,cap,"%s",r.ifr_name);return fd;
}
int ff_tap(char *name,size_t cap) {return private_device(name,cap,1);}
int ff_tun(char *name,size_t cap) {return private_device(name,cap,0);}
int ff_check(const struct ff_options *o) {
    int failed=0;
    printf("Read-only check; no BPF program loaded or attached.\n");
    for(unsigned i=0;i<o->device_count;i++) {
        unsigned idx,mtu;
        if(ff_link(o->devices[i].name,o->devices[i].mode,&idx,&mtu)) {
            fprintf(stderr,"%s: missing interface or incompatible link mode\n",o->devices[i].name);failed=1;continue;
        }
        printf("%s: ifindex=%u mtu=%u mode=%u\n",o->devices[i].name,idx,mtu,o->devices[i].mode);
        /* This independent backend owns TCX links, not classic priority/handle
         * filters. A classic priority is not a conflict or an ownership proof. */
    }
    printf("Flow map storage estimate (before kernel overhead): %llu bytes\n",
        (unsigned long long)(o->tcp_entries+o->udp_entries)*(sizeof(struct ff_key)+72));
    printf("BTF: %s; kernel helper/verifier and hardware-offload coverage require run/tests.\n",
        access("/sys/kernel/btf/vmlinux",R_OK)?"not available":"available");
    return failed;
}
