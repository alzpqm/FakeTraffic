# FakeTraffic

目前開發 **0.2.0 統一產品版，尚未實機驗收／發布**。
進度見 [新版交接](docs/handoff-20261023-unified-product.md)。

FakeHTTP（TCP）與 FakeSIP（UDP）的整合專案。0.2.0提供同頁完整設定、
共同儲存／套用、一個 `faketraffic` 服務與一份UCI，不再跳轉舊專案頁面。
核心套件內含兩個已驗證來源的NFQUEUE引擎；不是把兩套C程式重寫成單一daemon。

這不是 lilu0826/fake-flow 的 fork，也不含它的 eBPF 程式碼。參考該專案的
TCP/UDP 統一管理方式，但保留目前已修復、驗證的封包處理行為。合併不代表
吞吐量提升、電信網路問題已解決或所有資料路徑已驗證。

| 元件 | 本版來源 | 保留的介面 |
| --- | --- | --- |
| TCP引擎 | FakeHTTP 99.3-r1 | 內部binary，procd instance `tcp`、queue 預設512 |
| UDP引擎 | FakeSIP 0.9.1-r23 | 內部binary，procd instance `udp`、queue 預設513 |
| FakeTraffic | 0.2.0-r2 開發版 | 單一服務／UCI／LuCI完整設定頁 |

精確來源、逐檔 SHA-256 與來源 commit 見 `sources.lock.json`；原作者版權與
GPL-3.0-or-later 保留。原始歷史仍在原倉庫，來源導入不包含私人日誌或設備設定。

## 建置與檢查

Linux 需要 C compiler、make、libnetfilter_queue/libnfnetlink/libmnl development
headers；測試另需 Node.js、gettext、Perl json_pp。Debian 可使用既有工具鏈。

```sh
make all
make test
```

這些測試不連線生產路由器。兩引擎原有的 namespace / runtime 驗證工具保留在
各自 `components/` 下，只有改動相應封包或生命週期路徑才執行相應測試。

```sh
# 使用與設備相符的 OpenWrt 25.12 SDK；僅產生套件，不安裝。
sudo make packages SDK=/absolute/path/to/openwrt-sdk
```

只產生 `faketraffic-0.2.0-r2.apk` 與 `luci-app-faketraffic-0.2.0-r2.apk`。
全新設備一次安裝這兩包，不需要先手動安裝兩個舊服務或它們的LuCI。
安裝及回復步驟見 [遷移說明](docs/migration.md)。

## 維護範圍

所有後續產品修復、套件與版本在此維護。兩個原專案的歷史 release 留作追溯及
回復。運維、WAN/MTU/代理調校不屬於這個原始碼倉庫。v0.1.0僅是倉庫與
唯讀入口整合，未達使用者的完整介面／安裝整合要求；保留該tag作歷史追溯。
