#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

usage() {
    cat <<EOF
Usage: $0 <openwrt-sdk-dir> [output-dir]

Build OpenWrt 25 apk packages from this working tree.

Environment overrides:
  ARCH       OpenWrt package architecture, default: x86_64
  TARGET_CC  Target C compiler path
  STRIP      Target strip path
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ $# -lt 1 ]; then
    usage
    [ $# -lt 1 ] && exit 1 || exit 0
fi

SDK_DIR=$1
ARCH=${ARCH:-x86_64}
OUT_DIR=${2:-"$SDK_DIR/bin/packages/$ARCH/base"}
APK="$SDK_DIR/staging_dir/host/bin/apk"
PO2LMO="$SDK_DIR/staging_dir/hostpkg/bin/po2lmo"
TARGET_STAGING=$(find "$SDK_DIR/staging_dir" -maxdepth 1 -type d -name 'target-*' | head -n 1)
TARGET_CC=${TARGET_CC:-$(find "$SDK_DIR/staging_dir" -path '*/bin/*-openwrt-linux-musl-gcc' -type f | head -n 1)}
STRIP=${STRIP:-$(find "$SDK_DIR/staging_dir" -path '*/bin/*-openwrt-linux-musl-strip' -type f | head -n 1)}
export STAGING_DIR="$SDK_DIR/staging_dir"

[ -x "$APK" ] || { echo "missing apk tool: $APK" >&2; exit 1; }
[ -x "$PO2LMO" ] || { echo "missing LuCI translation compiler: $PO2LMO" >&2; exit 1; }
[ -n "$TARGET_STAGING" ] || { echo "missing target staging dir in SDK" >&2; exit 1; }
[ -x "$TARGET_CC" ] || { echo "missing target compiler in SDK" >&2; exit 1; }
[ -x "$STRIP" ] || { echo "missing target strip in SDK" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || {
    echo "this direct APK builder must run as root to record root-owned files" >&2
    exit 1
}

pkg_field() {
    awk -F:= -v key="$2" '$1 == key { print $2; exit }' "$1"
}

make_pkg_metadata() {
    pkgroot=$1
    pkgname=$2

    mkdir -p "$pkgroot/lib/apk/packages"
    (cd "$pkgroot" && find . \( -type f -o -type l \) | \
        sed 's#^\./#/#' | sort) \
        >"$pkgroot/lib/apk/packages/$pkgname.list"
}

make_default_scripts() {
    scriptdir=$1
    pkgname=$2

    mkdir -p "$scriptdir"
    cat >"$scriptdir/post-install" <<EOF
#!/bin/sh
[ "\${IPKG_NO_SCRIPT:-}" = "1" ] && exit 0
[ -s "\${IPKG_INSTROOT:-}/lib/functions.sh" ] || exit 0
. "\${IPKG_INSTROOT:-}/lib/functions.sh"
export root="\${IPKG_INSTROOT:-}"
export pkgname="$pkgname"
default_postinst
EOF
    cat >"$scriptdir/pre-deinstall" <<EOF
#!/bin/sh
[ -s "\${IPKG_INSTROOT:-}/lib/functions.sh" ] || exit 0
. "\${IPKG_INSTROOT:-}/lib/functions.sh"
export root="\${IPKG_INSTROOT:-}"
export pkgname="$pkgname"
default_prerm
EOF
    chmod 0755 "$scriptdir/post-install" "$scriptdir/pre-deinstall"
}

make_conffile_metadata() {
    pkgroot=$1
    pkgname=$2
    conffile=$3

    mkdir -p "$pkgroot/lib/apk/packages"
    printf '%s\n' "$conffile" >"$pkgroot/lib/apk/packages/$pkgname.conffiles"
    sha256sum "$pkgroot$conffile" | awk -v file="$conffile" '{ print file " " $1 }' \
        >"$pkgroot/lib/apk/packages/$pkgname.conffiles_static"
}

FAKESIP_VERSION=$(pkg_field "$ROOT_DIR/openwrt/fakesip/Makefile" PKG_VERSION)
FAKESIP_RELEASE=$(pkg_field "$ROOT_DIR/openwrt/fakesip/Makefile" PKG_RELEASE)
LUCI_VERSION=$(pkg_field "$ROOT_DIR/openwrt/luci-app-fakesip/Makefile" PKG_VERSION)
LUCI_RELEASE=$(pkg_field "$ROOT_DIR/openwrt/luci-app-fakesip/Makefile" PKG_RELEASE)
LUCI_MAKE_ARCH=$(pkg_field "$ROOT_DIR/openwrt/luci-app-fakesip/Makefile" PKGARCH)

[ -n "$LUCI_MAKE_ARCH" ] || {
    echo "missing LuCI PKGARCH" >&2
    exit 1
}

BUILD_DIR=${BUILD_DIR:-"/tmp/fakesip-openwrt-apk-build"}
FAKESIP_ROOT="$BUILD_DIR/fakesip-root"
LUCI_ROOT="$BUILD_DIR/luci-root"
FAKESIP_SCRIPTS="$BUILD_DIR/fakesip-scripts"
LUCI_SCRIPTS="$BUILD_DIR/luci-scripts"

rm -rf "$BUILD_DIR"
mkdir -p "$FAKESIP_ROOT/usr/bin" "$FAKESIP_ROOT/etc/config" \
    "$FAKESIP_ROOT/etc/init.d" "$LUCI_ROOT" "$OUT_DIR"

make -C "$ROOT_DIR" clean
make -C "$ROOT_DIR" \
    CC="$TARGET_CC" \
    STRIP="$STRIP" \
    CFLAGS="-I$TARGET_STAGING/usr/include" \
    LDFLAGS="-L$TARGET_STAGING/usr/lib -Wl,-rpath-link,$TARGET_STAGING/usr/lib" \
    VERSION="$FAKESIP_VERSION-openwrt"

install -m 0755 "$ROOT_DIR/build/fakesip" "$FAKESIP_ROOT/usr/bin/fakesip"
install -m 0600 "$ROOT_DIR/openwrt/fakesip/files/fakesip.config" \
    "$FAKESIP_ROOT/etc/config/fakesip"
install -m 0755 "$ROOT_DIR/openwrt/fakesip/files/fakesip.init" \
    "$FAKESIP_ROOT/etc/init.d/fakesip"
find "$FAKESIP_ROOT" \( -name '._*' -o -name '.DS_Store' \) -exec rm -rf {} +

make_conffile_metadata "$FAKESIP_ROOT" fakesip /etc/config/fakesip
make_pkg_metadata "$FAKESIP_ROOT" fakesip
make_default_scripts "$FAKESIP_SCRIPTS" fakesip
chown -R 0:0 "$FAKESIP_ROOT"

"$APK" mkpkg \
    --info "name:fakesip" \
    --info "version:$FAKESIP_VERSION-r$FAKESIP_RELEASE" \
    --info "description:UDP SIP camouflage using Netfilter Queue" \
    --info "arch:$ARCH" \
    --info "license:GPL-3.0-or-later" \
    --info "origin:feeds/base/fakesip" \
    --info "url:https://github.com/MikeWang000000/FakeSIP" \
    --info "maintainer:MikeWang000000" \
    --info "provides:fakesip-any" \
    --info "depends:libc libnetfilter-queue1 libnfnetlink0 libmnl0 kmod-nfnetlink-queue kmod-nft-queue nftables-json" \
    --script "post-install:$FAKESIP_SCRIPTS/post-install" \
    --script "pre-deinstall:$FAKESIP_SCRIPTS/pre-deinstall" \
    --files "$FAKESIP_ROOT" \
    --output "$OUT_DIR/fakesip-$FAKESIP_VERSION-r$FAKESIP_RELEASE.apk"

cp -Rp "$ROOT_DIR/openwrt/luci-app-fakesip/root/." "$LUCI_ROOT/"
mkdir -p "$LUCI_ROOT/usr/lib/lua/luci/i18n"
"$PO2LMO" "$ROOT_DIR/openwrt/luci-app-fakesip/po/zh_Hant/fakesip.po" \
    "$LUCI_ROOT/usr/lib/lua/luci/i18n/fakesip.zh-tw.lmo"
find "$LUCI_ROOT" \( -name '._*' -o -name '.DS_Store' \) -exec rm -rf {} +
make_pkg_metadata "$LUCI_ROOT" luci-app-fakesip
make_default_scripts "$LUCI_SCRIPTS" luci-app-fakesip
chown -R 0:0 "$LUCI_ROOT"

# OpenWrt's APK architecture list is target-specific. Even LuCI-only packages
# must use the target ARCH on images whose /etc/apk/arch omits `all`.
"$APK" mkpkg \
    --info "name:luci-app-fakesip" \
    --info "version:$LUCI_VERSION-r$LUCI_RELEASE" \
    --info "description:LuCI support for FakeSIP" \
    --info "arch:$ARCH" \
    --info "license:GPL-3.0-or-later" \
    --info "origin:feeds/base/luci-app-fakesip" \
    --info "url:https://github.com/MikeWang000000/FakeSIP" \
    --info "maintainer:MikeWang000000" \
    --info "depends:fakesip luci-base rpcd-mod-file" \
    --script "post-install:$LUCI_SCRIPTS/post-install" \
    --script "pre-deinstall:$LUCI_SCRIPTS/pre-deinstall" \
    --files "$LUCI_ROOT" \
    --output "$OUT_DIR/luci-app-fakesip-$LUCI_VERSION-r$LUCI_RELEASE.apk"

sha256sum "$OUT_DIR/fakesip-$FAKESIP_VERSION-r$FAKESIP_RELEASE.apk" \
    "$OUT_DIR/luci-app-fakesip-$LUCI_VERSION-r$LUCI_RELEASE.apk"
