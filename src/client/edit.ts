// Adlaire Portal System - 編集画面 (edit.html) のクライアントロジック
// ビルド後、public/js/edit.js として edit.html から読み込まれる。
// edit.html は生成したHTML内で onclick="..." / oninput="..." 属性から
// 各関数を直接呼び出すため、必要な関数は末尾で globalThis に公開している。
//
// サーバー・データベースは存在しない(静的ホスティング)ため、本画面はあくまで
// ローカルの編集補助ツールという位置づけ。「保存」操作はサーバーへの永続化ではなく、
// src/portal-config.ts を置き換えるためのTypeScriptファイルを生成してダウンロードする。
// 生成したファイルで src/portal-config.ts を上書きし、コミット後に
// `deno task build` で再ビルド・再デプロイして初めて公開内容に反映される。
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />

import type { Category, LinkItem, NewsItem, PortalConfig } from "../types.ts";
import { PORTAL_CONFIG } from "../portal-config.ts";
import { validateConfig } from "../validate.ts";

function updateStorageStatus(message: string): void {
  const statusEl = document.getElementById("storage-status");
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function normalizeConfig(c: PortalConfig): PortalConfig {
  if (c.news && !Array.isArray(c.news)) {
    c.news = [{ date: "News", text: String(c.news) }];
  }
  if (!c.news) c.news = [];
  return c;
}

// 編集セッションの初期値は、ビルド時にバンドルされた現在の src/portal-config.ts の内容
let config: PortalConfig = normalizeConfig(structuredClone(PORTAL_CONFIG));

function generateConfigFileSource(c: PortalConfig): string {
  return `// Adlaire Portal System - 設定データ (フラットファイル)
//
// このファイルが設定の唯一の正本です。サーバーもデータベースも存在しないため、
// ポータルの内容(タイトル・お知らせ・カテゴリ・リンク)を変更する場合は、
// このファイルを直接編集してコミットし、\`deno task build\` で再ビルドの上、
// 静的ホスティング先へ再デプロイしてください。
//
// public/edit.html は、このファイルを書き換えるための編集内容を組み立てて
// TypeScriptファイルとして書き出すローカル編集ツールです（自動反映はされません）。

import type { PortalConfig } from "./types.ts";

export const PORTAL_CONFIG: PortalConfig = ${JSON.stringify(c, null, 2)};
`;
}

const ICONS = [
  "🔍", "📅", "📂", "📊", "📄", "📝", "🏠", "🏢", "📞", "✉️",
  "💬", "💻", "🔒", "⚠️", "💡", "☕", "🍱", "🏥", "🎉", "🚃",
  "✈️", "🎯", "💼", "📈", "🔧", "⚙️", "🌐", "📱", "🖥️", "🎨",
];

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
  const newsHtml = config.news.length > 0
    ? `<div class="news-box"><div class="news-header">🔔 お知らせ</div><ul class="news-list">
        ${config.news.map((n) => `<li class="news-item"><span class="news-date">${escapeHtml(n.date)}</span><span>${escapeHtml(n.text)}</span></li>`).join("")}
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
  const newsListHtml = config.news
    .map(
      (n, idx) => `
      <div class="row">
        <input type="text" value="${escapeHtml(n.date)}" style="width:90px;" oninput="updateNews(${idx}, 'date', this.value)">
        <input type="text" value="${escapeHtml(n.text)}" style="flex:1;" oninput="updateNews(${idx}, 'text', this.value)">
        <button class="btn btn-icon btn-red" onclick="delNews(${idx})">🗑️</button>
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
    let html = `<div class="box" style="border-left:4px solid ${config.themeColor}"><div class="box-header"><input type="text" value="${escapeHtml(cat.name)}" oninput="updateCat(${cIdx}, this.value)" style="font-weight:bold; width:50%;"><div style="display:flex;"><button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, -1)">⬆️</button><button class="btn btn-icon btn-move" onclick="moveCat(${cIdx}, 1)">⬇️</button><button class="btn btn-icon btn-red" style="margin-left:5px;" onclick="delCat(${cIdx})">🗑️</button></div></div>`;
    cat.links.forEach((link: LinkItem, lIdx: number) => {
      html += `<div class="row"><div style="position:relative;"><input type="text" value="${escapeHtml(link.icon)}" style="width:35px; text-align:center; cursor:pointer;" readonly onclick="togglePalette('pal-${cIdx}-${lIdx}')"><div id="pal-${cIdx}-${lIdx}" class="palette">${ICONS.map((ic) => `<div class="p-icon" onclick="setIcon(${cIdx},${lIdx},'${ic}')">${ic}</div>`).join("")}</div></div><div style="flex:1;"><input type="text" value="${escapeHtml(link.name)}" placeholder="名称" oninput="updateLink(${cIdx},${lIdx},'name',this.value)" style="margin-bottom:3px;"><input type="text" value="${escapeHtml(link.url)}" placeholder="URL" style="font-size:12px; color:#666;" oninput="updateLink(${cIdx},${lIdx},'url',this.value)"></div><div style="display:flex; flex-direction:column; gap:2px;"><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, -1)">⬆️</button><button class="btn btn-icon btn-move" onclick="moveLink(${cIdx}, ${lIdx}, 1)">⬇️</button></div><button class="btn btn-icon btn-red" style="height:auto;" onclick="delLink(${cIdx},${lIdx})">×</button></div>`;
    });
    html += `<button class="btn btn-blue" onclick="addLink(${cIdx})" style="background:${config.themeColor}22; color:${config.themeColor}; border-color:${config.themeColor};">＋ リンクを追加</button></div>`;
    formArea.innerHTML += html;
  });
  formArea.innerHTML += `<button class="btn" style="width:100%; padding:15px; border:2px dashed #ccc; color:#666; font-weight:bold;" onclick="addCat()">＋ 新しいカテゴリを追加</button>`;
}

function update(k: "title" | "themeColor", v: string): void {
  config[k] = v;
  updatePreview();
}
function updateNews(i: number, k: keyof NewsItem, v: string): void {
  config.news[i][k] = v;
  updatePreview();
}
function delNews(i: number): void {
  config.news.splice(i, 1);
  renderForm();
  updatePreview();
}
function addNews(): void {
  const d = new Date();
  const dateStr = `${d.getFullYear()}/${(d.getMonth() + 1).toString().padStart(2, "0")}/${d.getDate().toString().padStart(2, "0")}`;
  config.news.unshift({ date: dateStr, text: "" });
  renderForm();
  updatePreview();
}
function updateCat(i: number, v: string): void {
  config.categories[i].name = v;
  updatePreview();
}
function moveCat(i: number, dir: number): void {
  if (i + dir < 0 || i + dir >= config.categories.length) return;
  [config.categories[i], config.categories[i + dir]] = [config.categories[i + dir], config.categories[i]];
  renderForm();
  updatePreview();
}
function moveLink(c: number, l: number, dir: number): void {
  const links = config.categories[c].links;
  if (l + dir < 0 || l + dir >= links.length) return;
  [links[l], links[l + dir]] = [links[l + dir], links[l]];
  renderForm();
  updatePreview();
}
function togglePalette(id: string): void {
  document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
  const palette = document.getElementById(id);
  if (palette) palette.style.display = "flex";
}
function setIcon(c: number, l: number, ic: string): void {
  config.categories[c].links[l].icon = ic;
  renderForm();
  updatePreview();
  document.querySelectorAll<HTMLElement>(".palette").forEach((el) => (el.style.display = "none"));
}
function delCat(i: number): void {
  if (confirm("このカテゴリを削除しますか?")) {
    config.categories.splice(i, 1);
    renderForm();
    updatePreview();
  }
}
function addCat(): void {
  config.categories.push({ name: "新規カテゴリ", links: [] });
  renderForm();
  updatePreview();
}
function updateLink(c: number, l: number, k: keyof LinkItem, v: string): void {
  config.categories[c].links[l][k] = v;
  updatePreview();
}
function delLink(c: number, l: number): void {
  config.categories[c].links.splice(l, 1);
  renderForm();
  updatePreview();
}
function addLink(c: number): void {
  config.categories[c].links.push({ name: "", url: "", icon: "📄" });
  renderForm();
  updatePreview();
}

// src/portal-config.ts を置き換えるTypeScriptファイルを生成してダウンロードする
function saveToFile(): void {
  try {
    validateConfig(config);
  } catch (error) {
    alert("❌ 保存できません。入力内容にエラーがあります。\n\n" + (error as Error).message);
    return;
  }

  const content = generateConfigFileSource(config);
  const blob = new Blob([content], { type: "text/typescript" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "portal-config.ts";
  a.click();
  URL.revokeObjectURL(url);
  updateStorageStatus("📄 portal-config.ts を生成 (" + new Date().toLocaleTimeString("ja-JP") + ")");
  alert(
    "✅ portal-config.ts を生成しました!\n\n" +
      "ダウンロードしたファイルで src/portal-config.ts を置き換えてコミットし、\n" +
      "`deno task build` で再ビルド・再デプロイすると公開内容に反映されます。",
  );
}

// JSON形式でエクスポート
function exportJSON(): void {
  const data = {
    version: "4.0",
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

      config = normalizeConfig(data.config);

      config.categories.forEach((cat: Category) => {
        if (!cat.name) cat.name = "未設定";
        if (!Array.isArray(cat.links)) cat.links = [];
      });

      renderForm();
      updatePreview();
      updateStorageStatus("📥 インポート完了 (未保存)");
      alert("✅ 設定をインポートしました!\n\n「portal-config.tsを生成」ボタンを押すとファイルに書き出せます。");
    } catch (error) {
      console.error("インポートエラー:", error);
      updateStorageStatus("❌ インポート失敗");
      alert("❌ ファイルの読み込みに失敗しました。\n\nエラー: " + (error as Error).message + "\n\n正しいJSON形式のファイルを選択してください。");
    }
  };
  reader.readAsText(file);
  (event.target as HTMLInputElement).value = ""; // リセット
}

// 編集内容を破棄し、現在ビルドされている src/portal-config.ts の内容に戻す
function resetToDefault(): void {
  if (!confirm("⚠️ 編集中の内容を破棄して、現在の portal-config.ts の内容に戻しますか?\n\nこの操作は取り消せません。")) {
    return;
  }
  config = normalizeConfig(structuredClone(PORTAL_CONFIG));
  renderForm();
  updatePreview();
  updateStorageStatus("🔄 portal-config.ts の内容に戻しました (未保存の編集は破棄されました)");
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
  delNews,
  addNews,
  updateCat,
  moveCat,
  moveLink,
  togglePalette,
  setIcon,
  delCat,
  addCat,
  updateLink,
  delLink,
  addLink,
  saveToFile,
  exportJSON,
  importJSON,
  handleImportFile,
  resetToDefault,
});

// 初期化: ビルド時にバンドルされた portal-config.ts の内容をフォームに反映する
updateStorageStatus("🗄️ ローカル編集モード (サーバーなし)");
renderForm();
updatePreview();
