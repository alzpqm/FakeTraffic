# FakeTraffic

FakeHTTP（TCP）與 FakeSIP（UDP）的共同維護專案，提供共同建置與 LuCI 管理入口。
0.1.0 保留兩套獨立的 NFQUEUE 引擎、服務及設定頁；共同入口只顯示狀態與設定連結。

| 元件 | 版本 |
| --- | --- |
| FakeHTTP／LuCI | 99.3-r1 |
| FakeSIP／LuCI | 0.9.1-r23 |
| FakeTraffic LuCI 入口 | 0.1.0-r1 |

從 [Releases](https://github.com/alzpqm/FakeTraffic/releases) 下載套件並核對 SHA256SUMS。
本版套件適用 OpenWrt 25.12／x86_64；安裝與回復見[說明](docs/migration.md)。
需要統一設定與服務管理時，請使用較新的產品版本，勿混裝不同版本的介面。

## 開發

Linux 需 C compiler、make、libnetfilter_queue／libnfnetlink／libmnl 開發檔；
測試另需 Node.js、gettext 與 Perl json_pp。

```sh
make all
make test
sudo make packages SDK=/absolute/path/to/openwrt-sdk
```

來源版本與雜湊見 [sources.lock.json](sources.lock.json)，版權與授權見 [NOTICE](NOTICE)。
