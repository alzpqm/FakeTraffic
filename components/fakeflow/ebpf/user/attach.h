/* SPDX-License-Identifier: GPL-2.0-only */
#ifndef FF_ATTACH_H
#define FF_ATTACH_H
#include "fakeflow.h"
#include <bpf/libbpf.h>
int ff_link(const char *name,unsigned mode,unsigned *index,unsigned *mtu);
int ff_command(const char *const argv[]);
int ff_tap(char *name,size_t cap);
int ff_tun(char *name,size_t cap);
#endif
