// Adlaire Portal System - 閲覧画面 (portal.html) のクライアントロジック
// ビルド後、public/js/portal.js として portal.html から読み込まれる。
// サーバーは存在しないため、設定データは src/portal-config.ts からビルド時に
// このファイルへ直接バンドルされる(実行時のfetchは行わない)。
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { Category, PortalConfig } from "../types.ts";
import { PORTAL_CONFIG } from "../portal-config.ts";

function hexToRgb(hex: string): string | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}`
    : null;
}

// XSS対策: HTMLエスケープ
function escapeHtml(text: unknown): string {
  const map: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  };
  return String(text).replace(/[&<>"']/g, (m) => map[m]);
}

// URL検証
function sanitizeUrl(url: unknown): string {
  if (!url) return "#";
  const urlStr = String(url).trim();
  if (/^https?:\/\//i.test(urlStr)) return urlStr;
  if (/^\//.test(urlStr) || /^\./.test(urlStr)) return urlStr;
  return "#";
}

function renderPortal(config: PortalConfig): void {
  if (!config) return;

  if (config.themeColor) {
    document.documentElement.style.setProperty("--primary", config.themeColor);
    const rgb = hexToRgb(config.themeColor);
    if (rgb) {
      document.documentElement.style.setProperty("--primary-light", `rgba(${rgb}, 0.1)`);
      const [r, g, b] = rgb.split(", ").map(Number);
      const darkR = Math.max(0, r - 30);
      const darkG = Math.max(0, g - 30);
      const darkB = Math.max(0, b - 30);
      document.documentElement.style.setProperty("--primary-dark", `rgb(${darkR}, ${darkG}, ${darkB})`);
    }
  }

  document.getElementById("sidebar-title")!.textContent = config.title;
  const now = new Date();
  document.getElementById("today-date")!.textContent =
    `${now.getFullYear()}.${(now.getMonth() + 1).toString().padStart(2, "0")}.${now.getDate().toString().padStart(2, "0")}`;

  const newsArea = document.getElementById("news-area")!;
  const newsList = document.getElementById("news-list")!;
  newsList.innerHTML = "";

  const newsItems = Array.isArray(config.news) ? config.news : [];

  if (newsItems.length > 0) {
    newsArea.style.display = "block";
    newsItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = "news-item";
      li.innerHTML = `<span class="news-date">${escapeHtml(item.date)}</span><span class="news-text">${escapeHtml(item.text)}</span>`;
      newsList.appendChild(li);
    });
  } else {
    newsArea.style.display = "none";
  }

  const navList = document.getElementById("nav-list")!;
  const contentArea = document.getElementById("content-area")!;
  navList.innerHTML = "";
  contentArea.innerHTML = "";

  config.categories.forEach((cat: Category, idx: number) => {
    const navLi = document.createElement("li");
    navLi.className = "nav-item";
    navLi.innerHTML = `<a href="#cat-${idx}" class="nav-link"><span>${escapeHtml(cat.name)}</span><span class="nav-count">${cat.links.length}</span></a>`;
    navList.appendChild(navLi);

    const section = document.createElement("div");
    section.className = "category-section search-target";
    section.id = `cat-${idx}`;
    section.innerHTML = `<div class="category-header"><h2 class="category-title">${escapeHtml(cat.name)}</h2></div>`;

    const grid = document.createElement("div");
    grid.className = "grid";
    cat.links.forEach((link) => {
      const a = document.createElement("a");
      a.href = sanitizeUrl(link.url);
      a.className = "card search-item";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.dataset.search = (link.name + cat.name).toLowerCase();
      a.innerHTML = `<span class="card-icon">${escapeHtml(link.icon)}</span><span class="card-name">${escapeHtml(link.name)}</span>`;
      grid.appendChild(a);
    });
    section.appendChild(grid);
    contentArea.appendChild(section);
  });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute("href")!);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

document.getElementById("search-input")!.addEventListener("keyup", (e) => {
  const term = (e.target as HTMLInputElement).value.toLowerCase();

  if (term === "") {
    // 検索ボックスが空の場合はすべて表示
    document.querySelectorAll<HTMLElement>(".search-item").forEach((item) => {
      item.style.display = "flex";
    });
    document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => {
      sec.style.display = "block";
    });
  } else {
    // 検索キーワードがある場合はフィルタリング
    document.querySelectorAll<HTMLElement>(".search-item").forEach((item) => {
      item.style.display = item.dataset.search?.includes(term) ? "flex" : "none";
    });
    document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => {
      const visibleCount = Array.from(sec.querySelectorAll<HTMLElement>(".search-item")).filter(
        (el) => el.style.display !== "none",
      ).length;
      sec.style.display = visibleCount > 0 ? "block" : "none";
    });
  }
});

// ビルド時にバンドルされた設定データを表示する
renderPortal(PORTAL_CONFIG);
