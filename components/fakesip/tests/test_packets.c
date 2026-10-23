#define _GNU_SOURCE

#include <arpa/inet.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/ip.h>
#include <netinet/ip6.h>
#include <netinet/udp.h>

#include "globvar.h"
#include "ipv4pkt.h"
#include "ipv6pkt.h"

static uint32_t add_words(uint32_t sum, const uint8_t *data, size_t length)
{
    while (length >= 2) {
        sum += ((uint32_t) data[0] << 8) | data[1];
        data += 2;
        length -= 2;
    }
    if (length) {
        sum += (uint32_t) data[0] << 8;
    }
    return sum;
}

static int valid_checksum(uint32_t sum)
{
    while (sum >> 16) {
        sum = (sum & 0xffffU) + (sum >> 16);
    }
    return sum == 0xffffU;
}

static int test_packet(int family, unsigned int value, size_t payload_len)
{
    uint8_t packet[128] __attribute__((aligned));
    uint8_t payload[3] = {(uint8_t) (value >> 8), (uint8_t) value, 0xa5};
    struct sockaddr_storage source, destination, parsed_source,
        parsed_destination;
    struct udphdr *udp, *parsed_udp;
    struct iphdr *ip4;
    struct ip6_hdr *ip6;
    uint32_t sum;
    uint8_t ttl;
    size_t header_len;
    int length, parsed_length, result;

    memset(&source, 0, sizeof(source));
    memset(&destination, 0, sizeof(destination));
    /* Different padding catches an accidental odd-byte checksum dependency. */
    memset(packet, (int) (value & 0xffU), sizeof(packet));
    source.ss_family = destination.ss_family = family;
    if (family == AF_INET) {
        inet_pton(AF_INET, "198.51.100.1",
                  &((struct sockaddr_in *) &source)->sin_addr);
        inet_pton(AF_INET, "203.0.113.2",
                  &((struct sockaddr_in *) &destination)->sin_addr);
        length = fs_pkt4_make(packet, sizeof(packet),
                              (struct sockaddr *) &source,
                              (struct sockaddr *) &destination, 3,
                              htons(40000), htons(443), payload, payload_len);
        header_len = sizeof(*ip4);
    } else {
        inet_pton(AF_INET6, "2001:db8::1",
                  &((struct sockaddr_in6 *) &source)->sin6_addr);
        inet_pton(AF_INET6, "2001:db8::2",
                  &((struct sockaddr_in6 *) &destination)->sin6_addr);
        length = fs_pkt6_make(packet, sizeof(packet),
                              (struct sockaddr *) &source,
                              (struct sockaddr *) &destination, 3,
                              htons(40000), htons(443), payload, payload_len);
        header_len = sizeof(*ip6);
    }
    if (length != (int) (header_len + sizeof(*udp) + payload_len)) {
        return 1;
    }
    udp = (struct udphdr *) (packet + header_len);
    if (ntohs(udp->len) != sizeof(*udp) + payload_len || !udp->check ||
        udp->source != htons(40000) || udp->dest != htons(443) ||
        memcmp(packet + header_len + sizeof(*udp), payload, payload_len)) {
        fprintf(stderr,
                "test_packets: family=%d value=%u payload=%zu "
                "invalid UDP header (checksum=%04x)\n",
                family, value, payload_len, ntohs(udp->check));
        return 1;
    }
    if (family == AF_INET) {
        ip4 = (struct iphdr *) packet;
        if (ntohs(ip4->tot_len) != length ||
            !valid_checksum(add_words(0, packet, header_len))) {
            return 1;
        }
        sum = add_words(IPPROTO_UDP + ntohs(udp->len), packet + 12, 8);
        result = fs_pkt4_parse(packet, length,
                               (struct sockaddr *) &parsed_source,
                               (struct sockaddr *) &parsed_destination, &ttl,
                               &parsed_udp, &parsed_length);
    } else {
        ip6 = (struct ip6_hdr *) packet;
        if (ntohs(ip6->ip6_plen) != length - (int) header_len) {
            return 1;
        }
        sum = add_words(IPPROTO_UDP + ntohs(udp->len), packet + 8, 32);
        result = fs_pkt6_parse(packet, length,
                               (struct sockaddr *) &parsed_source,
                               (struct sockaddr *) &parsed_destination, &ttl,
                               &parsed_udp, &parsed_length);
    }
    if (!valid_checksum(add_words(sum, (uint8_t *) udp, ntohs(udp->len))) ||
        result != 0 || ttl != 3 || parsed_udp != udp ||
        parsed_length != (int) payload_len ||
        memcmp(&source, &parsed_source,
               family == AF_INET ? sizeof(struct sockaddr_in)
                                 : sizeof(struct sockaddr_in6)) ||
        memcmp(&destination, &parsed_destination,
               family == AF_INET ? sizeof(struct sockaddr_in)
                                 : sizeof(struct sockaddr_in6))) {
        fprintf(stderr,
                "test_packets: family=%d value=%u checksum/roundtrip failed\n",
                family, value);
        return 1;
    }
    return 0;
}

int main(void)
{
    unsigned int value;
    int failures = 0;

    g_ctx.logfp = stderr;
    /* Cover both representations of one's-complement zero, both families,
       and odd/even payload lengths using an independent checksum oracle. */
    for (value = 0; value <= UINT16_MAX; value++) {
        failures += test_packet(AF_INET, value, 2);
        failures += test_packet(AF_INET6, value, 2);
    }
    failures += test_packet(AF_INET, 123, 3);
    failures += test_packet(AF_INET6, 123, 3);
    failures += test_packet(AF_INET, 0, 0);
    failures += test_packet(AF_INET6, 0, 0);
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}
