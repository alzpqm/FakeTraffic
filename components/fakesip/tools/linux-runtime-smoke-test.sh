#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
FAKESIP=${FAKESIP:-$ROOT_DIR/build/fakesip}

if [ "$(uname -s)" != Linux ] || [ "$(id -u)" -ne 0 ]; then
    echo 'FAIL: this test requires Linux and root' >&2
    exit 1
fi
for tool in unshare nsenter ip node timeout; do
    command -v "$tool" >/dev/null || exit 1
done
[ -x "$FAKESIP" ] || { echo "FAIL: missing binary: $FAKESIP" >&2; exit 1; }

# All addresses, firewall rules, queues and sysctls belong to this namespace.
export FAKESIP ROOT_DIR
# Variables are intentionally expanded by the shell inside the namespace.
# shellcheck disable=SC2016
timeout --kill-after=5 40 unshare -n bash -eu -o pipefail -c '
    ip link set lo up
    unshare -n sleep 35 &
    peer_pid=$!
    cleanup() { kill "$peer_pid" 2>/dev/null || true; }
    trap cleanup EXIT
    for attempt in {1..100}; do
        [ "$(readlink /proc/$peer_pid/ns/net)" != "$(readlink /proc/self/ns/net)" ] && break
        sleep 0.01
    done
    ip link add fs-test type veth peer name fs-peer
    ip link set fs-peer netns "$peer_pid"
    ip link set fs-test up
    ip addr add 198.51.100.1/24 dev fs-test
    ip -6 addr add 2001:db8::1/64 dev fs-test nodad
    nsenter -t "$peer_pid" -n ip link set lo up
    nsenter -t "$peer_pid" -n ip link set fs-peer up
    nsenter -t "$peer_pid" -n ip addr add 198.51.100.2/24 dev fs-peer
    nsenter -t "$peer_pid" -n ip -6 addr add 2001:db8::2/64 dev fs-peer nodad
    export FAKESIP_TEST_NETNS=1
    export FAKESIP_PEER_PID="$peer_pid"
    node "$ROOT_DIR/tests/test_runtime.js" "$FAKESIP"
'
