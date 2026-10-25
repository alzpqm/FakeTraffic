/* SPDX-License-Identifier: GPL-3.0-or-later */
#define _GNU_SOURCE
#include "telemetry.h"
#include <assert.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int short_writes, interrupted, fail_write;
ssize_t __real_write(int, const void *, size_t);
ssize_t __wrap_write(int fd, const void *buffer, size_t length)
{
    if (fail_write) { errno = ENOSPC; return -1; }
    if (interrupted) { interrupted = 0; errno = EINTR; return -1; }
    if (short_writes && length > 7) length = 7;
    return __real_write(fd, buffer, length);
}
static void read_snapshot(int dir, char *buffer, size_t size)
{
    int fd = openat(dir, "tcp.stats", O_RDONLY | O_NOFOLLOW);
    ssize_t n;
    assert(fd >= 0);
    n = read(fd, buffer, size - 1);
    assert(n > 0);
    buffer[n] = 0;
    close(fd);
}
int main(void)
{
    char directory[] = "/tmp/faketraffic-telemetry.XXXXXX";
    char data[4096], before[4096];
    struct stat mode;
    struct dirent *entry;
    DIR *listing;
    int dir, victim;
    assert(mkdtemp(directory));
    ft_stats_queue(513);
    dir = open(directory, O_RDONLY | O_DIRECTORY);
    assert(dir >= 0);
    errno = EDOM;
    ft_stats_send(0, 100, 100);
    ft_stats_send(0, -1, 100);
    ft_stats_send(0, 40, 100);
    ft_stats_send(1, 100, 100);
    ft_stats_add(FT_QUEUED, UINT64_C(9007199254740993));
    assert(errno == EDOM);
    short_writes = interrupted = 1;
    assert(ft_stats_snapshot(dir, "tcp") == 0);
    assert(errno == EDOM);
    short_writes = 0;
    read_snapshot(dir, data, sizeof(data));
    assert(strstr(data, "\"fake_send_attempts_total\":\"3\""));
    assert(strstr(data, "\"fake_send_accepted_total\":\"1\""));
    assert(strstr(data, "\"fake_send_errors_total\":\"1\""));
    assert(strstr(data, "\"fake_send_short_total\":\"1\""));
    assert(strstr(data, "\"fake_bytes_accepted_total\":\"100\""));
    assert(strstr(data, "\"original_send_accepted_total\":\"1\""));
    assert(strstr(data, "\"queued_total\":\"9007199254740993\""));
    assert(strstr(data, "\"queue_number\":513,\"queue_bound\":true"));
    assert(strstr(data, "\"boot_id\":\"") && strstr(data, "\"start_ticks\":\""));
    assert(fstatat(dir, "tcp.stats", &mode, AT_SYMLINK_NOFOLLOW) == 0);
    assert(S_ISREG(mode.st_mode) && (mode.st_mode & 0777) == 0600);
    strcpy(before, data);
    fail_write = 1;
    assert(ft_stats_snapshot(dir, "tcp") == -1);
    fail_write = 0;
    read_snapshot(dir, data, sizeof(data));
    assert(!strcmp(data, before));
    assert(ft_stats_snapshot(dir, "../escape") == -1);
    assert(fchmod(dir, 0755) == 0);
    assert(ft_stats_snapshot(dir, "tcp") == -1);
    assert(fchmod(dir, 0700) == 0);
    assert(unlinkat(dir, "tcp.stats", 0) == 0);
    victim = openat(dir, "victim", O_WRONLY | O_CREAT | O_EXCL, 0600);
    assert(victim >= 0 && __real_write(victim, "original", 8) == 8);
    close(victim);
    assert(symlinkat("victim", dir, "tcp.stats") == 0);
    ft_stats_add(FT_QUEUED, UINT64_MAX);
    assert(ft_stats_snapshot(dir, "tcp") == 0);
    read_snapshot(dir, data, sizeof(data));
    assert(strstr(data, "\"saturated\":true"));
    assert(strstr(data, "\"queued_total\":\"18446744073709551615\""));
    victim = openat(dir, "victim", O_RDONLY);
    assert(victim >= 0 && read(victim, data, sizeof(data)) == 8);
    assert(!memcmp(data, "original", 8));
    close(victim);
    listing = fdopendir(dup(dir));
    assert(listing);
    while ((entry = readdir(listing))) assert(!strstr(entry->d_name, ".tmp"));
    closedir(listing);
    unlinkat(dir, "victim", 0);
    unlinkat(dir, "tcp.stats", 0);
    close(dir);
    assert(rmdir(directory) == 0);
    puts("PASS telemetry: exact counts, original isolation, uint64, errno, partial I/O, atomic failure, permissions, symlink and saturation");
    return 0;
}
