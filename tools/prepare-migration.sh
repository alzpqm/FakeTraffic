#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# Reads the legacy configuration. Does not install, stop or rewrite anything.
set -eu
[ "$(id -u)" = 0 ] || { echo 'Root required' >&2; exit 1; }
umask 077
BACKUP=$(mktemp -d /root/faketraffic-migration.XXXXXX)
chmod 0700 "$BACKUP"
for name in fakehttp fakesip; do
    [ -s "/etc/config/$name" ] || { echo "Missing $name config" >&2; exit 1; }
    cp -p "/etc/config/$name" "$BACKUP/$name.original"
    uci -q export "$name" > "$BACKUP/$name.export"
done
[ "$(uci -q get fakehttp.globals)" = globals ]
[ "$(uci -q get fakehttp.advanced)" = advanced ]
[ "$(uci -q get fakesip.main)" = fakesip ]
if uci -q get fakehttp.main >/dev/null; then
    echo 'Conflicting named main section; manual migration required' >&2; exit 1
fi
# Current SIP service manages exactly main. Reject unhandled sections instead
# of silently losing an unusual installation's configuration.
SIP_SECTIONS=$(uci -q show fakesip | sed -n '/^[^.]*\.[^.]*=/p' | wc -l)
[ "$SIP_SECTIONS" -eq 1 ] || { echo 'Unexpected SIP sections; manual migration required' >&2; exit 1; }
{ sed '/^package /d' "$BACKUP/fakehttp.export"; printf '\n'; sed '/^package /d' "$BACKUP/fakesip.export"; } > "$BACKUP/faketraffic"
chmod 0600 "$BACKUP/faketraffic"
uci -c "$BACKUP" -q export faketraffic > "$BACKUP/merged.export"
cp -p /etc/apk/world "$BACKUP/world.before"
apk query --installed --format json --fields name,version fakehttp fakesip luci-app-fakehttp luci-app-fakesip luci-app-faketraffic > "$BACKUP/packages.before.json"
for name in fakehttp fakesip; do
    if "/etc/init.d/$name" enabled; then printf '1\n'; else printf '0\n'; fi > "$BACKUP/$name.enabled"
    if "/etc/init.d/$name" running; then printf '1\n'; else printf '0\n'; fi > "$BACKUP/$name.running"
done
printf '%s\n' "$BACKUP"
