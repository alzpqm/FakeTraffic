# FakeTraffic 0.1.0

FakeHTTP TCP 與 FakeSIP UDP 在同一個來源倉庫維護，提供共同建置、產品回歸、
來源清單及 LuCI 入口。第一版保留既有兩套獨立引擎、套件版本與完整設定頁。

- FakeHTTP / LuCI：99.3-r1，含已發布的 TTL32 與 legacy queue 順序修復。
- FakeSIP / LuCI：0.9.1-r23，含已發布的 checksum、process 與 IPv6 options 修復。
- 新入口：luci-app-faketraffic 0.1.0-r1，唯讀狀態與 TCP/UDP 設定連結。
- 沿用 GPL-3.0-or-later 與原作者版權；沒有引入 fake-flow 的 GPL2-only eBPF 程式。

本機136檔來源核對、兩核心／CLI／LuCI／套件回歸及共同入口整合測試通過。
SDK 重編的兩個核心執行檔與既有正式版本 SHA256 一致。OpenWrt 25.12.6 x86_64
完成共同入口的實際安裝、移除及再安裝；原四套件、程序身分與UCI設定保持。
實際瀏覽器頁面驗收狀態以整合交接為準。

附件僅供 OpenWrt 25.12+ x86_64。已安裝相符四個原套件的設備只需新增共同
入口 APK，先模擬交易並核對 SHA256SUMS。完整說明見 `docs/migration.md`。
共同入口沒有安裝／移除 hooks，也不重寫 UCI、停止引擎或改防火牆。

這是維護與管理整合；不宣稱 UDP 掉速已修復、效能提升、單 daemon 或新的 eBPF
後端已完成。舊版本與歷史來源保留作追溯與回復。
