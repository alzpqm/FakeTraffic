# FakeTraffic 0.2.0（草稿）

共同 LuCI 設定頁與單一服務管理 TCP／UDP，不再只是兩個舊設定頁的連結。

- 核心 `faketraffic-0.2.0-r2.apk` 包含兩個 NFQUEUE 引擎。
- 介面 `luci-app-faketraffic-0.2.0-r3.apk` 提供共同儲存／套用、服務啟停及狀態。
- 共用 `/etc/config/faketraffic`，服務內部分為 TCP／UDP 實例。
- 改善服務過渡期的啟停檢查及 LuCI 按鈕狀態。

本版草稿不是 eBPF 後端，也不是單一 C daemon。套件目標為 OpenWrt 25.12／x86_64，
安裝不自動啟動服務；不需要先安裝舊 FakeHTTP／FakeSIP 核心或介面。
安裝前核對 SHA256SUMS，保留回復套件，依 [migration.md](migration.md) 遷移；新舊服務不可並行注入。

本頁為歷史版本草稿，不代表該版本已公開發布。下載正式套件請以 Releases 頁面為準。
原作者版權與來源歸屬保留，不宣稱效能或網路分類效果優勢。
