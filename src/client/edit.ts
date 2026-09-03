// Adlaire Portal System - 編集画面 (edit.html) のクライアントロジック
// ビルド後、public/js/edit.js として edit.html から読み込まれる。
// edit.html は生成したHTML内で onclick="..." / oninput="..." 属性から
// 各関数を直接呼び出すため、必要な関数は末尾で globalThis に公開している。
//
// バックエンド(src/server.ts)のREST APIを通じてSQLiteデータベースに保存する。
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { Category, LinkItem, NewsItem, PortalConfig } from "../types.ts";

// JSONエクスポート(handleImportFileが読み込む)ファイルの形式バージョン。
// アプリのバージョン(SPEC.mdのバージョン)とは独立しており、{title, themeColor, news, categories}
// というエクスポート形式自体が変わらない限り上げる必要はない。
const EXPORT_FORMAT_VERSION = "1";

function updateStorageStatus(message: string): void {
  const statusEl = document.getElementById("storage-status");
  if (statusEl) {
    statusEl.textContent = message;
  }
}

let config: PortalConfig = { title: "Adlaireポータル", themeColor: "#00a968", news: [], categories: [] };

// サーバーから最後に取得した設定のバージョン(楽観的排他制御用)。
// 保存時にIf-Matchヘッダーとして送信し、他の人が先に保存していた場合はサーバーが409を返す。
let currentVersion: number | null = null;

function parseVersion(etag: string | null): number | null {
  if (!etag) return null;
  const n = Number(etag.replace(/"/g, ""));
  return Number.isFinite(n) ? n : null;
}

function normalizeConfig(c: PortalConfig): PortalConfig {
  if (c.news && !Array.isArray(c.news)) {
    c.news = [{ date: "News", text: String(c.news) }];
  }
  if (!c.news) c.news = [];
  return c;
}

// サーバーAPI(SQLiteデータベース)から設定を読み込む
async function loadFromServer(): Promise<PortalConfig> {
  const res = await fetch("/api/config");
  if (!res.ok) throw new Error("設定データの取得に失敗しました");
  currentVersion = parseVersion(res.headers.get("etag"));
  return res.json();
}

const ICONS = [
  "🔍", "📅", "📂", "📊", "📄", "📝", "🏠", "🏢", "📞", "✉️",
  "💬", "💻", "🔒", "⚠️", "💡", "☕", "🍱", "🏥", "🎉", "🚃",
  "✈️", "🎯", "💼", "📈", "🔧", "⚙️", "🌐", "📱", "🖥️", "🎨",
];

interface LinkCheckResult {
  ok: boolean;
  status: number | null;
  error: string | null;
}

// キーは "カテゴリindex-リンクindex"。「🔗 リンクをチェック」実行時にのみ更新される
// (ページを離れる・再読み込みすると消える、その場限りの確認結果)。
let linkCheckResults: Record<string, LinkCheckResult> | null = null;

// ドラッグ&ドロップでの並び替え中に、どの要素をつかんでいるかを保持する一時状態。
let dragCatIdx: number | null = null;
let dragLink: { cat: number; link: number } | null = null;
let dragNewsIdx: number | null = null;

// リンクの一括操作(選択→移動/削除)で選択中のリンク。キーは"カテゴリindex-リンクindex"。
// このブラウザタブ内だけの一時的な選択状態であり、保存・永続化は行わない(SPEC.md §1.3)。
// カテゴリ/リンクの追加・削除・並び替えなど構造が変わる操作の際はクリアする(インデックスがずれるため)。
let selectedLinks = new Set<string>();
// 一括操作バーの移動先カテゴリの選択状態。renderForm()のたびに<select>を作り直すため、
// 選択したチェックボックスが増えるなどして再描画されても選んだ移動先が保持されるよう、
// DOM側ではなくこの変数で管理する(§5.2.2)。
let bulkMoveTargetCatIdx = 0;
// カテゴリの一括操作(選択→公開/下書き切替・削除)で選択中のカテゴリのindex。selectedLinksと同じく
// このブラウザタブ内だけの一時的な選択状態(SPEC.md §1.3)。カテゴリの追加・削除・並び替えの際はクリアする。
let selectedCats = new Set<number>();
// お知らせの一括操作(選択→種別変更・削除)で選択中のお知らせのindex。同じく一時的な選択状態。
let selectedNews = new Set<number>();

// 元に戻す/やり直す(このブラウザタブ内だけの一時的な操作履歴。保存・永続化は行わない。SPEC.md §1.3)。
const MAX_UNDO_STEPS = 50;
let undoStack: PortalConfig[] = [];
let redoStack: PortalConfig[] = [];
// テキスト入力(タイトル・お知らせ・カテゴリ名・リンク名/URL)を1文字ごとに個別のUndo単位に
// してしまうと実用にならないため、直近のrenderForm()以降の連続したテキスト編集は1つの
// Undo単位にまとめる(coalescing)。構造的な操作(追加・削除・並び替え等)は都度個別に記録する。
let textEditDirty = false;

function cloneConfig(c: PortalConfig): PortalConfig {
  return JSON.parse(JSON.stringify(c));
}

// 構造的な変更(追加・削除・並び替え・ピン留め切り替え等)の直前に呼び、元に戻せるようにする。
function pushUndo(): void {
  undoStack.push(cloneConfig(config));
  if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
  redoStack = [];
}

// お知らせ/カテゴリ/リンクのindexがずれる操作(追加・削除・並び替え・一括インポート等)の直前に呼び、
// 一括操作の選択状態(§5.2.2)をすべてリセットする。pushUndo()から自動では行わない
// (テキスト編集はmarkTextEdit()経由でpushUndo()を呼ぶがrenderForm()を伴わないため、
// pushUndo()側で選択をクリアすると選択チェックボックス・操作バーの表示と実際の選択状態が
// 食い違ってしまう)。どの種類のindexがずれる操作かにかかわらず全種類まとめてクリアする
// (お知らせ/カテゴリ/リンクの操作が互いに影響し合うことはないが、判定を単純にするため)。
function clearAllSelectionsSilently(): void {
  selectedLinks.clear();
  selectedCats.clear();
  selectedNews.clear();
}

// お知らせ/カテゴリ/リンクの一括操作バーは、同時に複数種類が表示されると(いずれも
// `position: sticky; bottom: 0`のため)画面下部で重なって操作できなくなる。そのため
// 3種類の選択は互いに排他的とし、いずれかの種類を選択し始めたら他の種類の選択を解除する
// (チェックボックスの見た目も合わせてクリアする)。
function clearOtherSelections(keep: "link" | "cat" | "news"): void {
  if (keep !== "link" && selectedLinks.size > 0) {
    selectedLinks.clear();
    document.querySelectorAll<HTMLInputElement>(".link-select").forEach((cb) => (cb.checked = false));
  }
  if (keep !== "cat" && selectedCats.size > 0) {
    selectedCats.clear();
    document.querySelectorAll<HTMLInputElement>(".cat-select").forEach((cb) => (cb.checked = false));
  }
  if (keep !== "news" && selectedNews.size > 0) {
    selectedNews.clear();
    document.querySelectorAll<HTMLInputElement>(".news-select").forEach((cb) => (cb.checked = false));
  }
}

// テキスト入力の変更をUndo1単位にまとめて記録する。update系関数の先頭で呼ぶ。
function markTextEdit(): void {
  if (!textEditDirty) {
    pushUndo();
    textEditDirty = true;
  }
}

function undo(): void {
  if (undoStack.length === 0) return;
  redoStack.push(cloneConfig(config));
  config = undoStack.pop()!;
  linkCheckResults = null;
  clearAllSelectionsSilently();
  renderForm();
  updatePreview();
  updateStorageStatus("↩️ 元に戻しました (未保存)");
}

function redo(): void {
  if (redoStack.length === 0) return;
  undoStack.push(cloneConfig(config));
  config = redoStack.pop()!;
  linkCheckResults = null;
  clearAllSelectionsSilently();
  renderForm();
  updatePreview();
  updateStorageStatus("↪️ やり直しました (未保存)");
}

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === "z") {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (key === "s") {
    // 保存ショートカット(Ctrl+S / Cmd+S。SPEC.md §5.2.2)。ブラウザ既定の「ページを保存」を抑止する。
    e.preventDefault();
    const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
    if (!saveBtn.disabled) saveToServer();
  }
});

const resizer = document.getElementById("dragHandle")!;
const editorPanel = document.getElementById("editorPanel")! as HTMLElement;
resizer.addEventListener("mousedown", (e) => {
  e.preventDefault();
  resizer.classList.add("dragging");
  document.addEventListener("mousemove", resize);
  document.addEventListener("mouseup", stopResize);
});
function resize(e: MouseEvent): void {
  editorPanel.style.width = Math.max(300, e.clientX) + "px";
}
function stopResize(): void {
  resizer.classList.remove("dragging");
  document.removeEventListener("mousemove", resize);
  document.removeEventListener("mouseup", stopResize);
}

function buildPortalCss(): string {
  return `
    :root { --primary: ${config.themeColor}; --primary-light: ${config.themeColor}22; --bg: #f4f8fa; --text: #444; --card-bg: #fff; --shadow: 0 4px 6px rgba(0,0,0,0.05); --sidebar-w: 240px; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 0; }
    .layout { display: flex; min-height: 100vh; }
    .sidebar { width: var(--sidebar-w); background: #fff; border-right: 1px solid #eee; padding: 20px; box-sizing: border-box; flex-shrink:0; display:flex; flex-direction:column; }
    .main { flex: 1; padding: 30px; box-sizing: border-box; }
    h1 { color: var(--primary); margin: 0 0 5px 0; font-size:20px; }
    .nav-item { padding:10px; border-radius:8px; font-weight:bold; font-size:14px; color:#666; cursor:pointer; display:flex; justify-content:space-between; }
    .nav-item:hover { background:var(--primary-light); color:var(--primary); }
    .count { background:#f0f0f0; font-size:10px; padding:2px 6px; border-radius:10px; }

    .news-box { background: #fff; border-radius: 8px; box-shadow: var(--shadow); margin-bottom: 20px; overflow: hidden; border: 1px solid #eee; display: ${config.news.length > 0 ? "block" : "none"}; }
    .news-header { background: var(--primary-light); color: var(--primary); padding: 8px 15px; font-weight: bold; font-size: 13px; }
    .news-list { padding: 0; margin: 0; list-style: none; max-height: 120px; overflow-y: auto; }
    .news-item { padding: 10px 15px; border-bottom: 1px dashed #eee; display: flex; gap: 10px; align-items: baseline; font-size: 13px; }
    .news-item:last-child { border-bottom: none; }
    .news-date { font-weight: bold; color: var(--primary); font-family:monospace; white-space:nowrap; }

    .cat-head { border-bottom: 2px solid #eee; margin-top: 30px; padding-bottom: 10px; color: var(--primary); font-weight: bold; font-size: 1.2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 15px; margin-top: 15px; }
    .card { background: #fff; padding: 20px; border-radius: 12px; text-align: center; color: #444; text-decoration: none; box-shadow: var(--shadow); display: flex; flex-direction: column; align-items: center; border: 1px solid transparent; transition: 0.2s; }
    .card:hover { border-color: var(--primary); transform: translateY(-3px); }
    .icon { font-size: 32px; margin-bottom: 10px; } .name { font-weight: bold; font-size: 13px; }
    @media (max-width: 768px) {
      .layout { flex-direction: column; }
      .sidebar { width: 100%; height: auto; border-right: none; border-bottom: 1px solid #eee; padding: 10px; flex-direction:row; align-items:center; overflow-x:auto; gap:15px; }
      .nav-item { padding:5px 10px; white-space:nowrap; background:#f5f5f5; border-radius:20px; font-size:12px; }
      .count { display:none; }
      .main { padding: 20px; }
      .grid { grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); }
    }
  `;
}

const formArea = document.getElementById("form-area")!;
const iframe = document.getElementById("preview-frame")! as HTMLIFrameElement;

function setView(mode: "pc" | "mobile"): void {
  iframe.className = `mode-${mode}`;
  document.querySelectorAll(".vt-btn").forEach((b) => b.classList.remove("active"));
  document.getElementById(`btn-${mode}`)!.classList.add("active");
}

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

function updatePreview(): void {
  const css = buildPortalCss();
  // 有効期限切れのお知らせは閲覧画面と同じく表示しない(プレビューと実際の表示を一致させるため)。
  const todayIso = new Date().toISOString().slice(0, 10);
  const visibleNews = config.news.filter((n) => !n.expiresAt || n.expiresAt >= todayIso);
  const newsHtml = visibleNews.length > 0
    ? `<div class="news-box"><div class="news-header">🔔 お知らせ</div><ul class="news-list">
        ${
      visibleNews
        .map((n) =>
          `<li class="news-item">${n.pinned ? "📌 " : ""}<span class="news-date">${escapeHtml(n.date)}</span><span>${escapeHtml(n.text)}</span></li>`
        )
        .join("")
    }
      </ul></div>`
    : "";

  // 「下書き」状態のカテゴリは閲覧画面と同じくプレビューにも表示しない(SPEC.md §3.3, §5.1.2)。
  const visibleCategories = config.categories.filter((cat) => !cat.hidden);

  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${css}</style></head><body>
      <div class="layout"><div class="sidebar"><div><h1>${escapeHtml(config.title)}</h1><div style="font-size:11px; color:#999; margin-bottom:20px;">${new Date().toLocaleDateString("ja-JP")}</div></div>
      <div style="flex:1;">${visibleCategories.map((cat) => `<div class="nav-item"><span>${escapeHtml(cat.name)}</span><span class="count">${cat.links.length}</span></div>`).join("")}</div></div>
      <div class="main">${newsHtml}
      ${visibleCategories.map((cat) => `<div class="cat-head">${escapeHtml(cat.name)}</div><div class="grid">${cat.links.map((l) => `<a class="card"><span class="icon">${escapeHtml(l.icon)}</span><span class="name">${escapeHtml(l.name)}</span></a>`).join("")}</div>`).join("")}
      </div></div></body></html>`;
  iframe.srcdoc = html;
}

function renderForm(): void {
  // 新しい描画のたびに、テキスト編集のUndo単位まとめをリセットする(次の編集から新しい単位を開始する)。
  textEditDirty = false;

  const newsListHtml = config.news
    .map(
      (n, idx) => `
      <div class="news-entry" ondragover="onNewsDragOver(event)" ondrop="onNewsDrop(event, ${idx})">
        <div class="row">
          <span class="drag-handle" draggable="true" ondragstart="onNewsDragStart(event, ${idx})" title="ドラッグして並び替え">⠿</span>
          <input type="checkbox" class="news-select" style="width:auto; flex-shrink:0;" ${
      selectedNews.has(idx) ? "checked" : ""
    } onchange="toggleNewsSelect(${idx})" title="一括操作用に選択">
          <button class="btn btn-icon ${n.pinned ? "btn-pin active" : "btn-pin"}" onclick="toggleNewsPinned(${idx})" title="常に先頭に表示(ピン留め)">📌</button>
          <input type="text" value="${escapeHtml(n.date)}" style="width:90px;" oninput="updateNews(${idx}, 'date', this.value)">
          <input type="text" value="${escapeHtml(n.text)}" style="flex:1;" oninput="updateNews(${idx}, 'text', this.value)">
          <button class="btn btn-icon btn-red" onclick="delNews(${idx})">🗑️</button>
        </div>
        <div class="row news-sub-row">
          <label style="font-size:10px; color:#999; margin:0; text-transform:none; white-space:nowrap;">📅 有効期限(空欄=無期限):</label>
          <input type="date" value="${escapeHtml(n.expiresAt || "")}" style="width:150px;" onchange="updateNewsExpiry(${idx}, this.value)">
          <label style="font-size:10px; color:#999; margin:0 0 0 10px; text-transform:none; white-space:nowrap;">🏷️ 種別:</label>
          <select style="font-size:11px;" onchange="updateNewsLabel(${idx}, this.value)">
            <option value="" ${!n.label ? "selected" : ""}>一般</option>
            <option value="important" ${n.label === "important" ? "selected" : ""}>重要</option>
            <option value="maintenance" ${n.label === "maintenance" ? "selected" : ""}>メンテナンス</option>
          </select>
        </div>
      </div>`,
    )
    .join("");

  formArea.innerHTML = `
      <div class="box">
        <label>タイトル</label><input type="text" value="${escapeHtml(config.title)}" oninput="update('title', this.value)">
        <label>テーマカラー</label><input type="color" value="${config.themeColor || "#00a968"}" oninput="update('themeColor', this.value)">
        <label>🌤️ 天気表示の地点(空欄で非表示。例: Tokyo)</label><input type="text" value="${escapeHtml(config.weatherLocation || "")}" placeholder="例: Tokyo" oninput="update('weatherLocation', this.value)">
        <label style="display:flex; align-items:center; gap:6px; margin-top:10px;"><input type="checkbox" style="width:auto;" ${config.useFavicon ? "checked" : ""} onchange="toggleUseFavicon(this.checked)"> 🌐 アイコンの代わりにリンク先のファビコンを表示する</label>
        <label style="display:flex; align-items:center; gap:6px; margin-top:6px;"><input type="checkbox" style="width:auto;" ${config.pinImportantNews ? "checked" : ""} onchange="togglePinImportantNews(this.checked)"> 🔴 「重要」ラベルのお知らせを常に先頭に表示する</label>
        <label style="display:flex; align-items:center; gap:6px; margin-top:6px;"><input type="checkbox" style="width:auto;" ${config.archiveExpiredNews ? "checked" : ""} onchange="toggleArchiveExpiredNews(this.checked)"> 📦 期限切れのお知らせを完全に消さず「過去のお知らせ」に保持する</label>
      </div>
      <div class="box" id="news-box">
        <label>📢 お知らせリスト</label>
        ${newsListHtml}
        <button class="btn btn-green-outline" onclick="addNews()">＋ お知らせを追加</button>
      </div>`;
  renderNewsBulkActionBar();

  config.categories.forEach((cat: Category, cIdx: number) => {
    const hiddenStyle = cat.hidden ? "opacity:0.55;" : "";
    const hiddenBtn = cat.hidden
      ? `<button class="btn btn-icon" style="background:#fff3cd; color:#856404;" title="下書き中(閲覧画面には表示されません)。クリックで公開" onclick="toggleCatHidden(${cIdx})">🙈</button>`
      : `<button class="btn btn-icon" title="公開中。クリックで下書きにする(閲覧画面から一時的に隠す)" onclick="toggleCatHidden(${cIdx})">👁️</button>`;
    const isListMode = cat.displayMode === "list";
    let html = `<div class="box" ondragover="onCatDragOver(event)" ondrop="onCatDrop(event, ${cIdx})" style="border-left:4px solid ${config.themeColor}; ${hiddenStyle}">
      <div class="box-header">
        <span class="drag-handle" draggable="true" ondragstart="onCatDragStart(event, ${cIdx})" title="ドラッグして並び替え">⠿</span>
        <input type="checkbox" class="cat-select" style="width:auto; flex-shrink:0;" ${
      selectedCats.has(cIdx) ? "checked" : ""
    } onchange="toggleCatSelect(${cIdx})" title="一括操作用に選択">
        <div style="position:relative;">
          <input type="text" value="${
      escapeHtml(cat.icon || "")
    }" placeholder="🏷️" style="width:32px; text-align:center; cursor:pointer;" readonly onclick="togglePalette('pal-cat-${cIdx}')">
          <div id="pal-cat-${cIdx}" class="palette">
            <div class="p-icon" onclick="setCatIcon(${cIdx},'')" title="アイコンなし">🚫</div>
            ${ICONS.map((ic) => `<div class="p-icon" onclick="setCatIcon(${cIdx},'${ic}')">${ic}</div>`).join("")}
          </div>
        </div>
        <input type="text" value="${escapeHtml(cat.name)}" oninput="updateCat(${cIdx}, this.value)" style="font-weight:bold; width:35%;">
        <div style="display:flex;">
          ${hiddenBtn}
          <button class="btn btn-icon" title="このカテゴリを複製" onclick="duplicateCat(${cIdx})">📋</button>
          <button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, -1)">⬆️</button>
          <button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, 1)">⬇️</button>
          <button class="btn btn-icon btn-red" style="margin-left:5px;" onclick="delCat(${cIdx})">🗑️</button>
        </div>
      </div>
      ${cat.hidden ? `<div style="font-size:11px; color:#856404; margin:-6px 0 10px;">🙈 下書き中(閲覧画面には表示されません)</div>` : ""}
      <div class="row cat-sub-row">
        <label style="font-size:10px; color:#999; margin:0; text-transform:none; white-space:nowrap;">🖼️ 表示形式:</label>
        <select style="font-size:11px; width:auto;" onchange="updateCatDisplayMode(${cIdx}, this.value)">
          <option value="grid" ${!isListMode ? "selected" : ""}>グリッド</option>
          <option value="list" ${isListMode ? "selected" : ""}>リスト</option>
        </select>
      </div>`;
    cat.links.forEach((link: LinkItem, lIdx: number) => {
      const check = linkCheckResults?.[`${cIdx}-${lIdx}`];
      const checkBadge = !check
        ? ""
        : check.ok
        ? `<span title="OK${check.status ? ` (HTTP ${check.status})` : ""}" style="font-size:16px;">✅</span>`
        : `<span title="${escapeHtml(check.error || (check.status ? `HTTP ${check.status}` : "確認できませんでした"))}" style="font-size:16px; cursor:help;">❌</span>`;
      const clicksBadge = link.clicks
        ? `<span title="累計クリック数(匿名集計)" style="font-size:11px; color:#95a5a6; white-space:nowrap;">👁 ${link.clicks}</span>`
        : "";
      const linkKey = `${cIdx}-${lIdx}`;
      html += `<div class="link-entry" ondragover="onLinkDragOver(event)" ondrop="onLinkDrop(event, ${cIdx}, ${lIdx})">
        <div class="row"><span class="drag-handle" draggable="true" ondragstart="onLinkDragStart(event, ${cIdx}, ${lIdx})" title="ドラッグして並び替え">⠿</span><input type="checkbox" class="link-select" style="width:auto; flex-shrink:0;" ${
        selectedLinks.has(linkKey) ? "checked" : ""
      } onchange="toggleLinkSelect(${cIdx},${lIdx})" title="一括操作用に選択"><div style="position:relative;"><input type="text" value="${
        escapeHtml(link.icon)
      }" style="width:35px; text-align:center; cursor:pointer;" readonly onclick="togglePalette('pal-${cIdx}-${lIdx}')"><div id="pal-${cIdx}-${lIdx}" class="palette">${
        ICONS.map((ic) => `<div class="p-icon" onclick="setIcon(${cIdx},${lIdx},'${ic}')">${ic}</div>`).join("")
      }</div></div><div style="flex:1;"><input type="text" value="${
        escapeHtml(link.name)
      }" placeholder="名称" oninput="updateLink(${cIdx},${lIdx},'name',this.value)" style="margin-bottom:3px;"><input type="text" value="${
        escapeHtml(link.url)
      }" placeholder="URL" style="font-size:12px; color:#666;" oninput="updateLink(${cIdx},${lIdx},'url',this.value)"></div><div style="width:20px; text-align:center;">${checkBadge}</div>${clicksBadge}<div style="display:flex; flex-direction:column; gap:2px;"><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, -1)">⬆️</button><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, 1)">⬇️</button></div><button class="btn btn-icon btn-red" style="height:auto;" onclick="delLink(${cIdx},${lIdx})">×</button></div>
        <div class="row link-sub-row">
          <label style="font-size:10px; color:#999; margin:0; text-transform:none; white-space:nowrap;">📝 メモ:</label>
          <input type="text" value="${
        escapeHtml(link.memo || "")
      }" placeholder="任意の補足説明(カードのツールチップに表示)" style="flex:1; font-size:12px;" oninput="updateLinkMemo(${cIdx},${lIdx},this.value)">
        </div>
      </div>`;
    });
    html += `<button class="btn btn-blue" onclick="addLink(${cIdx})" style="background:${config.themeColor}22; color:${config.themeColor}; border-color:${config.themeColor};">＋ リンクを追加</button></div>`;
    formArea.innerHTML += html;
  });
  formArea.innerHTML += `<button class="btn" style="width:100%; padding:15px; border:2px dashed #ccc; color:#666; font-weight:bold;" onclick="addCat()">＋ 新しいカテゴリを追加</button>`;
  renderCatBulkActionBar();
  renderBulkActionBar();
}

// リンクの一括操作(選択→移動/削除)バーだけを描画する(SPEC.md §5.2.2)。チェックボックスを1つ
// 押すたびに毎回renderForm()全体(全カテゴリ・全リンク行)を再構築すると、リンク数が多い場合に
// 無駄な再描画コストとスクロール位置のリセットが発生するため、この操作バーだけを差し替える。
function renderBulkActionBar(): void {
  document.querySelector(".link-bulk-bar")?.remove();
  if (selectedLinks.size === 0) return;
  // 移動先に選んでいたカテゴリが削除されている等で存在しない場合は先頭にフォールバックする。
  if (!config.categories[bulkMoveTargetCatIdx]) bulkMoveTargetCatIdx = 0;
  const catOptions = config.categories
    .map((cat, i) => `<option value="${i}" ${i === bulkMoveTargetCatIdx ? "selected" : ""}>${escapeHtml(cat.name)}</option>`)
    .join("");
  formArea.insertAdjacentHTML(
    "beforeend",
    `<div class="bulk-action-bar link-bulk-bar">
        <span>✅ ${selectedLinks.size}件選択中</span>
        <select id="bulk-move-target" onchange="updateBulkMoveTarget(this.value)">${catOptions}</select>
        <button class="btn btn-blue" onclick="bulkMoveLinks(document.getElementById('bulk-move-target').value)">選択したカテゴリへ移動</button>
        <button class="btn btn-icon btn-red" onclick="bulkDeleteLinks()">🗑️ 選択を削除</button>
        <button class="btn" onclick="clearLinkSelection()">選択解除</button>
      </div>`,
  );
}

// カテゴリの一括操作バー(選択→公開/下書き切替・削除。SPEC.md §5.2.2)。
function renderCatBulkActionBar(): void {
  document.querySelector(".cat-bulk-bar")?.remove();
  if (selectedCats.size === 0) return;
  formArea.insertAdjacentHTML(
    "beforeend",
    `<div class="bulk-action-bar cat-bulk-bar">
        <span>✅ ${selectedCats.size}件のカテゴリを選択中</span>
        <button class="btn" onclick="bulkSetCatHidden(false)">👁️ 公開にする</button>
        <button class="btn" onclick="bulkSetCatHidden(true)">🙈 下書きにする</button>
        <button class="btn btn-icon btn-red" onclick="bulkDeleteCats()">🗑️ 選択を削除</button>
        <button class="btn" onclick="clearCatSelection()">選択解除</button>
      </div>`,
  );
}

// お知らせの一括操作バー(選択→種別変更・削除。SPEC.md §5.2.2)。
function renderNewsBulkActionBar(): void {
  document.querySelector(".news-bulk-bar")?.remove();
  if (selectedNews.size === 0) return;
  // formArea末尾への追加(beforeend)だと、renderForm()内(お知らせボックスの直後にカテゴリが
  // 続く前)から呼ぶ場合と、toggleNewsSelect()単体(既にカテゴリが全部描画済み)から呼ぶ場合とで
  // 挿入位置がページ最下部までずれてしまう。お知らせボックス自体の直後に固定するため、
  // #news-boxを基準にinsertAdjacentHTMLする。
  document.getElementById("news-box")!.insertAdjacentHTML(
    "afterend",
    `<div class="bulk-action-bar news-bulk-bar">
        <span>✅ ${selectedNews.size}件のお知らせを選択中</span>
        <select id="bulk-news-label-target">
          <option value="">一般にする</option>
          <option value="important">重要にする</option>
          <option value="maintenance">メンテナンスにする</option>
        </select>
        <button class="btn btn-blue" onclick="bulkSetNewsLabel(document.getElementById('bulk-news-label-target').value)">種別を変更</button>
        <button class="btn btn-icon btn-red" onclick="bulkDeleteNews()">🗑️ 選択を削除</button>
        <button class="btn" onclick="clearNewsSelection()">選択解除</button>
      </div>`,
  );
}

function update(k: "title" | "themeColor" | "weatherLocation", v: string): void {
  markTextEdit();
  config[k] = v;
  updatePreview();
}
function updateNews(i: number, k: "date" | "text", v: string): void {
  markTextEdit();
  config.news[i][k] = v;
  updatePreview();
}
// お知らせを常に先頭に表示する「ピン留め」の切り替え。編集者が管理する共有データであり、
// 閲覧者個人の状態ではないためSPEC.md §1.3のLocalStorage禁止制約には抵触しない。
function toggleNewsPinned(i: number): void {
  pushUndo();
  config.news[i].pinned = !config.news[i].pinned;
  renderForm();
  updatePreview();
}
// お知らせの有効期限(空欄は無期限)。この日付を過ぎると閲覧画面から自動的に非表示になる。
function updateNewsExpiry(i: number, v: string): void {
  pushUndo();
  config.news[i].expiresAt = v || undefined;
  updatePreview();
}
function delNews(i: number): void {
  pushUndo();
  clearAllSelectionsSilently();
  config.news.splice(i, 1);
  renderForm();
  updatePreview();
}
function addNews(): void {
  pushUndo();
  // unshift()は既存のお知らせのindexをすべて1つずらすため、選択状態をクリアする。
  clearAllSelectionsSilently();
  const d = new Date();
  const dateStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  config.news.unshift({ date: dateStr, text: "" });
  renderForm();
  updatePreview();
}
// お知らせのドラッグ&ドロップ並び替え(SPEC.md §5.2.2)。ピン留めされたお知らせは閲覧画面では常に
// 先頭にまとめて表示される(§3.2)ため、並び替えの効果はピン留め・非ピン留めそれぞれのグループ内での
// 表示順にのみ反映される。
function onNewsDragStart(e: DragEvent, idx: number): void {
  dragNewsIdx = idx;
  dragCatIdx = null;
  dragLink = null;
  e.dataTransfer?.setData("text/plain", String(idx));
}
function onNewsDragOver(e: DragEvent): void {
  if (dragNewsIdx === null) return;
  e.preventDefault();
}
function onNewsDrop(e: DragEvent, idx: number): void {
  if (dragNewsIdx === null) return;
  e.preventDefault();
  if (dragNewsIdx !== idx) {
    pushUndo();
    clearAllSelectionsSilently();
    const [moved] = config.news.splice(dragNewsIdx, 1);
    config.news.splice(idx, 0, moved);
    renderForm();
    updatePreview();
  }
  dragNewsIdx = null;
}
function updateCat(i: number, v: string): void {
  markTextEdit();
  config.categories[i].name = v;
  updatePreview();
}
// カテゴリの「下書き」状態を切り替える(SPEC.md §3.3, §5.2.2)。下書き中は閲覧画面には表示されない
// が、編集画面では引き続き編集できる(公開前の準備や、一時的に隠したいカテゴリ向け)。
function toggleCatHidden(i: number): void {
  pushUndo();
  config.categories[i].hidden = !config.categories[i].hidden;
  renderForm();
  updatePreview();
}
function moveCat(i: number, dir: number): void {
  if (i + dir < 0 || i + dir >= config.categories.length) return;
  pushUndo();
  clearAllSelectionsSilently();
  [config.categories[i], config.categories[i + dir]] = [config.categories[i + dir], config.categories[i]];
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
function moveLink(c: number, l: number, dir: number): void {
  const links = config.categories[c].links;
  if (l + dir < 0 || l + dir >= links.length) return;
  pushUndo();
  clearAllSelectionsSilently();
  [links[l], links[l + dir]] = [links[l + dir], links[l]];
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
// カテゴリのドラッグ&ドロップ並び替え(SPEC.md §5.2.2)。⬆️⬇️ボタンと同じ並び替え操作の
// 代替手段であり、保存(saveToServer)するまでデータベースには反映されない。
// カテゴリの本体(box全体)へのドロップは、リンクをドラッグ中の場合は「そのカテゴリの末尾へ移動」
// (リンクが1件もない空のカテゴリへ移動する手段として。空カテゴリには行がなくドロップ対象がないため)。
function onCatDragStart(e: DragEvent, idx: number): void {
  dragCatIdx = idx;
  dragLink = null;
  dragNewsIdx = null;
  e.dataTransfer?.setData("text/plain", String(idx));
}
function onCatDragOver(e: DragEvent): void {
  if (dragCatIdx === null && !dragLink) return;
  e.preventDefault();
}
function onCatDrop(e: DragEvent, idx: number): void {
  e.preventDefault();
  if (dragCatIdx !== null) {
    if (dragCatIdx !== idx) {
      pushUndo();
      clearAllSelectionsSilently();
      const [moved] = config.categories.splice(dragCatIdx, 1);
      config.categories.splice(idx, 0, moved);
      linkCheckResults = null;
      renderForm();
      updatePreview();
    }
    dragCatIdx = null;
    return;
  }
  if (dragLink) {
    pushUndo();
    clearAllSelectionsSilently();
    const [moved] = config.categories[dragLink.cat].links.splice(dragLink.link, 1);
    config.categories[idx].links.push(moved);
    linkCheckResults = null;
    renderForm();
    updatePreview();
    dragLink = null;
  }
}

// リンクのドラッグ&ドロップ並び替え。同一カテゴリ内・カテゴリをまたいだ移動の両方に対応する。
function onLinkDragStart(e: DragEvent, c: number, l: number): void {
  dragLink = { cat: c, link: l };
  dragCatIdx = null;
  dragNewsIdx = null;
  e.dataTransfer?.setData("text/plain", `${c}-${l}`);
}
function onLinkDragOver(e: DragEvent): void {
  if (!dragLink) return;
  e.preventDefault();
}
function onLinkDrop(e: DragEvent, c: number, l: number): void {
  if (!dragLink) return;
  e.preventDefault();
  e.stopPropagation();
  if (dragLink.cat !== c || dragLink.link !== l) {
    pushUndo();
    clearAllSelectionsSilently();
    const [moved] = config.categories[dragLink.cat].links.splice(dragLink.link, 1);
    // 同一カテゴリ内で自分より後ろの位置へ移動する場合、削除によって後続の添字が1つずれるため補正する。
    const insertAt = dragLink.cat === c && dragLink.link < l ? l - 1 : l;
    config.categories[c].links.splice(insertAt, 0, moved);
    linkCheckResults = null;
    renderForm();
    updatePreview();
  }
  dragLink = null;
}

function togglePalette(id: string): void {
  document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
  const palette = document.getElementById(id);
  if (palette) palette.style.display = "flex";
}
function setIcon(c: number, l: number, ic: string): void {
  pushUndo();
  config.categories[c].links[l].icon = ic;
  renderForm();
  updatePreview();
  document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
}
function delCat(i: number): void {
  if (confirm("このカテゴリを削除しますか?")) {
    pushUndo();
    clearAllSelectionsSilently();
    config.categories.splice(i, 1);
    linkCheckResults = null;
    renderForm();
    updatePreview();
  }
}
function addCat(): void {
  pushUndo();
  config.categories.push({ name: "新規カテゴリ", links: [] });
  renderForm();
  updatePreview();
}
// カテゴリのアイコン(絵文字。§3.3, §5.1.2)。空文字列を渡すとアイコンなしに戻す。
function setCatIcon(c: number, ic: string): void {
  pushUndo();
  config.categories[c].icon = ic || undefined;
  renderForm();
  updatePreview();
  document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
}
// カテゴリの表示形式(グリッド/リスト。§3.3, §5.1.2)。
function updateCatDisplayMode(c: number, v: string): void {
  pushUndo();
  config.categories[c].displayMode = v === "list" ? "list" : undefined;
  updatePreview();
}
// 既存カテゴリ(名称・リンク構成)を複製し、末尾に新規カテゴリとして追加する(SPEC.md §5.2.2)。
// クリック数・追加日時・到達可否等のサーバー側派生情報は複製せず(保存時にURLをもとに再計算される)、
// 名称・URL・アイコン・メモのみをコピーする。
function duplicateCat(c: number): void {
  pushUndo();
  const original = config.categories[c];
  config.categories.push({
    name: `${original.name} のコピー`,
    links: original.links.map((link) => ({ name: link.name, url: link.url, icon: link.icon, memo: link.memo })),
    ...(original.icon ? { icon: original.icon } : {}),
    ...(original.displayMode ? { displayMode: original.displayMode } : {}),
    ...(original.hidden ? { hidden: true } : {}),
  });
  linkCheckResults = null;
  renderForm();
  updatePreview();
  updateStorageStatus(`📋 「${original.name}」を複製しました (未保存)`);
}

// カテゴリの一括操作(選択→公開/下書き切替・削除。SPEC.md §5.2.2)。
function toggleCatSelect(c: number): void {
  if (selectedCats.has(c)) {
    selectedCats.delete(c);
  } else {
    clearOtherSelections("cat");
    selectedCats.add(c);
  }
  renderBulkActionBar();
  renderCatBulkActionBar();
  renderNewsBulkActionBar();
}
function clearCatSelection(): void {
  selectedCats.clear();
  document.querySelectorAll<HTMLInputElement>(".cat-select").forEach((cb) => (cb.checked = false));
  renderCatBulkActionBar();
}
function bulkSetCatHidden(hidden: boolean): void {
  if (selectedCats.size === 0) return;
  const indices = Array.from(selectedCats);
  pushUndo();
  clearAllSelectionsSilently();
  indices.forEach((i) => {
    if (config.categories[i]) config.categories[i].hidden = hidden;
  });
  renderForm();
  updatePreview();
}
function bulkDeleteCats(): void {
  if (selectedCats.size === 0) return;
  if (!confirm(`選択した${selectedCats.size}件のカテゴリ(含まれるリンクごと)を削除しますか?`)) return;
  // 降順で削除しないとindexがずれるため、大きいindexから処理する。
  const indices = Array.from(selectedCats).sort((a, b) => b - a);
  pushUndo();
  clearAllSelectionsSilently();
  indices.forEach((i) => config.categories.splice(i, 1));
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
function updateLink(c: number, l: number, k: "name" | "url" | "icon", v: string): void {
  markTextEdit();
  config.categories[c].links[l][k] = v;
  updatePreview();
}
function delLink(c: number, l: number): void {
  pushUndo();
  clearAllSelectionsSilently();
  config.categories[c].links.splice(l, 1);
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
function addLink(c: number): void {
  pushUndo();
  config.categories[c].links.push({ name: "", url: "", icon: "📄" });
  renderForm();
  updatePreview();
}
// リンクへの任意の補足説明。閲覧画面ではカードのツールチップ(title属性)として表示する(SPEC.md §5.1.2)。
function updateLinkMemo(c: number, l: number, v: string): void {
  markTextEdit();
  config.categories[c].links[l].memo = v || undefined;
  updatePreview();
}
// お知らせの種別ラベル(SPEC.md §3.2, §5.1.2)。空文字列("一般")の場合はラベルなしとして扱う。
function updateNewsLabel(i: number, v: string): void {
  pushUndo();
  config.news[i].label = (v || undefined) as NewsItem["label"];
  updatePreview();
}
// リンクカードでアイコン絵文字の代わりにファビコンを表示するかどうかの設定(§5.1.2)。
function toggleUseFavicon(v: boolean): void {
  pushUndo();
  config.useFavicon = v;
  updatePreview();
}
// 「重要」ラベルのお知らせをピン留めと同様に先頭表示するかどうかの設定(§3.1, §5.1.2)。
function togglePinImportantNews(v: boolean): void {
  pushUndo();
  config.pinImportantNews = v;
  updatePreview();
}
// 期限切れのお知らせを完全非表示にせず「過去のお知らせ」として保持するかどうかの設定(§3.1, §5.1.2)。
function toggleArchiveExpiredNews(v: boolean): void {
  pushUndo();
  config.archiveExpiredNews = v;
  updatePreview();
}

// お知らせの一括操作(選択→種別変更・削除。SPEC.md §5.2.2)。
function toggleNewsSelect(i: number): void {
  if (selectedNews.has(i)) {
    selectedNews.delete(i);
  } else {
    clearOtherSelections("news");
    selectedNews.add(i);
  }
  renderBulkActionBar();
  renderCatBulkActionBar();
  renderNewsBulkActionBar();
}
function clearNewsSelection(): void {
  selectedNews.clear();
  document.querySelectorAll<HTMLInputElement>(".news-select").forEach((cb) => (cb.checked = false));
  renderNewsBulkActionBar();
}
function bulkSetNewsLabel(label: string): void {
  if (selectedNews.size === 0) return;
  const indices = Array.from(selectedNews);
  pushUndo();
  clearAllSelectionsSilently();
  indices.forEach((i) => {
    if (config.news[i]) config.news[i].label = (label || undefined) as NewsItem["label"];
  });
  renderForm();
  updatePreview();
}
function bulkDeleteNews(): void {
  if (selectedNews.size === 0) return;
  if (!confirm(`選択した${selectedNews.size}件のお知らせを削除しますか?`)) return;
  // 降順で削除しないとindexがずれるため、大きいindexから処理する。
  const indices = Array.from(selectedNews).sort((a, b) => b - a);
  pushUndo();
  clearAllSelectionsSilently();
  indices.forEach((i) => config.news.splice(i, 1));
  renderForm();
  updatePreview();
}

// リンクの一括操作(選択→カテゴリ移動/削除。SPEC.md §5.2.2)。
function toggleLinkSelect(c: number, l: number): void {
  const key = `${c}-${l}`;
  if (selectedLinks.has(key)) {
    selectedLinks.delete(key);
  } else {
    clearOtherSelections("link");
    selectedLinks.add(key);
  }
  // チェックボックス自体の見た目(checked状態)はブラウザがクリック時点で既に反映済みのため、
  // renderForm()全体の再構築は行わず、操作バーだけを更新する(スクロール位置の保持・軽量化)。
  renderBulkActionBar();
  renderCatBulkActionBar();
  renderNewsBulkActionBar();
}
function clearLinkSelection(): void {
  selectedLinks.clear();
  // renderForm()全体は行わず(toggleLinkSelect()と同じ理由)、チェックボックスの見た目だけ
  // 手動で同期する(checked状態はrenderForm()時にselectedLinksから導出しているため)。
  document.querySelectorAll<HTMLInputElement>(".link-select").forEach((cb) => (cb.checked = false));
  renderBulkActionBar();
}
// 一括操作バーの移動先カテゴリの選択を記憶する(renderForm()の再描画をまたいで保持するため)。
function updateBulkMoveTarget(v: string): void {
  bulkMoveTargetCatIdx = Number(v);
}
// 選択中のリンクのキー("カテゴリindex-リンクindex")を、カテゴリごとにインデックス降順でグループ化する。
// 同一カテゴリ内で複数削除/移動する際、小さいindexから処理すると後続のindexがずれてしまうための対策。
function groupSelectedLinksByCategory(): Map<number, number[]> {
  const byCat = new Map<number, number[]>();
  selectedLinks.forEach((key) => {
    const [c, l] = key.split("-").map(Number);
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c)!.push(l);
  });
  byCat.forEach((lIdxs) => lIdxs.sort((a, b) => b - a));
  return byCat;
}
function bulkDeleteLinks(): void {
  if (selectedLinks.size === 0) return;
  if (!confirm(`選択した${selectedLinks.size}件のリンクを削除しますか?`)) return;
  // 削除するとindexがずれるため、グループ化は選択状態をクリアする前に行う。
  const byCat = groupSelectedLinksByCategory();
  pushUndo();
  clearAllSelectionsSilently();
  byCat.forEach((lIdxs, cIdx) => {
    lIdxs.forEach((lIdx) => config.categories[cIdx].links.splice(lIdx, 1));
  });
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
function bulkMoveLinks(targetCatIdxStr: string): void {
  const targetCatIdx = Number(targetCatIdxStr);
  if (selectedLinks.size === 0 || Number.isNaN(targetCatIdx) || !config.categories[targetCatIdx]) return;
  const byCat = groupSelectedLinksByCategory();
  pushUndo();
  clearAllSelectionsSilently();
  // 移動先での並び順は、選択したカテゴリ・リンクの走査順に依存する(厳密な元の表示順の保持は行わない)。
  const movedLinks: LinkItem[] = [];
  byCat.forEach((lIdxs, cIdx) => {
    lIdxs.forEach((lIdx) => movedLinks.push(config.categories[cIdx].links.splice(lIdx, 1)[0]));
  });
  config.categories[targetCatIdx].links.push(...movedLinks);
  linkCheckResults = null;
  renderForm();
  updatePreview();
}

// 画面に表示中の全リンクへサーバー経由でHEADリクエストを送り、到達可否を確認する。
// 結果はDBには保存されず、この編集セッション中のみ表示される(SPEC.md §5.2.2)。
// 定期自動チェック(§2.4, §5.1.2)で到達不可(broken)と判定されているリンクをまとめて選択する
// (SPEC.md §5.2.2)。選択後は既存の一括操作バー(確認・削除)でそのまま扱える。
function selectBrokenLinks(): void {
  const keys: string[] = [];
  config.categories.forEach((cat, cIdx) => {
    cat.links.forEach((link, lIdx) => {
      if (link.broken) keys.push(`${cIdx}-${lIdx}`);
    });
  });
  if (keys.length === 0) {
    alert("現在、到達不可と判定されているリンクはありません。");
    return;
  }
  clearOtherSelections("link");
  selectedLinks = new Set(keys);
  renderForm();
  updateStorageStatus(`⚠️ 到達不可リンク${keys.length}件を選択しました`);
}

async function checkLinks(): Promise<void> {
  const keys: string[] = [];
  const urls: string[] = [];
  config.categories.forEach((cat, cIdx) => {
    cat.links.forEach((link, lIdx) => {
      keys.push(`${cIdx}-${lIdx}`);
      urls.push(link.url);
    });
  });
  if (urls.length === 0) {
    alert("チェック対象のリンクがありません。");
    return;
  }

  const btn = document.getElementById("check-links-btn") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "🔗 チェック中...";
  }
  try {
    const res = await fetch("/api/check-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urls }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "リンクチェックに失敗しました");

    const results: { ok: boolean; status: number | null; error: string | null }[] = data.results;
    linkCheckResults = {};
    results.forEach((r, i) => {
      linkCheckResults![keys[i]] = r;
    });
    const brokenCount = results.filter((r) => !r.ok).length;
    const okCount = results.length - brokenCount;
    renderForm();
    // リンクチェック結果のサマリー表示(SPEC.md §5.2.2)。各行の✅/❌バッジに加え、全体の件数をまとめて示す。
    updateStorageStatus(
      brokenCount > 0
        ? `🔗 リンクチェック完了 (✅ OK: ${okCount}件 / ❌ NG: ${brokenCount}件)`
        : `🔗 リンクチェック完了 (✅ すべて正常です: ${okCount}件)`,
    );
  } catch (error) {
    alert("❌ リンクチェックに失敗しました。\n\n" + (error as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "🔗 リンクをチェック";
    }
  }
}

// データベース(SQLite)に保存。他の人が先に保存していた場合(バージョン不一致)は
// 409が返り、サーバー側の最新内容を再取得する(楽観的排他制御。SPEC.md §4.2)。
async function saveToServer(): Promise<void> {
  const saveBtn = document.getElementById("save-btn")! as HTMLButtonElement;
  saveBtn.disabled = true;
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (currentVersion !== null) {
      headers["If-Match"] = `"${currentVersion}"`;
    }
    const res = await fetch("/api/config", {
      method: "PUT",
      headers,
      body: JSON.stringify(config),
    });

    if (res.status === 409) {
      const conflictData = await res.json();
      alert(
        "⚠️ 保存できませんでした。\n\n" + (conflictData.error || "他の変更と競合しました。") +
          "\n\n「OK」を押すと最新の内容を再取得します。この画面での編集内容は失われます。",
      );
      pushUndo();
      clearAllSelectionsSilently();
      const loaded = await loadFromServer();
      config = normalizeConfig(loaded);
      linkCheckResults = null;
      renderForm();
      updatePreview();
      updateStorageStatus("🔄 競合を検出したため最新の内容を再取得しました");
      return;
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "保存に失敗しました");
    currentVersion = parseVersion(res.headers.get("etag"));
    config = normalizeConfig(data);
    renderForm();
    updatePreview();
    updateStorageStatus("✅ 保存完了 (" + new Date().toLocaleTimeString("ja-JP") + ")");
    alert("✅ データベースに保存しました!\n\nportal.htmlを再読み込みすると変更が反映されます。");
  } catch (error) {
    console.error("保存エラー:", error);
    updateStorageStatus("❌ 保存失敗");
    alert("❌ 保存に失敗しました。\n\n" + (error as Error).message);
  } finally {
    saveBtn.disabled = false;
  }
}

// JSON形式でエクスポート
// テキスト内容をブラウザ上でファイルとしてダウンロードさせる共通処理
// (JSONエクスポート・リンク一覧エクスポート・変更履歴エクスポートで共用)。
function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJSON(): void {
  const data = {
    version: EXPORT_FORMAT_VERSION,
    exportDate: new Date().toISOString(),
    config: config,
  };
  downloadFile(
    JSON.stringify(data, null, 2),
    `adlaire-portal-config-${new Date().toISOString().split("T")[0]}.json`,
    "application/json",
  );
  alert("✅ JSON形式でエクスポートしました!\n\nこのファイルをバックアップとして保管できます。");
}

// JSON形式でインポート
function importJSON(): void {
  document.getElementById("import-file")!.click();
}

// 現在のリンク一覧を「名称, URL」形式のテキストファイルとしてダウンロードする(一括インポートの
// 逆方向。SPEC.md §5.2.2)。カテゴリごとに「# カテゴリ名」の見出し行を挟む(この見出し行は
// カンマ/タブ区切りを含まないため、一括インポート側では自動的に読み飛ばされる)。
function exportLinksText(): void {
  const totalLinks = config.categories.reduce((sum, cat) => sum + cat.links.length, 0);
  if (totalLinks === 0) {
    alert("エクスポートするリンクがありません。");
    return;
  }
  const lines: string[] = [];
  config.categories.forEach((cat) => {
    if (cat.links.length === 0) return;
    // parseBulkImportLine()はカンマ/タブを区切り文字とみなすため、カテゴリ名にそれらが
    // 含まれていると見出し行が誤って「名称, URL」の1件として再インポートされてしまう。
    // 見出し行では区切り文字になり得る文字を空白に置き換え、常に読み飛ばされるようにする。
    lines.push(`# ${cat.name.replace(/[,\t]/g, " ")}`);
    // 区切り文字にはタブを使う(parseBulkImportLine()はタブが含まれていれば優先的にタブを区切りと
    // みなすため)。カンマ区切りだと、リンク名自体にカンマが含まれる場合(例:「Amazon, Inc」)に
    // 再インポート時の名称/URL分割が崩れてしまう。タブはリンク名に含まれることが稀なため安全側。
    cat.links.forEach((link) => lines.push(`${link.name}\t${link.url}`));
    lines.push("");
  });
  downloadFile(lines.join("\n"), `adlaire-portal-links-${new Date().toISOString().split("T")[0]}.txt`, "text/plain");
}

function handleImportFile(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target!.result as string);

      if (!data.config) {
        throw new Error("設定データが見つかりません");
      }
      if (!data.config.title || typeof data.config.title !== "string") {
        throw new Error("タイトルが不正です");
      }
      if (!Array.isArray(data.config.categories)) {
        throw new Error("カテゴリデータが不正です");
      }
      if (data.config.themeColor && !/^#[0-9A-Fa-f]{6}$/.test(data.config.themeColor)) {
        console.warn("⚠️ テーマカラーの形式が不正です。デフォルト値を使用します。");
        data.config.themeColor = "#00a968";
      }

      pushUndo();
      clearAllSelectionsSilently();
      config = normalizeConfig(data.config);

      config.categories.forEach((cat: Category) => {
        if (!cat.name) cat.name = "未設定";
        if (!Array.isArray(cat.links)) cat.links = [];
      });

      linkCheckResults = null;
      renderForm();
      updatePreview();
      updateStorageStatus("📥 インポート完了 (未保存)");
      alert("✅ 設定をインポートしました!\n\n「保存」ボタンを押すとデータベースに反映されます。");
    } catch (error) {
      console.error("インポートエラー:", error);
      updateStorageStatus("❌ インポート失敗");
      alert("❌ ファイルの読み込みに失敗しました。\n\nエラー: " + (error as Error).message + "\n\n正しいJSON形式のファイルを選択してください。");
    }
  };
  reader.readAsText(file);
  (event.target as HTMLInputElement).value = ""; // リセット
}

// デフォルトに戻す(データベースをシードデータでリセット)
async function resetToDefault(): Promise<void> {
  if (!confirm("⚠️ データベースの内容を破棄してデフォルトに戻しますか?\n\nこの操作は取り消せません。")) {
    return;
  }

  try {
    const res = await fetch("/api/config/reset", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "リセットに失敗しました");
    pushUndo();
    clearAllSelectionsSilently();
    currentVersion = parseVersion(res.headers.get("etag"));
    config = normalizeConfig(data);
    linkCheckResults = null;
    renderForm();
    updatePreview();
    updateStorageStatus("🔄 デフォルトに戻しました");
    alert("✅ デフォルト設定に戻しました!\n\nportal.htmlを再読み込みしてください。");
  } catch (error) {
    console.error("リセットエラー:", error);
    alert("❌ リセットに失敗しました。\n\n" + (error as Error).message);
  }
}

// 現在のデータベースファイル(portal.db)をそのままダウンロードする(SPEC.md §4.9)。
// 自動バックアップ(§2.3)とは別に、リスクのある変更前に手元へ控えを取る用途を想定している。
function downloadBackup(): void {
  window.location.href = "/api/backup/download";
}

// カテゴリ名・カテゴリ内のリンク名をそれぞれ五十音/アルファベット順に一括で並び替える(SPEC.md §5.2.2)。
// 保存(saveToServer)するまでデータベースには反映されない。
// カテゴリ・リンクの一括並び替え(SPEC.md §5.2.2)。"name"(名前順)はカテゴリ名・リンク名の両方を
// 五十音/アルファベット順に並び替える(既存の挙動)。"clicks"(クリック数順)・"addedAt"(追加日順)は
// カテゴリの並び順自体には意味がある基準ではないため、各カテゴリ内のリンクの並び順のみ変更する。
function sortLinks(mode: string): void {
  pushUndo();
  clearAllSelectionsSilently();
  if (mode === "name") {
    config.categories.sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }
  config.categories.forEach((cat) => {
    if (mode === "clicks") {
      cat.links.sort((a, b) => (b.clicks || 0) - (a.clicks || 0));
    } else if (mode === "addedAt") {
      // addedAtは保存時にサーバーが付与する派生情報のため、このセッションで追加したばかりの
      // 未保存リンクにはまだ存在しない。空文字列を最古として扱うと最新であるべき新規リンクが
      // 最後に回ってしまうため、代わりに他のどのISO日時よりも大きい番兵値を使い最新扱いにする。
      const key = (l: LinkItem) => l.addedAt || "\uFFFF";
      cat.links.sort((a, b) => key(b).localeCompare(key(a)));
    } else {
      cat.links.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    }
  });
  linkCheckResults = null;
  renderForm();
  updatePreview();
  const label = mode === "clicks" ? "クリック数順" : mode === "addedAt" ? "追加日順" : "名前順";
  updateStorageStatus(`🔤 ${label}に並び替えました (未保存)`);
}

// アクセス統計モーダルを開き、現在読み込み中のconfig(クリック数を含む)と
// GET /api/history から集計した簡易統計を表示する(SPEC.md §5.2.2)。新規のAPIは呼ばず、
// 既存のエンドポイントのデータのみで完結する。
async function openStats(): Promise<void> {
  const modal = document.getElementById("stats-modal")!;
  const body = document.getElementById("stats-body")!;
  body.innerHTML = "読み込み中...";
  modal.style.display = "flex";
  try {
    const allLinks: LinkItem[] = config.categories.flatMap((cat) => cat.links);
    const totalClicks = allLinks.reduce((sum, l) => sum + (l.clicks || 0), 0);
    const topLinks = allLinks
      .filter((l) => l.clicks)
      .sort((a, b) => (b.clicks || 0) - (a.clicks || 0))
      .slice(0, 10);

    const res = await fetch("/api/history");
    const historyEntries: HistoryEntrySummary[] = res.ok ? (await res.json()).entries : [];
    const lastChangedText = historyEntries.length > 0
      ? new Date(historyEntries[0].changedAt).toLocaleString("ja-JP")
      : "-";

    const tilesHtml = `
      <div class="stats-summary">
        <div class="stats-tile"><div class="stats-num">${config.categories.length}</div><div class="stats-label">カテゴリ数</div></div>
        <div class="stats-tile"><div class="stats-num">${allLinks.length}</div><div class="stats-label">リンク数</div></div>
        <div class="stats-tile"><div class="stats-num">${totalClicks}</div><div class="stats-label">総クリック数</div></div>
        <div class="stats-tile"><div class="stats-num">${historyEntries.length}</div><div class="stats-label">保存履歴件数</div></div>
      </div>
      <div style="font-size:11px; color:#95a5a6; margin:10px 0;">最終保存: ${escapeHtml(lastChangedText)}</div>`;

    const topLinksHtml = topLinks.length === 0
      ? `<div class="history-empty">まだクリックされたリンクがありません。</div>`
      : topLinks
        .map((l, i) =>
          `<div class="history-row"><span>${i + 1}. ${escapeHtml(l.icon)} ${escapeHtml(l.name)}</span><span>👁 ${l.clicks}</span></div>`
        )
        .join("");

    // カテゴリ別内訳(SPEC.md §5.2.2): カテゴリごとのリンク数・クリック数合計を一覧表示する。
    const catBreakdownHtml = config.categories.length === 0
      ? `<div class="history-empty">カテゴリがまだありません。</div>`
      : config.categories
        .map((cat) => {
          const catClicks = cat.links.reduce((sum, l) => sum + (l.clicks || 0), 0);
          return `<div class="history-row"><span>${escapeHtml(cat.icon ? `${cat.icon} ` : "")}${
            escapeHtml(cat.name)
          } (${cat.links.length}件)</span><span>👁 ${catClicks}</span></div>`;
        })
        .join("");

    body.innerHTML =
      `${tilesHtml}<label>カテゴリ別内訳</label>${catBreakdownHtml}<label>よく使われているリンク TOP10</label>${topLinksHtml}`;
  } catch (error) {
    body.innerHTML = `<div class="history-empty">❌ ${escapeHtml((error as Error).message)}</div>`;
  }
}

function closeStats(): void {
  document.getElementById("stats-modal")!.style.display = "none";
}

interface HistoryEntrySummary {
  id: number;
  changedAt: string;
}

interface DiffLinkInfo {
  name: string;
  url: string;
  category: string;
}

interface ConfigDiff {
  titleChanged: boolean;
  themeChanged: boolean;
  // このスナップショットを読み込んだ場合に「なくなる」リンク(現在の設定にのみ存在)
  removedLinks: DiffLinkInfo[];
  // このスナップショットを読み込んだ場合に「復元される」リンク(スナップショットにのみ存在)
  restoredLinks: DiffLinkInfo[];
  // 名称・所属カテゴリのいずれかが異なるリンク(URLが一致するもの同士で比較)
  changedLinks: { url: string; current: DiffLinkInfo; snapshot: DiffLinkInfo }[];
}

// URLごとにリンクをグループ化する。一括インポート時の重複URL警告(§5.2.2)が示すとおり、同じURLの
// リンクが複数(カテゴリをまたいで)存在する状態は許容されているため、Map<url, 1件>ではなく
// Map<url, 該当リンクの配列>として、同じURLの重複も取りこぼさないようにする。
function collectLinksByUrl(c: PortalConfig): Map<string, DiffLinkInfo[]> {
  const map = new Map<string, DiffLinkInfo[]>();
  c.categories.forEach((cat) => {
    cat.links.forEach((link) => {
      const info = { name: link.name, url: link.url, category: cat.name };
      const list = map.get(link.url);
      if (list) list.push(info);
      else map.set(link.url, [info]);
    });
  });
  return map;
}

// 現在の設定(current)と変更履歴のスナップショット(snapshot)を比較し、このスナップショットを
// 読み込んだ場合に生じる差分を算出する(SPEC.md §5.2.2)。リンクはURLをキーに同一性を判定する。
// 同じURLが複数存在する場合は、両者の該当リンクを順番に対応させ(多重集合としての比較)、
// 対応する組の所属カテゴリ/名称が異なれば「変更」、どちらか一方にしか対応する組が無ければ
// 「追加」または「削除」として扱う(厳密にどのリンクとどのリンクが対応するかの一意な判定はできないため、
// 件数と内容の差分を漏れなく表示することを優先した近似的な比較)。
function computeConfigDiff(current: PortalConfig, snapshot: PortalConfig): ConfigDiff {
  const currentLinks = collectLinksByUrl(current);
  const snapshotLinks = collectLinksByUrl(snapshot);
  const removedLinks: DiffLinkInfo[] = [];
  const restoredLinks: DiffLinkInfo[] = [];
  const changedLinks: ConfigDiff["changedLinks"] = [];
  const allUrls = new Set([...currentLinks.keys(), ...snapshotLinks.keys()]);
  allUrls.forEach((url) => {
    const currentList = currentLinks.get(url) ?? [];
    const snapshotList = snapshotLinks.get(url) ?? [];
    const pairCount = Math.min(currentList.length, snapshotList.length);
    for (let i = 0; i < pairCount; i++) {
      const cur = currentList[i];
      const snap = snapshotList[i];
      if (cur.name !== snap.name || cur.category !== snap.category) {
        changedLinks.push({ url, current: cur, snapshot: snap });
      }
    }
    for (let i = pairCount; i < currentList.length; i++) removedLinks.push(currentList[i]);
    for (let i = pairCount; i < snapshotList.length; i++) restoredLinks.push(snapshotList[i]);
  });
  return {
    titleChanged: current.title !== snapshot.title,
    themeChanged: current.themeColor !== snapshot.themeColor,
    removedLinks,
    restoredLinks,
    changedLinks,
  };
}

function renderConfigDiff(diff: ConfigDiff): string {
  const parts: string[] = [];
  if (diff.titleChanged) parts.push(`<div class="diff-line diff-changed">✏️ タイトルが変わります</div>`);
  if (diff.themeChanged) parts.push(`<div class="diff-line diff-changed">✏️ テーマカラーが変わります</div>`);
  diff.restoredLinks.forEach((l) =>
    parts.push(`<div class="diff-line diff-added">🟢 復元: ${escapeHtml(l.name)} (${escapeHtml(l.category)})</div>`)
  );
  diff.removedLinks.forEach((l) =>
    parts.push(`<div class="diff-line diff-removed">🔴 削除: ${escapeHtml(l.name)} (${escapeHtml(l.category)})</div>`)
  );
  diff.changedLinks.forEach((l) =>
    parts.push(
      `<div class="diff-line diff-changed">✏️ 変更: ${escapeHtml(l.current.name)} (${escapeHtml(l.current.category)}) → ${
        escapeHtml(l.snapshot.name)
      } (${escapeHtml(l.snapshot.category)})</div>`,
    )
  );
  if (parts.length === 0) return `<div class="diff-line">現在の設定と同じ内容です(リンク・タイトル・テーマカラーに差分はありません)。</div>`;
  return parts.join("");
}

// 履歴一覧に表示するキャッシュ(id→取得済みのスナップショット)。同じエントリの差分を
// 再度開いた際に再取得しないためだけの、このモーダルを開いている間だけの一時的なキャッシュ。
let historyEntryCache = new Map<number, PortalConfig>();

async function toggleHistoryDiff(id: number): Promise<void> {
  const panel = document.getElementById(`history-diff-${id}`)!;
  // 取得に成功して表示済みの場合のみ、再クリックで閉じる(トグル動作)。読み込み中・エラー表示中に
  // 再クリックした場合は、単に閉じるのではなく再取得を試みる(エラーのまま閉じるしかできず、
  // 3回目のクリックまで再試行できなくなるのを防ぐため)。
  if (panel.style.display === "block" && panel.dataset.state === "ok") {
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  panel.innerHTML = "読み込み中...";
  panel.dataset.state = "";
  try {
    let snapshot = historyEntryCache.get(id);
    if (!snapshot) {
      const res = await fetch(`/api/history/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "変更履歴の取得に失敗しました");
      snapshot = normalizeConfig((data as { config: PortalConfig }).config);
      historyEntryCache.set(id, snapshot);
    }
    panel.innerHTML = renderConfigDiff(computeConfigDiff(config, snapshot));
    panel.dataset.state = "ok";
  } catch (error) {
    panel.innerHTML = `❌ ${escapeHtml((error as Error).message)}`;
  }
}

// 変更履歴パネルを開き、一覧(新しい順)を取得して表示する(SPEC.md §4.7, §5.2.2)。
async function openHistory(): Promise<void> {
  const modal = document.getElementById("history-modal")!;
  const listEl = document.getElementById("history-list")!;
  listEl.innerHTML = "読み込み中...";
  modal.style.display = "flex";
  historyEntryCache = new Map();
  try {
    const res = await fetch("/api/history");
    if (!res.ok) throw new Error("変更履歴の取得に失敗しました");
    const data = await res.json() as { entries: HistoryEntrySummary[] };
    if (data.entries.length === 0) {
      listEl.innerHTML = `<div class="history-empty">変更履歴はまだありません。</div>`;
      return;
    }
    listEl.innerHTML = data.entries
      .map(
        (entry) => `
        <div class="history-entry">
          <div class="history-row">
            <span>${escapeHtml(new Date(entry.changedAt).toLocaleString("ja-JP"))}</span>
            <div style="display:flex; gap:6px;">
              <button class="btn" style="background:#f0f0f0; color:#666; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold;" onclick="toggleHistoryDiff(${entry.id})">🔍 現在との差分</button>
              <button class="btn" style="background:#e8f5f0; color:#00a968; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold;" onclick="restoreHistory(${entry.id})">この内容を確認</button>
            </div>
          </div>
          <div class="history-diff" id="history-diff-${entry.id}" style="display:none;"></div>
        </div>`,
      )
      .join("");
  } catch (error) {
    listEl.innerHTML = `<div class="history-empty">❌ ${escapeHtml((error as Error).message)}</div>`;
  }
}

function closeHistory(): void {
  document.getElementById("history-modal")!.style.display = "none";
}

// 変更履歴(直近50件)をJSON形式でダウンロードする(SPEC.md §5.2.2)。監査ログ・手元控え用途。
// 既存のGET /api/history・GET /api/history/:id (§4.7)のみを使い、新規のAPIは追加しない。
async function exportHistory(): Promise<void> {
  const btn = document.getElementById("export-history-btn") as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "📤 準備中...";
  }
  try {
    const res = await fetch("/api/history");
    if (!res.ok) throw new Error("変更履歴の取得に失敗しました");
    const data = await res.json() as { entries: HistoryEntrySummary[] };
    // Promise.allではなくallSettled()を使う: 変更履歴は直近50件のみ保持され保存のたびに古い
    // ものから削除されるため(§3.8)、一覧取得後・各エントリ取得中に他の編集者が保存すると、
    // 取得中の一部エントリが削除されて404になることがある。1件の失敗で残り全件を巻き添えに
    // せず、取得できた分だけでもエクスポートできるようにする。
    const settled = await Promise.allSettled(
      data.entries.map(async (summary) => {
        const entryRes = await fetch(`/api/history/${summary.id}`);
        const entryData = await entryRes.json();
        if (!entryRes.ok) throw new Error(entryData.error || `履歴[${summary.id}]の取得に失敗しました`);
        return { id: summary.id, changedAt: entryData.changedAt, config: entryData.config };
      }),
    );
    const entries = settled
      .filter((r): r is PromiseFulfilledResult<{ id: number; changedAt: string; config: PortalConfig }> => r.status === "fulfilled")
      .map((r) => r.value);
    const failedCount = settled.length - entries.length;
    if (entries.length === 0) {
      throw new Error("変更履歴を1件も取得できませんでした。");
    }
    const content = JSON.stringify({ exportDate: new Date().toISOString(), entries }, null, 2);
    downloadFile(content, `adlaire-portal-history-${new Date().toISOString().split("T")[0]}.json`, "application/json");
    if (failedCount > 0) {
      alert(
        `⚠️ ${failedCount}件は他の変更と競合して取得できなかったため、エクスポートから除外されました(${entries.length}件は正常にエクスポートされました)。`,
      );
    }
  } catch (error) {
    alert("❌ 変更履歴のエクスポートに失敗しました。\n\n" + (error as Error).message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "📤 エクスポート";
    }
  }
}

// 選択した変更履歴のスナップショットを編集画面に読み込む。データベースへはまだ保存されず、
// 「保存」ボタンを押すまで反映されない(既存のインポート機能と同じ流れ)。
async function restoreHistory(id: number): Promise<void> {
  if (
    !confirm(
      "この変更履歴の内容を編集画面に読み込みますか?\n\n現在の未保存の編集内容は失われます。読み込んだ後、「保存」を押すまでデータベースには反映されません。",
    )
  ) {
    return;
  }
  try {
    const res = await fetch(`/api/history/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "変更履歴の取得に失敗しました");
    pushUndo();
    clearAllSelectionsSilently();
    config = normalizeConfig((data as { config: PortalConfig }).config);
    linkCheckResults = null;
    closeHistory();
    renderForm();
    updatePreview();
    updateStorageStatus(
      `📜 変更履歴を読み込みました (${new Date((data as { changedAt: string }).changedAt).toLocaleString("ja-JP")}時点・未保存)`,
    );
  } catch (error) {
    alert("❌ 変更履歴の読み込みに失敗しました。\n\n" + (error as Error).message);
  }
}

// 「名称, URL」(カンマ区切り、またはExcel等からの貼り付けを想定したタブ区切り)の1行を解析する。
// 解析できない行(区切り文字がない、名称またはURLが空)はnullを返し、呼び出し側で読み飛ばす。
function parseBulkImportLine(line: string): { name: string; url: string } | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const sep = trimmed.includes("\t") ? "\t" : ",";
  const idx = trimmed.indexOf(sep);
  if (idx === -1) return null;
  const name = trimmed.slice(0, idx).trim();
  const url = trimmed.slice(idx + sep.length).trim();
  if (!name || !url) return null;
  return { name, url };
}

function openBulkImport(): void {
  if (config.categories.length === 0) {
    alert("先にカテゴリを1つ以上作成してください。");
    return;
  }
  const select = document.getElementById("bulk-import-category") as HTMLSelectElement;
  select.innerHTML = config.categories
    .map((cat, idx) => `<option value="${idx}">${escapeHtml(cat.name)}</option>`)
    .join("");
  (document.getElementById("bulk-import-text") as HTMLTextAreaElement).value = "";
  (document.getElementById("bulk-import-dedupe") as HTMLInputElement).checked = false;
  document.getElementById("bulk-import-modal")!.style.display = "flex";
}

function closeBulkImport(): void {
  document.getElementById("bulk-import-modal")!.style.display = "none";
}

// テキストエリアに貼り付けた複数行を一括で解析し、選択したカテゴリの末尾へまとめてリンクを
// 追加する(SPEC.md §5.2.2)。URLの妥当性チェックは保存時のサーバー側バリデーション(§6)に委ねる。
function applyBulkImport(): void {
  const select = document.getElementById("bulk-import-category") as HTMLSelectElement;
  const catIdx = Number(select.value);
  const text = (document.getElementById("bulk-import-text") as HTMLTextAreaElement).value;
  const parsed = text
    .split("\n")
    .map(parseBulkImportLine)
    .filter((x): x is { name: string; url: string } => x !== null);

  if (parsed.length === 0) {
    alert("追加できる行がありませんでした。「名称, URL」の形式で1行に1件ずつ入力してください。");
    return;
  }

  // 既存のリンク(カテゴリを問わず全体)と同じURLが含まれていないか確認する。重複していても追加自体は
  // 妨げない(意図的に同じURLを複数カテゴリに置きたい場合もあるため)が、誤操作防止のため警告する。
  const existingUrls = new Set(config.categories.flatMap((cat) => cat.links.map((link) => link.url)));
  const duplicates = parsed.filter((item) => existingUrls.has(item.url));
  const autoDedupe = (document.getElementById("bulk-import-dedupe") as HTMLInputElement).checked;
  let toAdd = parsed;
  if (duplicates.length > 0) {
    if (autoDedupe) {
      // 自動除外オプション有効時は確認ダイアログを出さず、重複分を除いて追加する(SPEC.md §5.2.2)。
      toAdd = parsed.filter((item) => !existingUrls.has(item.url));
      if (toAdd.length === 0) {
        alert(`貼り付けた${parsed.length}件はすべて既存のリンクと同じURLのため、追加するものがありませんでした。`);
        return;
      }
    } else {
      const list = duplicates.map((d) => `・${d.name} (${d.url})`).join("\n");
      if (
        !confirm(
          `⚠️ 以下の${duplicates.length}件は既存のリンクと同じURLです。\n\n${list}\n\nそれでも追加しますか?`,
        )
      ) {
        return;
      }
    }
  }

  pushUndo();
  toAdd.forEach((item) => {
    config.categories[catIdx].links.push({ name: item.name, url: item.url, icon: "📄" });
  });
  linkCheckResults = null;
  closeBulkImport();
  renderForm();
  updatePreview();
  const skippedNote = autoDedupe && toAdd.length < parsed.length ? `(重複${parsed.length - toAdd.length}件を除外) ` : "";
  updateStorageStatus(`📋 ${toAdd.length}件のリンクを一括追加しました ${skippedNote}(未保存)`);
}

// パレットの外側クリックで閉じる
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".palette") && !target.matches('input[readonly]')) {
    document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
  }
});

// edit.html は動的生成したHTML内の onclick="..." / oninput="..." から
// これらの関数を直接呼び出すため、globalThis に公開する。
Object.assign(globalThis, {
  setView,
  update,
  updateNews,
  toggleNewsPinned,
  updateNewsExpiry,
  delNews,
  addNews,
  updateCat,
  toggleCatHidden,
  moveCat,
  moveLink,
  setCatIcon,
  updateCatDisplayMode,
  duplicateCat,
  toggleCatSelect,
  clearCatSelection,
  bulkSetCatHidden,
  bulkDeleteCats,
  togglePinImportantNews,
  toggleArchiveExpiredNews,
  toggleNewsSelect,
  clearNewsSelection,
  bulkSetNewsLabel,
  bulkDeleteNews,
  onNewsDragStart,
  onNewsDragOver,
  onNewsDrop,
  onCatDragStart,
  onCatDragOver,
  onCatDrop,
  onLinkDragStart,
  onLinkDragOver,
  onLinkDrop,
  togglePalette,
  setIcon,
  delCat,
  addCat,
  updateLink,
  updateLinkMemo,
  updateNewsLabel,
  toggleUseFavicon,
  toggleLinkSelect,
  clearLinkSelection,
  updateBulkMoveTarget,
  bulkDeleteLinks,
  bulkMoveLinks,
  delLink,
  addLink,
  checkLinks,
  saveToServer,
  exportJSON,
  exportLinksText,
  importJSON,
  handleImportFile,
  resetToDefault,
  downloadBackup,
  sortLinks,
  selectBrokenLinks,
  openHistory,
  closeHistory,
  exportHistory,
  restoreHistory,
  toggleHistoryDiff,
  openBulkImport,
  closeBulkImport,
  applyBulkImport,
  openStats,
  closeStats,
  undo,
  redo,
});

// 初期化: データベースから設定を読み込む
(async () => {
  try {
    const loaded = await loadFromServer();
    config = normalizeConfig(loaded);
    updateStorageStatus("✅ データベースから読み込み");
  } catch (error) {
    console.error("読み込みエラー:", error);
    updateStorageStatus("❌ 読み込みエラー: サーバーに接続できません");
  }
  renderForm();
  updatePreview();
  (document.getElementById("save-btn")! as HTMLButtonElement).disabled = false;
})();
