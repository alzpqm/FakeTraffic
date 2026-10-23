#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK=$(CDPATH= cd -- "${1:?SDK directory required}" && pwd)
OUT=${2:-"$ROOT/dist"}
node "$ROOT/tools/verify-sources.mjs"
mkdir -p "$OUT"
umask 022
# Independent, pre-existing temporary child roots. Upstream builders clean
# only the explicit child supplied here; never share their default work root.
HTTP_WORK=$(mktemp -d /tmp/faketraffic-http.XXXXXX)
SIP_WORK=$(mktemp -d /tmp/faketraffic-sip.XXXXXX)
HTTP_SOURCE=$(mktemp -d /tmp/faketraffic-http-source.XXXXXX)
SIP_SOURCE=$(mktemp -d /tmp/faketraffic-sip-source.XXXXXX)
# The preserved upstream SIP builder copies source modes into LuCI. Normalize
# a disposable POSIX source copy so NTFS checkout modes cannot enter an APK.
cp -R "$ROOT/components/fakehttp/." "$HTTP_SOURCE/"
cp -R "$ROOT/components/fakesip/." "$SIP_SOURCE/"
find "$HTTP_SOURCE" "$SIP_SOURCE" -type d -exec chmod 0755 {} +
find "$HTTP_SOURCE" "$SIP_SOURCE" -type f -exec chmod 0644 {} +
find "$HTTP_SOURCE" "$SIP_SOURCE" -type f -name '*.sh' -exec chmod 0755 {} +
BUILD_DIR="$HTTP_WORK" sh "$HTTP_SOURCE/tools/build-openwrt-apk.sh" "$SDK" "$OUT"
BUILD_DIR="$SIP_WORK" sh "$SIP_SOURCE/tools/build-openwrt-apk.sh" "$SDK" "$OUT"
sh "$ROOT/tools/build-overview-apk.sh" "$SDK" "$OUT"
(cd "$OUT" && sha256sum fakehttp-99.3-r1.apk luci-app-fakehttp-99.3-r1.apk \
  fakesip-0.9.1-r23.apk luci-app-fakesip-0.9.1-r23.apk \
  luci-app-faketraffic-0.1.0-r1.apk > SHA256SUMS)
printf 'Build work roots retained for inspection: %s %s %s %s\n' "$HTTP_WORK" "$SIP_WORK" "$HTTP_SOURCE" "$SIP_SOURCE"
