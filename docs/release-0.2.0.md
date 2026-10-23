# FakeTraffic 0.2.0

真正的共同設定介面與服務，不再只是連到FakeHTTP/FakeSIP的唯讀入口。

- 一份LuCI表單直接設定TCP與UDP，共同儲存／套用、同一服務啟停及兩實例狀態。
- 核心 `faketraffic-0.2.0-r2.apk` 內含兩個既有NFQUEUE引擎；介面為
  `luci-app-faketraffic-0.2.0-r3.apk`，不需要先安裝舊兩核心或舊兩LuCI。
- 一份faketraffic UCI及一個procd服務，內部分tcp/udp實例。核心不是新eBPF
  後端，也不是宣稱已重寫成單一C daemon。保留兩引擎既有行為與修復。
- 修正立即停止可能落在procd fork/exec過渡期的整合風險：以精確exe及TERM
  handler就緒判斷；支援本機整數sleep fallback。新就緒邏輯已做隔離實機測試。
- 修正實際LuCI boolean attribute導致按鈕誤停用的問題；只有本產品設定及
  三個精確服務指令的寫入權限，無任意命令權。

安裝前核對SHA256SUMS、目標OpenWrt25.12 x86_64及系統依賴。全新設備只需
一次安裝上述兩包，再於共同頁面配置與啟用；安裝不自動啟動服務。
既有設備必須按[遷移說明](migration.md)保存配置、停用舊owner後顯式切換，
不能直接並行運行新舊兩套。

來源136個固定檔案SHA保持，兩binary SHA與已發布核心相同。共同表單9項
測試、init組合/防衝突/就緒測試、SDK打包權限與實際UI已驗；CI與30分鐘
最終結果以[本輪交接](handoff-20261023-unified-product.md)為準。

目前發布收尾尚待新版完整30分鐘觀察；本檔是發布說明草稿，不是已公開結果。
不宣稱吞吐提升、全WAN/DPI效果、全新刷機或所有硬體與IPv6路徑皆已驗證。
