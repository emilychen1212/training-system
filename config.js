/*
 * 講習站設定：部署完 Apps Script 後，把兩個網址貼在引號裡。
 * 這兩個網址都不是密碼：公開 API 只能寫入與讀取統計，後台只有你的 Google 帳號打得開。
 */
window.APP_CONFIG = {
  // 公開 API（gas-public）的網頁應用程式網址，結尾是 /exec
  API_URL: 'https://script.google.com/macros/s/AKfycbxwhgL2zAVhYu41xgMFbRmYco6ZJ09oFFEWwUER3hVmOEJsQDXBXEFFGOSnoy8DJJg/exec',
  // 講師後台（gas-admin）的網頁應用程式網址，投影頁的「講師抽獎」按鈕會連過去
  ADMIN_URL: 'https://script.google.com/macros/s/AKfycbzYHDT6kM3eCgdNndgUXCNC9QZLIqcylTAPTDpCs4iTVWJSLWEtO1LcK1jbm1fT2EHtmA/exec'
};
