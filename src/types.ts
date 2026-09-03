// Adlaire Portal System - 共有型定義
// src/validate.ts・src/db.ts・src/client/*.ts・scripts/check-config.ts で共通利用する。

// お知らせの種別ラベル。省略時は「一般」扱いでラベル表示を行わない。
export type NewsLabel = "important" | "maintenance";

export interface NewsItem {
  date: string;
  text: string;
  // 常に先頭に表示する(編集者が設定する共有データ。SPEC.md §1.3のブラウザ内保存禁止とは無関係)。省略時はfalse扱い。
  pinned?: boolean;
  // この日付(YYYY-MM-DD)を過ぎたら閲覧画面に表示しなくなる、任意の有効期限。省略時は無期限。
  expiresAt?: string;
  // 種別ラベル(SPEC.md §3.2, §5.1.2)。省略時は「一般」(ラベルバッジを表示しない)。
  label?: NewsLabel;
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
  // サーバーが link_check_status テーブルから付与する、定期自動チェックで到達不可だったかどうか
  // (読み取り専用の派生情報)。到達可能、または未チェックの場合は省略される。PUTの入力として
  // 送っても無視される。
  broken?: boolean;
  // 編集者が入力する任意の補足説明。閲覧画面ではカードのツールチップ(title属性)として表示する。
  memo?: string;
}

export interface Category {
  name: string;
  links: LinkItem[];
  // 閲覧画面(portal.html)には表示しない「下書き」状態(編集者が管理する共有データ)。
  // 編集画面では引き続き編集できる。省略時はfalse扱い(公開状態)。
  hidden?: boolean;
  // カテゴリ名の前に表示する任意の絵文字アイコン(§5.1.2)。省略時は表示しない。
  icon?: string;
  // 閲覧画面でのリンクの表示形式。省略時("grid")は既存のカードグリッド表示、"list"は
  // 1行ずつのコンパクトな一覧表示にする(§5.1.2)。
  displayMode?: "grid" | "list";
}

export interface PortalConfig {
  title: string;
  themeColor: string;
  news: NewsItem[];
  categories: Category[];
  // 天気表示に使う地点名(Open-Meteoのジオコーディングに渡す文字列。例: "Tokyo")。編集者が指定する
  // 通常の入力項目。省略・空文字列の場合、閲覧画面には天気ウィジェットを表示しない。
  weatherLocation?: string;
  // trueの場合、閲覧画面のリンクカードでicon(絵文字)の代わりにリンク先のファビコンを表示する。
  // 取得に失敗した場合はiconにフォールバックする(§5.1.2)。省略時はfalse(絵文字のみ)。
  useFavicon?: boolean;
  // trueの場合、有効期限(news[].expiresAt)を過ぎたお知らせを閲覧画面から完全に消さず、
  // 「過去のお知らせ」として折りたたみ表示する(§5.1.2)。省略時はfalse(従来どおり完全非表示)。
  archiveExpiredNews?: boolean;
  // trueの場合、種別ラベルが"important"のお知らせを、ピン留め(pinned)と同様に閲覧画面で
  // 常に先頭にまとめて表示する(§3.2, §5.1.2)。省略時はfalse(ラベルは表示順に影響しない)。
  pinImportantNews?: boolean;
}

// GET /api/weather のレスポンス形式。config(PortalConfig)には含まれない、
// サーバーがOpen-Meteo(外部API、APIキー不要)から定期的に取得する live データ。
export interface WeatherInfo {
  location: string | null; // 設定されている地点名(weatherLocationをそのまま反映)。未設定の場合はnull
  resolvedName: string | null; // ジオコーディングで解決された地名(取得できた場合)
  tempC: number | null;
  tempMaxC: number | null; // 当日の予想最高気温
  tempMinC: number | null; // 当日の予想最低気温
  weatherCode: number | null; // WMO Weather interpretation code
  fetchedAt: string | null; // ISO 8601形式。データ取得日時
  error: string | null; // 取得に失敗した場合のエラーメッセージ
}
