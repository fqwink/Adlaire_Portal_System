// Adlaire Portal System - 閲覧画面 (portal.html) のクライアントロジック
// ビルド後、public/js/portal.js として portal.html から読み込まれる。
// バックエンド(src/server.ts)のREST API(GET /api/config)から設定データを取得する。
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { Category, NewsLabel, PortalConfig, WeatherInfo } from "../types.ts";

// リンクの追加からこの日数以内はNEWバッジを表示する(SPEC.md §5.1.2)。
const NEW_BADGE_DAYS = 7;

// WMO Weather interpretation codeを絵文字に変換する(Open-Meteo。SPEC.md §2.5)。
function weatherEmoji(code: number): string {
  if (code === 0) return "☀️";
  if (code <= 3) return "⛅";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 67) return "🌧️";
  if (code >= 71 && code <= 77) return "❄️";
  if (code >= 80 && code <= 82) return "🌦️";
  if (code >= 85 && code <= 86) return "🌨️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}

// サイドバーの天気ウィジェットを更新する。地点未設定・取得失敗・データ欠落のいずれの場合も、
// ウィジェット自体を表示しないことでエラーを目立たせない(付随情報のため。SPEC.md §5.1.2)。
function renderWeather(weather: WeatherInfo): void {
  const el = document.getElementById("weather-widget")!;
  if (!weather.location || weather.tempC === null || weather.weatherCode === null) {
    el.style.display = "none";
    return;
  }
  const rangeHtml = weather.tempMaxC !== null && weather.tempMinC !== null
    ? `<span class="weather-range">${Math.round(weather.tempMaxC)}° / ${Math.round(weather.tempMinC)}°</span>`
    : "";
  el.style.display = "flex";
  el.innerHTML = `<span class="weather-icon">${weatherEmoji(weather.weatherCode)}</span>` +
    `<span class="weather-temp">${Math.round(weather.tempC)}°C</span>${rangeHtml}` +
    `<span class="weather-place">${escapeHtml(weather.resolvedName || weather.location)}</span>`;
}

// お知らせの種別ラベル(SPEC.md §3.2, §5.1.2)を色分けバッジのHTMLに変換する。未設定(「一般」)の場合は表示しない。
function newsLabelBadge(label: NewsLabel | undefined): string {
  if (label === "important") return `<span class="news-label news-label-important">重要</span>`;
  if (label === "maintenance") return `<span class="news-label news-label-maintenance">メンテナンス</span>`;
  return "";
}

// DateオブジェクトをブラウザのローカルタイムゾーンでのYYYY-MM-DD文字列に変換する。
// toISOString()はUTCに変換してしまうため、日付の比較に使うと非UTC圏(日本時間等)では
// 実際の現地日付とずれる(特に深夜〜早朝)。addNews()が挿入する日付も同じくローカルの
// 年月日から組み立てているため、比較の一貫性のためこちらも常にローカル基準で統一する。
function toLocalDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// お知らせの日付文字列(自由記述)をYYYY-MM-DD形式に変換できる場合のみ返す(§5.1.2の期間タブで使用)。
// 変換できない場合(自由記述で日付として解釈できない等)はnullを返し、期間タブでの絞り込み対象外
// (常に表示)として扱う。
function parseNewsDateIso(dateStr: string): string | null {
  // "YYYY-MM-DD"(ハイフン区切り)はJS仕様上、new Date()がUTC 0時として解釈する特別扱いのため、
  // toLocalDateIso()でローカル基準に変換し直すとUTCより西側のタイムゾーンでは1日ずれる。
  // この形式は既にYYYY-MM-DDそのものなので、Dateへの変換を経由せず文字列から直接取り出す。
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr.trim());
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  // それ以外の自由記述(例: addNews()が生成する"YYYY/MM/DD"形式)はローカル時刻として解釈される
  // ため、toLocalDateIso()で変換して問題ない。
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : toLocalDateIso(parsed);
}

function renderNewsItemHtml(item: { date: string; text: string; pinned?: boolean; label?: NewsLabel }): string {
  const pinBadge = item.pinned ? `<span class="news-pin" title="常に先頭に表示">📌</span>` : "";
  return `${pinBadge}${newsLabelBadge(item.label)}<span class="news-date">${escapeHtml(item.date)}</span><span class="news-text">${
    escapeHtml(item.text)
  }</span>`;
}

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
  const archivedArea = document.getElementById("news-archive")!;
  const archivedList = document.getElementById("news-archive-list")!;
  const archivedToggle = document.getElementById("news-archive-toggle")!;
  newsList.innerHTML = "";
  archivedList.innerHTML = "";

  // 有効期限(expiresAt)を過ぎたお知らせは、既定では表示しない(SPEC.md §5.1.2)。
  // archiveExpiredNewsが有効な場合は完全に消さず、「過去のお知らせ」として折りたたみ表示する。
  // ローカルタイムゾーン基準で統一する(applyFilters()の期間タブと同じ理由。toISOString()の
  // UTC変換だと日本時間等の非UTC圏で「今日」の境界がずれるため)。
  const todayIso = toLocalDateIso(now);
  const allNews = Array.isArray(config.news) ? config.news : [];
  const newsItems = allNews.filter((item) => !item.expiresAt || item.expiresAt >= todayIso);
  const archivedItems = config.archiveExpiredNews
    ? allNews.filter((item) => item.expiresAt && item.expiresAt < todayIso)
    : [];

  if (newsItems.length > 0) {
    newsArea.style.display = "block";
    newsItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = item.pinned ? "news-item news-pinned search-item" : "news-item search-item";
      li.dataset.search = item.text.toLowerCase();
      li.dataset.name = item.text;
      li.dataset.label = item.label || "";
      li.dataset.dateIso = parseNewsDateIso(item.date) || "";
      li.innerHTML = renderNewsItemHtml(item);
      newsList.appendChild(li);
    });
  } else {
    newsArea.style.display = "none";
  }

  if (archivedItems.length > 0) {
    archivedArea.style.display = "block";
    archivedToggle.textContent = `📦 過去のお知らせ (${archivedItems.length}件)`;
    archivedItems.forEach((item) => {
      const li = document.createElement("li");
      li.className = "news-item";
      li.innerHTML = renderNewsItemHtml(item);
      archivedList.appendChild(li);
    });
  } else {
    archivedArea.style.display = "none";
  }

  const navList = document.getElementById("nav-list")!;
  const contentArea = document.getElementById("content-area")!;
  navList.innerHTML = "";
  contentArea.innerHTML = "";

  // 「下書き」状態(hidden: true)のカテゴリは閲覧画面には表示しない(編集画面では引き続き編集できる。SPEC.md §3.3, §5.1.2)。
  const visibleCategories = config.categories.filter((cat) => !cat.hidden);

  visibleCategories.forEach((cat: Category, idx: number) => {
    const navIconHtml = cat.icon ? `${escapeHtml(cat.icon)} ` : "";
    const navLi = document.createElement("li");
    navLi.className = "nav-item";
    navLi.innerHTML =
      `<a href="#cat-${idx}" class="nav-link"><span>${navIconHtml}${escapeHtml(cat.name)}</span><span class="nav-count">${cat.links.length}</span></a>`;
    navList.appendChild(navLi);

    const isList = cat.displayMode === "list";
    const section = document.createElement("div");
    section.className = "category-section search-target";
    section.id = `cat-${idx}`;
    const titleIconHtml = cat.icon ? `<span class="category-icon">${escapeHtml(cat.icon)}</span>` : "";
    section.innerHTML =
      `<div class="category-header" data-role="collapse-toggle">${titleIconHtml}<h2 class="category-title">${
        escapeHtml(cat.name)
      }</h2><span class="collapse-arrow">▾</span></div>`;

    // カテゴリ単位の表示形式(§3.3, §5.1.2): "list"の場合はカードグリッドの代わりに
    // コンパクトな1行リスト表示にする(既定は"grid")。
    const grid = document.createElement("div");
    grid.className = isList ? "grid link-list" : "grid";
    cat.links.forEach((link) => {
      const a = document.createElement("a");
      a.href = sanitizeUrl(link.url);
      a.className = isList ? "card card-list search-item" : "card search-item";
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
      const brokenHtml = link.broken
        ? `<span class="card-broken" title="定期チェックで到達できませんでした">⚠️</span>`
        : "";
      const leftBadgesHtml = newHtml || brokenHtml
        ? `<span class="card-badges-left">${newHtml}${brokenHtml}</span>`
        : "";
      a.innerHTML =
        `${leftBadgesHtml}<span class="card-icon"></span><span class="card-name">${escapeHtml(link.name)}</span>${clicksHtml}`;
      // アイコン絵文字の代わりにリンク先のファビコンを表示するオプション(設定useFavicon。SPEC.md §5.1.2)。
      // リンク先ホストの/favicon.icoをブラウザから直接参照するだけで、新規の外部API連携は発生しない。
      // 取得に失敗した場合(faviconが無い等)は絵文字アイコンにフォールバックする。
      const iconEl = a.querySelector<HTMLElement>(".card-icon")!;
      const trimmedUrl = link.url.trim();
      if (config.useFavicon && /^https?:\/\//i.test(trimmedUrl)) {
        try {
          const img = document.createElement("img");
          img.className = "card-favicon";
          img.src = `${new URL(trimmedUrl).origin}/favicon.ico`;
          img.alt = "";
          img.onerror = () => {
            iconEl.textContent = link.icon;
          };
          iconEl.appendChild(img);
        } catch {
          iconEl.textContent = link.icon;
        }
      } else {
        iconEl.textContent = link.icon;
      }
      if (link.memo) a.title = link.memo;
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

// 「今日」「今週」の期間タブ(§5.1.2)にお知らせの日付(YYYY-MM-DD)が一致するか判定する。
// 「今週」は直近NEW_BADGE_DAYS日以内(NEWバッジと同じ日数)とする。
function matchesDateTab(dateIso: string, tab: string, todayIso: string): boolean {
  if (tab === "") return true;
  if (tab === "today") return dateIso === todayIso;
  if (tab === "week") {
    const diffDays = (new Date(todayIso).getTime() - new Date(dateIso).getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= NEW_BADGE_DAYS;
  }
  return true;
}

// 検索ボックスの語句とお知らせ種別フィルタ・期間タブ(SPEC.md §5.1.2)を組み合わせて表示/非表示を決める。
// リンクカードは検索語のみ、お知らせは検索語+種別フィルタ+期間タブすべてに一致した場合のみ表示する。
function applyFilters(): void {
  const term = (document.getElementById("search-input") as HTMLInputElement).value.toLowerCase();
  const labelFilter = (document.getElementById("news-label-filter") as HTMLSelectElement).value;
  const dateTab = document.querySelector<HTMLElement>(".news-date-tab.active")?.dataset.tab ?? "";
  // parseNewsDateIso()と同じくローカルタイムゾーン基準で統一する(toISOString()のUTC変換だと
  // 日本時間等の非UTC圏で日付がずれるため)。
  const todayIso = toLocalDateIso(new Date());
  const newsListEl = document.getElementById("news-list")!;
  const newsAreaEl = document.getElementById("news-area")!;

  document.querySelectorAll<HTMLElement>(".search-item").forEach((item) => {
    const isNews = item.parentElement === newsListEl;
    const searchMatched = term === "" || (item.dataset.search?.includes(term) ?? false);
    const labelMatched = !isNews || labelFilter === "" || item.dataset.label === labelFilter;
    // 日付が解釈できないお知らせ(dateIsoが空)は、期間タブによる絞り込みの対象外として常に表示する。
    const dateMatched = !isNews || !item.dataset.dateIso || matchesDateTab(item.dataset.dateIso, dateTab, todayIso);
    const matched = searchMatched && labelMatched && dateMatched;
    item.style.display = matched ? "flex" : "none";
    const nameEl = item.querySelector(".card-name, .news-text");
    if (nameEl) {
      nameEl.innerHTML = matched && term !== ""
        ? highlightMatch(item.dataset.name ?? "", term)
        : escapeHtml(item.dataset.name ?? "");
    }
  });
  document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => {
    // カテゴリの表示/非表示は検索語のみに左右される(お知らせ種別フィルタは対象外)。検索語が
    // 空の場合は常に表示する(リンクが1件もないカテゴリでもvisibleCountが0になり誤って
    // 非表示のままになってしまうのを防ぐため、visibleCountでの判定は検索語がある場合のみ行う)。
    if (term === "") {
      sec.style.display = "block";
      return;
    }
    const visibleCount = Array.from(sec.querySelectorAll<HTMLElement>(".search-item")).filter(
      (el) => el.style.display !== "none",
    ).length;
    sec.style.display = visibleCount > 0 ? "block" : "none";
    // 折りたたみ中でも検索結果は必ず見えるよう、マッチしたカテゴリは展開する。
    if (visibleCount > 0) sec.classList.remove("collapsed");
  });
  const visibleNewsCount = Array.from(newsListEl.querySelectorAll<HTMLElement>(".search-item")).filter(
    (el) => el.style.display !== "none",
  ).length;
  // お知らせ欄は元々お知らせが1件もない場合は表示しない(renderPortal()と同じ判定)
  const noFilterActive = term === "" && labelFilter === "" && dateTab === "";
  newsAreaEl.style.display = (noFilterActive ? newsListEl.children.length > 0 : visibleNewsCount > 0) ? "block" : "none";
}

document.getElementById("search-input")!.addEventListener("keyup", applyFilters);
document.getElementById("news-label-filter")!.addEventListener("change", applyFilters);

// お知らせの期間タブ(すべて/今日/今週。SPEC.md §5.1.2)
document.querySelectorAll<HTMLElement>(".news-date-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll<HTMLElement>(".news-date-tab").forEach((t) => t.classList.remove("active"));
    tab.classList.add("active");
    applyFilters();
  });
});

// 過去のお知らせ(アーカイブ)の折りたたみ表示切り替え(このブラウザタブ内だけの一時的な表示状態。SPEC.md §1.3)
document.getElementById("news-archive-toggle")!.addEventListener("click", () => {
  document.getElementById("news-archive")!.classList.toggle("expanded");
});

// カテゴリの一括折りたたみ/展開(このブラウザタブ内だけの表示状態。保存・永続化は行わない。SPEC.md §1.3)
document.getElementById("collapse-all-btn")!.addEventListener("click", () => {
  document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => sec.classList.add("collapsed"));
});
document.getElementById("expand-all-btn")!.addEventListener("click", () => {
  document.querySelectorAll<HTMLElement>(".category-section").forEach((sec) => sec.classList.remove("collapsed"));
});

// 検索のキーボードショートカット(SPEC.md §5.1.2): 「/」で検索欄にフォーカス、Escでクリアしてフォーカスを外す。
// 他の入力欄にフォーカス中の「/」は文字入力として扱う(ショートカットとして横取りしない)。
document.addEventListener("keydown", (e) => {
  const searchInput = document.getElementById("search-input") as HTMLInputElement;
  const active = document.activeElement;
  const isTyping = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
  if (e.key === "/" && !isTyping) {
    e.preventDefault();
    searchInput.focus();
  } else if (e.key === "Escape" && active === searchInput) {
    searchInput.value = "";
    applyFilters();
    searchInput.blur();
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

// 天気情報(外部API連携。SPEC.md §2.5)を取得して表示。付随情報のため、設定データの取得とは
// 独立して失敗を扱う(失敗してもウィジェットを表示しないだけで、閲覧画面全体には影響させない)。
fetch("/api/weather")
  .then((res) => (res.ok ? res.json() : null))
  .then((weather: WeatherInfo | null) => {
    if (weather) renderWeather(weather);
  })
  .catch(() => {
    // 表示しないだけで十分なため、エラー内容は無視する
  });
