# SPDX-License-Identifier: GPL-3.0-or-later
# Fixed-schema checks. No packet, module, route, firewall or configuration writes.
ft_error() { case ",$ft_errors," in *"\"$1\""*) ;; *) ft_errors="${ft_errors:+$ft_errors,}\"$1\"";; esac; }
ft_warning() { case ",$ft_warnings," in *"\"$1\""*) ;; *) ft_warnings="${ft_warnings:+$ft_warnings,}\"$1\"";; esac; }
ft_uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 9 ] && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }
ft_path() { case "$1" in /*) ;; *) return 1;; esac; case "$1" in *[!A-Za-z0-9_./:@%+=-]*) return 1;; esac; [ "${#1}" -le 1023 ]; }
ft_device() { case "$1" in ''|*[!A-Za-z0-9_.-]*) return 1;; esac; [ "${#1}" -le 15 ]; }
ft_add_device() {
    ft_device "$1" || { ft_error INVALID_DEVICE; return; }
    case " $ft_devices " in *" $1 "*) ;; *) ft_devices="${ft_devices:+$ft_devices }$1"; ft_device_count=$((ft_device_count + 1));; esac
}
ft_network() {
    local device
    case "$1" in ''|*[!A-Za-z0-9_.-]*) ft_error INVALID_NETWORK; return;; esac
    network_get_device device "$1" || { ft_error NETWORK_UNRESOLVED; return; }
    ft_add_device "$device"
}
ft_tcp_payload() {
    local enabled kind value
    config_get_bool enabled "$1" enabled 1
    [ "$enabled" = 1 ] || return
    ft_tcp_payload_count=$((ft_tcp_payload_count + 1))
    [ "$ft_tcp_payload_count" -le 16 ] || { ft_error TCP_TEMPLATE_LIMIT_EXCEEDED; return; }
    config_get kind "$1" type http
    config_get value "$1" payload
    case "$kind" in
        binary)
            ft_path "$value" || { ft_error INVALID_PAYLOAD_PATH; return; }
            ft_payload_file_check "$value"
            ft_tcp_templates="$ft_tcp_templates
[[tcp.templates]]
payload = \"custom\"
payload_file = \"$value\"
";;
        http|https)
            case "$value" in ''|*[!A-Za-z0-9.-]*) ft_error INVALID_HOSTNAME;; esac
            [ "${#value}" -le 253 ] || ft_error INVALID_HOSTNAME
            ft_tcp_kind=http; [ "$kind" != https ] || ft_tcp_kind=tls
            # Only the restricted alphabet above is interpolated into TOML.
            case "$value" in ''|*[!A-Za-z0-9.-]*) return;; esac
            ft_tcp_templates="$ft_tcp_templates
[[tcp.templates]]
payload = \"$ft_tcp_kind\"
hostname = \"$value\"
"
            ft_warning GENERATED_TEMPLATE_CHANGES
            ;;
        *) ft_error UNSUPPORTED_TCP_PAYLOAD;;
    esac
}
ft_udp_file() {
    ft_udp_files=$((ft_udp_files + 1))
    ft_udp_payload_count=$((ft_udp_payload_count + 1))
    [ "$ft_udp_payload_count" -le 16 ] || { ft_error UDP_TEMPLATE_LIMIT_EXCEEDED; return; }
    ft_path "$1" || { ft_error INVALID_PAYLOAD_PATH; return; }
    ft_payload_file_check "$1"
    ft_udp_templates="$ft_udp_templates
[[udp.templates]]
payload = \"custom\"
payload_file = \"$1\"
"
}
ft_udp_uri() {
    ft_udp_uris=$((ft_udp_uris + 1))
    ft_udp_payload_count=$((ft_udp_payload_count + 1))
    [ "$ft_udp_payload_count" -le 16 ] || { ft_error UDP_TEMPLATE_LIMIT_EXCEEDED; return; }
    case "$1" in sip:?*) ;; *) ft_error INVALID_SIP_URI; return;; esac
    case "$1" in *[!A-Za-z0-9_./:@%+=?\;-]*) ft_error INVALID_SIP_URI; return;; esac
    [ "${#1}" -le 120 ] || ft_error INVALID_SIP_URI
    ft_udp_templates="$ft_udp_templates
[[udp.templates]]
payload = \"sip\"
sip_uri = \"$1\"
"
    ft_warning GENERATED_TEMPLATE_CHANGES
}
ft_port_policy() { [ -z "$1" ] || ft_error TCP_PORT_BYPASS_UNSUPPORTED; }
ft_payload_file_check() {
    [ -f "$1" ] || { ft_error PAYLOAD_FILE_UNAVAILABLE; return; }
    local bytes
    bytes="$(wc -c < "$1" 2>/dev/null)" || { ft_error PAYLOAD_FILE_UNAVAILABLE; return; }
    ft_uint "$bytes" 1 1200 || ft_error PAYLOAD_SIZE_UNSUPPORTED
}
ft_environment() {
    local version major minor device link_type command active_pid checkpoint=false
    version="$(uname -r)"; major="${version%%.*}"; version="${version#*.}"; minor="${version%%.*}"
    if ! ft_uint "$major" 1 99 || ! ft_uint "$minor" 0 999 ||
       { [ "$major" -lt 6 ] || { [ "$major" -eq 6 ] && [ "$minor" -lt 6 ]; }; }; then
        ft_error KERNEL_MINIMUM_UNMET
    fi
    [ -x /usr/libexec/faketraffic/ebpf ] && [ -f /usr/lib/faketraffic/ebpf.bpf.o ] || ft_error EBPF_BACKEND_NOT_INSTALLED
    for command in /var/run/faketraffic/ebpf-runtime/filters /var/run/faketraffic/ebpf-runtime/recovery-required; do
        if [ -e "$command" ] || [ -L "$command" ]; then checkpoint=true; fi
    done
    if [ "$checkpoint" = true ]; then
        active_pid="$(ubus -t 2 call service list '{"name":"faketraffic"}' 2>/dev/null | jsonfilter -e '@.faketraffic.instances.ebpf.pid' 2>/dev/null)"
        case "$active_pid" in ''|*[!0-9]*) active_pid=0;; esac
        if [ "${#active_pid}" -le 10 ] && [ "$active_pid" != 0 ] &&
           [ "$(readlink "/proc/$active_pid/exe" 2>/dev/null)" = /usr/libexec/faketraffic/ebpf ]; then
            ft_warning BACKEND_STOP_REQUIRED
        else ft_error RECOVERY_REQUIRED
        fi
    fi
    [ -c /dev/net/tun ] || ft_error TUN_UNAVAILABLE
    for command in flock jsonfilter nft tc ip; do command -v "$command" >/dev/null 2>&1 || ft_error REQUIRED_TOOL_UNAVAILABLE; done
    for device in $ft_devices; do
        link_type="$(cat "/sys/class/net/$device/type" 2>/dev/null)" || { ft_error DEVICE_UNAVAILABLE; continue; }
        case "$ft_mode:$link_type" in l3:512|l3:65534|ethernet:1|pppoe:1) ;; *) ft_error INCOMPATIBLE_LINK_MODE;; esac
    done
    ft_warning LOAD_ATTACH_NOT_TESTED
    ft_warning OFFLOAD_COEXISTENCE_NOT_TESTED
}
ft_preflight() {
    local tcp udp tttl uttl trepeat urepeat thop uhop tpct upct value mode networks interfaces profile count
    ft_errors= ft_warnings= ft_devices= ft_device_count=0
    ft_tcp_payload_count=0 ft_udp_payload_count=0 ft_udp_files=0 ft_udp_uris=0
    ft_tcp_templates= ft_udp_templates=
    config_get ft_backend globals backend nfqueue
    case "$ft_backend" in nfqueue|ebpf) ;; *) ft_error INVALID_BACKEND;; esac
    config_get_bool tcp globals enabled 0
    config_get_bool udp main enabled 0
    [ "$tcp" = 1 ] || [ "$udp" = 1 ] || ft_error NOTHING_ENABLED
    config_get_bool value globals accept_ebpf_semantics 0
    [ "$value" = 1 ] || ft_error EXPLICIT_SEMANTICS_ACCEPTANCE_REQUIRED
    ft_warning NATIVE_BYPASS_POLICY
    ft_warning NFQUEUE_FIELDS_INACTIVE
    config_get ft_udp_trigger globals udp_trigger egress
    case "$ft_udp_trigger" in egress|both) ;; *) ft_error INVALID_UDP_TRIGGER;; esac
    config_get ft_mode globals ebpf_interface_mode l3
    case "$ft_mode" in l3|ethernet|pppoe) ;; *) ft_error INVALID_LINK_MODE;; esac
    tttl=3 trepeat=2 thop=0 tpct=0 uttl=3 urepeat=1 uhop=0 upct=0
    if [ "$tcp" = 1 ]; then
        config_get tttl advanced ttl 3; [ "$tttl" != -1 ] || tttl=3
        config_get trepeat advanced repeat 2; [ "$trepeat" != -1 ] || trepeat=2
        config_get_bool thop advanced disable_estimation 0
        config_get tpct advanced pct 0; [ "$tpct" != -1 ] || tpct=0
        config_list_foreach globals interface ft_add_device
        config_foreach ft_tcp_payload payload
        [ "$ft_tcp_payload_count" -gt 0 ] || ft_error TCP_TEMPLATE_REQUIRED
        config_list_foreach advanced bypass_port ft_port_policy
        config_get value advanced fwmark_bypassing -1; [ "$value" = -1 ] || ft_error CUSTOM_MARK_POLICY_UNSUPPORTED
        config_get value advanced fwmark_handle -1; [ "$value" = -1 ] || ft_error CUSTOM_MARK_POLICY_UNSUPPORTED
        for mode in skip use_iptables; do config_get_bool value advanced "$mode" 0; [ "$value" = 0 ] || ft_error MANUAL_FIREWALL_UNSUPPORTED; done
    fi
    ft_tcp_devices="$ft_devices"
    if [ "$udp" = 1 ]; then
        config_get uttl main ttl 3
        config_get urepeat main repeat 1
        config_get_bool uhop main no_hop_estimate 0
        config_get upct main dynamic_pct 0
        config_get_bool value main all_interfaces 0; [ "$value" = 0 ] || ft_error ALL_INTERFACES_UNSUPPORTED
        config_get_bool value main ipv4 1; [ "$value" = 1 ] || ft_error IP_FAMILY_SELECTION_UNSUPPORTED
        config_get_bool value main ipv6 1; [ "$value" = 1 ] || ft_error IP_FAMILY_SELECTION_UNSUPPORTED
        config_get value main fwmark 0x10000
        case "$value" in 0x10000|65536) ;; *) ft_error CUSTOM_MARK_POLICY_UNSUPPORTED;; esac
        config_get value main fwmask 0x10000
        case "$value" in 0x10000|65536) ;; *) ft_error CUSTOM_MARK_POLICY_UNSUPPORTED;; esac
        for mode in skip_firewall use_iptables; do config_get_bool value main "$mode" 0; [ "$value" = 0 ] || ft_error MANUAL_FIREWALL_UNSUPPORTED; done
        ft_devices= ft_device_count=0
        config_get mode main interface_mode network
        case "$mode" in
            network) config_list_foreach main network ft_network;;
            device) config_list_foreach main interface ft_add_device;;
            auto) config_list_foreach main network ft_network; config_list_foreach main interface ft_add_device;;
            *) ft_error INVALID_INTERFACE_MODE;;
        esac
        if [ "$tcp" = 1 ]; then
            # Compare sets, never silently widen either protocol's target set.
            for value in $ft_tcp_devices; do case " $ft_devices " in *" $value "*) ;; *) ft_error DIFFERENT_PROTOCOL_DEVICES;; esac; done
            for value in $ft_devices; do case " $ft_tcp_devices " in *" $value "*) ;; *) ft_error DIFFERENT_PROTOCOL_DEVICES;; esac; done
        fi
        config_get profile main sip_profile china_all
        case "$profile" in
            standard) ;;
            custom) config_list_foreach main sip_uri ft_udp_uri;;
            china_mobile|china_all) ft_udp_uri sip:user@ims.mnc000.mcc460.3gppnetwork.org;;
            china_unicom) ft_udp_uri sip:user@ims.mnc001.mcc460.3gppnetwork.org;;
            china_telecom) ft_udp_uri sip:user@ims.mnc003.mcc460.3gppnetwork.org;;
            china_sip_observed)
                ft_udp_uri sip:user@sipcq16.xnq.r.10086.cn:5260
                ft_udp_uri sip:user@sipsc109.r01.rcs.189.cn:5260;;
            *) ft_error UNSUPPORTED_SIP_PROFILE;;
        esac
        if [ "$profile" = china_all ]; then
            ft_udp_uri sip:user@ims.mnc001.mcc460.3gppnetwork.org
            ft_udp_uri sip:user@ims.mnc003.mcc460.3gppnetwork.org
        fi
        config_list_foreach main payload_file ft_udp_file
        if [ "$profile" = standard ] && [ "$ft_udp_files" -eq 0 ]; then ft_udp_uri sip:service@example.com; fi
        [ "$ft_udp_payload_count" -gt 0 ] || ft_error UDP_TEMPLATE_REQUIRED
        ft_warning UDP_TRIGGER_AND_WINDOW_CHANGES
    else
        ft_devices="$ft_tcp_devices"
    fi
    count=0; for value in $ft_devices; do count=$((count + 1)); done
    [ "$count" -gt 0 ] && [ "$count" -le 8 ] || ft_error DEVICE_COUNT_UNSUPPORTED
    if [ "$tcp" = 1 ] && [ "$udp" = 1 ]; then
        [ "$tttl:$trepeat:$thop:$tpct" = "$uttl:$urepeat:$uhop:$upct" ] || ft_error DIFFERENT_PROTOCOL_INJECTION_SETTINGS
    fi
    ft_ttl="$tttl" ft_repeat="$trepeat" ft_nohop="$thop" ft_percent="$tpct"
    if [ "$tcp" != 1 ]; then ft_ttl="$uttl" ft_repeat="$urepeat" ft_nohop="$uhop" ft_percent="$upct"; fi
    ft_uint "$ft_ttl" 1 255 || ft_error INVALID_TTL
    ft_uint "$ft_repeat" 1 8 || ft_error REPEAT_RANGE_UNSUPPORTED
    ft_uint "$ft_percent" 0 99 || ft_error INVALID_DYNAMIC_PERCENT
    [ "$ft_nohop" = 0 ] || [ "$ft_percent" = 0 ] || ft_error INVALID_HOP_SETTINGS
    ft_tcp_enabled="$tcp" ft_udp_enabled="$udp"
    ft_environment
    ft_compatible=false; [ -n "$ft_errors" ] || ft_compatible=true
}
ft_preflight_json() {
    printf '{"schema_version":1,"scope":"saved_config_and_read_only_environment","candidate":"ebpf","configured_backend":"%s","can_attempt":%s,"template_limit":16,"tcp_template_count":%s,"udp_template_count":%s,"load_attach":"not_tested","errors":[%s],"warnings":[%s]}\n' \
        "$(case "$ft_backend" in nfqueue|ebpf) printf '%s' "$ft_backend";; *) printf unknown;; esac)" "$ft_compatible" "$ft_tcp_payload_count" "$ft_udp_payload_count" "$ft_errors" "$ft_warnings"
}
ft_render() {
    [ "$ft_compatible" = true ] || return 1
    printf 'version = 2\n'
    local device estimate=true tcp=false udp=false
    [ "$ft_nohop" = 0 ] || estimate=false
    [ "$ft_tcp_enabled" = 0 ] || tcp=true
    [ "$ft_udp_enabled" = 0 ] || udp=true
    for device in $ft_devices; do printf '\n[[interfaces]]\nname = "%s"\nmode = "%s"\n' "$device" "$ft_mode"; done
    printf '\n[tcp]\nenabled = %s\ndirections = ["active", "passive"]\ntfo = "strip-syn"\nmax_batches = 3\n%s' "$tcp" "$ft_tcp_templates"
    printf '\n[udp]\nenabled = %s\ntrigger = "%s"\ninitial_packets = 5\nidle_timeout_seconds = 30\n%s' "$udp" "$ft_udp_trigger" "$ft_udp_templates"
    printf '\n[injection]\nttl = %s\nrepeat = %s\nestimate_hops = %s\ndynamic_percent = %s\nmax_packets_per_second = 1000\nburst = 2000\nallow_private = false\n\n[runtime]\ntcp_entries = 8192\nudp_entries = 8192\nlease_seconds = 10\n' "$ft_ttl" "$ft_repeat" "$estimate" "$ft_percent"
}
