# 遷移與回復

## 0.2.0統一產品版（開發／未驗收）

新版只需要核心 `faketraffic` 與介面 `luci-app-faketraffic`，依賴系統套件
由APK解析。兩個引擎安裝到專屬的 `/usr/libexec/faketraffic/`，不覆寫舊
`/usr/bin/`；單一 `/etc/init.d/faketraffic` 管理tcp/udp兩實例，讀取
`/etc/config/faketraffic`。不是兩個舊LuCI頁面的跳轉入口。

全新設備在核對SHA256、架構及系統相容性後，一次安裝兩包，再於共同介面
設定與啟用TCP/UDP；安裝不自動啟動，預設兩引擎停用。只需管理一個服務。

```sh
apk add --simulate --allow-untrusted ./faketraffic-0.2.0-r2.apk ./luci-app-faketraffic-0.2.0-r3.apk
# 確認交易後移除 --simulate 執行；不要使用 force-overwrite。
```

既有設備不得直接開啟新舊服務並行。保守遷移順序：

1. 私人root0700位置備份world、套件版本、原設定與服務啟用／運行狀態、
   離線回復用舊APK；確認沒有待套用UCI變更。
2. `tools/prepare-migration.sh`僅產生私人候選合併設定，不改正式UCI或服務。
   保留HTTP globals/advanced/payload及UDP main；遇到同名main或額外SIP
   section就拒絕，不靜默丟掉設定。審核語義／argv及原檔CAS後才可繼續。
3. 安裝新兩包不覆寫舊檔、不自動啟動。顯式停止及停用舊兩服務，確認PID、
   queue owner與舊表已退；再以候選檔建立新UCI並啟用新服務。這是會短暫
   停止偽裝的生命週期切換，不聲稱零中斷；不重啟網路或flush全域防火牆。
4. 驗證兩實例argv（除binary路徑外）、原UCI未變、queue/drop、連線探針、
   真正LuCI儲存／套用及回復流程。未驗前保留停用的舊核心以便回復。
5. 新版驗收通過後，預覽移除舊四套件，只允許這四包，不得自動清理其他
   系統依賴。原私人設定備份與APK保留，不刪歷史來源或GitHub release。

回復須先停用／停止新服務，確認兩實例已退，再恢復原服務狀態與原介面
APK。原設定不應被遷移修改；如需恢復任何檔案，先做CAS避免覆蓋使用者
期間修改。失敗後只恢復引擎、未恢復介面時，必須明列部分回復，不能稱完成。

以下保留的是0.1.0歷史流程，不能用於新版：

## 0.1.0歷史：唯讀入口

FakeTraffic 0.1.0 的維護範圍已合併；執行時仍使用兩個獨立引擎。套件名稱、
UCI 檔、nft 表及預設 queue 不變。不要刪除或停用 `fakehttp` / `fakesip`，
它們現在是 FakeTraffic 的元件，不是待清理的殘留。

## 現有 OpenWrt 25.12 x86_64 安裝

1. 備份 `/etc/config/fakehttp`、`/etc/config/fakesip` 到私人位置，記錄套件版本、
   檔案 hash、兩程序 PID/starttime 及 service 狀態；備份不可上傳 repo。
2. 必須已有 FakeHTTP / LuCI `99.3-r1`、FakeSIP / LuCI `0.9.1-r23`。本版
   入口 APK 鎖定這四個版本；其他版本先停止，另做適用性核對。
3. 核對下載的 SHA256SUMS，再預覽只安裝入口的交易：

   ```sh
   apk add --simulate --allow-untrusted ./luci-app-faketraffic-0.1.0-r1.apk
   ```

   只有新增入口套件才可繼續。若顯示任何核心、LuCI、系統套件升降級或移除，
   不執行；不要用 force、修 UCI 或重啟防火牆繞過。
4. 安裝相同檔案，從 LuCI「服務 → FakeTraffic」查看兩引擎並進入各自設定：

   ```sh
   apk add --allow-untrusted ./luci-app-faketraffic-0.1.0-r1.apk
   ```

   入口只有唯讀 `service.list` 權限、無安裝/解除安裝 scripts、無 UCI 預設檔。
   新 ACL 需要 rpcd 重新載入才生效；必要時只重啟 rpcd（會使現有 LuCI 登入
   session 失效），不重啟兩引擎、網路或防火牆。
5. 核對原版本、UCI hash、PID/starttime、queue owner 與原狀一致；驗證兩個
   設定連結、Running/Not running/Unavailable 顯示。入口不會自動輪詢。

全新設備需先安裝相同 release 的四個元件 APK；啟用與設定遵循各元件的
OpenWrt 說明。勿為安裝共同入口重新執行舊核心套件的 post-install。

## 回復

原有四個元件在安裝共同入口前應已是 APK world 的明確項目。回復前先模擬：

```sh
apk del --simulate luci-app-faketraffic
```

只允許移除共同入口。如果 APK 打算自動清理依賴，停止操作並先保留原四個
元件為明確 world 項目；不可直接使用 force 或 autoremove。確認後執行正常
`apk del luci-app-faketraffic`，重讀配置hash及程序身分；TCP/UDP設定與引擎保留。

## 舊專案收尾條件

- 新 repo 的來源可取得，來源追溯與 build/test 通過；release 附件重新下載核對。
- 共同入口完成目標系統驗收，沒有覆寫設定、重啟核心或改動資料路徑。
- 舊 repo README 指向新專案後才設為唯讀封存；不刪舊 commit/tag/release。
- GitHub archive 不等於刪除本機資料夾、停止兩個核心程序或關閉其他運維對話。
- 任一驗收未完成，交接明列未完成項，舊 repo 保持可維護。
