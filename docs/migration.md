# 0.1.0 安裝與回復

本版是共同維護倉庫與唯讀 LuCI 入口，不接管兩個引擎的服務或設定。
需要統一服務與完整共同表單時，請改用新版，不要把新版遷移步驟套到本版。

## 安裝

適用 OpenWrt 25.12／x86_64，需先有 FakeHTTP／LuCI 99.3-r1 與 FakeSIP／LuCI 0.9.1-r23。
備份原設定、套件及啟用狀態，下載相符附件並核對 SHA256SUMS，先預覽：

```sh
apk add --simulate --allow-untrusted ./luci-app-faketraffic-0.1.0-r1.apk
```

確認只新增共同入口，沒有其他套件升降級或移除後，移除 `--simulate` 執行。
LuCI 新 ACL 可能需要重新載入 rpcd，這會使原登入 session 失效，不需要重啟兩個引擎。

原 FakeHTTP／FakeSIP 仍需正常運行；不要因新增入口就停用它們。

## 回復

先預覽 `apk del --simulate luci-app-faketraffic`，只允許移除共同入口。
若解析結果要移除原有核心或其他依賴，先停止操作並保留原套件為明確 world 項目。
確認後正常移除入口，原引擎及設定繼續保留。不要使用 force 或 autoremove 繞過相依檢查。

備份可能含個人設定，不要上傳到公開倉庫、issue 或附件。
