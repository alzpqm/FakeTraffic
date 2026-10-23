#!/bin/sh
# rc.common does not enable errexit; several optional append helpers return 1
# when an option is disabled, so the harness must preserve that behavior.
set -u

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
INIT_SCRIPT="$ROOT_DIR/openwrt/fakesip/files/fakesip.init"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/fakesip-init-test.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT HUP INT TERM

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

assert_eq() {
	expected="$1"
	actual="$2"
	message="$3"
	[ "$actual" = "$expected" ] ||
		fail "$message (expected '$expected', got '$actual')"
}

assert_contains() {
	haystack="$1"
	needle="$2"
	message="$3"
	case "$haystack" in
		*"$needle"*) ;;
		*) fail "$message (missing '$needle')" ;;
	esac
}

config_get() {
	_dest="$1"
	_option="$3"
	eval "_value=\${CFG_${_option}-}"
	eval "$_dest=\"\$_value\""
}

config_get_bool() {
	_dest="$1"
	_default="$4"
	config_get "$_dest" "$2" "$3"
	eval "_value=\${$_dest}"
	[ -n "$_value" ] || eval "$_dest=\$_default"
}

config_list_foreach() {
	_option="$2"
	_callback="$3"
	shift 3
	eval "_values=\${CFG_${_option}-}"
	for _value in $_values; do
		"$_callback" "$_value" "$@"
	done
}

network_get_device() {
	_dest="$1"
	_network="$2"
	eval "_device=\${NET_${_network}-}"
	[ -n "$_device" ] || return 1
	eval "$_dest=\"\$_device\""
}

logger() {
	shift 2
	LOG_MESSAGES="${LOG_MESSAGES}${LOG_MESSAGES:+\n}$*"
}

procd_open_instance() {
	PROCD_OPEN=$((PROCD_OPEN + 1))
	PROCD_SECTION="$1"
}

procd_set_param() {
	if [ "$1" = command ]; then
		PROCD_PROGRAM="$2"
	elif [ "$1" = term_timeout ]; then
		PROCD_TERM_TIMEOUT="$2"
	fi
}

procd_append_param() {
	[ "$1" = command ] || return 0
	shift
	while [ "$#" -gt 0 ]; do
		case "$1" in
				-i)
				[ "$#" -ge 2 ] || fail "-i is missing its interface"
				shift
					PROCD_IFACES="${PROCD_IFACES}${PROCD_IFACES:+ }$1"
					;;
				-u)
					[ "$#" -ge 2 ] || fail "-u is missing its SIP URI"
					shift
					PROCD_URIS="${PROCD_URIS}${PROCD_URIS:+ }$1"
					;;
			-a)
				PROCD_ALL=1
				;;
		esac
		shift
	done
}

procd_close_instance() {
	PROCD_CLOSE=$((PROCD_CLOSE + 1))
}

procd_add_interface_trigger() {
	PROCD_INTERFACE_TRIGGERS="${PROCD_INTERFACE_TRIGGERS}${PROCD_INTERFACE_TRIGGERS:+ }$2"
}

reset_case() {
	CFG_enabled=1
	CFG_all_interfaces=0
	CFG_interface_mode=
	CFG_network=
	CFG_interface=
	CFG_sip_profile=standard
	CFG_sip_uri=
	CFG_payload_file=
	CFG_inbound=
	CFG_outbound=
	CFG_ipv4=
	CFG_ipv6=
	CFG_no_hop_estimate=
	CFG_skip_firewall=
	CFG_use_iptables=
	CFG_silent=
	CFG_queue_num=
	CFG_fwmark=
	CFG_fwmask=
	CFG_repeat=
	CFG_ttl=
	CFG_dynamic_pct=
	CFG_log_file=
	NET_wan=
	NET_ghostnet0=
	PROCD_OPEN=0
	PROCD_CLOSE=0
	PROCD_SECTION=
	PROCD_PROGRAM=
	PROCD_TERM_TIMEOUT=
	PROCD_IFACES=
	PROCD_URIS=
	PROCD_ALL=0
	PROCD_INTERFACE_TRIGGERS=
	LOG_MESSAGES=
}

# The OpenWrt library imports are replaced by the mocks above.
sed '/^\. \/lib\/functions/d' "$INIT_SCRIPT" > "$TMP_DIR/fakesip.init"
. "$TMP_DIR/fakesip.init"

reset_case
CFG_enabled=0
CFG_interface=pppoe-disabled
start_instance main
assert_eq 0 "$PROCD_OPEN" "disabled sections must not open a procd instance"

reset_case
CFG_inbound=0
CFG_outbound=0
CFG_interface=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "an empty traffic direction pair must not start"
assert_contains "$LOG_MESSAGES" "has no enabled traffic direction" \
	"an empty traffic direction pair must be logged"

reset_case
CFG_ipv4=0
CFG_ipv6=0
CFG_interface=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "an empty IP family pair must not start"
assert_contains "$LOG_MESSAGES" "has no enabled IP family" \
	"an empty IP family pair must be logged"

reset_case
CFG_sip_profile=custom
CFG_interface=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "a custom profile without SIP URIs must not start"
assert_contains "$LOG_MESSAGES" "custom SIP profile has no URI" \
	"a custom profile without SIP URIs must be logged"

reset_case
CFG_sip_profile=china_typo
CFG_interface=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "an unknown SIP profile must not start"
assert_contains "$LOG_MESSAGES" "has unknown SIP profile 'china_typo'" \
	"an unknown SIP profile must be logged"

reset_case
CFG_sip_profile=custom
CFG_sip_uri=sip:user@example.com
CFG_interface=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "a populated custom SIP profile must start"
assert_eq sip:user@example.com "$PROCD_URIS" \
	"a custom SIP profile must append its configured URI"

reset_case
CFG_sip_profile=standard
CFG_sip_uri=sip:stale@example.com
CFG_interface=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "the standard SIP profile must start"
assert_eq "" "$PROCD_URIS" \
	"the standard SIP profile must ignore stale custom URIs"

reset_case
CFG_sip_profile=
CFG_sip_uri=sip:stale@example.com
CFG_interface=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "an empty SIP profile must use the standard behavior"
assert_eq "" "$PROCD_URIS" \
	"an empty SIP profile must ignore stale custom URIs"

reset_case
CFG_sip_profile=china_sip_observed
CFG_interface=pppoe-wan
start_instance main
assert_eq 'sip:user@sipcq16.xnq.r.10086.cn:5260 sip:user@sipsc109.r01.rcs.189.cn:5260' \
	"$PROCD_URIS" \
	"the observed carrier SIP profile must preserve rotation order"

reset_case
start_instance main
assert_eq 0 "$PROCD_OPEN" "an empty interface configuration must not start"
assert_contains "$LOG_MESSAGES" "has no network or interface" \
	"an empty interface configuration must be logged"

reset_case
CFG_network=ghostnet0
start_instance main
assert_eq 0 "$PROCD_OPEN" "unresolved logical networks must not start"
assert_contains "$LOG_MESSAGES" "network 'ghostnet0' has no active device" \
	"an unresolved logical network must be logged"
assert_contains "$LOG_MESSAGES" "has no usable interface" \
	"a section without resolved interfaces must be logged"

reset_case
CFG_network="wan ghostnet0"
CFG_interface="pppoe-manual pppoe-wan"
NET_wan=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "a resolved interface must start one instance"
assert_eq 1 "$PROCD_CLOSE" "a resolved interface must close one instance"
assert_eq main "$PROCD_SECTION" "the configured section name must be preserved"
assert_eq /usr/bin/fakesip "$PROCD_PROGRAM" "the instance must run FakeSIP"
assert_eq 15 "$PROCD_TERM_TIMEOUT" "the instance must allow bounded graceful cleanup"
assert_eq "pppoe-wan pppoe-manual" "$PROCD_IFACES" \
	"resolved and direct interfaces must be ordered and deduplicated"

reset_case
CFG_interface_mode=network
CFG_network=wan
CFG_interface=pppoe-manual
NET_wan=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "network mode must start with a resolved network"
assert_eq pppoe-wan "$PROCD_IFACES" \
	"network mode must ignore retained Linux devices"

reset_case
CFG_interface_mode=device
CFG_network=wan
CFG_interface=pppoe-manual
NET_wan=pppoe-wan
start_instance main
assert_eq 1 "$PROCD_OPEN" "device mode must start with a Linux device"
assert_eq pppoe-manual "$PROCD_IFACES" \
	"device mode must ignore retained OpenWrt networks"

reset_case
CFG_interface_mode=network
CFG_interface=pppoe-manual
start_instance main
assert_eq 0 "$PROCD_OPEN" "network mode without a network must not start"
assert_contains "$LOG_MESSAGES" "has no OpenWrt network" \
	"a missing OpenWrt network must be logged"

reset_case
CFG_interface_mode=device
CFG_network=wan
NET_wan=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "device mode without a device must not start"
assert_contains "$LOG_MESSAGES" "has no Linux device" \
	"a missing Linux device must be logged"

reset_case
CFG_interface_mode=invalid
CFG_network=wan
CFG_interface=pppoe-manual
NET_wan=pppoe-wan
start_instance main
assert_eq 0 "$PROCD_OPEN" "an invalid interface mode must not start"
assert_contains "$LOG_MESSAGES" "has invalid interface mode 'invalid'" \
	"an invalid interface mode must be logged"

reset_case
CFG_interface="pppoe-future pppoe-future"
start_instance main
assert_eq 1 "$PROCD_OPEN" "direct PPP names must be accepted before they exist"
assert_eq pppoe-future "$PROCD_IFACES" "direct interface names must be deduplicated"

reset_case
CFG_interface_mode=network
CFG_network="wan wan2"
add_instance_triggers main
assert_eq "wan wan2" "$PROCD_INTERFACE_TRIGGERS" \
	"network mode must register logical-network reconnect triggers"

reset_case
CFG_interface_mode=device
CFG_network=wan
CFG_interface=pppoe-wan
add_instance_triggers main
assert_eq "" "$PROCD_INTERFACE_TRIGGERS" \
	"device mode must not register triggers for retained networks"

reset_case
CFG_network=wan
CFG_interface=pppoe-manual
add_instance_triggers main
assert_eq wan "$PROCD_INTERFACE_TRIGGERS" \
	"legacy mixed mode must retain logical-network reconnect triggers"

reset_case
CFG_interface=bad/name
start_instance main
assert_eq 0 "$PROCD_OPEN" "invalid direct interface names must not start"
assert_contains "$LOG_MESSAGES" "invalid interface 'bad/name'" \
	"invalid direct interface names must be logged"

reset_case
CFG_interface=abcdefghijklmnop
start_instance main
assert_eq 0 "$PROCD_OPEN" "16-byte direct interface names must not start"
assert_contains "$LOG_MESSAGES" "invalid interface 'abcdefghijklmnop'" \
	"overlong direct interface names must be logged"

reset_case
CFG_interface=abcdefghijklmno
start_instance main
assert_eq 1 "$PROCD_OPEN" "15-byte direct interface names must remain valid"
assert_eq abcdefghijklmno "$PROCD_IFACES" \
	"the maximum valid interface name must be preserved"

reset_case
CFG_all_interfaces=1
start_instance main
assert_eq 1 "$PROCD_OPEN" "all-interfaces mode must start without interface lists"
assert_eq 1 "$PROCD_ALL" "all-interfaces mode must append -a"
assert_eq "" "$PROCD_IFACES" "all-interfaces mode must not append -i"

printf 'OpenWrt init behavior tests passed.\n'
