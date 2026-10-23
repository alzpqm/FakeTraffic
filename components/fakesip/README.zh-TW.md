# FakeSIP

[English](README.md) | [正體中文](README.zh-TW.md)

FakeSIP 透過 Netfilter Queue（NFQUEUE），在指定 UDP 流量旁送出外觀類似 SIP
的偽裝封包，適合用於受控環境中的網路相容性與 DPI 研究。

本軟體不保證電信業者一定會提高優先權或解除限速。實際效果會受到線路、路由、
流量型態與偽裝內容影響，請以同一測試點的 A/B 測試結果判斷。

## OpenWrt 快速安裝

GitHub Releases 僅提供 OpenWrt 25 及更新版本可直接安裝的 APK：

- `fakesip-*.apk`：核心服務
- `luci-app-fakesip-*.apk`：LuCI 控制頁面，內含英文與正體中文

下載與路由器架構相符的套件後執行：

```sh
apk add --allow-untrusted /tmp/fakesip-*.apk
apk add --allow-untrusted /tmp/luci-app-fakesip-*.apk
```

安裝後前往 **服務 > FakeSIP**。建議操作方式：

1. 啟用 `main` 設定。
2. WAN 選擇方式保留 **OpenWrt 網路（建議）**。
3. 選擇實際撥號使用的 `wan`、`wan2` 等邏輯網路。
4. 依需求啟用 IPv4、IPv6 與輸出流量。
5. 使用 **儲存並套用**；服務會跟隨 OpenWrt 網路重新連線。

OpenWrt 網路會自動解析到目前的 PPPoE Linux 裝置。一般使用者不必手動選
`pppoe-wan`；只有特殊拓撲或舊設定才需要 **Linux 裝置（進階）** 模式。
`wan_6` 若與 `wan` 共用同一個 PPP 裝置，LuCI 會自動收合；是否處理 IPv6
由 IPv6 開關決定，不必重複選擇同一條撥號介面。

## OpenWrt 25 以下版本

OpenWrt 24.10、23.05、22.03、21.02 與 19.07 不再提供預先編譯的 IPK。
原始碼仍保留相容支援，請使用與路由器版本及架構完全相符的 OpenWrt SDK
自行編譯：

```sh
./tools/build-openwrt-ipk.sh /path/to/openwrt-sdk /tmp/fakesip-ipk
```

完整依賴、舊版 firewall3/iptables 設定與 SDK 操作請參閱
[OpenWrt 正體中文說明](openwrt/README.zh-TW.md)。

## SIP 偽裝設定檔

新安裝預設輪替中國移動、中國聯通與中國電信的標準 IMS 格式。另有標準 SIP、
單一業者、家庭網路觀察到的 5260 SIP/RCS 實驗設定，以及自訂 SIP URI。

設定檔只產生偽裝封包，不會登入 IMS、使用真實門號或連線到設定中的 SIP
網域。公開網域與格式也不能證明存在 QoS 白名單，應視為待測候選。

## 日誌與檢查

長時間使用建議開啟 **靜默模式**，避免大量封包日誌占滿 `/tmp`。除錯時可暫時
關閉，完成後再恢復。

```sh
/etc/init.d/fakesip status
logread -e fakesip
nft list table ip fakesip
cat /proc/net/netfilter/nfnetlink_queue
```

預設 NFQUEUE 編號為 `513`。正常運作時不應持續增加 kernel drop 或 user drop。

## Linux 快速使用

```sh
fakesip -i eth0
```

建置後可執行核心回歸測試：

```sh
make DEBUG=1
./tools/core-regression-test.sh
```

## 授權

GNU General Public License v3.0
