/* SPDX-License-Identifier: GPL-2.0-only */
#include "fakeflow.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <sys/random.h>
static int custom(const char *path, struct ff_template *t) {
    FILE *f=fopen(path,"rb"); if(!f) return -1;
    t->len=fread(t->data,1,FF_PAYLOAD_MAX,f);
    int extra=fgetc(f), bad=ferror(f);
    fclose(f); return (!t->len || extra!=EOF || bad) ? -1 : 0;
}
static int safe_text(const char *s) {
    if(!*s) return 0;
    for(;*s;s++) if((unsigned char)*s<=32 || (unsigned char)*s>=127) return 0;
    return 1;
}
static void put16(unsigned char *p, unsigned n) {p[0]=n>>8;p[1]=n;}
static int tls(struct ff_template *t,const char *hostname) {
    size_t n=strlen(hostname); unsigned char *p=t->data;
    /* TLS 1.2 ClientHello with SNI and a single supported cipher suite. */
    memset(t,0,sizeof(*t));
    p[0]=22;p[1]=3;p[2]=1;p[5]=1;
    p[9]=3;p[10]=3;
    if(getrandom(p+11,32,0)!=32) return -1;
    unsigned pos=43;
    p[pos++]=0; put16(p+pos,2);pos+=2;put16(p+pos,0xc02f);pos+=2;
    p[pos++]=1;p[pos++]=0;
    put16(p+pos,n+9);pos+=2;put16(p+pos,0);pos+=2;
    put16(p+pos,n+5);pos+=2;put16(p+pos,n+3);pos+=2;p[pos++]=0;
    put16(p+pos,n);pos+=2;memcpy(p+pos,hostname,n);pos+=n;
    put16(p+3,pos-5); p[6]=(pos-9)>>16;p[7]=(pos-9)>>8;p[8]=pos-9;
    t->len=pos;return 0;
}
static int make_template(struct ff_payload *p,int udp,char *error,size_t cap) {
    int n=0;
    struct ff_template *t=&p->value;
    memset(t,0,sizeof(*t));
    if(!strcmp(p->kind,"custom")) {
        if(*p->text) goto bad;
        if(custom(p->file,t)) goto bad_file;
    } else if(!udp) {
        if(*p->file || !safe_text(p->text)) goto bad;
        if(!strcmp(p->kind,"http")) {
            n=snprintf((char*)t->data,FF_PAYLOAD_MAX,
                "GET / HTTP/1.1\r\nHost: %s\r\nUser-Agent: Mozilla/5.0\r\nAccept: */*\r\nConnection: close\r\n\r\n",p->text);
            if(n<0 || n>=FF_PAYLOAD_MAX) goto bad;
            t->len=n;
        } else if(!strcmp(p->kind,"tls")) {
            if(tls(t,p->text)) goto bad;
        } else goto bad;
    } else {
        if(strcmp(p->kind,"sip") || *p->file || !safe_text(p->text) || strncmp(p->text,"sip:",4) || !p->text[4]) goto bad;
        const char *body="v=0\r\no=- 1 1 IN IP4 192.0.2.1\r\ns=-\r\nc=IN IP4 192.0.2.1\r\nt=0 0\r\nm=audio 49170 RTP/AVP 0\r\n";
        n=snprintf((char*)t->data,FF_PAYLOAD_MAX,
            "INVITE %s SIP/2.0\r\nVia: SIP/2.0/UDP 192.0.2.1:5060;branch=z9hG4bKfakeflow\r\n"
            "Max-Forwards: 70\r\nFrom: <sip:caller@example.com>;tag=1\r\nTo: <%s>\r\n"
            "Call-ID: fakeflow@example.com\r\nCSeq: 1 INVITE\r\nContact: <sip:caller@192.0.2.1>\r\n"
            "Content-Type: application/sdp\r\nContent-Length: %zu\r\n\r\n%s",p->text,p->text,strlen(body),body);
        if(n<0 || n>=FF_PAYLOAD_MAX) goto bad;
        t->len=n;
    }
    return 0;
bad_file:
    snprintf(error,cap,"custom payload must be a readable file containing 1..1200 bytes");return -1;
bad:
    snprintf(error,cap,"invalid payload type, hostname, SIP URI or conflicting payload_file");return -1;
}
int ff_templates(struct ff_options *o,char *error,size_t cap) {
    if(o->kernel.tcp_template_count>FF_TEMPLATE_MAX || o->kernel.udp_template_count>FF_TEMPLATE_MAX) return -1;
    for(unsigned i=0;i<o->kernel.tcp_template_count;i++) if(make_template(&o->tcp[i],0,error,cap))return -1;
    for(unsigned i=0;i<o->kernel.udp_template_count;i++) if(make_template(&o->udp[i],1,error,cap))return -1;
    return 0;
}
