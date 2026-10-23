# FakeTraffic

驗證及遷移結果見 [整合交接](docs/handoff-20261023-integration.md)。

FakeHTTP（TCP）與 FakeSIP（UDP）的共同維護專案。第一版整合原始碼、建置、
測試、版本清單及 LuCI 管理入口，保留兩個獨立 NFQUEUE 引擎。

這不是 lilu0826/fake-flow 的 fork，也不含它的 eBPF 程式碼。參考該專案的
TCP/UDP 統一管理方式，但保留目前已修復、驗證的封包處理行為。合併不代表
吞吐量提升、電信網路問題已解決或所有資料路徑已驗證。

| 元件 | 本版來源 | 保留的介面 |
| --- | --- | --- |
| FakeHTTP | 99.3-r1 | binary/service/UCI `fakehttp`、queue 預設 512 |
| FakeSIP | 0.9.1-r23 | binary/service/UCI `fakesip`、queue 預設 513 |
| FakeTraffic | 0.1.0-r1 | 新的唯讀 LuCI 入口，連到原 TCP/UDP 完整設定頁 |

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

套件保留原名稱及版本；新增 `luci-app-faketraffic-0.1.0-r1.apk`。
已裝相符兩引擎及 LuCI 的設備只需新增共同入口，無需重裝核心或修改 UCI。
安裝及回復步驟見 [遷移說明](docs/migration.md)。

## 維護範圍

所有後續產品修復、套件與版本在此維護。兩個原專案的歷史 release 留作追溯及
回復。運維、WAN/MTU/代理調校不屬於這個原始碼倉庫。第一版沒有把兩個 process
硬合成單一 daemon，兩者仍可各自啟停及診斷。
