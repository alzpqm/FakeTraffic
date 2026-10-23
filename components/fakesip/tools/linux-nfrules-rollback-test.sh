#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
FAKESIP=${FAKESIP:-$ROOT_DIR/build/fakesip}
BACKEND=${1:-nft}
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fakesip-nfrules.XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT HUP INT TERM

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

[ "$(uname -s)" = Linux ] || fail "this test requires Linux"
[ "$(id -u)" -eq 0 ] || fail "this test requires root"
[ -x "$FAKESIP" ] || fail "FakeSIP binary is missing: $FAKESIP"
command -v unshare >/dev/null 2>&1 || fail "unshare is unavailable"
command -v timeout >/dev/null 2>&1 || fail "timeout is unavailable"

case "$BACKEND" in
    nft)
        REAL_NFT=$(command -v nft) || fail "nft is unavailable"
        cat >"$WORK_DIR/nft" <<'WRAPPER'
#!/bin/sh
case " $* " in
    *" insert rule ip6 fakesip "*)
        echo "INJECT_NFT6_PARTIAL_FAILURE" >>"$INJECT_LOG"
        exit 97
        ;;
esac

if [ "${1-}" = -f ] && [ "${2-}" = - ]; then
    input=$(cat)
    printf '%s\n' "$input" | "$REAL_NFT" -f -
else
    exec "$REAL_NFT" "$@"
fi
WRAPPER
        chmod +x "$WORK_DIR/nft"
        : >"$WORK_DIR/injected.log"

        export FAKESIP WORK_DIR REAL_NFT
        unshare -n bash -eu -o pipefail -c '
            set +e
            PATH="$WORK_DIR:$PATH" INJECT_LOG="$WORK_DIR/injected.log" \
                timeout 10 "$FAKESIP" -a -1 -4 -6 -n 6513 -s \
                >"$WORK_DIR/fakesip.log" 2>&1
            rc=$?
            set -e
            [ "$rc" -ne 0 ] || exit 10
            grep -q INJECT_NFT6_PARTIAL_FAILURE "$WORK_DIR/injected.log" || exit 11
            ! "$REAL_NFT" list table ip fakesip >/dev/null 2>&1 || exit 12
            ! "$REAL_NFT" list table ip6 fakesip >/dev/null 2>&1 || exit 13
        ' || {
            cat "$WORK_DIR/fakesip.log" >&2 2>/dev/null || true
            fail "nft rollback integration failed"
        }
        ;;

    iptables)
        REAL_IPTABLES=$(command -v iptables) || fail "iptables is unavailable"
        REAL_IP6TABLES=$(command -v ip6tables) || fail "ip6tables is unavailable"
        cat >"$WORK_DIR/ip6tables" <<'WRAPPER'
#!/bin/sh
case " $* " in
    *" -A FAKESIP_R "*" --queue-num "*)
        echo "INJECT_IPT6_PARTIAL_FAILURE" >>"$INJECT_LOG"
        exit 97
        ;;
esac
exec "$REAL_IP6TABLES" "$@"
WRAPPER
        chmod +x "$WORK_DIR/ip6tables"
        : >"$WORK_DIR/injected.log"

        export FAKESIP WORK_DIR REAL_IPTABLES REAL_IP6TABLES
        unshare -n bash -eu -o pipefail -c '
            set +e
            PATH="$WORK_DIR:$PATH" INJECT_LOG="$WORK_DIR/injected.log" \
                timeout 10 "$FAKESIP" -a -1 -4 -6 -z -n 6513 -s \
                >"$WORK_DIR/fakesip.log" 2>&1
            rc=$?
            set -e
            [ "$rc" -ne 0 ] || exit 20
            grep -q INJECT_IPT6_PARTIAL_FAILURE "$WORK_DIR/injected.log" || exit 21
            ! "$REAL_IPTABLES" -w -t mangle -S 2>/dev/null | grep -q FAKESIP || exit 22
            ! "$REAL_IP6TABLES" -w -t mangle -S 2>/dev/null | grep -q FAKESIP || exit 23
        ' || {
            cat "$WORK_DIR/fakesip.log" >&2 2>/dev/null || true
            fail "iptables rollback integration failed"
        }
        ;;

    *)
        fail "unknown backend '$BACKEND' (expected nft or iptables)"
        ;;
esac

printf '%s rollback integration passed.\n' "$BACKEND"
