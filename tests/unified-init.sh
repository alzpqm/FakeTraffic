#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Stub-only: no root, network, production processes or firewall operations.
set -u
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/faketraffic-init-test.XXXXXX)
trap 'rm -f "$WORK/init"; rmdir "$WORK"' EXIT HUP INT TERM
sed '/^\. \/lib\//d' "$ROOT/openwrt/faketraffic/files/etc/init.d/faketraffic" > "$WORK/init"
. "$WORK/init"
fail() { echo "FAIL: $*" >&2; exit 1; }
config_get() {
    _target=$1 _section=$2 _option=$3 _fallback=${4:-}
    case "$_section.$_option" in
      globals.enabled) _value=$TCP_ENABLED;; main.enabled) _value=$UDP_ENABLED;;
      main.interface_mode) _value=network;; main.sip_profile) _value=china_all;;
      main.network|globals.interface) _value=wan;; main.queue_num) _value=$UDP_QUEUE;;
      *) _value=$_fallback;;
    esac
    eval "$_target=\$_value"
}
config_get_bool() { config_get "$@"; }
config_list_foreach() {
    case "$1.$2" in globals.interface|main.network) "$3" wan;; esac
    return 0
}
config_foreach() { return 0; }
config_load() { [ "$1" = faketraffic ] || fail 'Wrong config'; }
network_get_device() { eval "$1=pppoe-test"; }
network_flush_cache() { return 0; }
logger() { return 0; }
procd_open_instance() { INSTANCES="$INSTANCES $1"; }
procd_set_param() { [ "$1" != command ] || PROGRAMS="$PROGRAMS $2"; return 0; }
procd_append_param() { return 0; }
procd_close_instance() { return 0; }
procd_add_reload_trigger() { [ "$1" = faketraffic ] || fail 'Wrong reload'; }
procd_add_interface_trigger() { [ "$3" = /etc/init.d/faketraffic ] || fail 'Legacy network trigger'; }
legacy_active() { [ "$LEGACY" = 1 ]; }
UDP_QUEUE=513
for pair in 00 10 01 11; do
    TCP_ENABLED=$(printf '%s' "$pair" | cut -c1)
    UDP_ENABLED=$(printf '%s' "$pair" | cut -c2)
    INSTANCES= PROGRAMS= LEGACY=0
    start_service || fail "start $pair"
    case "$pair" in
      00) expected='';; 10) expected=' tcp';; 01) expected=' udp';; 11) expected=' tcp udp';;
    esac
    [ "$INSTANCES" = "$expected" ] || fail "Instances $pair: $INSTANCES"
    case "$PROGRAMS" in *'/usr/bin/'*) fail 'Legacy binary path';; esac
done
UDP_QUEUE=512 TCP_ENABLED=1 UDP_ENABLED=1 INSTANCES= PROGRAMS=
start_service && fail 'Must refuse colliding queues'
[ -z "$INSTANCES" ] || fail 'Started with a queue collision'
UDP_QUEUE=513
LEGACY=1 INSTANCES= PROGRAMS=
start_service && fail 'Must refuse legacy ownership'
[ -z "$INSTANCES" ] || fail 'Started beside legacy owner'
service_triggers || fail 'Network/config triggers'
ubus() { [ "$READY_MODE" != bus_error ] || return 1; printf '{}'; }
jsonfilter() {
    [ "$READY_MODE" != missing ] || return 0
    case "$2" in *.udp.pid) return 0;; *) printf '411\n';; esac
}
readlink() {
    if [ "$READY_MODE" = pre_exec ]; then printf '/sbin/procd\n'; else printf '/usr/libexec/faketraffic/fakehttp\n'; fi
}
awk() {
    case "$1" in
      *SigCgt*) if [ "$READY_MODE" = no_handler ]; then printf '0000000000000000\n'; else printf '0000000000004002\n'; fi;;
      *SigBlk*) if [ "$READY_MODE" = blocked ]; then printf '0000000000004000\n'; else printf '0000000000000000\n'; fi;;
    esac
}
sleep() { return 0; }
for READY_MODE in pre_exec no_handler blocked bus_error; do
    wait_instance_ready && fail "Readiness accepted $READY_MODE"
done
READY_MODE=ready
wait_instance_ready || fail 'Stable engine rejected'
READY_MODE=missing TCP_ENABLED=1 UDP_ENABLED=0
wait_instance_ready faketraffic 1 && fail 'Missing enabled engine accepted'
TCP_ENABLED=0 UDP_ENABLED=0
wait_instance_ready faketraffic 1 || fail 'Disabled engines rejected'
echo 'Unified init: enable combinations, queue collision, legacy refusal, triggers and seven readiness cases passed'
