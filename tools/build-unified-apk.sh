#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK=$(CDPATH= cd -- "${1:?Matching OpenWrt 25.12 SDK required}" && pwd)
OUT=${2:-"$ROOT/dist/0.4.0"}
MODE=${3:-all}
case "$MODE" in all|--luci-only) ;; *) echo 'Expected all or --luci-only' >&2; exit 1;; esac
ARCH=${ARCH:-x86_64}
APK="$SDK/staging_dir/host/bin/apk"
PO2LMO="$SDK/staging_dir/hostpkg/bin/po2lmo"
TARGET_STAGING=$(find "$SDK/staging_dir" -maxdepth 1 -type d -name 'target-*' | head -n 1)
TARGET_CC=$(find "$SDK/staging_dir" -path '*/bin/*-openwrt-linux-musl-gcc' -type f | head -n 1)
TARGET_STRIP=$(find "$SDK/staging_dir" -path '*/bin/*-openwrt-linux-musl-strip' -type f | head -n 1)
export STAGING_DIR="$SDK/staging_dir"
[ "$(id -u)" = 0 ] || { echo 'Root required for root-owned APK entries' >&2; exit 1; }
[ -x "$APK" ] && [ -x "$TARGET_CC" ] && [ -x "$TARGET_STRIP" ] && [ -x "$PO2LMO" ]
node "$ROOT/tools/verify-sources.mjs"
node "$ROOT/tools/sync-unified-adapters.mjs" --check
umask 022
WORK=$(mktemp -d /var/tmp/faketraffic-unified.XXXXXX)
CORE="$WORK/core"
LUCI="$WORK/luci"
mkdir -p "$CORE/usr/libexec/faketraffic" "$LUCI" "$OUT"
OUT=$(CDPATH= cd -- "$OUT" && pwd)
if [ "$MODE" = all ]; then
for engine in fakehttp fakesip; do
    cp -R "$ROOT/components/$engine" "$WORK/$engine"
    find "$WORK/$engine" -type d -exec chmod 0755 {} +
    find "$WORK/$engine" -type f -exec chmod 0644 {} +
    make -C "$WORK/$engine" clean
    case "$engine" in fakehttp) version=99.3-r1;; fakesip) version=0.9.1-openwrt;; esac
    make -C "$WORK/$engine" CC="$TARGET_CC" STRIP="$TARGET_STRIP" \
      CFLAGS="-I$TARGET_STAGING/usr/include" \
      LDFLAGS="-L$TARGET_STAGING/usr/lib -Wl,-rpath-link,$TARGET_STAGING/usr/lib" VERSION="$version"
    install -m 0755 "$WORK/$engine/build/$engine" "$CORE/usr/libexec/faketraffic/$engine"
done
cp -R "$ROOT/openwrt/faketraffic/files/." "$CORE/"
mkdir -p "$CORE/lib/apk/packages"
printf '%s\n' /etc/config/faketraffic > "$CORE/lib/apk/packages/faketraffic.conffiles"
sha256sum "$CORE/etc/config/faketraffic" | awk '{ print "/etc/config/faketraffic " $1 }' > "$CORE/lib/apk/packages/faketraffic.conffiles_static"
fi
cp -R "$ROOT/openwrt/luci-app-faketraffic/root/." "$LUCI/"
mkdir -p "$LUCI/usr/lib/lua/luci/i18n"
msgcat --use-first "$ROOT/openwrt/luci-app-faketraffic/po/zh_Hant/faketraffic.po" \
  "$ROOT/components/fakehttp/openwrt/luci-app-fakehttp/po/zh_Hant/fakehttp.po" \
  "$ROOT/components/fakesip/openwrt/luci-app-fakesip/po/zh_Hant/fakesip.po" -o "$WORK/faketraffic.po"
"$PO2LMO" "$WORK/faketraffic.po" "$LUCI/usr/lib/lua/luci/i18n/faketraffic.zh-tw.lmo"
mkdir -p "$LUCI/lib/apk/packages"
PACKAGES=luci-app-faketraffic
[ "$MODE" != all ] || PACKAGES="faketraffic $PACKAGES"
for package in $PACKAGES; do
    case "$package" in faketraffic) stage="$CORE";; *) stage="$LUCI";; esac
    (cd "$stage" && find . -type f | sed 's#^\./#/#' | LC_ALL=C sort) > "$stage/lib/apk/packages/$package.list"
    chown -R 0:0 "$stage"
    find "$stage" -type d -exec chmod 0755 {} +
    find "$stage" -type f -exec chmod 0644 {} +
done
if [ "$MODE" = all ]; then
chmod 0755 "$CORE/etc/init.d/faketraffic" "$CORE/usr/libexec/faketraffic/fakehttp" "$CORE/usr/libexec/faketraffic/fakesip"
chmod 0755 "$CORE/usr/libexec/faketraffic/lock-run" "$CORE/usr/libexec/faketraffic/preflight" "$CORE/usr/libexec/faketraffic/status" "$CORE/usr/libexec/rpcd/faketraffic"
chmod 0600 "$CORE/etc/config/faketraffic"
# Installation has no hooks and cannot start a competing owner. Removing the
# core must, however, stop and disable its own service before deleting files.
cp "$ROOT/openwrt/faketraffic/pre-deinstall" "$WORK/pre-deinstall"
chmod 0755 "$WORK/pre-deinstall"
"$APK" mkpkg --info 'name:faketraffic' --info 'version:0.4.0-r2' \
  --info 'description:Integrated TCP and UDP camouflage service' --info "arch:$ARCH" \
  --info 'license:GPL-3.0-or-later' --info 'origin:faketraffic' \
  --info 'url:https://github.com/alzpqm/FakeTraffic' --info 'maintainer:Codex <codex@local.invalid>' \
  --info 'depends:libc libnetfilter-queue1 libnfnetlink0 libmnl0 kmod-nfnetlink-queue kmod-nft-queue nftables-json busybox jsonfilter ubus' \
  --script "pre-deinstall:$WORK/pre-deinstall" \
  --files "$CORE" --output "$OUT/faketraffic-0.4.0-r2.apk"
fi
"$APK" mkpkg --info 'name:luci-app-faketraffic' --info 'version:0.4.0-r2' \
  --info 'description:Unified FakeTraffic TCP and UDP configuration' --info "arch:$ARCH" \
  --info 'license:GPL-3.0-or-later' --info 'origin:faketraffic' \
  --info 'url:https://github.com/alzpqm/FakeTraffic' --info 'maintainer:Codex <codex@local.invalid>' \
  --info 'depends:luci-base rpcd-mod-file faketraffic=0.4.0-r2' \
  --files "$LUCI" --output "$OUT/luci-app-faketraffic-0.4.0-r2.apk"
for package in $PACKAGES; do
    "$APK" adbdump "$OUT/$package-0.4.0-r2.apk" | node "$ROOT/tools/check-unified-metadata.mjs"
done
# Preserve older rollback artifacts and include every retained APK in the manifest.
(cd "$OUT" && sha256sum ./*.apk > SHA256SUMS)
printf 'Private build work retained: %s\n' "$WORK"
