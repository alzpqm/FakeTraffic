/*
 * payload.c - FakeSIP: https://github.com/MikeWang000000/FakeSIP
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
#include "payload.h"

#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <limits.h>

#include "logging.h"
#include "globvar.h"

#define BUFFLEN        1200
#define SIP_URI_MAXLEN 120
#define SET_BE16(a, u16)         \
    do {                         \
        (a)[0] = (u16) >> (8);   \
        (a)[1] = (u16) & (0xff); \
    } while (0)

struct payload_node {
    uint8_t payload[BUFFLEN];
    size_t payload_len;
    struct payload_node *next;
};

static const char *sdp_fmt = "v=0\r\n"
                             "o=- %lu %lu IN IP4 %s\r\n"
                             "s=-\r\n"
                             "c=IN IP4 %s\r\n"
                             "t=0 0\r\n"
                             "m=audio 6000 RTP/AVP 0\r\n"
                             "a=rtpmap:0 PCMU/8000\r\n";

static const char *ims_sdp_fmt =
    "v=0\r\n"
    "o=- %lu %lu IN IP4 %s\r\n"
    "s=-\r\n"
    "c=IN IP4 %s\r\n"
    "b=AS:41\r\n"
    "t=0 0\r\n"
    "m=audio 49152 RTP/AVP 97 96 101\r\n"
    "b=RS:0\r\n"
    "b=RR:2000\r\n"
    "a=rtpmap:97 AMR-WB/16000/1\r\n"
    "a=fmtp:97 mode-change-capability=2;max-red=0\r\n"
    "a=rtpmap:96 AMR/8000/1\r\n"
    "a=fmtp:96 mode-change-capability=2;max-red=0\r\n"
    "a=rtpmap:101 telephone-event/8000\r\n"
    "a=fmtp:101 0-15\r\n"
    "a=ptime:20\r\n"
    "a=maxptime:240\r\n"
    "a=sendrecv\r\n";

static const char *ims_headers = "Supported: 199, timer\r\n"
                                 "Session-Expires: 1800\r\n"
                                 "User-Agent: PRD-IR92/18 term-Generic/IMS-UE "
                                 "device-type/smart-phone mno-custom/none\r\n";

static const char *sip_fmt = "INVITE %s SIP/2.0\r\n"
                             "Via: SIP/2.0/UDP %s;branch=z9hG4bK%lx\r\n"
                             "Max-Forwards: 70\r\n"
                             "From: <sip:user@%s>;tag=%lx\r\n"
                             "To: \"%s\" <%s>\r\n"
                             "Call-ID: %lx@%s\r\n"
                             "CSeq: 1 INVITE\r\n"
                             "Contact: <sip:user@%s>\r\n"
                             "%s"
                             "Content-Type: application/sdp\r\n"
                             "Content-Length: %lu\r\n"
                             "\r\n"
                             "%s";

static struct payload_node *current_node;

static unsigned long make_random_ulong(void)
{
    unsigned long value;

    value = (unsigned long) rand();
#if ULONG_MAX > UINT_MAX
    value = (value << (sizeof(unsigned int) * CHAR_BIT)) ^
            (unsigned long) rand();
#endif

    return value;
}

static int host_equals(const char *host, size_t host_len, const char *expected)
{
    size_t expected_len;

    expected_len = strlen(expected);
    return host_len == expected_len &&
           strncasecmp(host, expected, expected_len) == 0;
}


static int is_ims_sip_uri(const char *sip_uri)
{
    static const char suffix[] = ".3gppnetwork.org";

    const char *authority_end, *at, *host, *host_end;
    size_t host_len, suffix_len;

    if (!sip_uri || strncmp(sip_uri, "sip:", 4) != 0) {
        return 0;
    }

    host = sip_uri + 4;
    authority_end = strpbrk(host, ";?");
    if (!authority_end) {
        authority_end = host + strlen(host);
    }

    at = memchr(host, '@', (size_t) (authority_end - host));
    if (at) {
        host = at + 1;
    }

    if (host >= authority_end || *host == '[') {
        return 0;
    }

    host_end = memchr(host, ':', (size_t) (authority_end - host));
    if (!host_end) {
        host_end = authority_end;
    }
    host_len = (size_t) (host_end - host);
    if (host_len > 0 && host[host_len - 1] == '.') {
        host_len--;
    }

    if (host_equals(host, host_len, "sipcq16.xnq.r.10086.cn") ||
        host_equals(host, host_len, "sipsc109.r01.rcs.189.cn")) {
        return 1;
    }

    suffix_len = sizeof(suffix) - 1;
    return host_len > suffix_len &&
           strncasecmp(host + host_len - suffix_len, suffix, suffix_len) == 0;
}


static int make_sip_invite(uint8_t *buffer, size_t *len, char *sip_uri)
{
    int i, len_, buffsize, is_ims;
    char sip_uri_random[96], local[64], sdp_buf[640], *username;
    const char *extra_headers, *selected_sdp_fmt;
    unsigned long rand_ul[5], content_length;

    for (i = 0; i < 5; i++) {
        rand_ul[i] = make_random_ulong();
    }

    len_ = snprintf(local, sizeof(local), "100.%u.%u.%u",
                    64U + (unsigned int) rand() % 64U,
                    1U + (unsigned int) rand() % 254U,
                    1U + (unsigned int) rand() % 254U);
    if (len_ < 0 || (size_t) len_ >= sizeof(local)) {
        E("ERROR: snprintf(): %s", "failure");
        return -1;
    }

    if (sip_uri) {
        if (strncmp("sip:", sip_uri, 4) != 0 || sip_uri[4] == '\0' ||
            strpbrk(sip_uri, " \t\r\n\f\v") != NULL ||
            strlen(sip_uri) > SIP_URI_MAXLEN) {
            E("ERROR: Invalid SIP URI (use sip:, no whitespace, max %d "
              "bytes): %s",
              SIP_URI_MAXLEN, sip_uri);
            return -1;
        }
    } else {
        len_ = snprintf(sip_uri_random, sizeof(sip_uri_random), "sip:user@%s",
                        local);
        if (len_ < 0 || (size_t) len_ >= sizeof(sip_uri_random)) {
            E("ERROR: snprintf(): %s", "failure");
            return -1;
        }
        sip_uri = sip_uri_random;
    }
    username = sip_uri + 4;

    is_ims = is_ims_sip_uri(sip_uri);
    selected_sdp_fmt = is_ims ? ims_sdp_fmt : sdp_fmt;
    extra_headers = is_ims ? ims_headers : "";
    len_ = snprintf(sdp_buf, sizeof(sdp_buf), selected_sdp_fmt,
                    rand_ul[0] & UINT32_MAX, rand_ul[1] & UINT32_MAX, local,
                    local);
    if (len_ < 0 || (size_t) len_ >= sizeof(sdp_buf)) {
        E("ERROR: snprintf(): %s", "failure");
        return -1;
    }

    content_length = len_;

    buffsize = *len;
    len_ = snprintf((char *) buffer, buffsize, sip_fmt, sip_uri, local,
                    rand_ul[2], local, rand_ul[3], username, sip_uri,
                    rand_ul[4], local, local, extra_headers, content_length,
                    sdp_buf);
    if (len_ < 0) {
        E("ERROR: snprintf(): %s", "failure");
        return -1;
    } else if (len_ >= buffsize) {
        E("ERROR: SIP URI is too long");
        return -1;
    }

    *len = len_;

    return 0;
}


static int make_custom(uint8_t *buffer, size_t *len, char *filepath)
{
    int extra, res;
    size_t len_, buffsize;
    FILE *fp;

    if (!buffer || !len || !filepath) {
        E("ERROR: make_custom(): %s", "invalid argument");
        return -1;
    }

    buffsize = *len;

    fp = fopen(filepath, "rb");
    if (!fp) {
        E("ERROR: fopen(): %s: %s", filepath, strerror(errno));
        return -1;
    }

    len_ = fread(buffer, 1, buffsize, fp);

    if (ferror(fp)) {
        E("ERROR: fread(): %s: %s", filepath, strerror(errno ? errno : EIO));
        fclose(fp);
        return -1;
    }

    if (len_ == buffsize) {
        extra = fgetc(fp);
        if (extra != EOF) {
            E("ERROR: %s: Data too long. Maximum length is %zu", filepath,
              buffsize);
            fclose(fp);
            return -1;
        }
        if (ferror(fp)) {
            E("ERROR: fgetc(): %s: %s", filepath,
              strerror(errno ? errno : EIO));
            fclose(fp);
            return -1;
        }
    }

    res = fclose(fp);
    if (res < 0) {
        E("ERROR: fclose(): %s", strerror(errno));
        return -1;
    }

    *len = len_;

    return 0;
}


int fs_payload_setup(void)
{
    int res;
    size_t len;
    struct payload_info *pinfo;
    struct payload_node *node, *next;

    for (pinfo = g_ctx.plinfo; pinfo->type; pinfo++) {
        node = malloc(sizeof(*node));
        if (!node) {
            E("ERROR: malloc(): %s", strerror(errno));
            goto cleanup;
        }

        if (current_node) {
            next = current_node->next;
            current_node->next = node;
            node->next = next;
        } else {
            node->next = node;
        }
        current_node = node;

        switch (pinfo->type) {
            case FS_PAYLOAD_CUSTOM:
                len = sizeof(node->payload);
                res = make_custom(node->payload, &len, pinfo->info);
                if (res < 0) {
                    E(T(make_custom));
                    goto cleanup;
                }
                node->payload_len = len;
                break;

            case FS_PAYLOAD_SIP:
                len = sizeof(node->payload);
                res = make_sip_invite(node->payload, &len, pinfo->info);
                if (res < 0) {
                    E(T(make_sip_invite));
                    goto cleanup;
                }
                node->payload_len = len;
                break;

            default:
                E("ERROR: Unknown payload type");
                goto cleanup;
        }
    }

    if (!current_node) {
        E("ERROR: No payload is available");
        goto cleanup;
    }

    current_node = current_node->next;

    return 0;

cleanup:
    fs_payload_cleanup();

    return -1;
}


void fs_payload_cleanup(void)
{
    struct payload_node *node, *next_node;

    node = current_node;
    while (node) {
        next_node = node->next;
        free(node);
        if (next_node == current_node) {
            break;
        }
        node = next_node;
    }
    current_node = NULL;
}


int th_payload_get(uint8_t **payload_ptr, size_t *payload_len)
{
    if (!payload_ptr || !payload_len) {
        return -1;
    }

    *payload_ptr = NULL;
    *payload_len = 0;
    if (!current_node) {
        return -1;
    }

    *payload_ptr = current_node->payload;
    *payload_len = current_node->payload_len;
    current_node = current_node->next;

    return 0;
}
