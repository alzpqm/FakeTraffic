# FakeTraffic 整合驗證與遷移

2026-10-23（Asia/Singapore）。狀態：來源公開、實機CLI驗收與遠端CI通過；
release草稿六附件就緒。瀏覽器登入／畫面驗收待完成，舊repo尚未封存。

## 已完成

1. 讀取Sol交接、FakeHTTP正式最終報告與模型技能／availability。沿用三模型
   已有架構覆核，不重跑投票；FakeHTTP已完成的報告確認保留雙NFQUEUE引擎。
   其指出fake-flow仍缺TTL32估算也是候選差異，不為未採用後端另外實驗。
2. 新目錄第一次 `make test` 全部成功：來源136檔、兩engine編譯／核心回歸、
   FakeHTTP255TTL cases、FakeSIP157IPv6options、兩LuCI/套件smoke與四項整合
   測試。錯誤分支fixture刻意產生的Broken pipe／invalid payload等不當作崩潰。
   原始log留本機Linux執行帳戶私人工作位置，不公開絕對路徑。
3. 使用者新增指定DeepSeek v4.1 Flash。查官方API說明確認呼叫名deepseek-flash，
   一次最短驗證native0/completed、model match、guard2、tools0/宣告0、FLASH_OK。
   168input+3output=171tokens；費用未知。更新既有helper預設model、availability
   與共用偏好；沿用明確off，沒有改Web3080、憑證或provider，沒有重跑研究。
4. 原Sol交接保留本機並加入.gitignore，避免把私人操作索引發布。公開交接以
   本檔記錄匿名結果；既有產品來源仍逐檔不變。

## 待完成

瀏覽器共同入口／兩設定連結驗收，正式release發布與下載核對，舊repo遷移
告示與archive。其他建置、來源、權限及實機CLI驗收已完成，不重跑。

## 後續操作

5. 沿用相符25.12 SDK建置五個APK成功。核心binary逐一extract比對：FakeHTTP
   `c049e50cf20ab001a93fd229b1b25514d19b9ad2a7d982f193b56b286d8f2cd5`、
   FakeSIP `ef839865881d7d362c6f3f61deed29bc0b517a674adba421b65b06d675cbb9b6`，
   均與既有正式release相同。APK本身metadata/封裝timestamp不同，不冒稱附件
   byte-identical。SDK library header有既有warning及NTFS clock-skew提示；
   本輪builder有clean並逐source重編，不宣稱零warning。
6. 首次inline跨PowerShell/bash的extract命令變數被展開成空值，mkdir拒絕既有
   根目錄而停止；沒有extract或刪除。改成私人保存的sh腳本後成功。
7. extract發現新入口從NTFS帶入0777檔案/目錄權限。尚未部署；已在stage及
   OpenWrt recipe正規化dirs0755/files0644，增加實際APK metadata gate。
   recipe補精確四元件EXTRA_DEPENDS，與直接APK builder政策一致。
8. GitHub connector缺少repo建立/archive與release上傳能力；這些步驟後續
   使用既有Git Credential Manager登入，不建立新token或輸出token。
9. FakeHTTP分身對話快照確認沒有可見並行操作者，本輪主代理單一操作。
   實機fresh版本25.12.6/kernel6.12.112，非歷史25.12.5；兩正式binary仍完全
   相符，四元件皆為APK world明確項目。未觸發負載或網路研究。
10. 首次唯讀preflight實質gate通過，但SSH wrapper結尾CR造成exit127；補明確
    exit0終止，set-e保留真正錯誤。首次安裝在base64工具不存在時前置停止，
    只留私人空staging、未安裝；改用既有Python標準模組decode，沒有裝依賴。
11. 實機simulate僅新增共同入口一包；完成實際install→remove→reinstall。
    原兩PID/starttime、binary/init/config hashes與所有UCI檔案逐次保持，四原
    套件版本不變。原始備份/交易raw只留私人位置。stat工具不存在導致末尾
    非關鍵列印失敗；另用Python權限與hash核對，不把find exit0當驗證通過。
12. 現有Chrome LuCI session過期，已請使用者在既有頁面登入，沒有索取聊天
    密碼或新登入權。實際頁面驗收尚待登入；CLI安裝成功不當作畫面已通過。
13. 擴大套件權限核對發現既有SIP builder也會複製NTFS的LuCI modes；共同
    builder改在獨立POSIX source copy正規化後呼叫，原136檔內容不變。
14. 兩個component的SDK建置都改用獨立source副本，避免交叉編譯物覆蓋本機
    native test build。打包權限gate保留，最終APK逐檔掃描；不為此重測封包路徑。
15. Python實機末次核對三個新檔均root/0644、SHA與來源一致；所有UCI hash
    通過、兩PID/starttime仍相同，四原套件及新入口版本正確。沒有重啟rpcd、
    engine、網路或防火牆。唯讀session過期與本輪部署分開記錄。
16. 五APK metadata合計97個權限項目通過，無group/world writable entries；
    新入口保留實際安裝過的相同APK bytes，SHA256
    `ccb76725dbe37c170250c655213d6d8b7d7f0a9b03fabdcb3e34a707cfe330d4`。
    其他四APK是同來源重建，原二進位相同但封裝metadata/timestamp不同；
    沒有重新安裝四核心/LuCI或假稱所有附件都逐包重裝。
17. 新repo以匿名Codex/local.invalid建立及推送。初次遠端CI的HTTP全部通過，
    在Ubuntu dash執行SIP Bash/pipefail腳本時失敗；本機sh行為差異先前未揭露。
    修正共同Makefile明確用bash，原component檔案不變，後續CI另記結果。
    初始source import的兩份.clang-format各有一行既有trailing whitespace；
    保留精確來源，不為格式修改已鎖定檔案。新整合檔案另核對。
18. 修正commit `0ff76c5dc546ce6cbfaf2a1c103a39c7f684dc9a` 遠端CI通過：
    https://github.com/alzpqm/FakeTraffic/actions/runs/39932524817 。
    初始import commit `4a47ce66bd4d44e80be408da1906cb61d091aa50` 及後續提交
    作者/提交者均Codex <codex@local.invalid>。156個staged檔掃描私人pattern為0，
    136個import blob hash再次核對，18個原/新腳本執行權限按Git tree保留。
19. release草稿已上傳五APK與SHA256SUMS，六項server SHA256全部匹配，未設
    為公開。manifest SHA256 `f862dab76f7c62d000874842f072dc588732074258b1b6bf2adeecd271e84f2a`。
    source為本repo，不上傳私人備份/raw、舊Sol內部索引或測試二進位。
20. 使用者回覆已登入後，指定Chrome重新載入仍是需要授權；先定位確認只有
    該一個可見LuCI分頁，並請使用者確認指定origin或接受明列未驗畫面限制。
    不能僅憑使用者已登入回覆就冒稱畫面實測成功。
21. 兩個舊repo已分別在乾淨公開checkout準備只改README的匿名commit，指向
    新repo並保留原引擎啟用/歷史來源與release；尚未push。舊工作區dirty檔保留。
    最終待辦僅畫面驗收/限制確認、正式發布/下載、推遷移告示與archive；
    既有模型、核心測試、設備install/remove/reinstall與CI不再重跑。
