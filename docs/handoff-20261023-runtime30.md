# FakeTraffic：實機畫面、舊專案收尾與30分鐘驗證

2026-10-23（Asia/Singapore）。狀態：使用者要求開始實機驗證30分鐘，進行中。

## 範圍

- 沿用已通過核心／套件／安裝回退與CI，不重做舊模型研究。
- 臨時登入資訊僅用於既有路由器與LuCI，不寫入檔案／Git／模型問題。
- 核對共同入口及兩設定頁；正式發布、下載核對後推遷移告示並archive舊repo。
- 正式計時窗在舊repo封存後開始，31筆／每60秒採樣，至少1800秒。
- 核對舊專案不再獨立維護、無重複process/queue owner。現有兩個engine是
  FakeTraffic保留元件，維持運行；封存倉庫不代表殺掉必要服務。
- 只有每5分鐘少量HTTPS／DNS功能探針，不執行高負載、測速或暫停中的運維研究。
- 原始log、樣本與備份留私人位置；公開紀錄只保存匿名結果與hash。

## 操作紀錄

1. 重新讀主交接與migration規則，確認正式release仍draft、兩舊repo未archive。
2. 新提供憑證登入成功；原Chrome分頁CDP逾時，依既有瀏覽器恢復指引建立
   同一瀏覽器新分頁，已顯示登入後選單。尚待共同入口/兩設定頁完整驗收。
3. 建立有硬性monotonic 1800秒截止的唯讀觀察器；資料只記私人root700目錄。
   尚未啟動正式30分鐘計時，不將準備時間算成實測。
4. 瀏覽器實際驗收完成：共同入口兩Running、TCP頁面服務/一般/負載/進階設定，
   UDP頁面服務/配置均載入；新分頁console error為空。未執行儲存或套用。
   截圖CDP擷取逾時，沒有留下可聲稱的截圖檔；文字/DOM驗收結果分開記錄。
5. fresh路由器preflight通過，兩核心仍為既有binary，PID/starttime與前輪相同、
   queue512/513 backlog及兩種drop均0。原始preflight僅私人保存。
6. v0.1.0正式release公開，六個附件fresh下載SHA吻合；舊兩repo遷移README
   推送並archive後才開始正式窗口，保留歷史。本版只有維護／入口整合，
   使用者隨後糾正其不符合真正共同介面要求，另開unified-product交接。
7. 舊版窗口實際19:21:07至19:51:08（Asia/Singapore），1800.91秒/31筆，
   alert0，HTTPS/DNS各7/7成功。兩核心RSS/HWM904KiB、fd5、Threads1固定；
   PID/starttime、52設定、binary/init/入口及boot保持，queue owner/drop保持。
   新system86行/高嚴重級0，kernel新增0行，崩潰候選0，四份log均未截斷。
   這不是新版共同服務/介面的驗收，不能沿用此時間冒稱新版通過。
