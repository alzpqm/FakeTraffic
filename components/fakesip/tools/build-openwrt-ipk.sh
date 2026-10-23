#!/usr/bin/env sh
set -eu

ROOT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

usage() {
    cat <<EOF
Usage: $0 <openwrt-sdk-dir> [output-dir]

Build OpenWrt 24.10 and older IPK packages from this working tree.

The SDK must match the target release and architecture. The script temporarily
copies the two local package recipes into the SDK, builds them with the OpenWrt
package system, and removes only those copies and the temporary SDK configuration
it created. Existing SDK package selections are restored after the build.

Environment overrides:
  V          OpenWrt build verbosity, default: s
  ALL_KMODS  SDK all-kernel-modules selection, default: n
  ALL_NONSHARED
             SDK all-nonshared-package selection, default: n
  ALL_PACKAGES
             SDK all-package selection, default: n
EOF
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ] || [ "$#" -lt 1 ]; then
    usage
    [ "$#" -lt 1 ] && exit 1 || exit 0
fi

SDK_DIR=$(CDPATH= cd -- "$1" && pwd)
OUT_DIR=${2:-"$ROOT_DIR/build/openwrt-ipk"}
PACKAGE_DIR="$SDK_DIR/package"
V=${V:-s}
ALL_KMODS=${ALL_KMODS:-n}
ALL_NONSHARED=${ALL_NONSHARED:-n}
ALL_PACKAGES=${ALL_PACKAGES:-n}

[ -f "$SDK_DIR/include/toplevel.mk" ] || {
    echo "not an OpenWrt SDK/buildroot: $SDK_DIR" >&2
    exit 1
}
[ -d "$PACKAGE_DIR" ] || {
    echo "missing OpenWrt package directory: $PACKAGE_DIR" >&2
    exit 1
}

case "$ALL_KMODS:$ALL_NONSHARED:$ALL_PACKAGES" in
    y:y:y|y:y:n|y:n:y|y:n:n|n:y:y|n:y:n|n:n:y|n:n:n) ;;
    *)
        echo "ALL_KMODS, ALL_NONSHARED, and ALL_PACKAGES must each be y or n" >&2
        exit 1
        ;;
esac

for feed in base packages luci; do
    [ -d "$SDK_DIR/feeds/$feed" ] || {
        echo "missing OpenWrt '$feed' feed in SDK: $SDK_DIR/feeds/$feed" >&2
        echo "run './scripts/feeds update $feed && ./scripts/feeds install -a -p $feed' first" >&2
        exit 1
    }
done

PACKAGES_CREATED=""
BACKUP_DIR="${TMPDIR:-/tmp}/fakesip-ipk.$$"
mkdir -p "$BACKUP_DIR"
CONFIG_BACKUP="$BACKUP_DIR/config"
CONFIG_OLD_BACKUP="$BACKUP_DIR/config.old"
TARGET_CONFIG_BACKUP="$BACKUP_DIR/config-target.in"
BUILD_CONFIG_BACKUP="$BACKUP_DIR/Config-build.in"
MAIN_CONFIG_BACKUP="$BACKUP_DIR/Config.in"
CONFIG_WAS_PRESENT=0
CONFIG_OLD_WAS_PRESENT=0
TARGET_CONFIG_WAS_PRESENT=0
BUILD_CONFIG_WAS_PRESENT=0
MAIN_CONFIG_WAS_PRESENT=0
CLEANED_UP=0
cleanup() {
    [ "$CLEANED_UP" -eq 0 ] || return 0
    CLEANED_UP=1
    for package in $PACKAGES_CREATED; do
        rm -rf "$PACKAGE_DIR/$package"
    done
    if [ "$CONFIG_WAS_PRESENT" -eq 1 ]; then
        mv -f "$CONFIG_BACKUP" "$SDK_DIR/.config"
    else
        rm -f "$SDK_DIR/.config" "$CONFIG_BACKUP"
    fi
    if [ "$CONFIG_OLD_WAS_PRESENT" -eq 1 ]; then
        mv -f "$CONFIG_OLD_BACKUP" "$SDK_DIR/.config.old"
    else
        rm -f "$SDK_DIR/.config.old" "$CONFIG_OLD_BACKUP"
    fi
    if [ "$TARGET_CONFIG_WAS_PRESENT" -eq 1 ]; then
        mv -f "$TARGET_CONFIG_BACKUP" "$SDK_DIR/tmp/.config-target.in"
    else
        rm -f "$SDK_DIR/tmp/.config-target.in" "$TARGET_CONFIG_BACKUP"
    fi
    if [ "$BUILD_CONFIG_WAS_PRESENT" -eq 1 ]; then
        mv -f "$BUILD_CONFIG_BACKUP" "$SDK_DIR/Config-build.in"
    else
        rm -f "$SDK_DIR/Config-build.in" "$BUILD_CONFIG_BACKUP"
    fi
    if [ "$MAIN_CONFIG_WAS_PRESENT" -eq 1 ]; then
        mv -f "$MAIN_CONFIG_BACKUP" "$SDK_DIR/Config.in"
    else
        rm -f "$SDK_DIR/Config.in" "$MAIN_CONFIG_BACKUP"
    fi
    rm -rf "$BACKUP_DIR"
}
trap cleanup EXIT HUP INT TERM

for package in fakesip luci-app-fakesip; do
    if [ -e "$PACKAGE_DIR/$package" ] || [ -L "$PACKAGE_DIR/$package" ]; then
        echo "package path already exists in SDK: $PACKAGE_DIR/$package" >&2
        echo "remove it or use a clean SDK before running this helper" >&2
        exit 1
    fi
    cp -Rp "$ROOT_DIR/openwrt/$package" "$PACKAGE_DIR/$package"
    PACKAGES_CREATED="$PACKAGES_CREATED $package"
done

mkdir -p "$OUT_DIR"

if [ -f "$SDK_DIR/.config" ]; then
    cp -p "$SDK_DIR/.config" "$CONFIG_BACKUP"
    CONFIG_WAS_PRESENT=1
fi
if [ -f "$SDK_DIR/.config.old" ]; then
    cp -p "$SDK_DIR/.config.old" "$CONFIG_OLD_BACKUP"
    CONFIG_OLD_WAS_PRESENT=1
fi
if [ -f "$SDK_DIR/tmp/.config-target.in" ]; then
    cp -p "$SDK_DIR/tmp/.config-target.in" "$TARGET_CONFIG_BACKUP"
    TARGET_CONFIG_WAS_PRESENT=1
fi
if [ -f "$SDK_DIR/Config-build.in" ]; then
    cp -p "$SDK_DIR/Config-build.in" "$BUILD_CONFIG_BACKUP"
    BUILD_CONFIG_WAS_PRESENT=1
fi
if [ -f "$SDK_DIR/Config.in" ]; then
    cp -p "$SDK_DIR/Config.in" "$MAIN_CONFIG_BACKUP"
    MAIN_CONFIG_WAS_PRESENT=1
fi

strip_profile_defaults() {
    config_build="$SDK_DIR/Config-build.in"
    temp="$config_build.fakesip.$$"

    [ -f "$config_build" ] || {
        echo "missing SDK Config-build.in: $config_build" >&2
        exit 1
    }
    awk '
        /^[[:space:]]*config[[:space:]]+/ {
            name = $2
            suppress = 0
            if (name ~ /^DEFAULT_/ && name != "DEFAULT_TARGET_OPTIMIZATION")
                suppress = 1
            if (name ~ /^MODULE_DEFAULT_/)
                suppress = 1
            if (name ~ /^(PACKAGE_|LUCI_)/)
                suppress = 1
            if (name ~ /^(ALL|ALL_KMODS|ALL_NONSHARED|BUILDBOT|TARGET_ALL_PROFILES|TARGET_PER_DEVICE_ROOTFS)$/)
                suppress = 1
            print
            next
        }
        suppress && /^[[:space:]]*default[[:space:]]+(y|m)([[:space:]]|$)/ {
            sub(/default (y|m)/, "default n")
        }
        { print }
    ' "$config_build" > "$temp"
    mv -f "$temp" "$config_build"
}

strip_global_package_defaults() {
    config_in="$SDK_DIR/Config.in"
    temp="$config_in.fakesip.$$"

    [ -f "$config_in" ] || {
        echo "missing SDK Config.in: $config_in" >&2
        exit 1
    }
    awk '
        /^[[:space:]]*config[[:space:]]+(ALL|ALL_KMODS|ALL_NONSHARED)[[:space:]]*$/ {
            suppress = 1
            print
            next
        }
        /^[[:space:]]*config[[:space:]]+/ { suppress = 0 }
        suppress && /^[[:space:]]*default[[:space:]]+(ALL|y|m)([[:space:]]|$)/ {
            sub(/default (ALL|y|m)/, "default n")
        }
        { print }
    ' "$config_in" > "$temp"
    mv -f "$temp" "$config_in"
}

strip_global_package_defaults
strip_profile_defaults
FAKESIP_SRC_DIR="$ROOT_DIR" make -C "$SDK_DIR" defconfig \
    >/dev/null

strip_package_selections() {
    config="$SDK_DIR/.config"
    temp="$config.fakesip.$$"

    sed -E \
        -e 's/^CONFIG_PACKAGE_([^=]+)=.*/# CONFIG_PACKAGE_\1 is not set/' \
        -e 's/^CONFIG_LUCI_([^=]+)=.*/# CONFIG_LUCI_\1 is not set/' \
        "$config" > "$temp"
    awk '
        /^CONFIG_DEFAULT_TARGET_/ { print; next }
        /^CONFIG_DEFAULT_[^=]+=/{
            key = $1
            sub(/^CONFIG_/, "", key)
            print "# CONFIG_" key " is not set"
            next
        }
        /^CONFIG_MODULE_DEFAULT_[^=]+=/{
            key = $1
            sub(/^CONFIG_/, "", key)
            print "# CONFIG_" key " is not set"
            next
        }
        { print }
    ' "$temp" > "$temp.defaults"
    mv -f "$temp.defaults" "$temp"
    awk '/^[[:space:]]*config (PACKAGE_|LUCI_)/ {
        print "# CONFIG_" $2 " is not set"
    }' "$SDK_DIR/tmp/.config-package.in" | sort -u >> "$temp"
    mv -f "$temp" "$config"
}

strip_target_package_defaults() {
    target_config="$SDK_DIR/tmp/.config-target.in"
    temp="$target_config.fakesip.$$"

    [ -f "$target_config" ] || {
        echo "missing generated target Kconfig: $target_config" >&2
        exit 1
    }
    sed -E '/^[[:space:]]*select (DEFAULT_|MODULE_DEFAULT_)/d' \
        "$target_config" > "$temp"
    mv -f "$temp" "$target_config"
}

set_config_value() {
    key=$1
    value=$2
    config="$SDK_DIR/.config"
    temp="$config.fakesip.$$"

    sed \
        -e "/^CONFIG_${key}=.*/d" \
        -e "/^# CONFIG_${key} is not set$/d" \
        "$config" > "$temp"
    case "$value" in
        y|m) printf 'CONFIG_%s=%s\n' "$key" "$value" >> "$temp" ;;
        n) printf '# CONFIG_%s is not set\n' "$key" >> "$temp" ;;
        *)
            rm -f "$temp"
            echo "invalid Kconfig value for $key: $value" >&2
            exit 1
            ;;
    esac
    mv -f "$temp" "$config"
}

set_config_bool() {
    set_config_value "$1" "$2"
}

strip_package_selections
strip_target_package_defaults
set_config_bool ALL_KMODS "$ALL_KMODS"
set_config_bool ALL_NONSHARED "$ALL_NONSHARED"
set_config_bool ALL "$ALL_PACKAGES"

if [ -f "$SDK_DIR/feeds/base/firewall4/Makefile" ] ||
   [ -f "$SDK_DIR/feeds/base/package/network/config/firewall4/Makefile" ]; then
    FIREWALL_PACKAGE=firewall4
elif [ -f "$SDK_DIR/feeds/base/firewall/Makefile" ] ||
     [ -f "$SDK_DIR/feeds/base/package/network/config/firewall/Makefile" ]; then
    FIREWALL_PACKAGE=firewall
else
    echo "could not identify firewall4 or firewall in the base feed" >&2
    exit 1
fi
set_config_bool "PACKAGE_$FIREWALL_PACKAGE" y
set_config_value PACKAGE_fakesip m
set_config_value PACKAGE_luci-app-fakesip m

selected_packages=$(grep -E '^CONFIG_(PACKAGE_|LUCI_).*=([ym])$' "$SDK_DIR/.config" |
    grep -Ev '^CONFIG_PACKAGE_(firewall4|firewall|fakesip|luci-app-fakesip)=' |
    wc -l | tr -d ' ')
[ "$selected_packages" -eq 0 ] || {
    echo "SDK still contains $selected_packages selected package symbols after cleanup" >&2
    exit 1
}

for config_pair in \
    "ALL_KMODS=$ALL_KMODS" \
    "ALL_NONSHARED=$ALL_NONSHARED" \
    "ALL=$ALL_PACKAGES"; do
    config_key=${config_pair%%=*}
    config_value=${config_pair#*=}
    if [ "$config_value" = y ]; then
        grep -Eq "^CONFIG_${config_key}=y$" "$SDK_DIR/.config"
    else
        grep -Eq "^# CONFIG_${config_key} is not set$" "$SDK_DIR/.config"
    fi
done

grep -Eq "^CONFIG_PACKAGE_${FIREWALL_PACKAGE}=y$" "$SDK_DIR/.config"

printf 'OpenWrt SDK selection: ALL_KMODS=%s ALL_NONSHARED=%s ALL=%s\n' \
    "$ALL_KMODS" "$ALL_NONSHARED" "$ALL_PACKAGES"

# Package path changes do not always invalidate SDK stamps or old IPKs. Clean
# both local packages so control metadata is regenerated from the copied recipe.
FAKESIP_SRC_DIR="$ROOT_DIR" make -C "$SDK_DIR" \
    NO_DEPS=1 \
    package/fakesip/clean \
    package/luci-app-fakesip/clean \
    V="$V"

FAKESIP_SRC_DIR="$ROOT_DIR" make -C "$SDK_DIR" \
    package/feeds/base/libmnl/compile \
    package/feeds/base/libnfnetlink/compile \
    package/feeds/packages/libnetfilter-queue/compile \
    V="$V"

# Kernel package dependencies are recorded in the IPK control file and are
# supplied by the target release feed. Building them from an SDK would enter
# the complete kernel package graph, so compile only the two local packages.
FAKESIP_SRC_DIR="$ROOT_DIR" make -C "$SDK_DIR" \
    NO_DEPS=1 \
    package/fakesip/compile \
    package/luci-app-fakesip/compile \
    V="$V"

copy_latest_ipk() {
    pattern=$1
    destination=$2
    candidate=$(find "$SDK_DIR/bin/packages" -type f -name "$pattern" -print |
        sort | tail -n 1)
    [ -n "$candidate" ] || {
        echo "could not find built package matching $pattern" >&2
        exit 1
    }
    cp -f "$candidate" "$OUT_DIR/"
    printf '%s\n' "$OUT_DIR/$(basename "$candidate")"
}

copy_latest_ipk 'fakesip_*.ipk' fakesip
copy_latest_ipk 'luci-app-fakesip_*.ipk' luci-app-fakesip

printf 'OpenWrt IPK packages written to %s\n' "$OUT_DIR"
