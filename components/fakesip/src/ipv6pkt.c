/*
 * ipv6pkt.c - FakeSIP: https://github.com/MikeWang000000/FakeSIP
 *
 * Copyright (C) 2025  MikeWang000000
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#define _GNU_SOURCE
#include "ipv6pkt.h"

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/ip6.h>
#include <netinet/udp.h>
#include <sys/socket.h>
#include <libnetfilter_queue/libnetfilter_queue_ipv6.h>
#include <libnetfilter_queue/libnetfilter_queue_udp.h>

#include "globvar.h"
#include "logging.h"

int fs_pkt6_parse(void *pkt_data, int pkt_len, struct sockaddr *saddr,
                  struct sockaddr *daddr, uint8_t *ttl,
                  struct udphdr **udph_ptr, int *udp_payload_len)
{
    struct ip6_hdr *ip6h;
    struct udphdr *udph;
    size_t offset, remaining, ext_len, udp_len;
    unsigned int next_header, extensions = 0;
    uint8_t *bytes = pkt_data;
    struct sockaddr_in6 *saddr_in6, *daddr_in6;

    saddr_in6 = (struct sockaddr_in6 *) saddr;
    daddr_in6 = (struct sockaddr_in6 *) daddr;

    if (pkt_len < (int) sizeof(*ip6h)) {
        E("ERROR: invalid packet length: %d", pkt_len);
        return -1;
    }

    ip6h = (struct ip6_hdr *) pkt_data;

    remaining = ntohs(ip6h->ip6_plen);
    offset = sizeof(*ip6h);
    /* Jumbograms are not supported by the NFQUEUE copy/builder limits. */
    if ((bytes[0] >> 4) != 6 || !remaining ||
        remaining > (size_t) pkt_len - offset) {
        E("ERROR: invalid IPv6 payload length or version");
        return -1;
    }

    next_header = ip6h->ip6_nxt;
    while (next_header != IPPROTO_UDP) {
        /* Only options headers have the semantics needed here. In particular,
         * do not interpret fragments, routing, AH or ESP as ordinary UDP.
         * The caller passes unsupported packets through unchanged.
         */
        if ((next_header != IPPROTO_HOPOPTS &&
             next_header != IPPROTO_DSTOPTS) ||
            (next_header == IPPROTO_HOPOPTS && offset != sizeof(*ip6h)) ||
            ++extensions > 16 || remaining < 2) {
            E("ERROR: unsupported or truncated IPv6 extension header");
            return -1;
        }
        ext_len = ((size_t) bytes[offset + 1] + 1) * 8;
        if (ext_len > remaining) {
            E("ERROR: invalid IPv6 extension length");
            return -1;
        }
        next_header = bytes[offset];
        offset += ext_len;
        remaining -= ext_len;
    }

    if (remaining < sizeof(*udph)) {
        E("ERROR: truncated IPv6 UDP header");
        return -1;
    }

    udph = (struct udphdr *) (bytes + offset);
    udp_len = ntohs(udph->len);
    if (udp_len < sizeof(*udph) || udp_len != remaining) {
        E("ERROR: invalid IPv6 UDP length");
        return -1;
    }

    memset(saddr_in6, 0, sizeof(*saddr_in6));
    saddr_in6->sin6_family = AF_INET6;
    memcpy(&saddr_in6->sin6_addr, &ip6h->ip6_src, sizeof(struct in6_addr));

    memset(daddr_in6, 0, sizeof(*daddr_in6));
    daddr_in6->sin6_family = AF_INET6;
    memcpy(&daddr_in6->sin6_addr, &ip6h->ip6_dst, sizeof(struct in6_addr));

    *ttl = ip6h->ip6_hlim;
    *udph_ptr = udph;
    *udp_payload_len = (int) (udp_len - sizeof(*udph));

    return 0;
}


int fs_pkt6_make(uint8_t *buffer, size_t buffer_size, struct sockaddr *saddr,
                 struct sockaddr *daddr, uint8_t ttl, uint16_t sport_be,
                 uint16_t dport_be, uint8_t *udp_payload,
                 size_t udp_payload_size)
{
    size_t pkt_len;
    struct ip6_hdr *ip6h;
    struct udphdr *udph;
    uint8_t *udppl;
    struct sockaddr_in6 *saddr_in6, *daddr_in6;

    if (saddr->sa_family != AF_INET6 || daddr->sa_family != AF_INET6) {
        E("ERROR: Invalid address family");
        return -1;
    }

    saddr_in6 = (struct sockaddr_in6 *) saddr;
    daddr_in6 = (struct sockaddr_in6 *) daddr;

    pkt_len = sizeof(*ip6h) + sizeof(*udph) + udp_payload_size;
    if (buffer_size < pkt_len + 1) {
        E("ERROR: %s", strerror(ENOBUFS));
        return -1;
    }

    ip6h = (struct ip6_hdr *) buffer;
    udph = (struct udphdr *) (buffer + sizeof(*ip6h));
    udppl = buffer + sizeof(*ip6h) + sizeof(*udph);

    memset(ip6h, 0, sizeof(*ip6h));
    ip6h->ip6_flow = htonl(FS_FAKE_IPV6_FLOW_WORD);
    ip6h->ip6_plen = htons(sizeof(*udph) + udp_payload_size);
    ip6h->ip6_nxt = IPPROTO_UDP;
    ip6h->ip6_hops = ttl;
    memcpy(&ip6h->ip6_src, &saddr_in6->sin6_addr, sizeof(struct in6_addr));
    memcpy(&ip6h->ip6_dst, &daddr_in6->sin6_addr, sizeof(struct in6_addr));

    memset(udph, 0, sizeof(*udph));
    udph->source = sport_be;
    udph->dest = dport_be;
    udph->len = htons(sizeof(*udph) + udp_payload_size);
    udph->check = 0;

    if (udp_payload_size) {
        memcpy(udppl, udp_payload, udp_payload_size);
    }

    nfq_udp_compute_checksum_ipv6(udph, ip6h);
    /* A computed zero must be sent as all ones; zero is invalid for IPv6 UDP.
     */
    if (!udph->check) {
        udph->check = htons(UINT16_MAX);
    }

    return pkt_len;
}
