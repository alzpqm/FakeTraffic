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
        nfqueue) ;;
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
