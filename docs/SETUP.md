# 飛資得講習站｜部署步驟

照順序做，大約 40 分鐘。每一步做完都有「應該看到什麼」，對不上就先停下來問。

開始前準備：

- 你自己的 Google 帳號（登入 Chrome）
- GitHub 帳號 `emilychen1212`，repository `training-system`（已建立，公開）
- 這個資料夾：`Emily Claude/training-system/`

會建立的東西：

| 名稱 | 在哪裡 | 用途 |
| --- | --- | --- |
| 試算表「飛資得講習站_資料庫」 | Google 雲端硬碟 | 所有資料 |
| Apps Script「講習站後台」 | 綁在試算表上 | 講師後台，只有你打得開 |
| Apps Script「講習站公開API」 | script.google.com | 學員填答用，只能寫入與讀統計 |
| GitHub Pages | emilychen1212.github.io/training-system | 學員問卷、課堂投影 |

---

## 步驟 1：建立試算表

1. 打開 <https://sheets.new>，會開一份新的試算表。
2. 左上角把名稱改成 **飛資得講習站_資料庫**。

## 步驟 2：貼上講師後台程式

1. 在試算表上方選單點 **擴充功能 → Apps Script**，會開新分頁。
2. 左上角「未命名的專案」點一下，改名為 **講習站後台**。
3. 左邊「檔案」區已經有一個 `程式碼.gs`：
   - 點它右邊的「⋮」→ **重新命名**，改成 `Code`（會自動變成 `Code.gs`）。
   - 全選內容刪掉，貼上 `gas-admin/Code.gs` 的全部內容。
4. 「檔案」旁邊的 **＋ → 指令碼**，命名 `Setup`，貼上 `gas-admin/Setup.gs`。
   再建兩個指令碼 `Templates`、`Worksheets`，分別貼上 `gas-admin/Templates.gs`、`gas-admin/Worksheets.gs`。
5. **＋ → HTML**，命名 `Index`，貼上 `gas-admin/Index.html`。
6. 同樣再建三個 HTML：`Styles`（貼 `Styles.html`）、`Scripts`（貼 `Scripts.html`）、`Logo`（貼 `Logo.html`，課程成果報告的 logo）。
7. 左邊齒輪 **專案設定** → 勾選 **在編輯器中顯示「appsscript.json」資訊清單檔案**。
   回到編輯器，點 `appsscript.json`，全部換成 `gas-admin/appsscript.json` 的內容。
8. 按 **Ctrl/⌘ + S** 存檔。

> 檔名大小寫要一模一樣（Index、Styles、Scripts），程式是用名字找檔案的。

## 步驟 3：初始化試算表

1. 上方函式下拉選單選 **setupSheets**，按 **執行**。
2. 第一次會要求授權：**審查權限** → 選你的帳號 → 出現「Google 尚未驗證這個應用程式」→ 點 **進階** → **前往「講習站後台」（不安全）** → **允許**。
   這是因為程式是你自己寫的、沒送 Google 審核，屬於正常現象。
3. 下方「執行紀錄」出現：`完成！試算表 ID（…）：一長串英數字`。
   **把這串 ID 複製起來**，步驟 5 會用到。

應該看到：回到試算表，多了 `courses`、`templates`、`responses`、`raffle_entries`、`audit_log` 五個分頁，`templates` 裡有一列 v1。

## 步驟 4：部署講師後台

1. 右上角 **部署 → 新增部署作業**。
2. 左邊齒輪「選取類型」→ **網頁應用程式**。
3. 說明填「第一版」，**執行身分：我**，**誰可以存取：只有我自己**。
4. 按 **部署**，複製「網頁應用程式網址」（結尾是 `/exec`）。這是 **後台網址**，請加入書籤。

應該看到：用這個網址打開，出現「飛資得講習站」的課程列表（目前是空的）。
用無痕視窗打開同一個網址，會被 Google 要求登入或顯示沒有權限，這樣才對。

## 步驟 5：建立公開 API

1. 打開 <https://script.google.com> → **新專案**，改名 **講習站公開API**。
2. `程式碼.gs` 改名 `Code`，內容換成 `gas-public/Code.gs`。
3. 一樣在專案設定打開 `appsscript.json`，換成 `gas-public/appsscript.json`。
4. **專案設定 → 指令碼屬性 → 新增指令碼屬性**：
   - 屬性：`SPREADSHEET_ID`
   - 值：步驟 3 複製的試算表 ID
   - 按 **儲存指令碼屬性**
5. 回編輯器，函式選 **doGet**，按 **執行**，一樣跑一次授權流程。
6. **部署 → 新增部署作業 → 網頁應用程式**，**執行身分：我**，**誰可以存取：所有人**。
7. 複製網址，這是 **API 網址**。

應該看到：用瀏覽器打開 API 網址，畫面顯示 `{"ok":true,"service":"training-system public api"}`。

## 步驟 6：自我測試

1. 回到 **講習站後台** 的 Apps Script。
2. **專案設定 → 指令碼屬性**，新增 `PUBLIC_API_URL`，值是步驟 5 的 API 網址。
3. 函式選 **runSelfTest**，按 **執行**（會再要求一次「連線到外部服務」的授權）。

應該看到：執行紀錄最後一行是 `共 71 項，全部通過`。
有 ❌ 就把整段紀錄複製給 Claude。測試會自己建一堂「[自我測試]」課程，跑完就刪掉。

## 步驟 7：填網站設定並上傳到 GitHub

1. 打開 `training-system/config.js`，把兩個網址貼進引號裡：

   ```js
   API_URL: 'https://script.google.com/macros/s/……/exec',
   ADMIN_URL: 'https://script.google.com/macros/s/……/exec'
   ```

2. 上傳到 GitHub。**最簡單：請 Claude 幫你推上去**（你的電腦已經登入 GitHub）。
   想自己來的話：在 repo 頁面 **Add file → Upload files**，把 `training-system` 資料夾裡的全部內容拖進去（不要拖資料夾本身），按 **Commit changes**。
3. repo 頁面 **Settings → Pages**：
   - Source：**Deploy from a branch**
   - Branch：**main**，資料夾 **/ (root)** → **Save**
4. 等 1～2 分鐘，頁面上方會出現 `Your site is live at https://emilychen1212.github.io/training-system/`。

## 步驟 8：用手機跑一次完整流程

1. 打開後台 → **＋ 新增課程**，填課名、今天日期，加一個獎項（例：測試獎 × 1）→ 儲存。
2. 在課程詳情按 **開放填答** → **開啟投影畫面**。
3. 用手機掃投影畫面的 QR Code，填完問卷 → **我要參加抽獎** → 填名字與 Email → 勾同意 → 確認登記。
4. 15 秒內，投影畫面的「份課程回饋」與「人登記抽獎」各變成 1。
5. 投影畫面右上 **講師抽獎** → **結束填答並凍結名單** → **抽出下一位**。
6. 回課程詳情 → **匯出名單 CSV**（存到你自己的資料夾）→ **清除本堂抽獎資料**（輸入「清除」）。
7. 後台只能刪除「完全沒有人填答」的課程。這堂測試課不想留的話，到試算表 `courses` 和 `responses` 分頁刪掉它的列（用 course_id 對應）。

完成！之後每堂課從步驟 8 的第 1 步開始就好。

---

## 之後要更新程式時

**Apps Script（後台或公開 API）**：貼上新程式 → 存檔 → **部署 → 管理部署作業** → 右上鉛筆 → 版本選 **新版本** → **部署**。
這樣網址不會變。**不要按「新增部署作業」**，那會產生新網址，config.js 就要跟著改。

**網站（GitHub）**：換掉檔案後上傳或推送，1～2 分鐘後生效。手機如果還看到舊畫面，重新整理一次。

## 常見問題

- **問卷頁顯示「網站還沒設定完成」**：config.js 的 API_URL 是空的，或還沒上傳到 GitHub。
- **問卷頁一直「載入中」或顯示網路不穩**：API 網址貼錯，或公開 API 的存取權不是「所有人」。
- **後台顯示「試算表還沒初始化」**：步驟 3 的 setupSheets 沒有執行成功。
- **公開 API 回 `NOT_CONFIGURED`**：步驟 5 的 SPREADSHEET_ID 沒存到，或貼錯。
- **試算表裡的欄位可以改名嗎**：不行，程式靠第一列欄位名稱找資料。可以在最右邊加自己的欄位。
