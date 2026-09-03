// Adlaire Portal System - 共有型定義
// src/validate.ts・src/client/*.ts・scripts/check-config.ts で共通利用する。

export interface NewsItem {
  date: string;
  text: string;
}

export interface LinkItem {
  name: string;
  url: string;
  icon: string;
  // 編集者があらかじめ指定する「ピン留め」フラグ。ブラウザ側の保存を伴う
  // 個人ごとの「お気に入り」は§1.3の制約により実装しない代わりに、
  // 静的データとして全閲覧者に共通のピン留めリンクを提供する。省略時はfalse扱い。
  pinned?: boolean;
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
