// Adlaire Portal System - 閲覧画面 (portal.html) のクライアントロジック
// ビルド後、public/js/portal.js として portal.html から読み込まれる。
// バックエンド(src/server.ts)のREST API(GET /api/config)から設定データを取得する。
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { Category, PortalConfig } from "../types.ts";

// リンクの追加からこの日数以内はNEWバッジを表示する(SPEC.md §5.1.2)。
const NEW_BADGE_DAYS = 7;

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

// 検索語にマッチした部分だけを<mark>で囲む。マッチ前後・マッチ部分をそれぞれ
// 個別にエスケープしてから連結するため、HTMLとして安全に挿入できる。
function highlightMatch(text: string, term: string): string {
  if (!term) return escapeHtml(text);
  const idx = text.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return escapeHtml(text);
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + term.length);
  const after = text.slice(idx + term.length);
  return `${escapeHtml(before)}<mark>${escapeHtml(match)}</mark>${escapeHtml(after)}`;
}

// URL検証
function sanitizeUrl(url: unknown): string {
  if (!url) return "#";
  const urlStr = String(url).trim();
  if (/^https?:\/\//i.test(urlStr)) return urlStr;
  if (/^\//.test(urlStr) || /^\./.test(urlStr)) return urlStr;
  return "#";
}

// リンククリックを匿名でサーバーに記録する(個人・端末の識別は行わない。SPEC.md §1.3, §4.6)。
// target="_blank"のためページ遷移を伴わず、結果を待つ必要もないためfire-and-forgetで送る。
function reportClick(url: string): void {
  fetch("/api/click", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  }).catch(() => {
    // 集計目的の付随情報のため、送信に失敗してもユーザー体験に影響させない
  });
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

  // 有効期限(expiresAt)を過ぎたお知らせは表示しない(SPEC.md §5.1.2)。
  const todayIso = now.toISOString().slice(0, 10);
  const newsItems = (Array.isArray(config.news) ? config.news : []).filter(
    (item) => !item.expiresAt || item.expiresAt >= todayIso,
  );

  if (newsItems.length > 0) {
    newsArea.style.display = "block";
    newsItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.pinned ? "news-item news-pinned" : "news-item";
      const pinBadge = item.pinned ? `<span class="news-pin" title="常に先頭に表示">📌</span>` : "";
      li.innerHTML =
        `${pinBadge}<span class="news-date">${escapeHtml(item.date)}</span><span class="news-text">${escapeHtml(item.text)}</span>`;
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
    section.innerHTML =
      `<div class="category-header" data-role="collapse-toggle"><h2 class="category-title">${escapeHtml(cat.name)}</h2><span class="collapse-arrow">▾</span></div>`;

    const grid = document.createElement("div");
    grid.className = "grid";
    cat.links.forEach((link) => {
      const a = document.createElement("a");
      a.href = sanitizeUrl(link.url);
      a.className = "card search-item";
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.dataset.search = (link.name + cat.name).toLowerCase();
      a.dataset.name = link.name;
      const clicksHtml = link.clicks
        ? `<span class="card-clicks" title="累計クリック数">👁 ${link.clicks}</span>`
        : "";
      const isNew = link.addedAt &&
        (now.getTime() - new Date(link.addedAt).getTime()) / (1000 * 60 * 60 * 24) <= NEW_BADGE_DAYS;
      const newHtml = isNew ? `<span class="card-new" title="最近追加されたリンク">NEW</span>` : "";
      a.innerHTML =
        `${newHtml}<span class="card-icon">${escapeHtml(link.icon)}</span><span class="card-name">${escapeHtml(link.name)}</span>${clicksHtml}`;
      a.addEventListener("click", () => reportClick(link.url));
      grid.appendChild(a);
    });
    section.appendChild(grid);
    contentArea.appendChild(section);
  });

  // カテゴリの折りたたみ(このブラウザタブ内だけの表示状態。保存・永続化は行わない。SPEC.md §1.3)
  document.querySelectorAll<HTMLElement>('[data-role="collapse-toggle"]').forEach((header) => {
    header.addEventListener("click", () => {
      header.closest(".category-section")?.classList.toggle("collapsed");
    });
  });

  document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener("click", function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute("href")!);
      if (target) {
        target.classList.remove("collapsed");
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
}

document.getElementById("search-input")!.addEventListener("keyup", (e) => {
  const term = (e.target as HTMLInputElement).value.toLowerCase();

  if (term === "") {
    // 検索ボックスが空の場合はすべて表示し、ハイライトも解除する
    document.querySelectorAll<HTMLElement>(".search-item").forEach((item) => {
      item.style.display = "flex";
      const nameEl = item.querySelector(".card-name");
      if (nameEl) nameEl.innerHTML = escapeHtml(item.dataset.name ?? "");
    });
    document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => {
      sec.style.display = "block";
    });
  } else {
    // 検索キーワードがある場合はフィルタリングし、マッチ部分をハイライトする。
    // 折りたたみ中でも検索結果は必ず見えるよう、マッチしたカテゴリは展開する。
    document.querySelectorAll<HTMLElement>(".search-item").forEach((item) => {
      const matched = item.dataset.search?.includes(term) ?? false;
      item.style.display = matched ? "flex" : "none";
      const nameEl = item.querySelector(".card-name");
      if (nameEl) {
        nameEl.innerHTML = matched ? highlightMatch(item.dataset.name ?? "", term) : escapeHtml(item.dataset.name ?? "");
      }
    });
    document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => {
      const visibleCount = Array.from(sec.querySelectorAll<HTMLElement>(".search-item")).filter(
        (el) => el.style.display !== "none",
      ).length;
      sec.style.display = visibleCount > 0 ? "block" : "none";
      if (visibleCount > 0) sec.classList.remove("collapsed");
    });
  }
});

// サーバーAPI(SQLiteデータベース)から設定を読み込んで表示
fetch("/api/config")
  .then((res) => {
    if (!res.ok) throw new Error("設定データの取得に失敗しました");
    return res.json();
  })
  .then((config: PortalConfig) => renderPortal(config))
  .catch((err) => {
    console.error("❌ 設定データの読み込みエラー:", err);
    document.getElementById("error-area")!.style.display = "block";
  });
