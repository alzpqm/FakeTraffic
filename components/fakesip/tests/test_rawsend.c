#define _GNU_SOURCE
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

static ssize_t test_sendto(int fd, const void *buf, size_t len, int flags,
                           const struct sockaddr *addr, socklen_t addrlen);
static int test_socket(int domain, int type, int protocol);
static int test_setsockopt(int fd, int level, int option_name,
                           const void *option_value, socklen_t option_len);
static int test_close(int fd);

#define sendto test_sendto
#define socket test_socket
#define setsockopt test_setsockopt
#define close test_close
#include "../src/rawsend.c"
#undef sendto
#undef socket
#undef setsockopt
#undef close

static ssize_t sendto_result;
static int sendto_error;
static int sendto_calls;
static int socket_calls;
static int socket_domains[4];
static int close_calls;

static ssize_t test_sendto(int fd, const void *buf, size_t len, int flags,
                           const struct sockaddr *addr, socklen_t addrlen)
{
    (void) fd;
    (void) buf;
    (void) len;
    (void) flags;
    (void) addr;
    (void) addrlen;

    sendto_calls++;
    errno = sendto_error;
    return sendto_result;
}

static int test_socket(int domain, int type, int protocol)
{
    (void) type;
    (void) protocol;

    if (socket_calls < (int) (sizeof(socket_domains) / sizeof(socket_domains[0]))) {
        socket_domains[socket_calls] = domain;
    }
    socket_calls++;
    return 100 + socket_calls;
}

static int test_setsockopt(int fd, int level, int option_name,
                           const void *option_value, socklen_t option_len)
{
    (void) fd;
    (void) level;
    (void) option_name;
    (void) option_value;
    (void) option_len;
    return 0;
}

static int test_close(int fd)
{
    (void) fd;
    close_calls++;
    return 0;
}

static int fail(const char *message)
{
    fprintf(stderr, "test_rawsend: %s\n", message);
    return EXIT_FAILURE;
}

static void reset_socket_test(void)
{
    socket_calls = 0;
    close_calls = 0;
    memset(socket_domains, 0, sizeof(socket_domains));
    sockfd = sock4fd = sock6fd = -1;
    sock4if = sock6if = -1;
}

static int test_socket_selection(void)
{
    reset_socket_test();
    g_ctx.outbound = 1;
    g_ctx.inbound = 0;
    g_ctx.use_ipv4 = g_ctx.use_ipv6 = 1;
    if (fs_rawsend_setup() < 0 || socket_calls != 1 ||
        socket_domains[0] != AF_PACKET || sockfd < 0 || sock4fd >= 0 ||
        sock6fd >= 0) {
        return fail("outbound-only setup opened unused raw IP sockets");
    }
    fs_rawsend_cleanup();
    if (close_calls != 1) {
        return fail("outbound-only cleanup closed the wrong socket count");
    }

    reset_socket_test();
    g_ctx.outbound = 0;
    g_ctx.inbound = 1;
    g_ctx.use_ipv4 = 1;
    g_ctx.use_ipv6 = 0;
    if (fs_rawsend_setup() < 0 || socket_calls != 1 ||
        socket_domains[0] != AF_INET || sockfd >= 0 || sock4fd < 0 ||
        sock6fd >= 0) {
        return fail("IPv4-only setup opened the wrong socket families");
    }
    sock4if = 9;
    fs_rawsend_cleanup();
    if (close_calls != 1 || sock4if != -1) {
        return fail("IPv4-only cleanup retained stale socket state");
    }

    reset_socket_test();
    g_ctx.outbound = 0;
    g_ctx.inbound = 1;
    g_ctx.use_ipv4 = 0;
    g_ctx.use_ipv6 = 1;
    if (fs_rawsend_setup() < 0 || socket_calls != 1 ||
        socket_domains[0] != AF_INET6 || sockfd >= 0 || sock4fd >= 0 ||
        sock6fd < 0) {
        return fail("IPv6-only setup opened the wrong socket families");
    }
    sock6if = 11;
    fs_rawsend_cleanup();
    if (close_calls != 1 || sock6if != -1) {
        return fail("IPv6-only cleanup retained stale socket state");
    }

    reset_socket_test();
    g_ctx.outbound = g_ctx.inbound = 1;
    g_ctx.use_ipv4 = g_ctx.use_ipv6 = 1;
    if (fs_rawsend_setup() < 0 || socket_calls != 3 ||
        socket_domains[0] != AF_PACKET || socket_domains[1] != AF_INET ||
        socket_domains[2] != AF_INET6) {
        return fail("bidirectional dual-stack setup missed a socket family");
    }
    fs_rawsend_cleanup();
    if (close_calls != 3) {
        return fail("dual-stack cleanup closed the wrong socket count");
    }

    return EXIT_SUCCESS;
}

int main(void)
{
    uint8_t packet[32] = {0};
    struct sockaddr_in destination;
    struct sockaddr_ll link;

    memset(&destination, 0, sizeof(destination));
    memset(&link, 0, sizeof(link));
    destination.sin_family = AF_INET;
    link.sll_ifindex = 7;

    g_ctx.logfp = stderr;
    if (test_socket_selection() != EXIT_SUCCESS) {
        return EXIT_FAILURE;
    }

    sock4fd = 123;
    sock4if = link.sll_ifindex;

    sendto_result = -1;
    sendto_error = EPERM;
    if (sendto_snat(&link, (struct sockaddr *) &destination, packet,
                    sizeof(packet)) != -1 || sendto_calls != 1) {
        return fail("EPERM must be reported as a fake-send failure");
    }

    sendto_result = sizeof(packet);
    sendto_error = 0;
    if (sendto_snat(&link, (struct sockaddr *) &destination, packet,
                    sizeof(packet)) != 0 || sendto_calls != 2) {
        return fail("a successful sendto must remain successful");
    }

    return EXIT_SUCCESS;
}
