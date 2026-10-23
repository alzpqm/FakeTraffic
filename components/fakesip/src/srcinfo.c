/*
 * srcinfo.c - FakeSIP: https://github.com/MikeWang000000/FakeSIP
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
#include "srcinfo.h"

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <netinet/in.h>
#include <sys/socket.h>

#include "logging.h"

#define SRCINFO_CAPACITY 500U

struct srcinfo {
    int initialized;
    unsigned int ifindex;
    uint8_t ttl;
    uint8_t hwaddr[8];
    struct sockaddr_storage addr;
};

static struct srcinfo *srci = NULL;
static size_t srci_end = 0;
static size_t srci_count = 0;

static int sameip(const struct sockaddr *addr1, const struct sockaddr *addr2)
{
    const struct sockaddr_in *addr_in_1, *addr_in_2;
    const struct sockaddr_in6 *addr_in6_1, *addr_in6_2;

    if (!addr1 || !addr2) {
        return 0;
    }

    if (addr1->sa_family != addr2->sa_family) {
        return 0;
    }

    if (addr1->sa_family == AF_INET) {
        addr_in_1 = (const struct sockaddr_in *) addr1;
        addr_in_2 = (const struct sockaddr_in *) addr2;

        return addr_in_1->sin_addr.s_addr == addr_in_2->sin_addr.s_addr;
    } else if (addr1->sa_family == AF_INET6) {
        addr_in6_1 = (const struct sockaddr_in6 *) addr1;
        addr_in6_2 = (const struct sockaddr_in6 *) addr2;

        return memcmp(&addr_in6_1->sin6_addr, &addr_in6_2->sin6_addr,
                      sizeof(addr_in6_1->sin6_addr)) == 0;
    }
    return 0;
}


int fs_srcinfo_setup(void)
{
    if (srci) {
        E("ERROR: fs_srcinfo_setup(): %s", "already initialized");
        return -1;
    }

    srci = calloc(SRCINFO_CAPACITY, sizeof(*srci));
    if (!srci) {
        E("ERROR: calloc(): %s", strerror(errno));
        return -1;
    }
    srci_end = 0;
    srci_count = 0;

    return 0;
}


void fs_srcinfo_cleanup(void)
{
    free(srci);
    srci = NULL;
    srci_end = 0;
    srci_count = 0;
}


int fs_srcinfo_put(const struct sockaddr *addr, unsigned int ifindex,
                   uint8_t ttl, const uint8_t hwaddr[8])
{
    struct srcinfo *info;

    if (!srci || !addr || !ifindex || !hwaddr ||
        srci_end >= SRCINFO_CAPACITY) {
        E("ERROR: fs_srcinfo_put(): %s", "invalid cache state or argument");
        return -1;
    }

    info = &srci[srci_end];
    memset(info, 0, sizeof(*info));

    if (addr->sa_family == AF_INET) {
        memcpy(&info->addr, addr, sizeof(struct sockaddr_in));
    } else if (addr->sa_family == AF_INET6) {
        memcpy(&info->addr, addr, sizeof(struct sockaddr_in6));
    } else {
        E("ERROR: Unknown sa_family: %d", (int) addr->sa_family);
        return -1;
    }

    info->ifindex = ifindex;
    info->ttl = ttl;
    memcpy(info->hwaddr, hwaddr, sizeof(info->hwaddr));
    info->initialized = 1;

    /* A full cache intentionally evicts the oldest observation. */
    srci_end = (srci_end + 1) % SRCINFO_CAPACITY;
    if (srci_count < SRCINFO_CAPACITY) {
        srci_count++;
    }

    return 0;
}


int fs_srcinfo_get(const struct sockaddr *addr, unsigned int ifindex,
                   uint8_t *ttl, uint8_t hwaddr[8])
{
    size_t i, index;
    struct srcinfo *info;

    if (!srci || !addr || !ifindex || !ttl || !hwaddr ||
        srci_end >= SRCINFO_CAPACITY || srci_count > SRCINFO_CAPACITY) {
        E("ERROR: fs_srcinfo_get(): %s", "invalid cache state or argument");
        return -1;
    }

    if (addr->sa_family != AF_INET && addr->sa_family != AF_INET6) {
        E("ERROR: Unknown sa_family: %d", (int) addr->sa_family);
        return -1;
    }

    for (i = 0; i < srci_count; i++) {
        index = (srci_end + SRCINFO_CAPACITY - i - 1) % SRCINFO_CAPACITY;
        info = &srci[index];
        if (info->initialized && info->ifindex == ifindex &&
            sameip(addr, (const struct sockaddr *) &info->addr)) {
            *ttl = info->ttl;
            memcpy(hwaddr, info->hwaddr, sizeof(info->hwaddr));
            return 0;
        }
    }
    return 1;
}
