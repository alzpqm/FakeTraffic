/* SPDX-License-Identifier: GPL-3.0-or-later */
#ifndef FAKETRAFFIC_TELEMETRY_H
#define FAKETRAFFIC_TELEMETRY_H
#include <stdint.h>
#include <stddef.h>
#include <sys/types.h>
enum ft_counter {
    FT_QUEUED, FT_METADATA_ERRORS, FT_ENGINE_ERRORS, FT_VERDICT_ERRORS,
    FT_RECEIVE_ERRORS, FT_HANDLE_ERRORS, FT_FAKE_BUILD_ERRORS,
    FT_FAKE_SEND_ATTEMPTS, FT_FAKE_SEND_ACCEPTED, FT_FAKE_SEND_ERRORS,
    FT_FAKE_SEND_SHORT, FT_FAKE_BYTES_ACCEPTED,
    FT_ORIGINAL_SEND_ATTEMPTS, FT_ORIGINAL_SEND_ACCEPTED,
    FT_ORIGINAL_SEND_ERRORS, FT_ORIGINAL_SEND_SHORT,
    FT_SKIP_DIRECTION, FT_SKIP_HOP, FT_SKIP_SOURCE, FT_EXPORT_ERRORS,
    FT_COUNTER_MAX
};
void ft_stats_add(enum ft_counter id, uint64_t value);
void ft_stats_send(int original, ssize_t result, size_t expected);
void ft_stats_queue(uint32_t queue);
void ft_stats_tick(const char *engine, int force);
/* Also used by isolated tests. Only a private directory fd is accepted. */
int ft_stats_snapshot(int directory_fd, const char *engine);
#define FT_COUNT(id) ft_stats_add((id), 1)
#endif
