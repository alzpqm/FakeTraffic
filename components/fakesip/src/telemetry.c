/* SPDX-License-Identifier: GPL-3.0-or-later */
#define _GNU_SOURCE
#include "telemetry.h"
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static uint64_t counters[FT_COUNTER_MAX];
static int saturated;
static uint32_t queue_number;
static int queue_bound;
void ft_stats_queue(uint32_t queue) { queue_number = queue; queue_bound = 1; }
static const char *const names[FT_COUNTER_MAX] = {
    "queued_total", "metadata_errors_total", "engine_errors_total",
    "verdict_errors_total", "receive_errors_total", "handle_errors_total",
    "fake_build_errors_total", "fake_send_attempts_total",
    "fake_send_accepted_total", "fake_send_errors_total", "fake_send_short_total",
    "fake_bytes_accepted_total", "original_send_attempts_total",
    "original_send_accepted_total", "original_send_errors_total",
    "original_send_short_total", "skip_direction_total", "skip_hop_total",
    "skip_source_total", "export_errors_total"
};

void ft_stats_add(enum ft_counter id, uint64_t value)
{
    if ((unsigned) id >= FT_COUNTER_MAX) return;
    if (UINT64_MAX - counters[id] < value) {
        counters[id] = UINT64_MAX;
        saturated = 1;
    } else counters[id] += value;
}

void ft_stats_send(int original, ssize_t result, size_t expected)
{
    FT_COUNT(original ? FT_ORIGINAL_SEND_ATTEMPTS : FT_FAKE_SEND_ATTEMPTS);
    if (result < 0) {
        FT_COUNT(original ? FT_ORIGINAL_SEND_ERRORS : FT_FAKE_SEND_ERRORS);
    } else if ((uint64_t) result != expected) {
        FT_COUNT(original ? FT_ORIGINAL_SEND_SHORT : FT_FAKE_SEND_SHORT);
    } else {
        FT_COUNT(original ? FT_ORIGINAL_SEND_ACCEPTED : FT_FAKE_SEND_ACCEPTED);
        if (!original) ft_stats_add(FT_FAKE_BYTES_ACCEPTED, expected);
    }
}

static uint64_t start_ticks(void)
{
    char line[4096], *at, *end;
    unsigned field;
    uint64_t result;
    FILE *fp = fopen("/proc/self/stat", "r");
    if (!fp) return 0;
    at = fgets(line, sizeof(line), fp);
    fclose(fp);
    if (!at || !(at = strrchr(line, ')'))) return 0;
    at++;
    /* comm may contain spaces and ')'; field 3 follows its last ')'. */
    for (field = 3; field < 22; field++) {
        while (*at == ' ') at++;
        while (*at && *at != ' ') at++;
        if (!*at) return 0;
    }
    errno = 0;
    result = strtoull(at, &end, 10);
    return errno || end == at ? 0 : result;
}

int ft_stats_snapshot(int directory_fd, const char *engine)
{
    char data[4096], temporary[96], target[32], boot[40];
    FILE *boot_file;
    struct stat st;
    struct timespec now;
    uint64_t ticks, millis;
    size_t used = 0, sent = 0;
    int fd = -1, n, saved_errno = errno, ok = -1;
    unsigned i;
    ssize_t written;

    if ((!engine || (strcmp(engine, "tcp") && strcmp(engine, "udp"))) ||
        fstat(directory_fd, &st) || !S_ISDIR(st.st_mode) ||
        st.st_uid != geteuid() || (st.st_mode & 0077) ||
        clock_gettime(CLOCK_MONOTONIC, &now)) goto done;
    ticks = start_ticks();
    if (!ticks) goto done;
    boot_file = fopen("/proc/sys/kernel/random/boot_id", "r");
    if (!boot_file) goto done;
    if (!fgets(boot, sizeof(boot), boot_file)) { fclose(boot_file); goto done; }
    fclose(boot_file);
    boot[strcspn(boot, "\r\n")] = 0;
    if (strlen(boot) != 36 || strspn(boot, "0123456789abcdef-") != 36) goto done;
    millis = (uint64_t) now.tv_sec * 1000 + (unsigned long) now.tv_nsec / 1000000;
    n = snprintf(data, sizeof(data),
        "{\"schema_version\":1,\"backend\":\"nfqueue\",\"engine\":\"%s\","
        "\"boot_id\":\"%s\",\"pid\":\"%ld\",\"start_ticks\":\"%" PRIu64 "\","
        "\"sample_mono_ms\":\"%" PRIu64 "\",\"queue_number\":%" PRIu32 ",\"queue_bound\":%s,\"saturated\":%s,\"counter_semantics\":\"non_exclusive\",\"counters\":{",
        engine, boot, (long) getpid(), ticks, millis, queue_number,
        queue_bound ? "true" : "false", saturated ? "true" : "false");
    if (n < 0 || (size_t) n >= sizeof(data)) goto done;
    used = (size_t) n;
    for (i = 0; i < FT_COUNTER_MAX; i++) {
        n = snprintf(data + used, sizeof(data) - used, "%s\"%s\":\"%" PRIu64 "\"",
                     i ? "," : "", names[i], counters[i]);
        if (n < 0 || (size_t) n >= sizeof(data) - used) goto done;
        used += (size_t) n;
    }
    if (used + 4 > sizeof(data)) goto done;
    memcpy(data + used, "}}\n", 3);
    used += 3;
    snprintf(target, sizeof(target), "%s.stats", engine);
    snprintf(temporary, sizeof(temporary), ".%s.%ld.%ld.%ld.tmp", engine,
             (long) getpid(), (long) now.tv_sec, now.tv_nsec);
    fd = openat(directory_fd, temporary,
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0) goto done;
    while (sent < used) {
        written = write(fd, data + sent, used - sent);
        if (written < 0 && errno == EINTR) continue;
        if (written <= 0) goto cleanup;
        sent += (size_t) written;
    }
    if (close(fd)) { fd = -1; goto cleanup; }
    fd = -1;
    if (renameat(directory_fd, temporary, directory_fd, target)) goto cleanup;
    ok = 0;
cleanup:
    if (fd >= 0) close(fd);
    if (ok) unlinkat(directory_fd, temporary, 0);
done:
    if (ok) FT_COUNT(FT_EXPORT_ERRORS);
    errno = saved_errno;
    return ok;
}

void ft_stats_tick(const char *engine, int force)
{
    static uint64_t next_ms;
    struct timespec now;
    uint64_t millis;
    int fd, saved_errno = errno;
    const char *enabled = getenv("FAKETRAFFIC_STATS");
    if (!enabled || strcmp(enabled, "1")) return;
    if (clock_gettime(CLOCK_MONOTONIC, &now)) goto done;
    millis = (uint64_t) now.tv_sec * 1000 + (unsigned long) now.tv_nsec / 1000000;
    if (!force && millis < next_ms) goto done;
    next_ms = millis + 5000;
    fd = open("/var/run/faketraffic", O_DIRECTORY | O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) { FT_COUNT(FT_EXPORT_ERRORS); goto done; }
    (void) ft_stats_snapshot(fd, engine);
    close(fd);
done:
    errno = saved_errno;
}
