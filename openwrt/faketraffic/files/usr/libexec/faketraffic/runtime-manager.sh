# SPDX-License-Identifier: GPL-3.0-or-later
prepare_runtime() {
    local metadata
    [ ! -L /var/run/faketraffic ] || return 1
    [ -d /var/run/faketraffic ] || mkdir -m 0700 /var/run/faketraffic || return 1
    metadata="$(ls -ldn /var/run/faketraffic)" || return 1
    set -- $metadata
    [ "$1:$3" = drwx------:0 ]
}
start_ebpf() {
    local temporary
    /usr/libexec/faketraffic/preflight check || { logger -t faketraffic 'eBPF preflight failed; configuration not translated'; return 1; }
    temporary="$(umask 077; mktemp /var/run/faketraffic/config.XXXXXX)" || return 1
    if ! /usr/libexec/faketraffic/preflight render > "$temporary"; then rm -f "$temporary"; return 1; fi
    chmod 0600 "$temporary" || { rm -f "$temporary"; return 1; }
    mv -f "$temporary" /var/run/faketraffic/ebpf.toml || { rm -f "$temporary"; return 1; }
    procd_open_instance ebpf
    procd_set_param command /usr/libexec/faketraffic/lock-run ebpf run \
        --config /var/run/faketraffic/ebpf.toml --object /usr/lib/faketraffic/ebpf.bpf.o \
        --runtime-dir /var/run/faketraffic/ebpf-runtime
    # Do not repeatedly retry a failed load/attach or an uncertain cleanup.
    procd_set_param stdout 1
    procd_set_param stderr 1
    procd_set_param term_timeout 15
    procd_close_instance
}
wait_own_stopped() {
    local reply pids tries=0
    while [ "$tries" -lt 20 ]; do
        reply="$(ubus -t 2 call service list '{"name":"faketraffic"}' 2>/dev/null)" || return 1
        pids="$(printf '%s' "$reply" | jsonfilter -e '@.faketraffic.instances.*.pid' 2>/dev/null)"
        [ -n "$pids" ] || return 0
        sleep 1
        tries=$((tries + 1))
    done
    logger -t faketraffic 'Existing backend has not stopped; no replacement started'
    return 1
}
nfqueue_number_valid() {
    case "$1" in ''|*[!0-9]*) return 1;; esac
    [ "$1" -ge "${2:-0}" ] 2>/dev/null && [ "$1" -le 65535 ] 2>/dev/null
}
# Match native unsigned decimal/hex parsing without evaluating arbitrary UCI
# text or interpreting decimal leading zeroes as shell octal.
nfqueue_uint() {
    local value="$1" digits
    case "$value" in
        0x*|0X*)
            digits="${value#??}"
            case "$digits" in ''|*[!0-9a-fA-F]*) return 1;; esac
            while [ "${digits#0}" != "$digits" ]; do digits="${digits#0}"; done
            digits="${digits:-0}"
            [ "${#digits}" -le 8 ] || return 1
            value=$((0x$digits))
            ;;
        ''|*[!0-9]*) return 1;;
        *)
            while [ "${value#0}" != "$value" ]; do value="${value#0}"; done
            value="${value:-0}"
            ;;
    esac
    [ "${#value}" -le 10 ] && [ "$value" -ge "$2" ] && [ "$value" -le "$3" ] || return 1
    printf '%s\n' "$value"
}
validate_nfqueue_packets() {
    local protocol="$1" ttl repeat percent nohop inbound outbound ipv4 ipv6
    if [ "$protocol" = tcp ]; then
        config_get ttl advanced ttl -1
        config_get repeat advanced repeat -1
        config_get percent advanced pct -1
        config_get_bool nohop advanced disable_estimation 0
        # TCP's adapter omits these default/disabled sentinels.
        case "$ttl" in ''|-1|0) ttl=3;; esac
        case "$repeat" in ''|-1|0) repeat=2;; esac
        case "$percent" in ''|-1|0) percent=0;; esac
        case "$ttl:$repeat:$percent" in *[!0-9:]*) return 1;; esac
        percent="$(nfqueue_uint "$percent" 0 99)" || return 1
    else
        config_get ttl main ttl
        config_get repeat main repeat
        config_get percent main dynamic_pct
        config_get_bool nohop main no_hop_estimate 0
        ttl="${ttl:-3}" repeat="${repeat:-2}"
        # Only empty and literal 0 are omitted by append_nonzero_arg. Other
        # spellings that parse as zero would be passed to native -y and rejected.
        case "$percent" in ''|0) percent=0;;
            *) percent="$(nfqueue_uint "$percent" 1 99)" || return 1;; esac
        config_get_bool inbound main inbound 0
        config_get_bool outbound main outbound 1
        config_get_bool ipv4 main ipv4 1
        config_get_bool ipv6 main ipv6 1
        [ "$inbound" = 1 ] || [ "$outbound" = 1 ] || return 1
        [ "$ipv4" = 1 ] || [ "$ipv6" = 1 ] || return 1
    fi
    nfqueue_uint "$ttl" 1 255 >/dev/null && nfqueue_uint "$repeat" 1 10 >/dev/null || return 1
    [ "$nohop" != 1 ] || [ "$percent" = 0 ]
}
# Pure candidate validation, shared by start and reload. Disabled protocols do
# not reserve queues. Keep this before stop so invalid UCI imports cannot evict
# a working owner; the LuCI form is not the only configuration writer.
validate_nfqueue() {
    local tcp_enabled udp_enabled tcp_queue udp_queue
    config_get_bool tcp_enabled globals enabled 0
    config_get_bool udp_enabled main enabled 0
    config_get tcp_queue advanced queue_number 512
    config_get udp_queue main queue_num 513
    [ "$tcp_queue" != -1 ] || tcp_queue=512
    if { [ "$tcp_enabled" = 1 ] && ! nfqueue_number_valid "$tcp_queue"; } ||
       { [ "$udp_enabled" = 1 ] && ! nfqueue_number_valid "$udp_queue" 1; }; then
        logger -t faketraffic 'Invalid NFQUEUE number; active service preserved'
        return 1
    fi
    if [ "$tcp_enabled" = 1 ] && [ "$udp_enabled" = 1 ] &&
       [ "$tcp_queue" -eq "$udp_queue" ] 2>/dev/null; then
        logger -t faketraffic 'TCP and UDP cannot share one NFQUEUE'
        return 1
    fi
    if { [ "$tcp_enabled" = 1 ] && ! validate_nfqueue_packets tcp; } ||
       { [ "$udp_enabled" = 1 ] && ! validate_nfqueue_packets udp; }; then
        logger -t faketraffic 'Invalid NFQUEUE packet settings; active service preserved'
        return 1
    fi
    return 0
}
reload_backend() {
    local backend tcp_enabled udp_enabled
    config_load faketraffic
    config_get backend globals backend nfqueue
    config_get_bool tcp_enabled globals enabled 0
    config_get_bool udp_enabled main enabled 0
    case "$backend" in
        ebpf)
            if [ "$tcp_enabled" = 1 ] || [ "$udp_enabled" = 1 ]; then /usr/libexec/faketraffic/preflight check || return 1; fi
            ;;
        nfqueue) validate_nfqueue || return 1;;
        *) return 1;;
    esac
    # Validate first. Do not stop a working backend for an invalid candidate.
    stop || return 1
    wait_own_stopped || return 1
    start
}

# rc.common's default restart stops first, bypassing reload_backend's candidate
# validation. Delegate through procd's locked reload hook instead. An invalid
# saved candidate must leave the currently running backend untouched.
restart() {
    reload "$@"
}
