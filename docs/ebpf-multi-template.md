# eBPF 多模板（0.4.0）

在同一個 FakeTraffic LuCI／UCI 清單設定多個 TCP payload、SIP URI 或 payload_file。
不需手動執行兩個後端服務。NFQUEUE／eBPF 的選擇仍保留。
每協定啟用時需要 1–16 份模板。TCP 支援 HTTP、TLS、自訂 binary；UDP 支援
SIP URI、既有營運商 profile、自訂 binary。每個 trigger 按設定清單輪替一份，
同一次 repeat 全用該份內容，不新增清單 fanout。自訂檔案需 1–1200 bytes，可含 NUL。
超限、空清單、無法讀檔、衝突欄位直接拒絕，不靜默截斷或退回單模板。

已儲存範本數來自預檢；實際運行數來自 native metrics，兩者可能不同。
舊後端未提供 counts 時 UI 顯示無法取得，不從表單猜測。現有注入計數仍為 TCP/UDP
共用，沒有新增每模板／每協定送達率。一次成功的本地 clone 不證明遠端或 DPI 接受。

## Native 格式

UCI 由預檢產生 v2。直接使用 native CLI 時範例如下（介面請按隔離環境調整）：

```toml
version = 2
[[interfaces]]
name = "lab0"
mode = "l3"

[tcp]
enabled = true
[[tcp.templates]]
payload = "http"
hostname = "a.example"
[[tcp.templates]]
payload = "tls"
hostname = "b.example"

[udp]
enabled = true
[[udp.templates]]
payload = "sip"
sip_uri = "sip:user@a.example"
[[udp.templates]]
payload = "custom"
payload_file = "/tmp/anonymous-lab-payload.bin"
```

先 `ebpf validate --config FILE` 檢查內容；`check` 另做唯讀環境檢查，並不等於
load/attach 已通過。v1 singleton 格式保持相容；不可把 singleton 欄位混進 v2。
disabled protocol 可無模板。核心、UI、eBPF 套件版本固定相符；daemon/object
map shape 不符在載入前拒絕，沒有自動轉換舊 BPF object。

## 安全及限制

新世代完整準備所有模板、輪替狀態、config，最後才發布 active generation。
失敗保留舊設定。每世代使用獨立 slot；快速更新達到有界 map 容量時可拒絕候選，
不會清空仍在用的設定。兩秒沒有更新後回收比前一代更舊的模板及輪替資料。
這不是跨 map 原子交易，也不是任意速率 reload 保證。

輪替是全介面／CPU 共用、每協定獨立的 spinlock cursor；不是各 CPU 自行輪替。
模板 map 預配置上限為 16 世代 × 2 協定 × 16 slots，會增加記憶體配置；
未宣稱較省 RAM、吞吐提升或無鎖擴充性。NFQUEUE 的內部反向鏈結插入順序，及
HTTP/TLS/SIP 產生 bytes，未承諾與此後端完全相同，仍需明確接受 native 語義差異。

驗證方式：`make test-ebpf-config`、`make test-template-publication BPF_INCLUDE=<既有標頭目錄>`、
`sh tests/preflight.sh`、`node --test tests/*.test.mjs`。
實際 BPF／封包僅於明確授權隔離環境執行 `tests/ebpf-netns.py --isolated-lab ... --l3-unix --multi`。
