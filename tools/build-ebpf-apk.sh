#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-or-later
# An existing matching SDK and private target-development prefix are required.
# Builds from pinned sources; never downloads/installs dependencies or services.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SDK=$(CDPATH= cd -- "${1:?matching OpenWrt SDK required}" && pwd)
DEPS=$(CDPATH= cd -- "${2:?target development prefix required}" && pwd)
OUT=${3:-"$ROOT/dist/0.4.0"}
APK=$SDK/staging_dir/host/bin/apk
CC=$(find "$SDK/staging_dir" -path '*/bin/*-openwrt-linux-musl-gcc' -type f | head -n 1)
STRIP=$(find "$SDK/staging_dir" -path '*/bin/*-openwrt-linux-musl-strip' -type f | head -n 1)
READELF=$(find "$SDK/staging_dir" -path '*/bin/*-openwrt-linux-musl-readelf' -type f | head -n 1)
TOOLCHAIN=$(dirname "$(dirname "$CC")")
CLANG=$SDK/staging_dir/host/llvm-bpf/bin/clang
LLVM_STRIP=$SDK/staging_dir/host/llvm-bpf/bin/llvm-strip
export STAGING_DIR=$SDK/staging_dir
[ "$(id -u)" = 0 ] || { echo 'Root required for root-owned APK entries' >&2; exit 1; }
[ -x "$APK" ] && [ -x "$CC" ] && [ -x "$CLANG" ] && [ -x "$LLVM_STRIP" ]
[ -f "$DEPS/include/bpf/libbpf.h" ] && [ -f "$DEPS/include/libelf.h" ] && [ -f "$DEPS/include/zlib.h" ]
node "$ROOT/tools/verify-sources.mjs"
WORK=$(mktemp -d /var/tmp/faketraffic-ebpf-build.XXXXXX)
STAGE=$WORK/stage
mkdir -p "$STAGE/usr/libexec/faketraffic" "$STAGE/usr/lib/faketraffic" "$STAGE/usr/share/licenses/faketraffic-ebpf" "$STAGE/lib/apk/packages" "$OUT"
OUT=$(CDPATH= cd -- "$OUT" && pwd)
cd "$ROOT/components/fakeflow"
"$CC" -Os -Wall -Wextra -Werror -I"$DEPS/include" -Iebpf/include \
  -ffile-prefix-map="$ROOT"=/usr/src/faketraffic ebpf/user/*.c \
  -L"$DEPS/lib" -Wl,-rpath-link,"$DEPS/lib" -lbpf -lelf -lz -o "$STAGE/usr/libexec/faketraffic/ebpf"
"$STRIP" "$STAGE/usr/libexec/faketraffic/ebpf"
"$CLANG" -O2 -g -target bpf -mcpu=v3 -I"$DEPS/include" -I"$TOOLCHAIN/include" -Iebpf/include -Iebpf/bpf \
  -fdebug-compilation-dir=/usr/src/faketraffic/components/fakeflow \
  -fdebug-prefix-map="$ROOT"=/usr/src/faketraffic -fdebug-prefix-map="$DEPS"=/usr/src/target-deps \
  -c ebpf/bpf/observer.bpf.c -o "$STAGE/usr/lib/faketraffic/ebpf.bpf.o"
"$LLVM_STRIP" --strip-debug "$STAGE/usr/lib/faketraffic/ebpf.bpf.o"
"$READELF" -h "$STAGE/usr/libexec/faketraffic/ebpf" | grep -q 'Advanced Micro Devices X86-64'
"$READELF" -h "$STAGE/usr/lib/faketraffic/ebpf.bpf.o" | grep -q 'Linux BPF'
if "$READELF" -d "$STAGE/usr/libexec/faketraffic/ebpf" | grep -Eq 'RPATH|RUNPATH'; then exit 1; fi
cp LICENSE "$STAGE/usr/share/licenses/faketraffic-ebpf/LICENSE"
cp "$ROOT/openwrt/faketraffic-ebpf/pre-deinstall" "$STAGE/usr/libexec/faketraffic/ebpf-pre-deinstall"
(cd "$STAGE" && find . -type f | sed 's#^\./#/#' | LC_ALL=C sort) > "$STAGE/lib/apk/packages/faketraffic-ebpf.list"
chown -R 0:0 "$STAGE"
find "$STAGE" -type d -exec chmod 0755 {} +
find "$STAGE" -type f -exec chmod 0644 {} +
chmod 0755 "$STAGE/usr/libexec/faketraffic/ebpf"
chmod 0755 "$STAGE/usr/libexec/faketraffic/ebpf-pre-deinstall"
"$APK" mkpkg --info 'name:faketraffic-ebpf' --info 'version:0.4.0-r2' \
  --info 'description:FD-owned TCX backend for the single FakeTraffic service' --info 'arch:x86_64' \
  --info 'license:GPL-2.0-only' --info 'origin:faketraffic' --info 'url:https://github.com/alzpqm/FakeTraffic' \
  --info 'maintainer:Codex <codex@local.invalid>' \
  --info 'depends:libc libgcc1 libbpf1 libelf1 zlib ip-full tc-full kmod-sched-bpf kmod-tun faketraffic=0.4.0-r2' \
  --script "pre-deinstall:$ROOT/openwrt/faketraffic-ebpf/pre-deinstall" \
  --files "$STAGE" --output "$OUT/faketraffic-ebpf-0.4.0-r2.apk"
"$APK" adbdump "$OUT/faketraffic-ebpf-0.4.0-r2.apk" | node "$ROOT/tools/check-unified-metadata.mjs"
(cd "$OUT" && sha256sum ./*.apk > SHA256SUMS)
printf 'Private eBPF build work retained: %s\n' "$WORK"
