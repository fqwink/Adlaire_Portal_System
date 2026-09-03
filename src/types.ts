// Adlaire Portal System - 共有型定義
// src/validate.ts・src/db.ts・src/client/*.ts・scripts/check-config.ts で共通利用する。

export interface NewsItem {
  date: string;
  text: string;
  // 常に先頭に表示する(編集者が設定する共有データ。SPEC.md §1.3のブラウザ内保存禁止とは無関係)。省略時はfalse扱い。
  pinned?: boolean;
  // この日付(YYYY-MM-DD)を過ぎたら閲覧画面に表示しなくなる、任意の有効期限。省略時は無期限。
  expiresAt?: string;
}

export interface LinkItem {
  name: string;
  url: string;
  icon: string;
  // サーバーが GET /api/config のたびに link_clicks テーブルから付与する、匿名の
  // 累積クリック数(読み取り専用の派生情報)。0件のときは省略される。PUTの入力として
  // 送っても無視される(保存内容には反映されない)。
  clicks?: number;
  // サーバーが link_added_at テーブルから付与する、このURLが最初に保存された日時(読み取り専用の
  // 派生情報。ISO 8601形式)。閲覧画面のNEWバッジ表示に使う。PUTの入力として送っても無視される。
  addedAt?: string;
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
