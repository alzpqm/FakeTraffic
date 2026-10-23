#define _GNU_SOURCE

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#include "../src/nfqueue.c"

static int fail(const char *message)
{
    fprintf(stderr, "test_nfqueue: %s\n", message);
    return EXIT_FAILURE;
}

static void exit_on_alarm(int signal_number)
{
    (void) signal_number;
    g_ctx.exit = 1;
}

static int test_idle_signal_exit(void)
{
    int pipe_fd[2], flags, result;
    struct sigaction action, old_action;
    struct timespec start, end;
    long elapsed_ms;

    if (pipe(pipe_fd) < 0) {
        return fail("pipe setup failed");
    }
    if (set_nonblocking(pipe_fd[0]) < 0) {
        close(pipe_fd[0]);
        close(pipe_fd[1]);
        return fail("NFQUEUE descriptor was not made nonblocking");
    }
    flags = fcntl(pipe_fd[0], F_GETFL, 0);
    if (flags < 0 || !(flags & O_NONBLOCK)) {
        close(pipe_fd[0]);
        close(pipe_fd[1]);
        return fail("NFQUEUE descriptor is still blocking");
    }

    memset(&action, 0, sizeof(action));
    sigemptyset(&action.sa_mask);
    action.sa_handler = exit_on_alarm;
    action.sa_flags = SA_RESTART;
    if (sigaction(SIGALRM, &action, &old_action) < 0) {
        close(pipe_fd[0]);
        close(pipe_fd[1]);
        return fail("SIGALRM setup failed");
    }

    fd = pipe_fd[0];
    g_ctx.exit = 0;
    if (clock_gettime(CLOCK_MONOTONIC, &start) < 0) {
        sigaction(SIGALRM, &old_action, NULL);
        close(pipe_fd[0]);
        close(pipe_fd[1]);
        return fail("start time read failed");
    }

    alarm(1);
    result = fs_nfq_loop();
    alarm(0);
    if (clock_gettime(CLOCK_MONOTONIC, &end) < 0) {
        sigaction(SIGALRM, &old_action, NULL);
        close(pipe_fd[0]);
        close(pipe_fd[1]);
        return fail("end time read failed");
    }

    sigaction(SIGALRM, &old_action, NULL);
    close(pipe_fd[0]);
    close(pipe_fd[1]);
    fd = -1;
    g_ctx.exit = 0;

    elapsed_ms = (end.tv_sec - start.tv_sec) * 1000L +
        (end.tv_nsec - start.tv_nsec) / 1000000L;
    if (result != 0 || elapsed_ms < 0 || elapsed_ms > 2000L) {
        return fail("idle NFQUEUE loop did not stop within the signal bound");
    }

    return EXIT_SUCCESS;
}

int main(void)
{
    struct nfqnl_msg_packet_hw packet_hw;
    struct sockaddr_ll link;
    size_t i;

    g_ctx.logfp = stderr;
    memset(&packet_hw, 0, sizeof(packet_hw));
    memset(&link, 0xa5, sizeof(link));
    packet_hw.hw_addrlen = htons(6);
    for (i = 0; i < sizeof(packet_hw.hw_addr); i++) {
        packet_hw.hw_addr[i] = (uint8_t) (i + 1);
    }

    if (copy_packet_hwaddr(&link, &packet_hw) < 0 || link.sll_halen != 6 ||
        memcmp(link.sll_addr, packet_hw.hw_addr, 6) != 0 ||
        link.sll_addr[6] != 0 || link.sll_addr[7] != 0) {
        return fail("NFQUEUE hardware address length was not preserved");
    }

    memset(&link, 0xa5, sizeof(link));
    if (copy_packet_hwaddr(&link, NULL) < 0 || link.sll_halen != 0) {
        return fail("missing NFQUEUE hardware address was not accepted");
    }
    for (i = 0; i < sizeof(link.sll_addr); i++) {
        if (link.sll_addr[i] != 0) {
            return fail("missing hardware address left stale bytes");
        }
    }

    packet_hw.hw_addrlen = htons(sizeof(packet_hw.hw_addr) + 1U);
    if (copy_packet_hwaddr(&link, &packet_hw) == 0) {
        return fail("oversized NFQUEUE hardware address was accepted");
    }

    if (test_idle_signal_exit() != EXIT_SUCCESS) {
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
