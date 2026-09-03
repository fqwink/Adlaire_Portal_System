// Adlaire Portal System - 設定データ (フラットファイル)
//
// このファイルが設定の唯一の正本です。サーバーもデータベースも存在しないため、
// ポータルの内容(タイトル・お知らせ・カテゴリ・リンク)を変更する場合は、
// このファイルを直接編集してコミットし、`deno task build` で再ビルドの上、
// 静的ホスティング先へ再デプロイしてください。
//
// public/edit.html は、このファイルを書き換えるための編集内容を組み立てて
// TypeScriptファイルとして書き出すローカル編集ツールです（自動反映はされません）。

import type { PortalConfig } from "./types.ts";

export const PORTAL_CONFIG: PortalConfig = {
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
