// Adlaire Portal System - SQLiteデータアクセス層
// Deno公式のSQLiteライブラリ (jsr:@db/sqlite, FFIベース) を使用する。
// 初回起動時のみ src/portal-config.json をシードデータとして読み込み、以降はDBが正本となる。

import { Database } from "jsr:@db/sqlite@^0.13.0";
import type { Category, LinkItem, NewsItem, PortalConfig } from "./types.ts";
import { validateConfig } from "./validate.ts";
import seedDataRaw from "./portal-config.json" with { type: "json" };

const seedData = seedDataRaw as PortalConfig;

const dataDirUrl = new URL("../data/", import.meta.url);
const backupDirUrl = new URL("./backups/", dataDirUrl);
try {
  await Deno.mkdir(dataDirUrl, { recursive: true });
} catch (err) {
  if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
}

const DB_PATH = new URL("./portal.db", dataDirUrl);
const db = new Database(DB_PATH);
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL,
    theme_color TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    weather_location TEXT
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  -- リンクURLごとの匿名クリック集計。個人・端末を識別する情報は一切持たない(SPEC.md §1.3)。
  -- links行はPUTのたびに全削除・再作成されるため、リンクのidではなくURL文字列をキーにして
  -- 保存内容が変わっても集計を維持する。
  CREATE TABLE IF NOT EXISTS link_clicks (
    url TEXT PRIMARY KEY,
    count INTEGER NOT NULL DEFAULT 0
  );

  -- リンクURLが最初に保存された日時。閲覧画面のNEWバッジ表示に使う(SPEC.md §5.1.2)。
  -- link_clicksと同じ理由でURL文字列をキーにし、一度記録した日時はPUTで内容が変わっても更新しない。
  CREATE TABLE IF NOT EXISTS link_added_at (
    url TEXT PRIMARY KEY,
    added_at TEXT NOT NULL
  );

  -- 設定が保存されるたびのスナップショット。誰が変更したかは記録しない(認証機能がないため)。
  CREATE TABLE IF NOT EXISTS change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    changed_at TEXT NOT NULL,
    config_json TEXT NOT NULL
  );

  -- リンクURLごとの定期自動チェック(SPEC.md §5.1.2)の最新結果。link_clicks/link_added_atと
  -- 同じ理由でURL文字列をキーにする。手動チェック(POST /api/check-links)の結果はここには
  -- 保存されない(その場限りの確認のため。SPEC.md §4.4)。
  CREATE TABLE IF NOT EXISTS link_check_status (
    url TEXT PRIMARY KEY,
    ok INTEGER NOT NULL,
    checked_at TEXT NOT NULL
  );
`);

// 旧スキーマ(version列なし)で作成済みのDBに対する軽量マイグレーション
const settingsColumns = db.prepare("PRAGMA table_info(settings)").all<{ name: string }>();
if (!settingsColumns.some((c) => c.name === "version")) {
  db.exec("ALTER TABLE settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
}
if (!settingsColumns.some((c) => c.name === "weather_location")) {
  db.exec("ALTER TABLE settings ADD COLUMN weather_location TEXT");
}

// 旧スキーマ(pinned/expires_at列なし)で作成済みのDBに対する軽量マイグレーション
const newsColumns = db.prepare("PRAGMA table_info(news)").all<{ name: string }>();
if (!newsColumns.some((c) => c.name === "pinned")) {
  db.exec("ALTER TABLE news ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0");
}
if (!newsColumns.some((c) => c.name === "expires_at")) {
  db.exec("ALTER TABLE news ADD COLUMN expires_at TEXT");
}

// 旧スキーマ(hidden列なし)で作成済みのDBに対する軽量マイグレーション
const categoriesColumns = db.prepare("PRAGMA table_info(categories)").all<{ name: string }>();
if (!categoriesColumns.some((c) => c.name === "hidden")) {
  db.exec("ALTER TABLE categories ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0");
}

const MAX_HISTORY_ENTRIES = 50;

interface SettingsRow {
  title: string;
  themeColor: string;
  weatherLocation: string | null;
}
interface CategoryRow {
  id: number;
  name: string;
  hidden: number;
}

// PUT /api/config が If-Match ヘッダーで指定したバージョンと現在のDBの内容が
// 一致しない場合に投げる。楽観的排他制御(SPEC.md §4.2)のためのエラー型。
export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

// URLごとの匿名クリック回数。キーはlinksテーブルと同じURL文字列。
export function getClickCounts(): Record<string, number> {
  const rows = db.prepare("SELECT url, count FROM link_clicks").all<{ url: string; count: number }>();
  const result: Record<string, number> = {};
  rows.forEach((row) => {
    result[row.url] = row.count;
  });
  return result;
}

// リンクのクリックを1件記録する(閲覧画面から匿名で送信される。SPEC.md §4.6)。
export function recordClick(url: string): void {
  db.prepare(
    "INSERT INTO link_clicks (url, count) VALUES (?, 1) " +
      "ON CONFLICT(url) DO UPDATE SET count = count + 1",
  ).run(url);
}

// URLごとの最初に保存された日時。キーはlinksテーブルと同じURL文字列。
function getAddedAtMap(): Record<string, string> {
  const rows = db.prepare("SELECT url, added_at AS addedAt FROM link_added_at").all<
    { url: string; addedAt: string }
  >();
  const result: Record<string, string> = {};
  rows.forEach((row) => {
    result[row.url] = row.addedAt;
  });
  return result;
}

// URLごとの定期自動チェックの最新結果(到達可否のみ)。キーはlinksテーブルと同じURL文字列。
function getLinkCheckStatusMap(): Record<string, boolean> {
  const rows = db.prepare("SELECT url, ok FROM link_check_status").all<{ url: string; ok: number }>();
  const result: Record<string, boolean> = {};
  rows.forEach((row) => {
    result[row.url] = !!row.ok;
  });
  return result;
}

// 定期自動チェック(SPEC.md §5.1.2)の結果をまとめて記録する。src/server.ts の
// スケジューラーから呼び出される。手動チェック(POST /api/check-links)の結果は含めない。
export function recordLinkCheckResults(results: { url: string; ok: boolean }[]): void {
  const now = new Date().toISOString();
  const stmt = db.prepare(
    "INSERT INTO link_check_status (url, ok, checked_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(url) DO UPDATE SET ok = excluded.ok, checked_at = excluded.checked_at",
  );
  db.transaction(() => {
    results.forEach((r) => stmt.run(r.url, r.ok ? 1 : 0, now));
  })();
}

interface NewsRow {
  date: string;
  text: string;
  pinned: number;
  expiresAt: string | null;
}

export function getConfig(): PortalConfig | null {
  const settings = db
    .prepare("SELECT title, theme_color AS themeColor, weather_location AS weatherLocation FROM settings WHERE id = 1")
    .get<SettingsRow>();
  if (!settings) return null;

  const news: NewsItem[] = db
    .prepare(
      "SELECT date, text, pinned, expires_at AS expiresAt FROM news " +
        "ORDER BY pinned DESC, sort_order ASC, id ASC",
    )
    .all<NewsRow>()
    .map((row) => ({
      date: row.date,
      text: row.text,
      ...(row.pinned ? { pinned: true } : {}),
      ...(row.expiresAt ? { expiresAt: row.expiresAt } : {}),
    }));

  const clickCounts = getClickCounts();
  const addedAtMap = getAddedAtMap();
  const checkStatusMap = getLinkCheckStatusMap();

  const categories: Category[] = db
    .prepare("SELECT id, name, hidden FROM categories ORDER BY sort_order ASC, id ASC")
    .all<CategoryRow>()
    .map((cat) => {
      const links: LinkItem[] = db
        .prepare(
          "SELECT name, url, icon FROM links WHERE category_id = ? ORDER BY sort_order ASC, id ASC",
        )
        .all<LinkItem>(cat.id)
        .map((link) => {
          const clicks = clickCounts[link.url];
          const addedAt = addedAtMap[link.url];
          const broken = checkStatusMap[link.url] === false;
          return {
            ...link,
            ...(clicks ? { clicks } : {}),
            ...(addedAt ? { addedAt } : {}),
            ...(broken ? { broken: true } : {}),
          };
        });
      return { name: cat.name, links, ...(cat.hidden ? { hidden: true } : {}) };
    });

  return {
    title: settings.title,
    themeColor: settings.themeColor,
    news,
    categories,
    ...(settings.weatherLocation ? { weatherLocation: settings.weatherLocation } : {}),
  };
}

// 現在の設定バージョン(楽観的排他制御用)。設定データが未作成の場合は null。
export function getVersion(): number | null {
  const row = db.prepare("SELECT version FROM settings WHERE id = 1").get<{ version: number }>();
  return row ? row.version : null;
}

const runReplace = db.transaction((config: PortalConfig, expectedVersion?: number) => {
  const current = db.prepare("SELECT version FROM settings WHERE id = 1").get<{ version: number }>();
  if (expectedVersion !== undefined && current !== undefined && current.version !== expectedVersion) {
    throw new VersionConflictError(
      "他の変更によってこの設定は更新されています。最新の内容を再取得してから保存し直してください。",
    );
  }
  const nextVersion = current ? current.version + 1 : 1;

  db.prepare(
    "INSERT INTO settings (id, title, theme_color, version, weather_location) VALUES (1, ?, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET title = excluded.title, theme_color = excluded.theme_color, " +
      "version = excluded.version, weather_location = excluded.weather_location",
  ).run(config.title, config.themeColor, nextVersion, config.weatherLocation || null);

  db.exec("DELETE FROM news");
  const insertNews = db.prepare(
    "INSERT INTO news (date, text, sort_order, pinned, expires_at) VALUES (?, ?, ?, ?, ?)",
  );
  config.news.forEach((item, idx) =>
    insertNews.run(item.date, item.text, idx, item.pinned ? 1 : 0, item.expiresAt || null)
  );

  db.exec("DELETE FROM links");
  db.exec("DELETE FROM categories");
  const insertCategory = db.prepare(
    "INSERT INTO categories (name, sort_order, hidden) VALUES (?, ?, ?)",
  );
  const insertLink = db.prepare(
    "INSERT INTO links (category_id, name, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  const insertAddedAt = db.prepare(
    "INSERT INTO link_added_at (url, added_at) VALUES (?, ?) ON CONFLICT(url) DO NOTHING",
  );
  const now = new Date().toISOString();
  config.categories.forEach((cat, cIdx) => {
    insertCategory.run(cat.name, cIdx, cat.hidden ? 1 : 0);
    const categoryId = db.lastInsertRowId;
    cat.links.forEach((link, lIdx) => {
      insertLink.run(categoryId, link.name, link.url, link.icon, lIdx);
      insertAddedAt.run(link.url, now);
    });
  });

  // 変更履歴として、保存後の設定全体をスナップショットとして残す(誰が変更したかは記録しない)。
  db.prepare("INSERT INTO change_log (changed_at, config_json) VALUES (?, ?)").run(
    new Date().toISOString(),
    JSON.stringify(config),
  );
  db.exec(
    `DELETE FROM change_log WHERE id NOT IN (
      SELECT id FROM change_log ORDER BY id DESC LIMIT ${MAX_HISTORY_ENTRIES}
    )`,
  );
});

export function replaceConfig(raw: unknown, expectedVersion?: number): PortalConfig {
  const config = validateConfig(raw);
  runReplace(config, expectedVersion);
  return getConfig()!;
}

export function resetToSeed(): PortalConfig {
  return replaceConfig(seedData);
}

export interface HistoryEntrySummary {
  id: number;
  changedAt: string;
}

// 変更履歴の一覧(新しい順)。内容(config_json)は含めない軽量な一覧。
export function getHistoryList(): HistoryEntrySummary[] {
  return db
    .prepare("SELECT id, changed_at AS changedAt FROM change_log ORDER BY id DESC")
    .all<HistoryEntrySummary>();
}

// 変更履歴1件のスナップショット(保存当時の設定全体)を取得する。存在しない場合はnull。
export function getHistoryEntry(id: number): { changedAt: string; config: PortalConfig } | null {
  const row = db
    .prepare("SELECT changed_at AS changedAt, config_json AS configJson FROM change_log WHERE id = ?")
    .get<{ changedAt: string; configJson: string }>(id);
  if (!row) return null;
  return { changedAt: row.changedAt, config: JSON.parse(row.configJson) as PortalConfig };
}

function ensureSeeded(): void {
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!existing) {
    replaceConfig(seedData);
  }
}

ensureSeeded();

// 現在の data/portal.db をそのまま読み込む(手動ダウンロード用。SPEC.md §4.9)。定期バックアップ
// (backupDatabase())と同じく、書き込み中に読む可能性を完全には排除できないベストエフォートな
// 取得である点は同じ(§2.3参照)。
export async function readDbFileBytes(): Promise<Uint8Array> {
  return await Deno.readFile(DB_PATH);
}

const MAX_BACKUPS_TO_KEEP = 24;

// data/portal.db を data/backups/ へタイムスタンプ付きでコピーし、古いものを削除する。
// SQLiteファイルの書き込み中に呼ばれる可能性を完全には排除できないベストエフォートな
// バックアップであり、トランザクション整合性を厳密に保証するものではない
// (このシステムの用途では書き込み頻度が低く、実用上のリスクは小さいと判断している)。
export async function backupDatabase(): Promise<void> {
  await Deno.mkdir(backupDirUrl, { recursive: true }).catch((err) => {
    if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupUrl = new URL(`./portal-${timestamp}.db`, backupDirUrl);
  await Deno.copyFile(DB_PATH, backupUrl);

  const entries: { name: string; url: URL }[] = [];
  for await (const entry of Deno.readDir(backupDirUrl)) {
    if (entry.isFile && entry.name.startsWith("portal-") && entry.name.endsWith(".db")) {
      entries.push({ name: entry.name, url: new URL(entry.name, backupDirUrl) });
    }
  }
  entries.sort((a, b) => (a.name < b.name ? 1 : -1)); // ファイル名(タイムスタンプ)の新しい順
  for (const old of entries.slice(MAX_BACKUPS_TO_KEEP)) {
    await Deno.remove(old.url).catch(() => {});
  }
}
