# FakeTraffic

OpenWrt 的 TCP 與 UDP／SIP 流量偽裝工具，在同一個 LuCI 頁面設定，由同一個服務管理。
0.2.0 使用 NFQUEUE，核心套件內含 TCP 與 UDP 引擎，不必另裝兩套舊服務。

## 套件與使用

- `faketraffic`：核心服務與兩個引擎。
- `luci-app-faketraffic`：共同設定頁及服務啟停。

套件適用 OpenWrt 25.12／x86_64。先核對 SHA256SUMS，再依[安裝與回復說明](docs/migration.md)
安裝相符版本。從 LuCI「服務 → FakeTraffic」選擇介面、啟用 TCP／UDP、設定偽裝內容並儲存套用。
全新安裝不自動啟動服務；舊服務不可與新版並行注入。

TTL／Hop Limit 應讓偽裝封包在抵達真實對端前耗盡；本工具不保證所有網路的分類效果或效能改善。

## 開發

Linux 需 C compiler、make、libnetfilter_queue／libnfnetlink／libmnl 開發檔；
測試另需 Node.js、gettext 與 Perl json_pp。

```sh
make all
make test
sudo make packages SDK=/absolute/path/to/openwrt-sdk
```

來源版本與雜湊見 [sources.lock.json](sources.lock.json)，版權與授權見 [NOTICE](NOTICE)。
