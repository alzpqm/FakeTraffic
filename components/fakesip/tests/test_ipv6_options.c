#define _GNU_SOURCE
#include <arpa/inet.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/ip6.h>
#include "globvar.h"
#include "ipv6pkt.h"

static unsigned int cases;

static int fixture(uint8_t *packet, unsigned int extensions, size_t payload)
{
    struct ip6_hdr *ip = (struct ip6_hdr *) packet;
    struct udphdr *udp;
    size_t offset = sizeof(*ip);
    unsigned int i;
    memset(packet, 0, 512);
    ip->ip6_vfc = 0x60;
    ip->ip6_hlim = 37;
    ip->ip6_nxt = extensions ? IPPROTO_HOPOPTS : IPPROTO_UDP;
    inet_pton(AF_INET6, "2001:db8::1", &ip->ip6_src);
    inet_pton(AF_INET6, "2001:db8::2", &ip->ip6_dst);
    for (i = 0; i < extensions; i++, offset += 8) {
        packet[offset] = i + 1 == extensions ? IPPROTO_UDP : IPPROTO_DSTOPTS;
        packet[offset + 2] = 1; /* PadN */
        packet[offset + 3] = 4;
    }
    udp = (struct udphdr *) (packet + offset);
    udp->source = htons(40000);
    udp->dest = htons(443);
    udp->len = htons(sizeof(*udp) + payload);
    memset(packet + offset + sizeof(*udp), 0xa5, payload);
    ip->ip6_plen = htons(offset - sizeof(*ip) + sizeof(*udp) + payload);
    return (int) (offset + sizeof(*udp) + payload);
}

static void check(uint8_t *packet, int length, int success, size_t offset,
                  int payload)
{
    struct sockaddr_storage src, dst;
    struct udphdr *udp = NULL;
    struct ip6_hdr *ip = (struct ip6_hdr *) packet;
    uint8_t ttl = 0;
    int parsed = -1;
    int ret = fs_pkt6_parse(packet, length, (struct sockaddr *) &src,
                            (struct sockaddr *) &dst, &ttl, &udp, &parsed);
    cases++;
    if ((ret == 0) != success || (success &&
        (udp != (struct udphdr *) (packet + offset) || parsed != payload ||
         ttl != 37 || src.ss_family != AF_INET6 || dst.ss_family != AF_INET6 ||
         memcmp(&((struct sockaddr_in6 *) &src)->sin6_addr, &ip->ip6_src, 16) ||
         memcmp(&((struct sockaddr_in6 *) &dst)->sin6_addr, &ip->ip6_dst, 16)))) {
        fprintf(stderr, "IPv6 options case %u failed\n", cases);
        exit(EXIT_FAILURE);
    }
}

int main(void)
{
    uint8_t packet[512] __attribute__((aligned));
    static const uint8_t unsupported[] = {6, 43, 44, 50, 51, 59, 253};
    unsigned int i;
    int length, cut;
    g_ctx.logfp = tmpfile(); /* Expected malformed-input diagnostics stay quiet. */
    if (!g_ctx.logfp) {
        return EXIT_FAILURE;
    }
    length = fixture(packet, 0, 3);
    check(packet, length, 1, 40, 3);
    length = fixture(packet, 1, 3);
    check(packet, length, 1, 48, 3);
    packet[6] = IPPROTO_DSTOPTS;
    check(packet, length, 1, 48, 3);
    length = fixture(packet, 2, 3);
    check(packet, length, 1, 56, 3);
    for (cut = -1; cut < length; cut++) {
        check(packet, cut, 0, 0, 0);
    }
    length = fixture(packet, 16, 0);
    check(packet, length, 1, 168, 0);
    length = fixture(packet, 17, 0);
    check(packet, length, 0, 0, 0);
    length = fixture(packet, 1, 3);
    packet[41] = 255;
    check(packet, length, 0, 0, 0);
    length = fixture(packet, 2, 3);
    packet[40] = IPPROTO_HOPOPTS; /* Hop-by-Hop must be first. */
    check(packet, length, 0, 0, 0);
    for (i = 0; i < sizeof(unsupported); i++) {
        length = fixture(packet, 1, 3);
        packet[6] = unsupported[i];
        check(packet, length, 0, 0, 0);
        packet[6] = IPPROTO_DSTOPTS;
        packet[40] = unsupported[i];
        check(packet, length, 0, 0, 0);
    }
    length = fixture(packet, 1, 3);
    packet[0] = 0x40;
    check(packet, length, 0, 0, 0);
    for (i = 0; i < 32; i++) {
        length = fixture(packet, 1, 3);
        ((struct ip6_hdr *) packet)->ip6_plen = htons(i);
        check(packet, length, i == 19, 48, 3);
        length = fixture(packet, 1, 3);
        ((struct udphdr *) (packet + 48))->len = htons(i);
        check(packet, length, i == 11, 48, 3);
    }
    length = fixture(packet, 1, 0);
    check(packet, length, 1, 48, 0);
    /* Captured trailing bytes are not UDP payload. */
    check(packet, length + 16, 1, 48, 0);
    fclose(g_ctx.logfp);
    g_ctx.logfp = NULL;
    printf("IPv6 options: %u parser cases passed\n", cases);
    return EXIT_SUCCESS;
}
