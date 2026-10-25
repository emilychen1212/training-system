# 飛資得講習站

單一講師用的教育訓練管理平台：開課、課後問卷 QR Code、課堂即時投影、現場抽獎。

- 需求與決策紀錄：[docs/SPEC.md](docs/SPEC.md)
- 部署步驟：[docs/SETUP.md](docs/SETUP.md)
- 驗收清單：[docs/TEST.md](docs/TEST.md)
- 介面示意：[docs/mockups/](docs/mockups/)

| 路徑 | 內容 |
| --- | --- |
| `s/` | 學員問卷（GitHub Pages） |
| `live/` | 課堂投影（GitHub Pages） |
| `assets/`、`config.js` | 學員端共用檔案與 API 網址設定 |
| `gas-public/` | 公開 API（Apps Script，任何人可呼叫，只能寫入與讀統計） |
| `gas-admin/` | 講師後台（Apps Script，綁在試算表，只有講師帳號能開） |
| `dev/` | 本機測試伺服器：`SEED=1 node dev/server.js`，打開 http://localhost:8768/admin |
