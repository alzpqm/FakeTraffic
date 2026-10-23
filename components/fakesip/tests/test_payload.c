#define _GNU_SOURCE

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "globvar.h"
#include "payload.h"

#define CUSTOM_PAYLOAD_SIZE 1200U
#define SIP_URI_MAXLEN 120U

static int fail(const char *message)
{
    fprintf(stderr, "test_payload: %s\n", message);
    return EXIT_FAILURE;
}

static int write_all(int fd, const uint8_t *data, size_t len)
{
    size_t written;
    ssize_t result;

    written = 0;
    while (written < len) {
        result = write(fd, data + written, len - written);
        if (result <= 0) {
            return -1;
        }
        written += (size_t) result;
    }
    return 0;
}

static int payload_contains(const uint8_t *payload, size_t payload_len,
                            const char *text)
{
    return memmem(payload, payload_len, text, strlen(text)) != NULL;
}

static int content_length_matches(const uint8_t *payload, size_t payload_len)
{
    char text[2048], *body, *field;
    size_t declared_length;

    if (payload_len >= sizeof(text)) {
        return 0;
    }

    memcpy(text, payload, payload_len);
    text[payload_len] = '\0';
    field = strstr(text, "\r\nContent-Length: ");
    body = strstr(text, "\r\n\r\n");
    if (!field || !body || field >= body ||
        sscanf(field, "\r\nContent-Length: %zu", &declared_length) != 1) {
        return 0;
    }

    return declared_length == payload_len - (size_t) (body + 4 - text);
}

static void fill_ims_uri(char *buffer, size_t uri_len)
{
    static const char prefix[] = "sip:";
    static const char suffix[] = "@ims.mnc000.mcc460.3gppnetwork.org";

    memcpy(buffer, prefix, sizeof(prefix) - 1);
    memset(buffer + sizeof(prefix) - 1, 'a',
           uri_len - (sizeof(prefix) - 1) - (sizeof(suffix) - 1));
    memcpy(buffer + uri_len - (sizeof(suffix) - 1), suffix,
           sizeof(suffix) - 1);
    buffer[uri_len] = '\0';
}

int main(void)
{
    struct payload_info sip_payloads[] = {
        {FS_PAYLOAD_SIP, NULL},
        {FS_PAYLOAD_END, NULL},
    };
    struct payload_info ims_payloads[] = {
        {FS_PAYLOAD_SIP,
         "sip:user@ims.mnc000.mcc460.3gppnetwork.org"},
        {FS_PAYLOAD_END, NULL},
    };
    struct payload_info custom_payloads[] = {
        {FS_PAYLOAD_CUSTOM, NULL},
        {FS_PAYLOAD_END, NULL},
    };
    struct payload_info boundary_payloads[] = {
        {FS_PAYLOAD_SIP, NULL},
        {FS_PAYLOAD_END, NULL},
    };
    uint8_t expected[CUSTOM_PAYLOAD_SIZE], *payload;
    size_t payload_len;
    char max_sip_uri[SIP_URI_MAXLEN + 1];
    char long_sip_uri[SIP_URI_MAXLEN + 2];
    char path[] = "/tmp/fakesip-payload-test.XXXXXX";
    int fd;

    g_ctx.logfp = stderr;
    payload = (uint8_t *) 1;
    payload_len = 1;
    if (th_payload_get(&payload, &payload_len) == 0 || payload != NULL ||
        payload_len != 0) {
        return fail("empty payload list was accepted");
    }

    g_ctx.plinfo = sip_payloads;
    if (fs_payload_setup() < 0 ||
        th_payload_get(&payload, &payload_len) < 0 || !payload || !payload_len) {
        return fail("default SIP payload setup failed");
    }
    if (!payload_contains(payload, payload_len, ";branch=z9hG4bK") ||
        !payload_contains(payload, payload_len,
                          "\r\nMax-Forwards: 70\r\n") ||
        !payload_contains(payload, payload_len, "\r\nFrom: <sip:user@") ||
        !payload_contains(payload, payload_len, "\r\nContact: <sip:user@") ||
        !content_length_matches(payload, payload_len) ||
        payload_contains(payload, payload_len, "198.51.100.") ||
        payload_contains(payload, payload_len, "203.0.113.")) {
        fs_payload_cleanup();
        return fail("default SIP payload format is invalid");
    }
    fs_payload_cleanup();
    if (th_payload_get(&payload, &payload_len) == 0) {
        return fail("payload remained available after cleanup");
    }

    g_ctx.plinfo = ims_payloads;
    if (fs_payload_setup() < 0 ||
        th_payload_get(&payload, &payload_len) < 0 ||
        !payload_contains(payload, payload_len,
                          "INVITE sip:user@ims.mnc000.mcc460.3gppnetwork.org ") ||
        !payload_contains(payload, payload_len,
                          "\r\nSupported: 199, timer\r\n") ||
        !payload_contains(payload, payload_len,
                          "\r\nSession-Expires: 1800\r\n") ||
        !payload_contains(payload, payload_len,
                          "\r\nUser-Agent: PRD-IR92/18 ") ||
        !payload_contains(payload, payload_len,
                          "\r\na=rtpmap:97 AMR-WB/16000/1\r\n") ||
        !payload_contains(payload, payload_len,
                          "\r\na=rtpmap:96 AMR/8000/1\r\n") ||
        !payload_contains(payload, payload_len, "\r\na=ptime:20\r\n") ||
        !payload_contains(payload, payload_len, "\r\na=maxptime:240\r\n") ||
        !content_length_matches(payload, payload_len) ||
        payload_contains(payload, payload_len, "octet-align=1")) {
        fs_payload_cleanup();
        return fail("IMS SIP payload format is invalid");
    }
    fs_payload_cleanup();

    {
        struct payload_info observed_carrier_payloads[] = {
            {FS_PAYLOAD_SIP,
             "sip:user@sipcq16.xnq.r.10086.cn:5260"},
            {FS_PAYLOAD_SIP,
             "sip:user@sipsc109.r01.rcs.189.cn:5260"},
            {FS_PAYLOAD_END, NULL},
        };
        static const char *const expected_uris[] = {
            "INVITE sip:user@sipcq16.xnq.r.10086.cn:5260 SIP/2.0",
            "INVITE sip:user@sipsc109.r01.rcs.189.cn:5260 SIP/2.0",
            "INVITE sip:user@sipcq16.xnq.r.10086.cn:5260 SIP/2.0",
        };
        size_t i;

        g_ctx.plinfo = observed_carrier_payloads;
        if (fs_payload_setup() < 0) {
            return fail("observed carrier SIP payload setup failed");
        }
        for (i = 0; i < sizeof(expected_uris) / sizeof(expected_uris[0]); i++) {
            if (th_payload_get(&payload, &payload_len) < 0 ||
                !payload_contains(payload, payload_len, expected_uris[i]) ||
                !payload_contains(payload, payload_len,
                                  "\r\nSupported: 199, timer\r\n") ||
                !payload_contains(payload, payload_len,
                                  "\r\nUser-Agent: PRD-IR92/18 ") ||
                !payload_contains(payload, payload_len,
                                  "\r\na=rtpmap:97 AMR-WB/16000/1\r\n") ||
                !content_length_matches(payload, payload_len)) {
                fs_payload_cleanup();
                return fail("observed carrier SIP payload is not IMS-style");
            }
        }
        fs_payload_cleanup();
    }

    {
        struct payload_info host_boundary_payloads[] = {
            {FS_PAYLOAD_SIP,
             "sip:user@sipcq16.xnq.r.10086.cn.evil:5260"},
            {FS_PAYLOAD_SIP,
             "sip:user@ims.mnc000.mcc460.3gppnetwork.org.evil"},
            {FS_PAYLOAD_SIP,
             "sip:user@example.com?subject=@sipcq16.xnq.r.10086.cn"},
            {FS_PAYLOAD_SIP,
             "sip:user@SIPCQ16.XNQ.R.10086.CN:5260;transport=udp"},
            {FS_PAYLOAD_SIP,
             "sip:user@IMS.MNC000.MCC460.3GPPNETWORK.ORG.:5260"},
            {FS_PAYLOAD_END, NULL},
        };
        static const int expected_ims[] = {0, 0, 0, 1, 1};
        size_t i;

        g_ctx.plinfo = host_boundary_payloads;
        if (fs_payload_setup() < 0) {
            return fail("SIP host-boundary payload setup failed");
        }
        for (i = 0; i < sizeof(expected_ims) / sizeof(expected_ims[0]); i++) {
            int has_ims_headers;

            if (th_payload_get(&payload, &payload_len) < 0) {
                fs_payload_cleanup();
                return fail("SIP host-boundary payload rotation failed");
            }
            has_ims_headers = payload_contains(
                payload, payload_len, "\r\nSupported: 199, timer\r\n");
            if (has_ims_headers != expected_ims[i]) {
                fs_payload_cleanup();
                return fail("SIP IMS classification ignored host boundaries");
            }
        }
        fs_payload_cleanup();
    }

    {
        struct payload_info rotation_payloads[] = {
            {FS_PAYLOAD_SIP, "sip:first@ims.mnc000.mcc460.3gppnetwork.org"},
            {FS_PAYLOAD_SIP, "sip:second@ims.mnc001.mcc460.3gppnetwork.org"},
            {FS_PAYLOAD_SIP, "sip:third@ims.mnc003.mcc460.3gppnetwork.org"},
            {FS_PAYLOAD_END, NULL},
        };
        static const char *const expected_order[] = {
            "first@", "second@", "third@", "first@",
        };
        size_t i;

        g_ctx.plinfo = rotation_payloads;
        if (fs_payload_setup() < 0) {
            return fail("rotation payload setup failed");
        }
        for (i = 0; i < sizeof(expected_order) / sizeof(expected_order[0]);
             i++) {
            if (th_payload_get(&payload, &payload_len) < 0 ||
                !payload_contains(payload, payload_len,
                                  expected_order[i])) {
                fs_payload_cleanup();
                return fail("payload rotation order does not match "
                            "configuration order");
            }
        }
        fs_payload_cleanup();
    }

    fill_ims_uri(max_sip_uri, SIP_URI_MAXLEN);
    boundary_payloads[0].info = max_sip_uri;
    g_ctx.plinfo = boundary_payloads;
    if (fs_payload_setup() < 0 ||
        th_payload_get(&payload, &payload_len) < 0 || !payload || !payload_len) {
        return fail("maximum-length SIP URI was rejected");
    }
    fs_payload_cleanup();

    fill_ims_uri(long_sip_uri, SIP_URI_MAXLEN + 1);
    boundary_payloads[0].info = long_sip_uri;
    if (fs_payload_setup() == 0) {
        fs_payload_cleanup();
        return fail("overlength SIP URI was accepted");
    }

    memset(expected, 0x5a, sizeof(expected));
    fd = mkstemp(path);
    if (fd < 0 || write_all(fd, expected, sizeof(expected)) < 0 ||
        close(fd) < 0) {
        if (fd >= 0) {
            close(fd);
        }
        unlink(path);
        return fail("could not create exact-size payload fixture");
    }

    custom_payloads[0].info = path;
    g_ctx.plinfo = custom_payloads;
    if (fs_payload_setup() < 0 ||
        th_payload_get(&payload, &payload_len) < 0 ||
        payload_len != sizeof(expected) ||
        memcmp(payload, expected, sizeof(expected)) != 0) {
        unlink(path);
        return fail("exact-size custom payload was rejected or corrupted");
    }

    fs_payload_cleanup();
    unlink(path);
    return EXIT_SUCCESS;
}
