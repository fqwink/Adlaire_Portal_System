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
