/*
 * process.c - FakeSIP: https://github.com/MikeWang000000/FakeSIP
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
#include "process.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

#include "globvar.h"
#include "logging.h"

int fs_execute_command(char **argv, int silent, const char *input)
{
    int res, pipefd[2], status, fd, i, io_failed;
    size_t input_len, written;
    ssize_t n;
    pid_t pid, wait_res;

    if (!argv || !argv[0]) {
        E("ERROR: fs_execute_command(): %s", "invalid argv");
        return -1;
    }

    pipefd[0] = pipefd[1] = -1;
    if (input) {
        res = pipe(pipefd);
        if (res < 0) {
            E("ERROR: pipe(): %s", strerror(errno));
            return -1;
        }
        /* Keep pipe ends away from stdin/stdout/stderr, including when the
           caller starts with closed standard descriptors. */
        for (i = 0; i < 2; i++) {
            if (pipefd[i] <= STDERR_FILENO) {
                fd = fcntl(pipefd[i], F_DUPFD, STDERR_FILENO + 1);
                if (fd < 0) {
                    E("ERROR: fcntl(): F_DUPFD: %s", strerror(errno));
                    close(pipefd[0]);
                    close(pipefd[1]);
                    return -1;
                }
                close(pipefd[i]);
                pipefd[i] = fd;
            }
        }
    }

    pid = fork();
    if (pid < 0) {
        E("ERROR: fork(): %s", strerror(errno));
        if (input) {
            close(pipefd[0]);
            close(pipefd[1]);
        }
        return -1;
    }

    if (!pid) {
        fd = -1;

        if (silent) {
            fd = open("/dev/null", O_WRONLY);
            if (fd < 0) {
                E("ERROR: open(): %s", strerror(errno));
                goto child_exit;
            }
        } else if (g_ctx.logfp && g_ctx.logfp != stderr) {
            fd = fileno(g_ctx.logfp);
            if (fd < 0) {
                E("ERROR: fileno(): %s", strerror(errno));
                goto child_exit;
            }
        }

        if (fd >= 0) {
            res = dup2(fd, STDOUT_FILENO);
            if (res < 0) {
                E("ERROR: dup2(): %s", strerror(errno));
                goto child_exit;
            }
            res = dup2(fd, STDERR_FILENO);
            if (res < 0) {
                E("ERROR: dup2(): %s", strerror(errno));
                goto child_exit;
            }
            if (fd != STDOUT_FILENO && fd != STDERR_FILENO) {
                close(fd);
            }
            fd = -1;
        }

        if (input) {
            close(pipefd[1]);
            pipefd[1] = -1;
            res = dup2(pipefd[0], STDIN_FILENO);
            if (res < 0) {
                E("ERROR: dup2(): %s", strerror(errno));
                goto child_exit;
            }
            close(pipefd[0]);
            pipefd[0] = -1;
        }

        execvp(argv[0], argv);

        E("ERROR: execvp(): %s: %s", argv[0], strerror(errno));

    child_exit:
        if (fd >= 0 && fd != STDOUT_FILENO && fd != STDERR_FILENO) {
            close(fd);
        }
        if (pipefd[0] >= 0) {
            close(pipefd[0]);
        }
        if (pipefd[1] >= 0) {
            close(pipefd[1]);
        }
        _exit(EXIT_FAILURE);
    }

    io_failed = 0;
    if (input) {
        if (close(pipefd[0]) < 0) {
            E("ERROR: close(): pipe read end: %s", strerror(errno));
            io_failed = 1;
        }
        pipefd[0] = -1;
        input_len = strlen(input);
        written = 0;
        while (written < input_len) {
            n = write(pipefd[1], input + written, input_len - written);
            if (n < 0) {
                if (errno == EINTR) {
                    continue;
                }
                E("ERROR: write(): %s", strerror(errno));
                io_failed = 1;
                break;
            } else if (n == 0) {
                E("ERROR: write(): %s", "short write");
                io_failed = 1;
                break;
            }
            written += (size_t) n;
        }
        if (close(pipefd[1]) < 0) {
            E("ERROR: close(): pipe write end: %s", strerror(errno));
            io_failed = 1;
        }
        pipefd[1] = -1;
    }

    do {
        wait_res = waitpid(pid, &status, 0);
    } while (wait_res < 0 && errno == EINTR);

    if (wait_res < 0) {
        E("ERROR: waitpid(): %s", strerror(errno));
        goto child_failed;
    }

    if (!io_failed && WIFEXITED(status) && WEXITSTATUS(status) == 0) {
        return 0;
    }

child_failed:
    if (!silent) {
        E_RAW("[*] failed command is: %s", argv[0]);
        for (i = 1; argv[i]; i++) {
            E_RAW(" %s", argv[i]);
        }
        E_RAW("\n");
    }

    return -1;
}
