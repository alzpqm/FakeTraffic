#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Anonymous stub-only inputs. No real UCI/network/engine execution.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
. "$ROOT/openwrt/faketraffic/files/usr/libexec/faketraffic/preflight-core.sh"
config_get() {
    _target=$1 _key=$2.$3 _value=${4:-}
    case "$_key" in
      globals.backend) _value=$BACKEND;; globals.accept_ebpf_semantics) _value=$ACK;;
      globals.enabled) _value=$TCP;; main.enabled) _value=$UDP;;
      advanced.ttl) _value=$TCP_TTL;; main.ttl) _value=$UDP_TTL;;
      advanced.repeat) _value=$TCP_REPEAT;; main.repeat) _value=$UDP_REPEAT;;
      advanced.disable_estimation|main.no_hop_estimate) _value=1;;
      main.ipv6) _value=$IPV6;; main.all_interfaces) _value=$ALL;;
      main.interface_mode) _value=network;; main.sip_profile) _value=$PROFILE;;
      main.fwmark) _value=$MARK;;
      p*.type) _value=$KIND;; p*.enabled) _value=1;;
      p*.payload) _value=$HOST;;
    esac
    eval "$_target=\$_value"
}
config_get_bool() { config_get "$@"; }
config_list_foreach() {
    case "$1.$2" in
      globals.interface) "$3" wan0;; main.network) "$3" wan;;
      advanced.bypass_port) [ "$PORT" = 0 ] || "$3" 443;;
      main.sip_uri) i=0; while [ "$i" -lt "$URIS" ]; do "$3" "$URI"; i=$((i + 1)); done;;
      main.payload_file) [ -z "$FILE" ] || "$3" "$FILE";;
    esac
    return 0
}
config_foreach() { i=0; while [ "$i" -lt "$PAYLOADS" ]; do "$1" "p$i"; i=$((i + 1)); done; return 0; }
network_get_device() { eval "$1=\$DEVICE"; }
ft_environment() { ft_warning LOAD_ATTACH_NOT_TESTED; }
reset() {
    BACKEND=ebpf ACK=1 TCP=1 UDP=1 TCP_TTL=3 UDP_TTL=3 TCP_REPEAT=1 UDP_REPEAT=1
    IPV6=1 ALL=0 PROFILE=standard MARK=0x10000 HOST=www.example.com PORT=0
    URI=sip:test@example.com PAYLOADS=1 URIS=1 DEVICE=wan0 KIND=http FILE=
}
passed=0
accept() { ft_preflight; [ -z "$ft_errors" ] || { echo "FAIL accepted fixture: $ft_errors"; exit 1; }; passed=$((passed + 1)); }
reject() {
    ft_preflight
    case ",$ft_errors," in *"\"$1\""*) ;; *) echo "FAIL missing blocker $1: $ft_errors"; exit 1;; esac
    [ "$ft_compatible" = false ]
    passed=$((passed + 1))
}
reset; accept
reset; ACK=0; reject EXPLICIT_SEMANTICS_ACCEPTANCE_REQUIRED
reset; TCP_REPEAT=9 UDP_REPEAT=9; reject REPEAT_RANGE_UNSUPPORTED
reset; TCP_REPEAT=2; reject DIFFERENT_PROTOCOL_INJECTION_SETTINGS
reset; UDP_TTL=4; reject DIFFERENT_PROTOCOL_INJECTION_SETTINGS
reset; PAYLOADS=2; accept; [ "$ft_tcp_payload_count" = 2 ]
rendered=$(ft_render); [ "$(printf '%s' "$rendered" | grep -c '^\[\[tcp.templates\]\]')" = 2 ]
reset; PAYLOADS=16; accept
reset; PAYLOADS=17; reject TCP_TEMPLATE_LIMIT_EXCEEDED
reset; PAYLOADS=0; reject TCP_TEMPLATE_REQUIRED
reset; MARK=65537; reject CUSTOM_MARK_POLICY_UNSUPPORTED
reset; PORT=1; reject TCP_PORT_BYPASS_UNSUPPORTED
reset; IPV6=0; reject IP_FAMILY_SELECTION_UNSUPPORTED
reset; DEVICE=wan1; reject DIFFERENT_PROTOCOL_DEVICES
reset; ALL=1; reject ALL_INTERFACES_UNSUPPORTED
reset; PROFILE=china_all; accept; [ "$ft_udp_payload_count" = 3 ]
reset; PROFILE=china_sip_observed; accept; [ "$ft_udp_payload_count" = 2 ]
reset; PROFILE=unknown; reject UNSUPPORTED_SIP_PROFILE
reset; HOST='invalid"host'; reject INVALID_HOSTNAME
reset; PROFILE=custom URI='sip:bad"@example.com'; reject INVALID_SIP_URI
reset; BACKEND='arbitrary'; reject INVALID_BACKEND
reset; TCP=0 UDP=0; reject NOTHING_ENABLED
reset; TCP=0; accept
reset; UDP=0; accept
reset; PROFILE=custom; accept
reset; PROFILE=custom URIS=16; accept
reset; PROFILE=custom URIS=17; reject UDP_TEMPLATE_LIMIT_EXCEEDED
reset; PROFILE=custom URIS=0; reject UDP_TEMPLATE_REQUIRED
reset; PROFILE=custom URI=sip:; reject INVALID_SIP_URI
fixture=$(mktemp)
trap 'rm -f "$fixture"' EXIT HUP INT TERM
printf '\000binary' > "$fixture"
reset; KIND=binary HOST="$fixture" PROFILE=china_all FILE="$fixture"; accept
[ "$ft_tcp_payload_count:$ft_udp_payload_count" = 1:4 ]
reset; KIND=binary HOST=/nonexistent-anonymous-payload; reject PAYLOAD_FILE_UNAVAILABLE
reset; FILE=/nonexistent-anonymous-payload; reject PAYLOAD_FILE_UNAVAILABLE
printf 'Preflight: %s positive/negative stub cases passed; no native load/attach tested\n' "$passed"
