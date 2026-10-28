# FakeTraffic

OpenWrt 的 TCP 與 UDP／SIP 流量偽裝工具，在同一個 LuCI 頁面設定，由同一個服務管理。
支援 NFQUEUE 與可選的 eBPF 後端，兩者擇一運行。
不需另外安裝或啟動獨立的 FakeHTTP、FakeSIP、fake-flow 服務。

## 功能

- 統一設定 TCP、UDP、介面、偽裝內容與發送參數。
- TCP 支援 HTTP、TLS 與自訂二進位內容。
- UDP 支援 SIP URI、電信業者 SIP 範本與自訂二進位內容。
- eBPF 支援每協定 1–16 份模板輪替。
- LuCI 顯示運行狀態、實際後端、模板數與流量計數器，並提供 eBPF 相容性預檢。

## 下載與需求

目前版本：[**0.4.0-r4**](https://github.com/alzpqm/FakeTraffic/releases/tag/v0.4.0-r4)。
預編譯 APK 適用於 **OpenWrt 25.12／x86_64**；其他架構或韌體版本需先確認建置與相依相容性。
以下指令固定下載同一版套件，核對校驗清單與所選 APK 後，再一次安裝。

| 套件 | 用途 |
| --- | --- |
| `faketraffic` | 核心服務，包含 TCP 與 UDP 引擎 |
| `luci-app-faketraffic` | LuCI 管理介面 |
| `faketraffic-ebpf` | 可選的 eBPF 後端 |

套件數不等於服務數：NFQUEUE 使用核心與 LuCI 兩包；eBPF 使用三包，
但都只管理一個 `faketraffic` 服務、一份設定及同一個 LuCI 頁面。

eBPF 另需 Linux 6.6+、TCX 與匹配的系統相依套件，安裝後仍須執行相容性預檢。

## 首次安裝

以 root 執行，需有 `curl`、`sha256sum` 及 `awk`。以下兩段擇一複製執行，不需手動下載檔案。
若已有 FakeTraffic，先閱讀下方「升級現有安裝」並乾淨停止服務，再使用相符指令；
從獨立舊專案遷移則先看[遷移說明](docs/migration.md)，停用舊服務後才啟動新版。

**使用 NFQUEUE**，安裝核心與 LuCI：

```sh
(
set -eu
if apk info -e faketraffic-ebpf >/dev/null 2>&1; then
  echo '已安裝 eBPF 套件，請改用下方三包指令。' >&2
  exit 1
fi
work=$(mktemp -d /tmp/faketraffic.XXXXXX)
trap 'rm -rf "$work"' EXIT
base=https://github.com/alzpqm/FakeTraffic/releases/download/v0.4.0-r4
set -- faketraffic-0.4.0-r4.apk luci-app-faketraffic-0.4.0-r4.apk
curl -fL --retry 2 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
printf '%s  SHA256SUMS\n' '55ebfeaf695493e5f39ed74d71c29b3679da59428f6877ecba9c6335e12729d8' > "$work/manifest.sha256"
(cd "$work" && sha256sum -c manifest.sha256)
for name in "$@"; do
  curl -fL --retry 2 "$base/$name" -o "$work/$name"
  awk -v name="./$name" '$2 == name { print; found++ } END { exit(found != 1) }' "$work/SHA256SUMS" >> "$work/packages.sha256"
done
(cd "$work" && sha256sum -c packages.sha256)
apk update
(cd "$work" && apk add --allow-untrusted "$@")
)
```

**需要 eBPF**，三個套件在同一筆交易安裝：

```sh
(
set -eu
work=$(mktemp -d /tmp/faketraffic.XXXXXX)
trap 'rm -rf "$work"' EXIT
base=https://github.com/alzpqm/FakeTraffic/releases/download/v0.4.0-r4
set -- faketraffic-0.4.0-r4.apk luci-app-faketraffic-0.4.0-r4.apk faketraffic-ebpf-0.4.0-r4.apk
curl -fL --retry 2 "$base/SHA256SUMS" -o "$work/SHA256SUMS"
printf '%s  SHA256SUMS\n' '55ebfeaf695493e5f39ed74d71c29b3679da59428f6877ecba9c6335e12729d8' > "$work/manifest.sha256"
(cd "$work" && sha256sum -c manifest.sha256)
for name in "$@"; do
  curl -fL --retry 2 "$base/$name" -o "$work/$name"
  awk -v name="./$name" '$2 == name { print; found++ } END { exit(found != 1) }' "$work/SHA256SUMS" >> "$work/packages.sha256"
done
(cd "$work" && sha256sum -c packages.sha256)
apk update
(cd "$work" && apk add --allow-untrusted "$@")
)
```

全新安裝不會自動啟用服務或協定，初始後端為 NFQUEUE；安裝 eBPF 套件本身不會自動切換後端。
目前附件未提供 APK 簽章公鑰，因此使用本次命令的 `--allow-untrusted`，
並以此頁固定的 SHA256 核對下載內容；這是完整性校驗，不是 APK 來源簽章驗證。

## 升級現有安裝

先備份設定、原套件與服務啟用狀態，再依[升級與回復說明](docs/migration.md)乾淨停止服務。
停止失敗或仍有未知程序／checkpoint 時，先查明原因，不要直接覆蓋或刪除保護檔案。

核心、LuCI 及已安裝的 eBPF 套件必須在**同一筆 `apk add` 交易**更新為同版本。
已安裝 `faketraffic-ebpf` 者，**即使目前選用 NFQUEUE，也要使用上方三包命令**；
不可先升核心，再單獨補升後端，否則可能產生精確版本相依衝突。
只有未安裝 eBPF 套件者才使用兩包命令。

升級完成後啟動 `faketraffic`，核對運行狀態與原開機啟用狀態。升級沿用既有設定，
不需重新選擇後端或重新建立模板；相依交易若涉及預期外套件變動，請停止處理，勿強制忽略相依。

## 開始使用

1. 開啟 LuCI 的「服務 → FakeTraffic」。
2. 選擇要使用的介面，啟用 TCP 或 UDP，填寫偽裝內容與參數。
3. 選擇處理後端。新安裝預設為 NFQUEUE；使用 eBPF 前，請檢查相容性預檢與語義差異提示。
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
