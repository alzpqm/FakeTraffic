# FakeSIP OpenWrt Package

[English](README.md) | [正體中文](README.zh-TW.md)

This directory contains an OpenWrt package recipe, a UCI config, and a procd
service script for FakeSIP.

## Compatibility Matrix

The package uses the native package format of each OpenWrt release:

| OpenWrt releases | Availability | Package format | Default firewall path | FakeSIP setting |
| --- | --- | --- | --- | --- |
| 25.12 and newer | GitHub Release | APK via `apk` | `fw4`/nftables | `use_iptables='0'` |
| 24.10, 23.05, 22.03 | Build from source | IPK via `opkg` | `fw4`/nftables | `use_iptables='0'` |
| 21.02 | Build from source | IPK via `opkg` | `fw3`/iptables | `use_iptables='1'` |
| 19.07 | Build from source | IPK via `opkg` | `fw3`/iptables | `use_iptables='1'` |

This repository's compatibility gate covers OpenWrt 19.07 through 25.12. The
18.06 and older series use an earlier LuCI JavaScript packaging/API generation
and are not claimed as supported until they receive a separate port.

GitHub Releases publish only OpenWrt 25+ APK files. OpenWrt 24.10 and older are
supported as source-build targets: use the SDK matching the router's exact
release and architecture. Prebuilt IPKs are not published.

OpenWrt 22.03 and later use firewall4/nftables by default. OpenWrt 19.07 and
21.02 use the legacy firewall3/iptables path by default. The core binary
contains both backends; the selected path is controlled by `use_iptables` and
the presence of the matching runtime packages.

## Build With The OpenWrt SDK

For OpenWrt 25 APK packages, the most direct path is:

```sh
./tools/build-openwrt-apk.sh /path/to/openwrt-sdk
```

The script builds from the current working tree, creates both `fakesip` and
`luci-app-fakesip`, and writes APKs under
`/path/to/openwrt-sdk/bin/packages/x86_64/base/` by default.

Copy the package recipes into an OpenWrt SDK or buildroot:

```sh
cp -r /path/to/FakeSIP/openwrt/fakesip /path/to/openwrt-sdk/package/fakesip
cp -r /path/to/FakeSIP/openwrt/luci-app-fakesip /path/to/openwrt-sdk/package/luci-app-fakesip
cd /path/to/openwrt-sdk
make defconfig
make package/fakesip/compile V=s FAKESIP_SRC_DIR=/path/to/FakeSIP
make package/luci-app-fakesip/compile V=s
```

`FAKESIP_SRC_DIR` builds the package from your local working tree. Without it,
the recipe fetches the pinned fork commit in `openwrt/fakesip/Makefile`. The
core and LuCI packages use the same release version, `0.9.1-r23`. The pinned
commit is updated as part of the release process so normal SDK builds reproduce
the released core source.

The package artifact is written under `bin/packages/`.

For OpenWrt 24.10 and older, build the packages yourself. The repository
includes a helper that temporarily adds both local recipes to a matching SDK,
uses a package-only build selection, builds native IPK packages, restores the
SDK `.config`, and copies the packages out:

```sh
./tools/build-openwrt-ipk.sh /path/to/openwrt-sdk /tmp/fakesip-ipk
```

Use an SDK for the exact target and release of the router. The helper refuses
to overwrite an existing `package/fakesip` or
`package/luci-app-fakesip` directory in the SDK. Official SDK archives do not
necessarily contain checked-out feeds; install the feeds before running the
helper:

```sh
cd /path/to/openwrt-sdk
./scripts/feeds update base packages luci
./scripts/feeds install -a -p base
./scripts/feeds install -a -p packages
./scripts/feeds install -a -p luci
```

Runtime prerequisites on the router:

- all releases: `libnetfilter-queue`, `libnfnetlink`, `libmnl`, and
  `kmod-nfnetlink-queue`
- firewall4 releases: `nftables-json` (or `nftables-nojson`) and
  `kmod-nft-queue`
- firewall3/iptables releases: `iptables`, `ip6tables`,
  `iptables-mod-nfqueue`, and `iptables-mod-conntrack-extra`
- LuCI releases: `luci-base` and `rpcd-mod-file` before installing
  `luci-app-fakesip`

## Install On OpenWrt

OpenWrt 25.12 and newer use `apk`:

```sh
scp bin/packages/*/*/fakesip-*.apk root@192.168.1.1:/tmp/
scp bin/packages/*/*/luci-app-fakesip-*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
apk add --allow-untrusted /tmp/fakesip-*.apk
apk add --allow-untrusted /tmp/luci-app-fakesip-*.apk
```

If `/etc/init.d/fakesip` was edited before installing the package, `apk` may
preserve the existing file and write the packaged service as
`/etc/init.d/fakesip.apk-new`. Review and merge it before expecting LuCI/UCI
changes to control the running service.

OpenWrt 24.10 and older use `opkg` after you build the IPKs from source with a
matching SDK:

```sh
scp bin/packages/*/*/fakesip_*.ipk root@192.168.1.1:/tmp/
scp bin/packages/*/*/luci-app-fakesip_*.ipk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
opkg install /tmp/fakesip_*.ipk
opkg install /tmp/luci-app-fakesip_*.ipk
```

On OpenWrt 23.05/22.03, leave `use_iptables` at `0` and make sure the
firewall4 NFQUEUE module is installed. On OpenWrt 19.07/21.02, install the
iptables NFQUEUE and `connbytes` extensions above, then select the iptables
backend:

```sh
uci set fakesip.main.use_iptables='1'
uci commit fakesip
/etc/init.d/fakesip restart
```

If an image uses a non-default firewall backend, follow the runtime package
list for the backend actually installed instead of the release default.

## Configure And Run

The default config is disabled so installation never changes traffic by
surprise. Enable it and point it at your WAN network:

In LuCI, open **Services > FakeSIP**, enable the `main` configuration, keep the
recommended **OpenWrt network** mode, select the WAN network, then use
**Save & Apply**. The init script resolves that logical network to its current
Linux device, including a dynamically created PPPoE device. The registered
procd interface and reload triggers handle reconnects and configuration changes;
the service buttons are for explicit start, restart, or stop operations.

Select each WAN only once. LuCI hides an automatically generated IPv6 companion
such as `wan_6` when it resolves to the same L3 device as `wan`; the IPv4 and
IPv6 switches determine which address families FakeSIP processes. A previously
configured companion remains visible so an existing unusual setup is never
silently discarded.

The same setup from SSH is:

```sh
uci set fakesip.main.enabled='1'
uci set fakesip.main.interface_mode='network'
uci -q delete fakesip.main.network
uci -q delete fakesip.main.interface
uci add_list fakesip.main.network='wan'
uci set fakesip.main.ipv4='1'
uci set fakesip.main.ipv6='1'
uci set fakesip.main.outbound='1'
uci set fakesip.main.inbound='0'
uci set fakesip.main.silent='1'
uci -q delete fakesip.main.log_file
uci commit fakesip

/etc/init.d/fakesip enable
/etc/init.d/fakesip start
```

For multi-WAN, add each logical network to the same instance. Running one
FakeSIP process per WAN with separate queue numbers can make later queues
unreachable because all instances share the same nft table and chain names.
The package therefore exposes and starts only the `main` UCI section. Add every
WAN network to that one section.

```sh
uci add_list fakesip.main.network='wan2'
uci add_list fakesip.main.network='wan3'
uci commit fakesip
/etc/init.d/fakesip restart
```

The advanced **Linux device** mode is retained for unusual configurations that
do not have a usable OpenWrt logical network. It binds directly to the named
device and therefore cannot use logical-network reconnect triggers:

```sh
uci set fakesip.main.interface_mode='device'
uci -q delete fakesip.main.network
uci -q delete fakesip.main.interface
uci add_list fakesip.main.interface='pppoe-wan'
uci commit fakesip
/etc/init.d/fakesip restart
```

The selected standard mode determines which list is active; retained values
from the other mode are ignored. Configurations created before `interface_mode`
existed remain compatible: network-only and device-only entries infer the
corresponding mode, while old mixed configurations retain their combined
behavior under **Legacy combined** until the user chooses a standard mode.

## SIP Payload Profile

Fresh installs default to rotating standards-based IMS payloads for China
Mobile, China Unicom, and China Telecom. In LuCI, select the profile under the
**Payload** tab. The equivalent UCI values are:

```sh
uci set fakesip.main.sip_profile='china_all'
uci commit fakesip
/etc/init.d/fakesip restart
```

Available values are `standard`, `china_mobile`, `china_unicom`,
`china_telecom`, `china_all`, `china_sip_observed`, and `custom`. Custom mode
reads one or more `sip_uri` list values:

```sh
uci set fakesip.main.sip_profile='custom'
uci -q delete fakesip.main.sip_uri
uci add_list fakesip.main.sip_uri='sip:user@example.com'
uci commit fakesip
/etc/init.d/fakesip restart
```

The carrier profiles use public 3GPP realm syntax and do not contain real
subscriber identities or IMS credentials. Treat them as test profiles rather
than proof that a particular carrier prioritizes SIP.

The `china_sip_observed` profile is an experimental two-payload rotation based
on SIP/RCS endpoints observed on a home network: China Mobile Chongqing
`sipcq16.xnq.r.10086.cn:5260` and China Telecom Sichuan
`sipsc109.r01.rcs.189.cn:5260`. FakeSIP embeds those host and port strings in
an IMS-style INVITE; it does not resolve or connect to either hostname. They
do not replace the default `china_all` profile and are not evidence of a
carrier QoS whitelist.

## Check It

```sh
/etc/init.d/fakesip status
logread -e fakesip
tail -f /tmp/fakesip.log
nft list table ip fakesip
```

The service should have one queue rule for the configured instance, usually
queue `513`.

The package enables silent mode by default for long-running routers. Set
`fakesip.main.log_file` only while debugging; high-volume packet logs can fill
`/tmp` quickly on busy links.

In nftables mode, FakeSIP tags its forged IPv4/IPv6 packets and suppresses only
time-exceeded replies that quote that tag. Normal `mtr` and traceroute replies
remain visible. The iptables fallback does not suppress time-exceeded traffic
because it cannot perform the same inner-packet match without extra modules.

## Optional iptables Mode

The package depends on nftables because modern OpenWrt uses fw4/nft by default.
For old images that need iptables mode:

```sh
uci set fakesip.main.use_iptables='1'
uci commit fakesip
/etc/init.d/fakesip restart
```

Install the matching iptables/NFQUEUE kernel packages for your OpenWrt release
before enabling this mode.
