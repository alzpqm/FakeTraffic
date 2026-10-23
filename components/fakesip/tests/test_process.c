#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include "globvar.h"
#include "process.h"

#define LARGE_INPUT_SIZE (4U * 1024U * 1024U)

static int fail(const char *message)
{
    fprintf(stderr, "test_process: %s\n", message);
    return EXIT_FAILURE;
}

static int test_closed_standard_fds(int use_log)
{
    int mask, fd, status, failures = 0;
    pid_t pid, result;
    char *argv[] = {"/bin/sh", "-c",
                    "IFS= read -r value && [ \"$value\" = 'test input' ] && "
                    "printf 'output\\n' && printf 'error\\n' >&2",
                    NULL};

    /* Supervisors may start us with any standard descriptor closed. */
    for (mask = 0; mask < 8; mask++) {
        pid = fork();
        if (pid < 0) {
            return fail("closed-descriptor test fork failed");
        }
        if (pid == 0) {
            FILE *log = NULL;
            char logged[64] = {0};
            int command_result;

            for (fd = 0; fd < 3; fd++) {
                if (mask & (1 << fd)) {
                    close(fd);
                }
            }
            if (use_log) {
                log = tmpfile();
                if (!log) {
                    _exit(EXIT_FAILURE);
                }
                g_ctx.logfp = log;
            }
            command_result = fs_execute_command(argv, !use_log,
                                                "test input\n");
            if (log) {
                rewind(log);
                if (fread(logged, 1, sizeof(logged) - 1, log) != 13 ||
                    strcmp(logged, "output\nerror\n") != 0) {
                    command_result = -1;
                }
                fclose(log);
            }
            _exit(command_result == 0 ? EXIT_SUCCESS : EXIT_FAILURE);
        }
        do {
            result = waitpid(pid, &status, 0);
        } while (result < 0 && errno == EINTR);
        if (result < 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
            fprintf(stderr,
                    "test_process: closed descriptor mask %d log=%d failed\n",
                    mask, use_log);
            failures++;
        }
    }
    return failures ? EXIT_FAILURE : EXIT_SUCCESS;
}

int main(void)
{
    char *large_input;
    char *cat_argv[] = {"/bin/cat", NULL};
    char *true_argv[] = {"/bin/true", NULL};

    g_ctx.logfp = stderr;
    signal(SIGPIPE, SIG_IGN);

    if (fs_execute_command(cat_argv, 1, "test input") < 0) {
        return fail("successful input pipe was rejected");
    }

    large_input = malloc(LARGE_INPUT_SIZE + 1U);
    if (!large_input) {
        return fail("large input allocation failed");
    }
    memset(large_input, 'x', LARGE_INPUT_SIZE);
    large_input[LARGE_INPUT_SIZE] = '\0';

    if (fs_execute_command(true_argv, 1, large_input) == 0) {
        free(large_input);
        return fail("broken input pipe was reported as successful");
    }

    free(large_input);
    if (test_closed_standard_fds(0) != EXIT_SUCCESS ||
        test_closed_standard_fds(1) != EXIT_SUCCESS) {
        return EXIT_FAILURE;
    }
    return EXIT_SUCCESS;
}
