#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
WORK_DIR="${WORK_DIR:-/tmp/fakesip-smoke}"
LOG="$WORK_DIR/smoke.log"

mkdir -p "$WORK_DIR"
: >"$LOG"

run() {
    echo "\$ $*" | tee -a "$LOG"
    "$@" 2>&1 | tee -a "$LOG"
    local rc=${PIPESTATUS[0]}
    echo "[exit $rc]" | tee -a "$LOG"
    return "$rc"
}

section() {
    printf '\n## %s\n' "$*" | tee -a "$LOG"
}

section "Host"
run uname -a
if [ -r /etc/os-release ]; then
    run sed -n '1,8p' /etc/os-release
fi

section "Tooling"
for tool in gcc make nft iptables ip6tables tcpdump; do
    if command -v "$tool" >/dev/null 2>&1; then
        run "$tool" --version
    else
        echo "missing: $tool" | tee -a "$LOG"
    fi
done

section "Build"
run make -C "$ROOT_DIR" clean
run make -C "$ROOT_DIR" DEBUG=1

section "Core Regression Tests"
run "$ROOT_DIR/tools/core-regression-test.sh"

section "Static Bug Probes"
awk '
    /udph->len = htons\(udp_payload_size\)/ {
        print "BUG: IPv4 UDP length excludes UDP header at " FILENAME ":" FNR
    }
    /udph->len = udp_payload_size/ {
        print "BUG: IPv6 UDP length excludes UDP header and lacks htons at " FILENAME ":" FNR
    }
    /fs_execute_command\(nft_cmd, 0, nft_conf_buff\);/ {
        count[FILENAME]++
        if (count[FILENAME] > 1) {
            print "BUG: repeated nft ruleset apply at " FILENAME ":" FNR
        }
    }
    FILENAME ~ /ipv6ipt\.c$/ && /"iptables"/ {
        print "BUG: IPv6 iptables setup invokes IPv4 iptables at " FILENAME ":" FNR
    }
    FILENAME ~ /ipv6ipt\.c$/ && /"--icmp-type"/ {
        print "BUG: IPv6 iptables setup uses IPv4 ICMP matcher at " FILENAME ":" FNR
    }
' "$ROOT_DIR"/src/ipv4pkt.c "$ROOT_DIR"/src/ipv6pkt.c \
   "$ROOT_DIR"/src/ipv6nft.c "$ROOT_DIR"/src/ipv6ipt.c | tee -a "$LOG"

section "nft Tagged ICMP Syntax Probe"
if command -v nft >/dev/null 2>&1; then
    NFT_PROBE="$WORK_DIR/fakesip-tagged-icmp.nft"
    cat >"$NFT_PROBE" <<'NFT'
table ip fakesip_probe {
    chain fs_prerouting {
        type filter hook prerouting priority mangle - 5;
        policy accept;
        icmp type time-exceeded @th,96,16 0x4653 counter drop;
    }
}
NFT
    run nft -c -f "$NFT_PROBE"
    cat >"$NFT_PROBE" <<'NFT'
table ip6 fakesip_probe {
    chain fs_prerouting {
        type filter hook prerouting priority mangle - 5;
        policy accept;
        icmpv6 type time-exceeded @th,64,32 0x60046553 counter drop;
    }
}
NFT
    run nft -c -f "$NFT_PROBE"
else
    echo "skip: nft not installed" | tee -a "$LOG"
fi

section "Summary"
echo "Log written to $LOG"
