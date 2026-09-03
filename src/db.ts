// Adlaire Portal System - SQLiteデータアクセス層
// Deno公式のSQLiteライブラリ (jsr:@db/sqlite, FFIベース) を使用する。

import { Database } from "jsr:@db/sqlite@^0.13.0";
import type { Category, LinkItem, NewsItem, PortalConfig } from "./types.ts";
import { validateConfig } from "./validate.ts";
import { seedData } from "./seed-data.ts";

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
    theme_color TEXT NOT NULL
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

interface SettingsRow {
  title: string;
  themeColor: string;
}
interface CategoryRow {
  id: number;
  name: string;
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
      const links = db
        .prepare(
          "SELECT name, url, icon FROM links WHERE category_id = ? ORDER BY sort_order ASC, id ASC",
        )
        .all<LinkItem>(cat.id);
      return { name: cat.name, links };
    });

  return { title: settings.title, themeColor: settings.themeColor, news, categories };
}

const runReplace = db.transaction((config: PortalConfig) => {
  db.prepare(
    "INSERT INTO settings (id, title, theme_color) VALUES (1, ?, ?) " +
      "ON CONFLICT(id) DO UPDATE SET title = excluded.title, theme_color = excluded.theme_color",
  ).run(config.title, config.themeColor);

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

export function replaceConfig(raw: unknown): PortalConfig {
  const config = validateConfig(raw);
  runReplace(config);
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
