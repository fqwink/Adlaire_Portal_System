// Adlaire Portal System - 設定データのバリデーション
// SPEC.md §4.4 のサーバー側バリデーション仕様に対応する。

import type { PortalConfig } from "./types.ts";

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;

// portal.html / edit.html 側の sanitizeUrl() と同じ基準で検証する
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

  return {
    title: config.title,
    themeColor: config.themeColor,
    news,
    categories: config.categories,
  } as PortalConfig;
}
