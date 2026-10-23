#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK=$(CDPATH= cd -- "${1:?SDK directory required}" && pwd)
OUT=${2:-"$ROOT/dist"}
APK="$SDK/staging_dir/host/bin/apk"
ARCH=${ARCH:-x86_64}
[ -x "$APK" ] || { echo 'Missing SDK apk tool' >&2; exit 1; }
[ "$(id -u)" = 0 ] || { echo 'Run as root to produce root-owned package entries' >&2; exit 1; }
STAGE=$(mktemp -d /tmp/faketraffic-overview.XXXXXX)
cp -Rp "$ROOT/openwrt/luci-app-faketraffic/root/." "$STAGE/"
mkdir -p "$STAGE/lib/apk/packages" "$OUT"
(cd "$STAGE" && find . -type f | sed 's#^\./#/#' | LC_ALL=C sort) > "$STAGE/lib/apk/packages/luci-app-faketraffic.list"
chown -R 0:0 "$STAGE"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
# No install/remove/upgrade scripts. This package cannot restart an engine,
# rewrite UCI, remove legacy packages or take ownership of legacy files.
"$APK" mkpkg --info 'name:luci-app-faketraffic' --info 'version:0.1.0-r1' \
  --info 'description:FakeTraffic TCP and UDP management entry' \
  --info "arch:$ARCH" --info 'license:GPL-3.0-or-later' \
  --info 'origin:faketraffic' --info 'url:https://github.com/alzpqm/FakeTraffic' \
  --info 'maintainer:Codex <codex@local.invalid>' \
  --info 'depends:luci-base fakehttp=99.3-r1 fakesip=0.9.1-r23 luci-app-fakehttp=99.3-r1 luci-app-fakesip=0.9.1-r23' \
  --files "$STAGE" --output "$OUT/luci-app-faketraffic-0.1.0-r1.apk"
"$APK" adbdump "$OUT/luci-app-faketraffic-0.1.0-r1.apk" | node "$ROOT/tools/check-overview-metadata.mjs"
printf 'Overview package staging retained: %s\n' "$STAGE"
