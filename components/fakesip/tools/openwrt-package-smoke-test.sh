#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
PKG_DIR="$ROOT_DIR/openwrt/fakesip"
LUCI_DIR="$ROOT_DIR/openwrt/luci-app-fakesip"
CORE_VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$PKG_DIR/Makefile")
LUCI_VERSION=$(sed -n 's/^PKG_VERSION:=//p' "$LUCI_DIR/Makefile")
CORE_RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$PKG_DIR/Makefile")
LUCI_RELEASE=$(sed -n 's/^PKG_RELEASE:=//p' "$LUCI_DIR/Makefile")

fail() {
    printf 'FAIL: %s\n' "$*" >&2
    exit 1
}

require_file() {
    [ -f "$1" ] || fail "missing file: $1"
}

require_executable() {
    [ -x "$1" ] || fail "not executable: $1"
}

require_grep() {
    pattern="$1"
    file="$2"
    grep -Eq -- "$pattern" "$file" || fail "missing pattern '$pattern' in $file"
}

forbid_grep() {
    pattern="$1"
    file="$2"
    if grep -Eq -- "$pattern" "$file"; then
        fail "unexpected pattern '$pattern' in $file"
    fi
}

require_file "$PKG_DIR/Makefile"
require_file "$PKG_DIR/files/fakesip.config"
require_file "$PKG_DIR/files/fakesip.init"
require_file "$ROOT_DIR/openwrt/README.md"
require_file "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_file "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_file "$LUCI_DIR/Makefile"
require_file "$LUCI_DIR/root/usr/share/luci/menu.d/luci-app-fakesip.json"
require_file "$LUCI_DIR/root/usr/share/rpcd/acl.d/luci-app-fakesip.json"
require_file "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_file "$LUCI_DIR/po/zh_Hant/fakesip.po"
require_file "$ROOT_DIR/tests/test_luci_fakesip.js"
require_file "$ROOT_DIR/tests/test_luci_i18n.js"

require_executable "$PKG_DIR/files/fakesip.init"

[ "$CORE_VERSION" = "$LUCI_VERSION" ] ||
    fail "core/LuCI package versions differ: $CORE_VERSION vs $LUCI_VERSION"
[ "$CORE_RELEASE" = "$LUCI_RELEASE" ] ||
    fail "core/LuCI package releases differ: $CORE_RELEASE vs $LUCI_RELEASE"

sh -n "$PKG_DIR/files/fakesip.init"
sh -n "$ROOT_DIR/tools/build-openwrt-apk.sh"
sh -n "$ROOT_DIR/tools/build-openwrt-ipk.sh"
sh "$ROOT_DIR/tests/test_openwrt_init.sh"
if command -v node >/dev/null 2>&1; then
    node --check "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js" >/dev/null
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
        "$LUCI_DIR/root/usr/share/luci/menu.d/luci-app-fakesip.json"
    node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" \
        "$LUCI_DIR/root/usr/share/rpcd/acl.d/luci-app-fakesip.json"
	node "$ROOT_DIR/tests/test_luci_fakesip.js" \
		"$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js" \
		"$LUCI_DIR/root/usr/share/rpcd/acl.d/luci-app-fakesip.json"
	node "$ROOT_DIR/tests/test_luci_i18n.js" \
		"$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js" \
		"$LUCI_DIR/po/zh_Hant/fakesip.po"
else
    printf 'WARN: node is unavailable; skipping LuCI JS and JSON syntax checks.\n'
fi

require_grep 'BuildPackage,fakesip' "$PKG_DIR/Makefile"
require_grep 'libnetfilter-queue' "$PKG_DIR/Makefile"
require_grep 'kmod-nfnetlink-queue' "$PKG_DIR/Makefile"
require_grep 'fakesip.config' "$PKG_DIR/Makefile"
require_grep 'fakesip.init' "$PKG_DIR/Makefile"
require_grep 'PKG_RELEASE:=23' "$PKG_DIR/Makefile"
require_grep 'PKG_SOURCE_VERSION:=74442cb4ea8a7f6737efaac538ca3e973a21f318' "$PKG_DIR/Makefile"
require_grep 'PACKAGE_firewall4:nftables-json' "$PKG_DIR/Makefile"
require_grep 'PACKAGE_firewall4:kmod-nft-queue' "$PKG_DIR/Makefile"
require_grep 'PACKAGE_firewall:iptables-mod-nfqueue' "$PKG_DIR/Makefile"
require_grep 'PACKAGE_firewall:iptables-mod-conntrack-extra' "$PKG_DIR/Makefile"
require_grep 'for feed in base packages luci' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'scripts/feeds update \$feed' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'ALL_KMODS=\${ALL_KMODS:-n}' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'set_config_value' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'set_config_bool' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'set_config_bool ALL_KMODS' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'package/feeds/base/libmnl/compile' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'NO_DEPS=1' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'FIREWALL_PACKAGE=firewall4' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'FIREWALL_PACKAGE=firewall' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'strip_package_selections' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'strip_profile_defaults' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'strip_target_package_defaults' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'select \(DEFAULT_|MODULE_DEFAULT_' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'Existing SDK package selections are restored' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'kmod-nft-queue' "$ROOT_DIR/openwrt/README.md"
require_grep '19\.07' "$ROOT_DIR/openwrt/README.md"
require_grep 'config fakesip' "$PKG_DIR/files/fakesip.config"
require_grep "option ipv6 '1'" "$PKG_DIR/files/fakesip.config"
require_grep "option silent '1'" "$PKG_DIR/files/fakesip.config"
require_grep "option repeat '1'" "$PKG_DIR/files/fakesip.config"
require_grep "option sip_profile 'china_all'" "$PKG_DIR/files/fakesip.config"
require_grep "option interface_mode 'network'" "$PKG_DIR/files/fakesip.config"
require_grep 'USE_PROCD=1' "$PKG_DIR/files/fakesip.init"
require_grep 'network_get_device' "$PKG_DIR/files/fakesip.init"
require_grep 'start_instance main' "$PKG_DIR/files/fakesip.init"
require_grep 'ims\.mnc000\.mcc460\.3gppnetwork\.org' "$PKG_DIR/files/fakesip.init"
require_grep 'ims\.mnc001\.mcc460\.3gppnetwork\.org' "$PKG_DIR/files/fakesip.init"
require_grep 'ims\.mnc003\.mcc460\.3gppnetwork\.org' "$PKG_DIR/files/fakesip.init"
require_grep 'FS_FAKE_IPV4_ID' "$ROOT_DIR/include/ipv4pkt.h"
require_grep 'FS_FAKE_IPV6_FLOW_WORD' "$ROOT_DIR/include/ipv6pkt.h"
require_grep '@th,96,16' "$ROOT_DIR/src/ipv4nft.c"
require_grep '@th,64,32' "$ROOT_DIR/src/ipv6nft.c"
forbid_grep 'ipt_.*icmp_cmd' "$ROOT_DIR/src/ipv4ipt.c"
forbid_grep 'ipt_.*icmp_cmd' "$ROOT_DIR/src/ipv6ipt.c"
require_grep 'BuildPackage,luci-app-fakesip' "$LUCI_DIR/Makefile"
require_grep 'PKG_VERSION:=0.9.1' "$LUCI_DIR/Makefile"
require_grep 'PKG_RELEASE:=23' "$LUCI_DIR/Makefile"
require_grep '^[[:space:]]+PKGARCH:=all$' "$LUCI_DIR/Makefile"
require_grep 'luci-base' "$LUCI_DIR/Makefile"
require_grep 'rpcd-mod-file' "$LUCI_DIR/Makefile"
require_grep 'luci-base/host' "$LUCI_DIR/Makefile"
require_grep 'po2lmo .*po/zh_Hant/fakesip.po' "$LUCI_DIR/Makefile"
require_grep 'fakesip.zh-tw.lmo' "$LUCI_DIR/Makefile"
require_grep 'admin/services/fakesip' "$LUCI_DIR/root/usr/share/luci/menu.d/luci-app-fakesip.json"
require_grep 'luci-app-fakesip' "$LUCI_DIR/root/usr/share/rpcd/acl.d/luci-app-fakesip.json"
require_grep 'form.Map..fakesip' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "form.NamedSection, 'main', 'fakesip'" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "form.ListValue, 'sip_profile'" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep 'china_sip_observed' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "widgets.NetworkSelect, 'network'" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "widgets.DeviceSelect, 'interface'" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep 'isRedundantIpv6Network' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "form.ListValue, 'interface_mode'" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'addremove = true' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "o.default = '1';" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "range\\(1,65535\\)" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'range\(1,4294967295\)' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep "fs.exec\('/etc/init.d/fakesip', \[ 'status' \]\)" "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'fs.exec_direct' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'window.location.reload' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep 'poll.add\(this.statusPoll, 5\)' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep 'getSectionOptionUIElement' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
require_grep 'notifyServiceSuccess' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'node.insertBefore\(this.renderStatusPanel' "$LUCI_DIR/root/www/luci-static/resources/view/fakesip/fakesip.js"
forbid_grep 'nbytes < 0 && errno != EPERM' "$ROOT_DIR/src/rawsend.c"
require_grep '^    if \(nbytes < 0\) \{' "$ROOT_DIR/src/rawsend.c"
require_grep 'if \(g_ctx.daemon && g_ctx.logfp == stderr\)' "$ROOT_DIR/src/mainfun.c"
require_grep "has no usable interface" "$PKG_DIR/files/fakesip.init"
require_grep 'type f -o -type l' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'chown -R 0:0' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'install -m 0600 .*fakesip.config' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'LUCI_MAKE_ARCH=\$\(pkg_field .* PKGARCH\)' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep '--info "arch:\$ARCH"' "$ROOT_DIR/tools/build-openwrt-apk.sh"
forbid_grep '--info "arch:\$LUCI_ARCH"' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'cp -Rp .*openwrt/\$package.*PACKAGE_DIR/\$package' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
forbid_grep 'ln -s .*openwrt/\$package' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'package/fakesip/clean' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep 'package/luci-app-fakesip/clean' "$ROOT_DIR/tools/build-openwrt-ipk.sh"
require_grep '--script "post-install:' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep '--script "pre-deinstall:' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'default_postinst' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'default_prerm' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'staging_dir/hostpkg/bin/po2lmo' "$ROOT_DIR/tools/build-openwrt-apk.sh"
require_grep 'fakesip.zh-tw.lmo' "$ROOT_DIR/tools/build-openwrt-apk.sh"

logger_setup_line=$(grep -n 'res = fs_logger_setup();' "$ROOT_DIR/src/mainfun.c" | tail -n 1 | cut -d: -f1)
daemon_silent_line=$(grep -n 'if (g_ctx.daemon && g_ctx.logfp == stderr)' "$ROOT_DIR/src/mainfun.c" | cut -d: -f1)
[ -n "$logger_setup_line" ] && [ -n "$daemon_silent_line" ] &&
	[ "$logger_setup_line" -lt "$daemon_silent_line" ] ||
	fail "daemon silent-mode decision must follow logger setup"

resolved_iface_line=$(grep -n 'if \[ -z "$FS_IFACES_ADDED" \]' "$PKG_DIR/files/fakesip.init" | cut -d: -f1)
open_instance_line=$(grep -n 'procd_open_instance "$section"' "$PKG_DIR/files/fakesip.init" | cut -d: -f1)
[ -n "$resolved_iface_line" ] && [ -n "$open_instance_line" ] &&
	[ "$resolved_iface_line" -lt "$open_instance_line" ] ||
	fail "usable interfaces must be validated before opening a procd instance"

direction_guard_line=$(grep -n 'has no enabled traffic direction' "$PKG_DIR/files/fakesip.init" | cut -d: -f1)
family_guard_line=$(grep -n 'has no enabled IP family' "$PKG_DIR/files/fakesip.init" | cut -d: -f1)
[ -n "$direction_guard_line" ] && [ -n "$family_guard_line" ] &&
	[ "$direction_guard_line" -lt "$open_instance_line" ] &&
	[ "$family_guard_line" -lt "$open_instance_line" ] ||
	fail "traffic direction and IP family guards must precede procd startup"

printf 'OpenWrt package smoke test passed.\n'
