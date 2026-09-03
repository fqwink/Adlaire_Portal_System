// Adlaire Portal System - 初期シードデータ
// データベースが空のとき（初回起動時）にこの内容でテーブルを初期化する。

import type { PortalConfig } from "./types.ts";

export const seedData: PortalConfig = {
  title: "Adlaireポータル",
  themeColor: "#00a968",
  news: [
    {
      date: "2026/02/14",
      text: "🎉 Adlaireポータルシステムへようこそ!",
    },
    {
      date: "2026/02/10",
      text: "📢 編集画面から自由にカスタマイズできます",
    },
  ],
  categories: [
    {
      name: "🔧 よく使うツール",
      links: [
        { name: "Google", url: "https://google.com", icon: "🔍" },
        { name: "カレンダー", url: "https://calendar.google.com", icon: "📅" },
        { name: "Gmail", url: "https://mail.google.com", icon: "✉️" },
      ],
    },
    {
      name: "📂 ドキュメント",
      links: [
        { name: "Google Drive", url: "https://drive.google.com", icon: "📂" },
        { name: "Dropbox", url: "https://dropbox.com", icon: "💼" },
      ],
    },
  ],
};
