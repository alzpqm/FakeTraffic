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
- 匿名來源提交 `60181b4b1311a63afbb5321701026095dd4a7088` 已推送，作者與提交者
  Codex/local.invalid。22個新增/修改檔案匿名掃描0命中，136來源blob再次核對。
  遠端CI成功：https://github.com/alzpqm/FakeTraffic/actions/runs/39948714381 。
  本次只重打改動後的介面測試/打包；未重跑舊上游研究或模型投票。
- 已準備唯讀新版觀察器（尚未啟動）；它另驗單一faketraffic服務下的tcp/udp
  PID及舊兩服務每分鐘保持stopped/disabled，不能把舊雙服務窗口算作新版。
- 舊版30分鐘實際完成，詳runtime30交接；高嚴重級與崩潰候選均0。
  新版第一次遷移前置在不存在的faketraffic UCI執行changes時exit1，因此停止；
  尚未安裝、停用、重啟或改正式設定。修正為存在的配置才查named changes，
  不忽略實際existing config的錯誤或待套用變更，私人失敗回執保留。
- 第二次切換實際安裝r1並開始引擎，過早的argv斷言失敗；同一段回復的argv
  斷言又阻斷介面回復，曾標記rollback-incomplete。後續獨立read-only驗證
  舊兩引擎已健康、argv相符、queue/drop0，再顯式恢復0.1.0介面成功及HTTPS200。
  新核心r1仍安裝但disabled；沒有把r1標成正式release或假稱新版30分鐘通過。
- 使用者允許對實質問題增加朋友研究、不限制朋友tokens。新一輪Gemini與
  Claude各成功（10903/12113 reported tokens）；DeepSeek一次因max-tokens
  2200中斷（2597tokens）為失敗，不冒稱完成。新增實測證據後另一聚焦問題
  DeepSeek Flash/off成功1239tokens/guard2/tools0；不是原問題無變更重試。
  費用未知。採納跨exec/argv/startticks/queue取樣與獨立UI回復；拒絕將尚無
  原始快照的race直接稱已證、將loader改argv當定論、或新owner未退仍啟舊核心。
- 專用未掛任何規則的queue65010/65011、skip-firewall測試共8案：6次立即
  stop各2.054秒後procd SIGKILL；等待穩定後TCP0.081s/UDP0.041s正常退出。
  已取得同PID/startticks從/sbin/procd argv過渡到真正engine的快照；正式
  服務/設定及queue owners/drop保持，測試服務/queues清空。這次證實過早
  gate與TERM時序風險，非先前猜測的封包引擎參數錯誤。
- 開發r2就緒callback及7個stub案例。首個guard probe雖未SIGKILL，但其
  start時間短於設計採樣窗，不能當guard生效證據；正在核實jsonfilter語法。
- 裝置直接fixture證明兩種jsonfilter wildcard皆有效，拒絕先前語法猜測。
  讀取probe實際stderr後定位BusyBox sleep不接受小數；原stub未測這個平台邊界。
  改成可用時usleep、否則整數sleep1，兩條路徑均有約5秒上限且等待失敗不忽略。
  實機probe新增stderr為空及實際採樣時間門檻，避免exit0就稱guard通過。
- 第二個實機guard probe兩輪均實際等待約2秒，stop2.109/2.086秒（包含2秒
  就緒確認），stderr空、無SIGKILL，正式服務/設定保持，測試queues/服務全退。
  該裝置走整數sleep fallback；不得宣稱usleep分支已在此機驗證。
- r2已建置並核對44個權限項目及兩binary SHA；既有argv等價要求沒有放寬。
  遷移gate改為相同PID/startticks、精確exe/argv/TERM handler/queue連續取樣，
  原始快照保存在私人位置。回復時新owner未清空不啟舊owner，但UI獨立嘗試。
