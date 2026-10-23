# FakeTraffic 0.1.0

FakeHTTP TCP 與 FakeSIP UDP 的共同維護版本，提供共同建置、來源清單及唯讀 LuCI 入口。
本版保留兩套獨立引擎、服務與完整設定頁，尚不是單一共同設定服務。

- FakeHTTP／LuCI：99.3-r1。
- FakeSIP／LuCI：0.9.1-r23。
- 共同入口：luci-app-faketraffic 0.1.0-r1，提供狀態及設定連結。

附件適用 OpenWrt 25.12／x86_64。已有相符四個元件套件時，只需新增共同入口；
先核對 SHA256SUMS 並模擬交易，不覆寫原設定、不停止原引擎。
安裝與回復請參閱 [migration.md](migration.md)。

原作者版權與 GPL-3.0-or-later 保留；本版不包含 fake-flow 的 eBPF 後端。
不宣稱吞吐改善、網路分類效果或所有硬體相容性。
