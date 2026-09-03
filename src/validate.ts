// Adlaire Portal System - 設定データのバリデーション
// SPEC.md §6 のバリデーション仕様に対応する。src/db.ts の replaceConfig() (PUT /api/config、
// および scripts/check-config.ts によるシードデータのビルド前検証) から呼び出される。
// isValidUrl() は src/server.ts の check-links エンドポイントでも入力検証に使う。

import type { PortalConfig } from "./types.ts";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// portal.html の sanitizeUrl() と同じ基準で検証する
export function isValidUrl(url: unknown): boolean {
  if (typeof url !== "string") return false;
  const trimmed = url.trim();
  return /^https?:\/\//i.test(trimmed) || /^[./]/.test(trimmed);
}

export function validateConfig(raw: unknown): PortalConfig {
  const config = raw as Partial<PortalConfig> | null | undefined;

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
  if (
    config.weatherLocation !== undefined && config.weatherLocation !== null &&
    typeof config.weatherLocation !== "string"
  ) {
    throw new Error("天気表示の地点名が不正です");
  }

  const news = Array.isArray(config.news) ? config.news : [];
  news.forEach((item, i) => {
    if (!item || typeof item.date !== "string" || typeof item.text !== "string") {
      throw new Error(`お知らせ[${i}]の形式が不正です`);
    }
    if (item.pinned !== undefined && typeof item.pinned !== "boolean") {
      throw new Error(`お知らせ[${i}]のピン留め指定が不正です`);
    }
    if (item.expiresAt !== undefined && item.expiresAt !== null && item.expiresAt !== "") {
      if (typeof item.expiresAt !== "string" || !DATE_RE.test(item.expiresAt)) {
        throw new Error(`お知らせ[${i}]の有効期限の形式が不正です (例: 2026-12-31)`);
      }
    }
  });

  config.categories.forEach((cat, i) => {
    if (!cat || typeof cat.name !== "string") {
      throw new Error(`カテゴリ[${i}]の名称が不正です`);
    }
    if (!Array.isArray(cat.links)) {
      throw new Error(`カテゴリ[${i}]のリンクデータが不正です`);
    }
    if (cat.hidden !== undefined && typeof cat.hidden !== "boolean") {
      throw new Error(`カテゴリ[${i}]の公開状態の指定が不正です`);
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

  return {
    title: config.title,
    themeColor: config.themeColor,
    news,
    categories: config.categories,
    ...(config.weatherLocation ? { weatherLocation: config.weatherLocation } : {}),
  } as PortalConfig;
}
