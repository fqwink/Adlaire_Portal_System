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
  renderForm();
  updatePreview();
  updateStorageStatus("↩️ 元に戻しました (未保存)");
}

function redo(): void {
  if (redoStack.length === 0) return;
  undoStack.push(cloneConfig(config));
  config = redoStack.pop()!;
  linkCheckResults = null;
  renderForm();
  updatePreview();
  updateStorageStatus("↪️ やり直しました (未保存)");
}

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z") return;
  e.preventDefault();
  if (e.shiftKey) redo();
  else undo();
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

  const html = `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><style>${css}</style></head><body>
      <div class="layout"><div class="sidebar"><div><h1>${escapeHtml(config.title)}</h1><div style="font-size:11px; color:#999; margin-bottom:20px;">${new Date().toLocaleDateString("ja-JP")}</div></div>
      <div style="flex:1;">${config.categories.map((cat) => `<div class="nav-item"><span>${escapeHtml(cat.name)}</span><span class="count">${cat.links.length}</span></div>`).join("")}</div></div>
      <div class="main">${newsHtml}
      ${config.categories.map((cat) => `<div class="cat-head">${escapeHtml(cat.name)}</div><div class="grid">${cat.links.map((l) => `<a class="card"><span class="icon">${escapeHtml(l.icon)}</span><span class="name">${escapeHtml(l.name)}</span></a>`).join("")}</div>`).join("")}
      </div></div></body></html>`;
  iframe.srcdoc = html;
}

function renderForm(): void {
  // 新しい描画のたびに、テキスト編集のUndo単位まとめをリセットする(次の編集から新しい単位を開始する)。
  textEditDirty = false;

  const newsListHtml = config.news
    .map(
      (n, idx) => `
      <div class="row">
        <button class="btn btn-icon ${n.pinned ? "btn-pin active" : "btn-pin"}" onclick="toggleNewsPinned(${idx})" title="常に先頭に表示(ピン留め)">📌</button>
        <input type="text" value="${escapeHtml(n.date)}" style="width:90px;" oninput="updateNews(${idx}, 'date', this.value)">
        <input type="text" value="${escapeHtml(n.text)}" style="flex:1;" oninput="updateNews(${idx}, 'text', this.value)">
        <button class="btn btn-icon btn-red" onclick="delNews(${idx})">🗑️</button>
      </div>
      <div class="row news-sub-row">
        <label style="font-size:10px; color:#999; margin:0; text-transform:none; white-space:nowrap;">📅 有効期限(空欄=無期限):</label>
        <input type="date" value="${escapeHtml(n.expiresAt || "")}" style="width:150px;" onchange="updateNewsExpiry(${idx}, this.value)">
      </div>`,
    )
    .join("");

  formArea.innerHTML = `
      <div class="box">
        <label>タイトル</label><input type="text" value="${escapeHtml(config.title)}" oninput="update('title', this.value)">
        <label>テーマカラー</label><input type="color" value="${config.themeColor || "#00a968"}" oninput="update('themeColor', this.value)">
      </div>
      <div class="box">
        <label>📢 お知らせリスト</label>
        ${newsListHtml}
        <button class="btn btn-green-outline" onclick="addNews()">＋ お知らせを追加</button>
      </div>`;

  config.categories.forEach((cat: Category, cIdx: number) => {
    let html = `<div class="box" ondragover="onCatDragOver(event)" ondrop="onCatDrop(event, ${cIdx})" style="border-left:4px solid ${config.themeColor}"><div class="box-header"><span class="drag-handle" draggable="true" ondragstart="onCatDragStart(event, ${cIdx})" title="ドラッグして並び替え">⠿</span><input type="text" value="${escapeHtml(cat.name)}" oninput="updateCat(${cIdx}, this.value)" style="font-weight:bold; width:50%;"><div style="display:flex;"><button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, -1)">⬆️</button><button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, 1)">⬇️</button><button class="btn btn-icon btn-red" style="margin-left:5px;" onclick="delCat(${cIdx})">🗑️</button></div></div>`;
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
      html += `<div class="row" ondragover="onLinkDragOver(event)" ondrop="onLinkDrop(event, ${cIdx}, ${lIdx})"><span class="drag-handle" draggable="true" ondragstart="onLinkDragStart(event, ${cIdx}, ${lIdx})" title="ドラッグして並び替え">⠿</span><div style="position:relative;"><input type="text" value="${escapeHtml(link.icon)}" style="width:35px; text-align:center; cursor:pointer;" readonly onclick="togglePalette('pal-${cIdx}-${lIdx}')"><div id="pal-${cIdx}-${lIdx}" class="palette">${ICONS.map((ic) => `<div class="p-icon" onclick="setIcon(${cIdx},${lIdx},'${ic}')">${ic}</div>`).join("")}</div></div><div style="flex:1;"><input type="text" value="${escapeHtml(link.name)}" placeholder="名称" oninput="updateLink(${cIdx},${lIdx},'name',this.value)" style="margin-bottom:3px;"><input type="text" value="${escapeHtml(link.url)}" placeholder="URL" style="font-size:12px; color:#666;" oninput="updateLink(${cIdx},${lIdx},'url',this.value)"></div><div style="width:20px; text-align:center;">${checkBadge}</div>${clicksBadge}<div style="display:flex; flex-direction:column; gap:2px;"><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, -1)">⬆️</button><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, 1)">⬇️</button></div><button class="btn btn-icon btn-red" style="height:auto;" onclick="delLink(${cIdx},${lIdx})">×</button></div>`;
    });
    html += `<button class="btn btn-blue" onclick="addLink(${cIdx})" style="background:${config.themeColor}22; color:${config.themeColor}; border-color:${config.themeColor};">＋ リンクを追加</button></div>`;
    formArea.innerHTML += html;
  });
  formArea.innerHTML += `<button class="btn" style="width:100%; padding:15px; border:2px dashed #ccc; color:#666; font-weight:bold;" onclick="addCat()">＋ 新しいカテゴリを追加</button>`;
}

function update(k: "title" | "themeColor", v: string): void {
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
  config.news.splice(i, 1);
  renderForm();
  updatePreview();
}
function addNews(): void {
  pushUndo();
  const d = new Date();
  const dateStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  config.news.unshift({ date: dateStr, text: "" });
  renderForm();
  updatePreview();
}
function updateCat(i: number, v: string): void {
  markTextEdit();
  config.categories[i].name = v;
  updatePreview();
}
function moveCat(i: number, dir: number): void {
  if (i + dir < 0 || i + dir >= config.categories.length) return;
  pushUndo();
  [config.categories[i], config.categories[i + dir]] = [config.categories[i + dir], config.categories[i]];
  linkCheckResults = null;
  renderForm();
  updatePreview();
}
function moveLink(c: number, l: number, dir: number): void {
  const links = config.categories[c].links;
  if (l + dir < 0 || l + dir >= links.length) return;
  pushUndo();
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
function updateLink(c: number, l: number, k: "name" | "url" | "icon", v: string): void {
  markTextEdit();
  config.categories[c].links[l][k] = v;
  updatePreview();
}
function delLink(c: number, l: number): void {
  pushUndo();
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

// 画面に表示中の全リンクへサーバー経由でHEADリクエストを送り、到達可否を確認する。
// 結果はDBには保存されず、この編集セッション中のみ表示される(SPEC.md §5.2.2)。
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
    renderForm();
    updateStorageStatus(
      brokenCount > 0
        ? `🔗 リンクチェック完了 (${brokenCount}件に問題があります)`
        : "🔗 リンクチェック完了 (すべて正常です)",
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
function exportJSON(): void {
  const data = {
    version: EXPORT_FORMAT_VERSION,
    exportDate: new Date().toISOString(),
    config: config,
  };
  const content = JSON.stringify(data, null, 2);
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `adlaire-portal-config-${new Date().toISOString().split("T")[0]}.json`;
  a.click();
  URL.revokeObjectURL(url);
  alert("✅ JSON形式でエクスポートしました!\n\nこのファイルをバックアップとして保管できます。");
}

// JSON形式でインポート
function importJSON(): void {
  document.getElementById("import-file")!.click();
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

interface HistoryEntrySummary {
  id: number;
  changedAt: string;
}

// 変更履歴パネルを開き、一覧(新しい順)を取得して表示する(SPEC.md §4.7, §5.2.2)。
async function openHistory(): Promise<void> {
  const modal = document.getElementById("history-modal")!;
  const listEl = document.getElementById("history-list")!;
  listEl.innerHTML = "読み込み中...";
  modal.style.display = "flex";
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
        (entry) =>
          `<div class="history-row"><span>${escapeHtml(new Date(entry.changedAt).toLocaleString("ja-JP"))}</span><button class="btn" style="background:#e8f5f0; color:#00a968; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold;" onclick="restoreHistory(${entry.id})">この内容を確認</button></div>`,
      )
      .join("");
  } catch (error) {
    listEl.innerHTML = `<div class="history-empty">❌ ${escapeHtml((error as Error).message)}</div>`;
  }
}

function closeHistory(): void {
  document.getElementById("history-modal")!.style.display = "none";
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

  pushUndo();
  parsed.forEach((item) => {
    config.categories[catIdx].links.push({ name: item.name, url: item.url, icon: "📄" });
  });
  linkCheckResults = null;
  closeBulkImport();
  renderForm();
  updatePreview();
  updateStorageStatus(`📋 ${parsed.length}件のリンクを一括追加しました (未保存)`);
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
  moveCat,
  moveLink,
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
  delLink,
  addLink,
  checkLinks,
  saveToServer,
  exportJSON,
  importJSON,
  handleImportFile,
  resetToDefault,
  openHistory,
  closeHistory,
  restoreHistory,
  openBulkImport,
  closeBulkImport,
  applyBulkImport,
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
