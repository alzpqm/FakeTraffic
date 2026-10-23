# FakeSIP

[English](README.md) | [正體中文](README.zh-TW.md)

FakeSIP uses Netfilter Queue (NFQUEUE) to send SIP-shaped decoy packets beside
selected UDP traffic. It is intended for controlled network compatibility and
DPI research.

FakeSIP does not guarantee that a carrier will prioritize or unthrottle a
connection. Results depend on the network, payload, route, and traffic pattern.

## Quick Start

```sh
fakesip -i eth0
```

## OpenWrt

OpenWrt packaging under [`openwrt/`](openwrt/) includes:

- `fakesip`: the binary, UCI configuration, and procd service
- `luci-app-fakesip`: a LuCI page under **Services > FakeSIP**, with English
  and Traditional Chinese

GitHub Releases provide ready-to-install APK packages for OpenWrt 25 and newer.
OpenWrt 24.10 and older remain source-build targets; prebuilt IPKs are not
published. See the [OpenWrt guide](openwrt/README.md) for installation,
configuration, dependencies, and older SDK builds.

## Tests

After building FakeSIP on Linux, run the focused core regression suite:

```sh
make DEBUG=1
./tools/core-regression-test.sh
```

## Usage

```text
Usage: fakesip [options]

Interface Options:
  -a                 work on all network interfaces (ignores -i)
  -i <interface>     work on specified network interface

Payload Options:
  -b <file>          use UDP payload from binary file
  -u <uri>           use specified SIP URI

General Options:
  -0                 process inbound packets
  -1                 process outbound packets
  -4                 process IPv4 connections
  -6                 process IPv6 connections
  -d                 run as a daemon
  -k                 kill the running process
  -s                 enable silent mode
  -w <file>          write log to <file> instead of stderr

Advanced Options:
  -f                 skip firewall rules
  -g                 disable hop count estimation
  -m <mark>          fwmark for bypassing the queue
  -n <number>        netfilter queue number
  -r <repeat>        duplicate generated packets for <repeat> times
  -t <ttl>           TTL for generated packets
  -x <mask>          set the mask for fwmark
  -y <pct>           raise TTL dynamically to <pct>% of estimated hops
  -z                 use iptables commands instead of nft
```

## License

GNU General Public License v3.0
