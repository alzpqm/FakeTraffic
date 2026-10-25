# FakeTraffic 0.4.0-r3

同一 LuCI 頁面、UCI 與服務管理 TCP 和 UDP／SIP 偽裝，預設使用 NFQUEUE，另提供可選 eBPF 後端。

## 功能與修正

- eBPF 每協定支援 1–16 份 HTTP／TLS／SIP／自訂二進位模板，每次觸發輪替一份。
- 顯示實際後端、模板數及計數器，並提供相容性預檢。
- 修正已停止 eBPF 時的卸載阻塞、未知狀態誤判及 SDK 服務鉤子行為。
- 補齊 SDK 繁中翻譯與建置校驗清單更新。
- 修正 UDP／eBPF 初始 TTL32 跳數推導，與 TCP 的近端跳過策略保持一致；跳數推導仍是啟發式估算。
- NFQUEUE 在停止原服務前拒絕 queue 衝突及無效編號，避免無效候選設定中斷偽裝。
- 舊 `stats` 介面不再將讀取失敗或總和溢位當成零；正常數值格式維持相容，監控建議使用 `metrics`。

## 套件與需求

附件適用 OpenWrt 25.12／x86_64，三包版本均為 0.4.0-r3。

- NFQUEUE：安裝 `faketraffic` 與 `luci-app-faketraffic`。
- eBPF：再安裝同版本 `faketraffic-ebpf` 及匹配的系統依賴；需要 Linux 6.6+／TCX。

從 [Release](https://github.com/alzpqm/FakeTraffic/releases/tag/v0.4.0-r3) 下載並以附件 SHA256SUMS 核對。
不需另裝舊 FakeHTTP／FakeSIP 服務；全新安裝不自動啟動。
升級與回復見 [migration.md](migration.md)，多模板設定見 [ebpf-multi-template.md](ebpf-multi-template.md)。

核心、LuCI 與 eBPF 套件版本須匹配。舊服務不可與新版並行注入；不要以 force-depends、
盲刪 checkpoint 或修改無關網路設定來繞過保護。計數器不代表遠端送達率或 DPI 效果。

原作者版權、元件授權及來源雜湊保留，見 [來源與授權](../THIRD_PARTY_NOTICES.md)。
