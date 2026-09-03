// Adlaire Portal System - 共有型定義
// src/validate.ts・src/db.ts・src/client/*.ts・scripts/check-config.ts で共通利用する。

export interface NewsItem {
  date: string;
  text: string;
}

export interface LinkItem {
  name: string;
  url: string;
  icon: string;
  // サーバーが GET /api/config のたびに link_clicks テーブルから付与する、匿名の
  // 累積クリック数(読み取り専用の派生情報)。0件のときは省略される。PUTの入力として
  // 送っても無視される(保存内容には反映されない)。
  clicks?: number;
}

export interface Category {
  name: string;
  links: LinkItem[];
}

export interface PortalConfig {
  title: string;
  themeColor: string;
  news: NewsItem[];
  categories: Category[];
}
