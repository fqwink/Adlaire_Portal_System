// Adlaire Portal System - SQLiteデータアクセス層
// Node.js組み込みの node:sqlite (実験的機能) を使用しており、追加のネイティブ依存がありません。

const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const seedData = require("./seed-data");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "portal.db");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_PATH);
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

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// portal.html / edit.html 側の sanitizeUrl() と同じ基準で検証する
function isValidUrl(url) {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) || /^[./]/.test(trimmed);
}

function validateConfig(config) {
  if (!config || typeof config !== "object") {
    throw new Error("設定データが見つかりません");
  }
  if (!config.title || typeof config.title !== "string") {
    throw new Error("タイトルが不正です");
  }
  if (!config.themeColor || !HEX_COLOR_RE.test(config.themeColor)) {
    throw new Error("テーマカラーの形式が不正です (例: #00a968)");
  }
  if (!Array.isArray(config.categories)) {
    throw new Error("カテゴリデータが不正です");
  }
  const news = Array.isArray(config.news) ? config.news : [];
  news.forEach((item, i) => {
    if (!item || typeof item.date !== "string" || typeof item.text !== "string") {
      throw new Error(`お知らせ[${i}]の形式が不正です`);
    }
  });
  config.categories.forEach((cat, i) => {
    if (!cat || typeof cat.name !== "string") {
      throw new Error(`カテゴリ[${i}]の名称が不正です`);
    }
    if (!Array.isArray(cat.links)) {
      throw new Error(`カテゴリ[${i}]のリンクデータが不正です`);
    }
    cat.links.forEach((link, j) => {
      if (!link || typeof link.name !== "string" || typeof link.icon !== "string") {
        throw new Error(`カテゴリ[${i}]のリンク[${j}]が不正です`);
      }
      if (!isValidUrl(link.url)) {
        throw new Error(`カテゴリ[${i}]のリンク[${j}]のURLが不正です`);
      }
    });
  });
  return { ...config, news };
}

function getConfig() {
  const settings = db.prepare("SELECT title, theme_color AS themeColor FROM settings WHERE id = 1").get();
  if (!settings) return null;

  const news = db
    .prepare("SELECT date, text FROM news ORDER BY sort_order ASC, id ASC")
    .all();

  const categories = db
    .prepare("SELECT id, name FROM categories ORDER BY sort_order ASC, id ASC")
    .all()
    .map((cat) => {
      const links = db
        .prepare("SELECT name, url, icon FROM links WHERE category_id = ? ORDER BY sort_order ASC, id ASC")
        .all(cat.id);
      return { name: cat.name, links };
    });

  return { title: settings.title, themeColor: settings.themeColor, news, categories };
}

function replaceConfig(rawConfig) {
  const config = validateConfig(rawConfig);

  db.exec("BEGIN");
  try {
    db.prepare(
      "INSERT INTO settings (id, title, theme_color) VALUES (1, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET title = excluded.title, theme_color = excluded.theme_color"
    ).run(config.title, config.themeColor);

    db.exec("DELETE FROM news");
    const insertNews = db.prepare("INSERT INTO news (date, text, sort_order) VALUES (?, ?, ?)");
    config.news.forEach((item, idx) => insertNews.run(item.date, item.text, idx));

    db.exec("DELETE FROM links");
    db.exec("DELETE FROM categories");
    const insertCategory = db.prepare("INSERT INTO categories (name, sort_order) VALUES (?, ?)");
    const insertLink = db.prepare(
      "INSERT INTO links (category_id, name, url, icon, sort_order) VALUES (?, ?, ?, ?, ?)"
    );
    config.categories.forEach((cat, cIdx) => {
      insertCategory.run(cat.name, cIdx);
      const categoryId = db.prepare("SELECT last_insert_rowid() AS id").get().id;
      cat.links.forEach((link, lIdx) => {
        insertLink.run(categoryId, link.name, link.url, link.icon, lIdx);
      });
    });

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return getConfig();
}

function ensureSeeded() {
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!existing) {
    replaceConfig(seedData);
  }
}

function resetToSeed() {
  return replaceConfig(seedData);
}

ensureSeeded();

module.exports = { getConfig, replaceConfig, resetToSeed, validateConfig };
