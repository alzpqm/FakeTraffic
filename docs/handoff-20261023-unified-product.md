# 真正統一介面與安裝流程：修正驗收目標

2026-10-23。狀態：開發中，尚未部署或驗收新版本。

## 使用者糾正與事實

- 使用者明確要求像參考 fake-flow 一樣的合併介面及合併專案；唯讀總覽加上
  跳轉舊設定頁不符合要求。v0.1.0只完成維護整合，不能稱完整產品合併。
- v0.1.0已公開、六個附件重新下載SHA核對通過；兩舊repo遷移README已推送
  並archive，歷史/release保留。這些收尾早於使用者真正目標驗收，據實記錄。
- 舊版30分鐘唯讀觀察已開始，第一次實際進度查詢是6筆/300秒/0告警，
  HTTPS200與DNS成功；本機stdout由PowerShell緩衝，不是遠端沒有執行。
  未完成的計時不當通過，新版服務/設定整合也不沿用舊版窗口冒稱驗收。

## 本輪最小目標

1. 一個完整可編輯的LuCI頁面，同頁TCP/UDP欄位、共同儲存/套用，無舊頁跳轉。
2. 一個faketraffic核心套件及luci-app-faketraffic，不再要求使用者安裝四個
   舊套件。核心內含既有兩個封包引擎，非eBPF移植、非單一C daemon重寫。
3. 一份faketraffic UCI、一個procd服務的tcp/udp實例；保留既有argv語義、
   封包修復與來源追溯。先隔離測試，實機遷移必須有可驗證回復。
4. 不強制覆寫套件擁有的路徑，不默默刪設定、不恢復測速或已暫停網路研究。

## 新模型分工與回執

已完整重讀兩skill、availability與共用指南，三個互補、匿名、一次性文字問題。
回執均native0、成功、指定model相符、tools0；DeepSeek另guard2/宣告0。

- Gemini Flash medium：單一form.Map及共同表單。usage7098/2046/total9144。
  採納單一Map；其聲稱多Map「獨立UCI快取必然覆蓋」未提供主證據，不採作事實。
- Claude Sonnet4.6：套件路徑所有權與顯式遷移/回復。8327/1213/total9540。
  採納備份/交易預覽/離線回復；其移除核心先於依賴LuCI的順序不直接照用。
  全域uci export/import及/tmp未保護備份也不採用。
- DeepSeek V4.1 Flash/off：具名procd實例與生命週期邊界。351/766/total1117。
  採納直接監管各binary、無額外supervisor；其稱procd不追蹤子程序與必須
  pidfile均未核實，不採作事實。逐engine reload是建議，不假稱已有此功能。
- reported totals合計19801，provider定義可能不同，費用未知；raw留私人位置。
  沒有重跑三模型投票或授予工具/部署權。

## 後續操作（持續追加）

- 已讀新舊表單、兩init/config及APK builder；原136個產品檔案保留不改。
- 開發新版時不改正在觀察的設備；實機不會同時啟動新舊服務。
- 建立從固定來源機械擷取的四個adapter（表單兩模組、共同init/config）；
  原136檔SHA全通。表單只有一個Map，原驗證器保留，前後端拒絕queue衝突。
- WSL與Windows共用的8個新介面測試通過；init stub通過四啟用組合、queue
  衝突、舊owner拒絕與network/config triggers。這不是procd實機生命週期測試。
- 新SDK APK建置及extract完成；44個權限項目均root且600/644/755，兩核心
  binary SHA與0.1.0實機相同。新核心沒有安裝hook，只有移除前停止自己的
  服務；LuCI無hook且只依賴新核心與必要系統包，無舊四包依賴。
- 首次patch因同一路徑delete/add被拒絕（未套用），改成新view子路徑。
  一次PowerShell Get-Content混用Raw/Head失敗，之後改用正確讀法；無設備變更。
- 初步舊版窗口第二次進度20筆/1140秒/0告警，兩核心RSS904KiB、fd5且PID
  保持；仍未滿1800秒，不提早宣稱通過。所有原始樣本只留私人位置。
- 補保留SIP原本Reset清除tooltip行為，來源漂移fixture也保留，現9項測試通。
  嘗試只重打LuCI以節省重編，但WSL先前/tmp stage已不存在，前置停止，沒有
  改APK或設備。改用持久/var/tmp工作根重建確切最新表單，禁止拿舊包冒稱新版。
