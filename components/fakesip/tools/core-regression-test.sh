#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
WORK_DIR=${WORK_DIR:-/tmp/fakesip-core-regression}
CC=${CC:-gcc}
CFLAGS=${CFLAGS:--std=c99 -pedantic -Wall -Wextra -Werror}
SKIP_CLI_TESTS=${SKIP_CLI_TESTS:-0}

mkdir -p "$WORK_DIR"

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

build_test() {
    name=$1
    shift
    "$CC" $CFLAGS -I"$ROOT_DIR/include" "$ROOT_DIR/tests/$name.c" "$@" \
        -o "$WORK_DIR/$name"
    "$WORK_DIR/$name"
}

build_test test_payload \
    "$ROOT_DIR/src/payload.c" "$ROOT_DIR/src/globvar.c" \
    "$ROOT_DIR/src/logging.c"
build_test test_srcinfo \
    "$ROOT_DIR/src/srcinfo.c" "$ROOT_DIR/src/globvar.c" \
    "$ROOT_DIR/src/logging.c"
build_test test_process \
    "$ROOT_DIR/src/process.c" "$ROOT_DIR/src/globvar.c" \
    "$ROOT_DIR/src/logging.c"
build_test test_logging \
    "$ROOT_DIR/src/globvar.c"
build_test test_nfrules \
    "$ROOT_DIR/src/nfrules.c" "$ROOT_DIR/src/globvar.c" \
    "$ROOT_DIR/src/logging.c"

if [ "$(uname -s)" = Linux ]; then
    build_test test_ipv6_options \
        "$ROOT_DIR/src/ipv6pkt.c" "$ROOT_DIR/src/globvar.c" \
        "$ROOT_DIR/src/logging.c" -lnetfilter_queue -lnfnetlink -lmnl

    build_test test_packets \
        "$ROOT_DIR/src/ipv4pkt.c" "$ROOT_DIR/src/ipv6pkt.c" \
        "$ROOT_DIR/src/globvar.c" "$ROOT_DIR/src/logging.c" \
        -lnetfilter_queue -lnfnetlink -lmnl

    "$CC" $CFLAGS -ffunction-sections -fdata-sections \
        -I"$ROOT_DIR/include" "$ROOT_DIR/tests/test_rawsend.c" \
        "$ROOT_DIR/src/globvar.c" "$ROOT_DIR/src/logging.c" \
        -Wl,--gc-sections -lnetfilter_queue -lnfnetlink -lmnl \
        -o "$WORK_DIR/test_rawsend"
    "$WORK_DIR/test_rawsend"

    "$CC" $CFLAGS -ffunction-sections -fdata-sections \
        -I"$ROOT_DIR/include" "$ROOT_DIR/tests/test_nfqueue.c" \
        "$ROOT_DIR/src/globvar.c" "$ROOT_DIR/src/logging.c" \
        -Wl,--gc-sections -lnetfilter_queue -lnfnetlink -lmnl \
        -o "$WORK_DIR/test_nfqueue"
    "$WORK_DIR/test_nfqueue"
fi

FAKESIP=${FAKESIP:-$ROOT_DIR/build/fakesip}
case "$SKIP_CLI_TESTS" in
    0) [ -x "$FAKESIP" ] ||
        fail "FakeSIP binary is missing: $FAKESIP (build it first or set SKIP_CLI_TESTS=1)" ;;
    1)
        printf 'Core unit regression tests passed; CLI parser tests explicitly skipped.\n'
        exit 0
        ;;
    *) fail "SKIP_CLI_TESTS must be 0 or 1" ;;
esac

if [ -x "$FAKESIP" ]; then
    assert_invalid() {
        set +e
        output=$($FAKESIP -a -f "$@" 2>&1)
        status=$?
        set -e
        [ "$status" -ne 0 ] || {
            printf 'FAIL: accepted invalid option: %s\n' "$*" >&2
            exit 1
        }
        case $output in
            *"invalid value"*) ;;
            *)
                printf 'FAIL: wrong error for invalid option %s: %s\n' \
                    "$*" "$output" >&2
                exit 1
                ;;
        esac
    }

    assert_invalid -m 123junk
    assert_invalid -m 18446744073709551616
    assert_invalid -n 65536
    assert_invalid -r -1
    assert_invalid -t +3
    assert_invalid -x 0x10000junk
    assert_invalid -y " 50"

    set +e
    output=$($FAKESIP -a -f -n 018 -m invalid 2>&1)
    status=$?
    set -e
    [ "$status" -ne 0 ] || {
        printf 'FAIL: decimal leading-zero queue test unexpectedly started\n' >&2
        exit 1
    }
    case $output in
        *"invalid value for -m"*) ;;
        *)
            printf 'FAIL: leading-zero decimal was not fully parsed: %s\n' \
                "$output" >&2
            exit 1
            ;;
    esac
fi

printf 'Core regression tests passed.\n'
