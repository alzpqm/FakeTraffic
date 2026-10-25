/* SPDX-License-Identifier: GPL-2.0-only */
#define _GNU_SOURCE
#include "../ebpf/user/fakeflow.h"
#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int parse_text(const char *text,struct ff_options *o) {
    char file[]="/tmp/fakeflow-config-XXXXXX",err[512];
    int fd=mkstemp(file);assert(fd>=0);
    assert(write(fd,text,strlen(text))==(ssize_t)strlen(text));close(fd);
    int result=ff_config_read(file,o,err,sizeof(err));unlink(file);return result;
}
static unsigned u16(const unsigned char *p){return (p[0]<<8)|p[1];}
int main(void) {
    struct ff_options o;char error[512];
    const char *base="version = 1\n[[interfaces]]\nname = \"wan\"\n";
    assert(!parse_text(base,&o));
    assert(o.kernel.strip_tfo && o.kernel.repeat==2 && o.kernel.ttl==3);
    assert(o.kernel.tcp_template_count==1 && o.kernel.udp_template_count==1);
    assert(memmem(o.tcp[0].value.data,o.tcp[0].value.len,"Host: www.example.com",21));
    assert(memmem(o.udp[0].value.data,o.udp[0].value.len,"INVITE sip:",11));
    assert(!parse_text("version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\npayload=\"tls\"\nhostname=\"unit.example\"\n",&o));
    assert(o.tcp[0].value.data[0]==22 && o.tcp[0].value.data[5]==1);
    assert(u16(o.tcp[0].value.data+3)==o.tcp[0].value.len-5);
    assert(u16(o.tcp[0].value.data+7)==o.tcp[0].value.len-9);
    assert(memmem(o.tcp[0].value.data,o.tcp[0].value.len,"unit.example",12));
    const char *invalid[]={
        "version=2\n[[interfaces]]\nname=\"wan\"\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\nname=\"wan2\"\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\ntfo=\"strip-empty-syn\"\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[injection]\nttl=0\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[injection]\nrepeat=9\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\nhostname=\"bad host\"\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\nenabled=1\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[[interfaces]]\nname=\"wan\"\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\nunknown=true\n",
        "version=1\n[[interfaces]]\nname=\"wan\"\n[tcp]\npayload=\"custom\"\npayload_file=\"/does/not/exist\"\n"
    };
    for(unsigned i=0;i<sizeof(invalid)/sizeof(invalid[0]);i++)assert(parse_text(invalid[i],&o));
    assert(!parse_text(base,&o));
    char file[]="/tmp/fakeflow-payload-XXXXXX";int fd=mkstemp(file);assert(fd>=0);
    unsigned char data[1201];for(unsigned i=0;i<sizeof(data);i++)data[i]=i;
    assert(write(fd,data,1200)==1200);close(fd);
    strcpy(o.tcp[0].kind,"custom");strcpy(o.tcp[0].file,file);o.tcp[0].text[0]=0;
    assert(!ff_templates(&o,error,sizeof(error)) && o.tcp[0].value.len==1200);
    assert(!memcmp(data,o.tcp[0].value.data,1200));
    FILE *f=fopen(file,"ab");assert(f);fputc(1,f);fclose(f);
    assert(ff_templates(&o,error,sizeof(error)));unlink(file);
    /* New schema: independent counts, mixed kinds, no default/legacy fallback. */
    const char *v2="version=2\n[[interfaces]]\nname=\"wan\"\n[udp]\nenabled=false\n";
    char text[16384];
    snprintf(text,sizeof(text),"%s[[tcp.templates]]\npayload=\"http\"\nhostname=\"a.example\"\n"
        "[[tcp.templates]]\npayload=\"tls\"\nhostname=\"b.example\"\n",v2);
    assert(!parse_text(text,&o) && o.kernel.tcp_template_count==2 && !o.kernel.udp_template_count);
    assert(!memcmp(o.tcp[0].value.data,"GET ",4) && o.tcp[1].value.data[0]==22);
    for(unsigned n=1;n<=17;n++) {
        strcpy(text,v2);
        for(unsigned j=0;j<n;j++)strcat(text,"[[tcp.templates]]\npayload=\"http\"\nhostname=\"a.example\"\n");
        int e=parse_text(text,&o);
        if(n<=FF_TEMPLATE_MAX)assert(!e && o.kernel.tcp_template_count==n);
        else assert(e);
    }
    assert(parse_text(v2,&o)); /* enabled TCP cannot have an empty list */
    assert(!parse_text("version=2\n[[interfaces]]\nname=\"wan\"\n[tcp]\nenabled=false\n[udp]\nenabled=false\n",&o));
    const char *extra[]={
        "[[tcp.templates]]\npayload=\"http\"\nhostname=\"a.example\"\nhostname=\"b.example\"\n",
        "[[tcp.templates]]\npayload=\"http\"\n",
        "[[tcp.templates]]\npayload=\"http\"\nhostname=\"a.example\"\npayload_file=\"/unused\"\n",
        "[[tcp.templates]]\npayload=\"custom\"\nhostname=\"a.example\"\npayload_file=\"/unused\"\n",
        "[[tcp.templates]]\npayload=\"sip\"\nhostname=\"a.example\"\n",
        "[tcp]\npayload=\"http\"\nhostname=\"a.example\"\n",
        "[[udp.templates]]\npayload=\"sip\"\nsip_uri=\"sip:\"\n"
    };
    for(unsigned j=0;j<sizeof(extra)/sizeof(extra[0]);j++) {
        snprintf(text,sizeof(text),"%s%s",v2,extra[j]);assert(parse_text(text,&o));
    }
    snprintf(text,sizeof(text),"%s[[tcp.templates]]\npayload=\"http\"\nhostname=\"a.example\"\n",base);
    assert(parse_text(text,&o)); /* v1 cannot silently consume arrays */
    puts("PASS: v1 compatibility, mixed v2 templates, counts 1..16/17, strict conflicts, TLS/SNI, exact binary bounds");return 0;
}
