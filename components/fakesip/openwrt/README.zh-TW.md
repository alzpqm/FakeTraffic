# FakeSIP OpenWrt 套件

[English](README.md) | [正體中文](README.zh-TW.md)

本目錄包含 FakeSIP 核心套件、UCI 預設設定、procd 服務與 LuCI 控制頁面。

## 支援範圍

| OpenWrt 版本 | 提供方式 | 套件格式 | 預設防火牆 | FakeSIP 設定 |
| --- | --- | --- | --- | --- |
| 25.12 及更新版本 | GitHub Release | APK / `apk` | firewall4 / nftables | `use_iptables='0'` |
| 24.10、23.05、22.03 | 自行編譯 | IPK / `opkg` | firewall4 / nftables | `use_iptables='0'` |
| 21.02、19.07 | 自行編譯 | IPK / `opkg` | firewall3 / iptables | `use_iptables='1'` |

GitHub Releases 只發佈 OpenWrt 25 及更新版本的 APK。OpenWrt 25 以下版本
仍保留原始碼相容支援，但使用者必須以對應版本、目標與架構的 SDK 自行編譯；
專案不發佈預先編譯的舊版 IPK。OpenWrt 18.06 與更舊版本目前不宣告支援。

## OpenWrt 25+ 安裝

將 Release 中的兩個 APK 上傳到路由器：

```sh
scp fakesip-*.apk luci-app-fakesip-*.apk root@192.168.1.1:/tmp/
ssh root@192.168.1.1
apk add --allow-untrusted /tmp/fakesip-*.apk
apk add --allow-untrusted /tmp/luci-app-fakesip-*.apk
```

`fakesip` 是核心服務；`luci-app-fakesip` 是 LuCI 頁面，已內含正體中文翻譯。
若安裝前手動修改過 `/etc/init.d/fakesip`，`apk` 可能保留舊檔並產生
`/etc/init.d/fakesip.apk-new`，請先比較並處理後再測試服務。

## OpenWrt 25 以下自行編譯

下載與路由器版本、目標平台及 CPU 架構完全相符的官方 OpenWrt SDK，安裝
`base`、`packages` 與 `luci` feeds，再執行：

```sh
cd /path/to/openwrt-sdk
./scripts/feeds update base packages luci
./scripts/feeds install -a -p base
./scripts/feeds install -a -p packages
./scripts/feeds install -a -p luci

cd /path/to/FakeSIP
./tools/build-openwrt-ipk.sh /path/to/openwrt-sdk /tmp/fakesip-ipk
```

產生的 IPK 位於指定輸出目錄，以 `opkg install` 安裝。21.02 與 19.07 使用
firewall3，還必須安裝 iptables NFQUEUE 與 connbytes 相關模組，並設定：

```sh
uci set fakesip.main.use_iptables='1'
uci commit fakesip
/etc/init.d/fakesip restart
```

OpenWrt 22.03 以上預設使用 firewall4/nftables，通常保持 `use_iptables='0'`。

## 執行環境依賴

- 全版本：`libnetfilter-queue`、`libnfnetlink`、`libmnl`、`kmod-nfnetlink-queue`
- firewall4：`nftables-json`（或 `nftables-nojson`）、`kmod-nft-queue`
- firewall3：`iptables`、`ip6tables`、`iptables-mod-nfqueue`、
  `iptables-mod-conntrack-extra`
- LuCI：`luci-base`、`rpcd-mod-file`

## LuCI 設定

安裝後前往 **服務 > FakeSIP**。預設設定不會自動啟用，以免安裝後突然改變
流量。一般使用者建議：

1. 啟用 `main`。
2. WAN 選擇方式使用 **OpenWrt 網路（建議）**。
3. 選擇 `wan`、`wan2` 等實際撥號的邏輯網路，每條 WAN 只選一次。
4. 保持輸出流量開啟，依需求啟用 IPv4 與 IPv6。
5. 選擇 SIP 偽裝設定檔，按 **儲存並套用**。

OpenWrt 邏輯網路會解析到目前使用中的 PPPoE Linux 裝置，也能配合 procd 在
重新撥號後重建服務。`wan_6` 若與 `wan` 共用相同 L3 裝置，LuCI 會自動收合；
這不代表 IPv6 未偽裝，IPv6 開關才決定處理的位址族。

**Linux 裝置（進階）** 只保留給沒有可用 OpenWrt 邏輯網路的特殊或舊式設定。
直接指定 `pppoe-wan` 不具備相同的邏輯網路重連觸發，一般使用者不需要選它。

SSH 的等效設定：

```sh
uci set fakesip.main.enabled='1'
uci set fakesip.main.interface_mode='network'
uci -q delete fakesip.main.network
uci -q delete fakesip.main.interface
uci add_list fakesip.main.network='wan'
uci set fakesip.main.outbound='1'
uci set fakesip.main.inbound='0'
uci set fakesip.main.ipv4='1'
uci set fakesip.main.ipv6='1'
uci set fakesip.main.silent='1'
uci commit fakesip
/etc/init.d/fakesip enable
/etc/init.d/fakesip restart
```

多 WAN 應加入同一個 `main` 實例，不要為每條 WAN 建立不同 FakeSIP 程序，
以免共用 nft table/chain 時讓後續 NFQUEUE 規則無法到達。

## SIP Payload

新安裝預設使用 `china_all`，依設定順序輪替中國移動、中國聯通與中國電信的
標準 IMS 格式。可用值包括 `standard`、`china_mobile`、`china_unicom`、
`china_telecom`、`china_all`、`china_sip_observed` 與 `custom`。

`china_sip_observed` 是家庭網路中觀察到的兩個 5260 SIP/RCS 網域實驗設定。
FakeSIP 只把 Host 與連接埠文字放入 IMS 風格的 INVITE，不會解析或連線到該
網域，也不能因此推論電信業者提供 QoS 白名單。

自訂設定範例：

```sh
uci set fakesip.main.sip_profile='custom'
uci -q delete fakesip.main.sip_uri
uci add_list fakesip.main.sip_uri='sip:user@example.com'
uci commit fakesip
/etc/init.d/fakesip restart
```

## 健康檢查

```sh
/etc/init.d/fakesip status
logread -e fakesip
nft list table ip fakesip
nft list table ip6 fakesip
cat /proc/net/netfilter/nfnetlink_queue
```

預設佇列是 `513`。長時間執行建議保持靜默模式；除錯才暫時關閉，否則忙碌
線路的大量日誌可能快速占滿 `/tmp`。NFQUEUE 的 backlog、kernel drop 與
user drop 不應持續增加。

## 從目前工作樹建置 OpenWrt 25 APK

```sh
./tools/build-openwrt-apk.sh /path/to/openwrt-sdk
```

腳本會建置核心與 LuCI APK，並把正體中文 LMO 一起封裝。一般 SDK recipe
建置則可把 `openwrt/fakesip` 與 `openwrt/luci-app-fakesip` 複製到 SDK 的
`package/` 目錄；詳細命令請參閱 [English OpenWrt README](README.md)。
