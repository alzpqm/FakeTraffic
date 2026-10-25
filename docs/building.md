# 開發與建置

## 本機編譯

Linux 需要 C compiler、make，以及 libnetfilter_queue／libnfnetlink／libmnl 開發檔。
測試另需 Node.js、Python 3、gettext 與 Perl json_pp。

```sh
make all
make test
```

eBPF daemon／BPF object 的編譯另需 clang／LLVM、pkg-config、libbpf／libelf／zlib 開發檔：

```sh
make -C components/fakeflow all
make test-template-publication
```

原生 jsonfilter 與 SDK po2lmo 的平台測試需提供相應工具；缺少時會明示 skip。
需要核心權限的隔離封包測試另見 `tests/ebpf-netns.py`，不包含在一般 `make test` 中。

## OpenWrt APK

使用與目標設備相符的 OpenWrt 25.12 SDK，建置核心與 LuCI：

```sh
sudo make packages SDK=/absolute/path/to/openwrt-sdk
```

只建置 LuCI：

```sh
sudo sh tools/build-unified-apk.sh /path/to/sdk /path/to/output --luci-only
```

eBPF 後端需另外提供匹配目標架構的開發 prefix：

```sh
sudo sh tools/build-ebpf-apk.sh /path/to/sdk /path/to/target-development-prefix
```

該 prefix 須包含 `include/bpf`、libelf／zlib headers 及可供 link 的目標 libraries。
預設產物放在 `dist/0.4.0/`；建置腳本只產生套件，不安裝或啟動服務。
目前直接 APK 建置腳本以 x86_64 為目標，核心、LuCI 與 eBPF 套件版本必須匹配。

## 來源追溯

`sources.lock.json` 保存匯入來源版本與原始檔案雜湊，`source-overrides.lock.json`
保存已審核的本地修改。修改元件來源時，應一併維護對應紀錄。

```sh
node tools/verify-sources.mjs
node tools/sync-unified-adapters.mjs --check
```
