// Adlaire Portal System - SQLiteデータアクセス層
// Deno公式のSQLiteライブラリ (jsr:@db/sqlite, FFIベース) を使用する。
// 初回起動時のみ src/portal-config.json をシードデータとして読み込み、以降はDBが正本となる。

import { Database } from "jsr:@db/sqlite@^0.13.0";
import type { Category, LinkItem, NewsItem, PortalConfig } from "./types.ts";
import { validateConfig } from "./validate.ts";
import seedDataRaw from "./portal-config.json" with { type: "json" };

const seedData = seedDataRaw as PortalConfig;

const dataDirUrl = new URL("../data/", import.meta.url);
try {
  await Deno.mkdir(dataDirUrl, { recursive: true });
} catch (err) {
  if (!(err instanceof Deno.errors.AlreadyExists)) throw err;
}

const db = new Database(new URL("./portal.db", dataDirUrl));
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    title TEXT NOT NULL,
    theme_color TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS news (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    text TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    icon TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  );
`);

// 旧スキーマ(version列なし)で作成済みのDBに対する軽量マイグレーション
const settingsColumns = db.prepare("PRAGMA table_info(settings)").all<{ name: string }>();
if (!settingsColumns.some((c) => c.name === "version")) {
  db.exec("ALTER TABLE settings ADD COLUMN version INTEGER NOT NULL DEFAULT 1");
}

interface SettingsRow {
  title: string;
  themeColor: string;
}
interface CategoryRow {
  id: number;
  name: string;
}

// PUT /api/config が If-Match ヘッダーで指定したバージョンと現在のDBの内容が
// 一致しない場合に投げる。楽観的排他制御(SPEC.md §4.2)のためのエラー型。
export class VersionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VersionConflictError";
  }
}

export function getConfig(): PortalConfig | null {
  const settings = db
    .prepare("SELECT title, theme_color AS themeColor FROM settings WHERE id = 1")
    .get<SettingsRow>();
  if (!settings) return null;

  const news = db
    .prepare("SELECT date, text FROM news ORDER BY sort_order ASC, id ASC")
    .all<NewsItem>();

  const categories: Category[] = db
    .prepare("SELECT id, name FROM categories ORDER BY sort_order ASC, id ASC")
    .all<CategoryRow>()
    .map((cat) => {
      const links: LinkItem[] = db
        .prepare(
          "SELECT name, url, icon FROM links WHERE category_id = ? ORDER BY sort_order ASC, id ASC",
        )
        .all<LinkItem>(cat.id);
      return { name: cat.name, links };
    });

  return { title: settings.title, themeColor: settings.themeColor, news, categories };
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
    "INSERT INTO settings (id, title, theme_color, version) VALUES (1, ?, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET title = excluded.title, theme_color = excluded.theme_color, version = excluded.version",
  ).run(config.title, config.themeColor, nextVersion);

  db.exec("DELETE FROM news");
  const insertNews = db.prepare("INSERT INTO news (date, text, sort_order) VALUES (?, ?, ?)");
  config.news.forEach((item, idx) => insertNews.run(item.date, item.text, idx));

  db.exec("DELETE FROM links");
  db.exec("DELETE FROM categories");
  const insertCategory = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
  const insertLink = db.prepare(
    "INSERT INTO links (category_id, name, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)",
  );
  config.categories.forEach((cat, cIdx) => {
    insertCategory.run(cat.name, cIdx);
    const categoryId = db.lastInsertRowId;
    cat.links.forEach((link, lIdx) => {
      insertLink.run(categoryId, link.name, link.url, link.icon, lIdx);
    });
  });
});

export function replaceConfig(raw: unknown, expectedVersion?: number): PortalConfig {
  const config = validateConfig(raw);
  runReplace(config, expectedVersion);
  return getConfig()!;
}

export function resetToSeed(): PortalConfig {
  return replaceConfig(seedData);
}

function ensureSeeded(): void {
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!existing) {
    replaceConfig(seedData);
  }
}

ensureSeeded();
