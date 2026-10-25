# FakeTraffic

OpenWrt 的 TCP 與 UDP／SIP 流量偽裝工具，在同一個 LuCI 頁面設定，由同一個服務管理。
提供 NFQUEUE 與可選的 eBPF 後端。

## 功能

- 統一設定 TCP、UDP、介面、偽裝內容與發送參數。
- TCP 支援 HTTP、TLS 與自訂二進位內容。
- UDP 支援 SIP URI、電信業者 SIP 範本與自訂二進位內容。
- eBPF 支援每協定 1–16 份模板輪替。
- LuCI 顯示運行狀態、實際後端、模板數與流量計數器，並提供 eBPF 相容性預檢。

## 下載與安裝

從 [GitHub Releases](https://github.com/alzpqm/FakeTraffic/releases) 下載套件及 `SHA256SUMS`。
目前預編譯套件適用於 **OpenWrt 25.12／x86_64**，版本為 **0.4.0-r3**。

| 套件 | 用途 |
| --- | --- |
| `faketraffic` | 核心服務，包含 TCP 與 UDP 引擎 |
| `luci-app-faketraffic` | LuCI 管理介面 |
| `faketraffic-ebpf` | 可選的 eBPF 後端 |

下載三個 APK 與校驗清單後，先核對檔案：

```sh
sha256sum -c SHA256SUMS
```

安裝核心與 LuCI：

```sh
apk add --allow-untrusted ./faketraffic-0.4.0-r3.apk ./luci-app-faketraffic-0.4.0-r3.apk
```

需要 eBPF 時，再安裝相同版本的後端套件：

```sh
apk add --allow-untrusted ./faketraffic-ebpf-0.4.0-r3.apk
```

eBPF 需要 Linux 6.6+、TCX 與匹配的系統相依套件。全新安裝時，服務及協定預設不啟用。
從舊 FakeHTTP／FakeSIP／fake-flow 遷移時，請先依[升級與回復說明](docs/migration.md)處理舊服務。

## 開始使用

1. 開啟 LuCI 的「服務 → FakeTraffic」。
2. 選擇要使用的介面，啟用 TCP 或 UDP，填寫偽裝內容與參數。
3. 選擇處理後端。預設為 NFQUEUE；使用 eBPF 前，請檢查相容性預檢與語義差異提示。
4. 儲存並套用，再確認頁面上的運行狀態；需要時使用「啟動」按鈕。

若要開機自動啟動：

```sh
/etc/init.d/faketraffic enable
```

TTL／Hop Limit 應依實際路徑設定，使偽裝封包在抵達真實對端前耗盡。
計數器用於觀察本機處理情況，不代表遠端送達率。

## 文件

- [eBPF 與多模板設定](docs/ebpf-multi-template.md)
- [升級與回復](docs/migration.md)
- [開發與建置](docs/building.md)

## 來源與授權

TCP／UDP 引擎分別來自 FakeHTTP 與 FakeSIP；可選 eBPF 後端衍生自 fake-flow。
原作者版權與各元件授權均保留。來源版本與雜湊見 [sources.lock.json](sources.lock.json)，
授權與元件邊界見 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
