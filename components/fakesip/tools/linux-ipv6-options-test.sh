#!/usr/bin/env bash
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo 'Requires root for private namespaces'; exit 1; }
export FS_AUDIT_BINARY
FS_AUDIT_BINARY=$(realpath "$1")
export FS_AUDIT_EXPERIMENT
FS_AUDIT_EXPERIMENT=$(cd -- "$(dirname -- "$0")/../tests" && pwd)
# Variables in this script body expand in the new namespace's shell.
# shellcheck disable=SC2016
timeout --kill-after=3 35 unshare -n bash -eu -o pipefail -c '
    ip link set lo up
    unshare -n sleep 32 &
    peer_pid=$!
    cleanup() { kill "$peer_pid" 2>/dev/null || true; wait "$peer_pid" 2>/dev/null || true; }
    trap cleanup EXIT
    for attempt in {1..100}; do
        [ "$(readlink /proc/$peer_pid/ns/net)" != "$(readlink /proc/self/ns/net)" ] && break
        sleep 0.01
    done
    ip link add fs-audit type veth peer name fs-peer
    ip link set fs-peer netns "$peer_pid"
    ip link set fs-audit up
    ip -6 addr add 2001:db8::1/64 dev fs-audit nodad
    nsenter -t "$peer_pid" -n ip link set lo up
    nsenter -t "$peer_pid" -n ip link set fs-peer up
    nsenter -t "$peer_pid" -n ip -6 addr add 2001:db8::2/64 dev fs-peer nodad
    export FS_AUDIT_ISOLATED=1 FS_AUDIT_PEER="$peer_pid"
    python3 "$FS_AUDIT_EXPERIMENT/test_ipv6_options.py" "$FS_AUDIT_BINARY"
'
