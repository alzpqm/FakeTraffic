/*
 * nfqueue.c - FakeSIP: https://github.com/MikeWang000000/FakeSIP
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
#include "nfqueue.h"

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <arpa/inet.h>
#include <net/ethernet.h>
#include <netinet/ip.h>
#include <netinet/udp.h>
#include <sys/socket.h>
#include <linux/if_packet.h>
#include <linux/netfilter.h>
#include <linux/netfilter/nfnetlink_queue.h>
#include <libnetfilter_queue/libnetfilter_queue.h>

#include "globvar.h"
#include "logging.h"
#include "rawsend.h"
#include "signals.h"

static int fd = -1;
static struct nfq_handle *h = NULL;
static struct nfq_q_handle *qh = NULL;

#define NFQ_MAX_PACKET_ERRORS 20U
#define NFQ_BACKOFF_MAX_MS    1000U
#define NFQ_POLL_TIMEOUT_MS   250

static int set_nonblocking(int socket_fd)
{
    int flags;

    flags = fcntl(socket_fd, F_GETFL, 0);
    if (flags < 0) {
        E("ERROR: fcntl(): F_GETFL: %s", strerror(errno));
        return -1;
    }

    if (!(flags & O_NONBLOCK) &&
        fcntl(socket_fd, F_SETFL, flags | O_NONBLOCK) < 0) {
        E("ERROR: fcntl(): F_SETFL: %s", strerror(errno));
        return -1;
    }

    return 0;
}

static void error_backoff(unsigned int error_count)
{
    unsigned int delay_ms, shift;
    struct timespec delay, remaining;

    shift = error_count > 7 ? 7 : error_count;
    delay_ms = 10U << shift;
    if (delay_ms > NFQ_BACKOFF_MAX_MS) {
        delay_ms = NFQ_BACKOFF_MAX_MS;
    }

    delay.tv_sec = delay_ms / 1000U;
    delay.tv_nsec = (long) (delay_ms % 1000U) * 1000000L;
    while (nanosleep(&delay, &remaining) < 0 && errno == EINTR &&
           !g_ctx.exit) {
        delay = remaining;
    }
}


static int copy_packet_hwaddr(struct sockaddr_ll *sll,
                              const struct nfqnl_msg_packet_hw *hwph)
{
    unsigned int hwaddr_len;

    if (!sll) {
        return -1;
    }

    sll->sll_halen = 0;
    memset(sll->sll_addr, 0, sizeof(sll->sll_addr));
    if (!hwph) {
        return 0;
    }

    hwaddr_len = ntohs(hwph->hw_addrlen);
    if (hwaddr_len > sizeof(sll->sll_addr)) {
        E("ERROR: invalid hardware address length: %u", hwaddr_len);
        return -1;
    }

    sll->sll_halen = (unsigned char) hwaddr_len;
    memcpy(sll->sll_addr, hwph->hw_addr, hwaddr_len);
    return 0;
}

static int callback(struct nfq_q_handle *qh, struct nfgenmsg *nfmsg,
                    struct nfq_data *nfa, void *data)
{
    uint32_t pkt_id, iifindex, oifindex;
    int verdict, pkt_len, modified;
    struct nfqnl_msg_packet_hdr *ph;
    unsigned char *pkt_data;
    struct nfqnl_msg_packet_hw *hwph;
    struct sockaddr_ll sll;

    (void) nfmsg;
    (void) data;

    ph = nfq_get_msg_packet_hdr(nfa);
    if (!ph) {
        EE("ERROR: nfq_get_msg_packet_hdr(): %s", "failure");
        return -1;
    }

    pkt_id = ntohl(ph->packet_id);

    iifindex = nfq_get_indev(nfa);
    oifindex = nfq_get_outdev(nfa);

    pkt_data = NULL;
    pkt_len = nfq_get_payload(nfa, &pkt_data);
    if (pkt_len < 0 || !pkt_data) {
        EE("ERROR: nfq_get_payload(): %s", "failure");
        goto ret_accept;
    }

    memset(&sll, 0, sizeof(sll));
    sll.sll_family = AF_PACKET;
    sll.sll_protocol = ph->hw_protocol;
    if (oifindex) {
        sll.sll_pkttype = PACKET_OUTGOING;
        sll.sll_ifindex = oifindex;
    } else if (iifindex) {
        sll.sll_pkttype = PACKET_HOST;
        sll.sll_ifindex = iifindex;
    } else {
        EE("ERROR: Failed to get interface index");
        goto ret_accept;
    }

    /* hwph can be null on PPP interfaces or POSTROUTING packets */
    hwph = nfq_get_packet_hw(nfa);
    if (copy_packet_hwaddr(&sll, hwph) < 0) {
        goto ret_accept;
    }

    verdict = fs_rawsend_handle(&sll, pkt_data, pkt_len, &modified);
    if (verdict < 0) {
        EE(T(fs_rawsend_handle));
        goto ret_accept;
    }

    if (modified && verdict != NF_DROP) {
        return nfq_set_verdict(qh, pkt_id, verdict, pkt_len, pkt_data);
    }

    return nfq_set_verdict(qh, pkt_id, verdict, 0, NULL);

ret_accept:
    return nfq_set_verdict(qh, pkt_id, NF_ACCEPT, 0, NULL);
}


int fs_nfq_setup(void)
{
    int res, opt;
    char *err_hint;
    socklen_t opt_len;

    h = nfq_open();
    if (!h) {
        switch (errno) {
            case EPERM:
                err_hint = " (Are you root?)";
                break;
            case EINVAL:
                err_hint = " (Missing kernel module?)";
                break;
            default:
                err_hint = "";
        }
        E("ERROR: nfq_open(): %s%s", strerror(errno), err_hint);
        return -1;
    }

    qh = nfq_create_queue(h, g_ctx.nfqnum, &callback, NULL);
    if (!qh) {
        switch (errno) {
            case EPERM:
                res = fs_kill_running(0);
                errno = EPERM;
                if (res < 0) {
                    err_hint = " (Another process is running / Are you root?)";
                } else {
                    err_hint = " (Another process is running)";
                }
                break;
            case EINVAL:
                err_hint = " (Missing kernel module?)";
                break;
            default:
                err_hint = "";
        }
        E("ERROR: nfq_create_queue(): %s%s", strerror(errno), err_hint);
        goto close_nfq;
    }

    res = nfq_set_mode(qh, NFQNL_COPY_PACKET, 0xffff);
    if (res < 0) {
        E("ERROR: nfq_set_mode(): NFQNL_COPY_PACKET: %s", strerror(errno));
        goto destroy_queue;
    }

    res = nfq_set_queue_flags(qh, NFQA_CFG_F_FAIL_OPEN, NFQA_CFG_F_FAIL_OPEN);
    if (res < 0) {
        E("ERROR: nfq_set_queue_flags(): NFQA_CFG_F_FAIL_OPEN: %s",
          strerror(errno));
        goto destroy_queue;
    }

    fd = nfq_fd(h);
    if (fd < 0) {
        E("ERROR: nfq_fd(): %s", "failure");
        goto destroy_queue;
    }

    if (set_nonblocking(fd) < 0) {
        goto destroy_queue;
    }

    opt_len = sizeof(opt);
    res = getsockopt(fd, SOL_SOCKET, SO_RCVBUF, &opt, &opt_len);
    if (res < 0) {
        E("ERROR: getsockopt(): SO_RCVBUF: %s", strerror(errno));
        goto destroy_queue;
    }

    if (opt < 1048576 /* 1 MB */) {
        opt = 1048576;
        res = setsockopt(fd, SOL_SOCKET, SO_RCVBUFFORCE, &opt, sizeof(opt));
        if (res < 0) {
            E("WARNING: setsockopt(): SO_RCVBUFFORCE: %s; trying SO_RCVBUF",
              strerror(errno));
            res = setsockopt(fd, SOL_SOCKET, SO_RCVBUF, &opt, sizeof(opt));
            if (res < 0) {
                E("ERROR: setsockopt(): SO_RCVBUF: %s", strerror(errno));
                goto destroy_queue;
            }
        }
    }

    return 0;

destroy_queue:
    nfq_destroy_queue(qh);
    qh = NULL;

close_nfq:
    nfq_close(h);
    h = NULL;
    fd = -1;

    return -1;
}


void fs_nfq_cleanup(void)
{
    if (qh) {
        nfq_destroy_queue(qh);
        qh = NULL;
    }

    if (h) {
        nfq_close(h);
        h = NULL;
        fd = -1;
    }
}


int fs_nfq_loop(void)
{
    static const size_t buffsize = UINT16_MAX + 4096U;

    int res, ret;
    unsigned int packet_err_cnt, transient_err_cnt;
    ssize_t recv_len;
    char *buff;
    struct pollfd poll_fd;

    buff = malloc(buffsize);
    if (!buff) {
        E("ERROR: malloc(): %s", strerror(errno));
        return -1;
    }

    packet_err_cnt = transient_err_cnt = 0;
    poll_fd.fd = fd;
    poll_fd.events = POLLIN;
    poll_fd.revents = 0;

    while (!g_ctx.exit) {
        poll_fd.revents = 0;
        res = poll(&poll_fd, 1, NFQ_POLL_TIMEOUT_MS);
        if (res < 0) {
            if (errno == EINTR) {
                continue;
            }
            E("ERROR: poll(): %s", strerror(errno));
            ret = -1;
            goto free_buff;
        }
        if (res == 0 || g_ctx.exit) {
            continue;
        }
        if (poll_fd.revents & POLLNVAL) {
            E("ERROR: poll(): %s", "invalid NFQUEUE socket");
            ret = -1;
            goto free_buff;
        }
        if (!(poll_fd.revents & (POLLIN | POLLERR | POLLHUP))) {
            continue;
        }

        recv_len = recv(fd, buff, buffsize, 0);
        if (recv_len < 0) {
            switch (errno) {
                case EINTR:
                    continue;
                case EAGAIN:
#if EWOULDBLOCK != EAGAIN
                case EWOULDBLOCK:
#endif
                case ETIMEDOUT:
                    transient_err_cnt++;
                    error_backoff(transient_err_cnt);
                    continue;
                case ENOBUFS:
                    transient_err_cnt++;
                    E("WARNING: recv(): %s; NFQUEUE remains active",
                      strerror(errno));
                    error_backoff(transient_err_cnt);
                    continue;
                default:
                    E("ERROR: recv(): %s", strerror(errno));
                    ret = -1;
                    goto free_buff;
            }
        }

        if (recv_len == 0) {
            E("ERROR: recv(): %s", "NFQUEUE socket closed");
            ret = -1;
            goto free_buff;
        }

        transient_err_cnt = 0;
        res = nfq_handle_packet(h, buff, recv_len);
        if (res < 0) {
            packet_err_cnt++;
            E("ERROR: nfq_handle_packet(): failure (%u/%u)", packet_err_cnt,
              NFQ_MAX_PACKET_ERRORS);
            if (packet_err_cnt >= NFQ_MAX_PACKET_ERRORS) {
                E("too many consecutive packet handling errors, exiting...");
                ret = -1;
                goto free_buff;
            }
            error_backoff(packet_err_cnt);
            continue;
        }

        packet_err_cnt = 0;
    }

    ret = 0;

free_buff:
    free(buff);

    return ret;
}
