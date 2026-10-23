#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "globvar.h"
#include "nfrules.h"

static int fail_v4, fail_v6;
static int setup_v4, setup_v6, cleanup_v4, cleanup_v6;

static int fail(const char *message)
{
    fprintf(stderr, "test_nfrules: %s\n", message);
    return EXIT_FAILURE;
}

int fs_execute_command(char **argv, int silent, const char *input)
{
    (void) argv;
    (void) silent;
    (void) input;
    return 0;
}

int fs_nft4_setup(void)
{
    setup_v4++;
    return fail_v4 ? -1 : 0;
}

int fs_nft6_setup(void)
{
    setup_v6++;
    return fail_v6 ? -1 : 0;
}

void fs_nft4_cleanup(void)
{
    cleanup_v4++;
}

void fs_nft6_cleanup(void)
{
    cleanup_v6++;
}

int fs_ipt4_setup(void)
{
    return fs_nft4_setup();
}

int fs_ipt6_setup(void)
{
    return fs_nft6_setup();
}

void fs_ipt4_cleanup(void)
{
    fs_nft4_cleanup();
}

void fs_ipt6_cleanup(void)
{
    fs_nft6_cleanup();
}

static void reset_state(int use_iptables)
{
    memset(&g_ctx, 0, sizeof(g_ctx));
    g_ctx.logfp = stderr;
    g_ctx.use_ipv4 = 1;
    g_ctx.use_ipv6 = 1;
    g_ctx.use_iptables = use_iptables;
    fail_v4 = fail_v6 = 0;
    setup_v4 = setup_v6 = cleanup_v4 = cleanup_v6 = 0;
}

static int test_backend(int use_iptables)
{
    reset_state(use_iptables);
    fail_v4 = 1;
    if (fs_nfrules_setup() == 0 || setup_v4 != 1 || setup_v6 != 0 ||
        cleanup_v4 != 1 || cleanup_v6 != 1) {
        return fail("IPv4 setup failure did not roll back both families");
    }

    reset_state(use_iptables);
    fail_v6 = 1;
    if (fs_nfrules_setup() == 0 || setup_v4 != 1 || setup_v6 != 1 ||
        cleanup_v4 != 1 || cleanup_v6 != 1) {
        return fail("IPv6 setup failure did not roll back both families");
    }

    reset_state(use_iptables);
    if (fs_nfrules_setup() != 0 || setup_v4 != 1 || setup_v6 != 1 ||
        cleanup_v4 != 0 || cleanup_v6 != 0) {
        return fail("successful setup unexpectedly cleaned up rules");
    }
    fs_nfrules_cleanup();
    if (cleanup_v4 != 1 || cleanup_v6 != 1) {
        return fail("explicit cleanup did not clean both families");
    }

    return EXIT_SUCCESS;
}

int main(void)
{
    if (test_backend(0) != EXIT_SUCCESS || test_backend(1) != EXIT_SUCCESS) {
        return EXIT_FAILURE;
    }

    return EXIT_SUCCESS;
}
