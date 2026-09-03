// Adlaire Portal System - Denoサーバー
// 静的ファイル(public/配下)の配信、設定データのREST API、リンク到達確認API(check-links)、
// クリック集計・変更履歴・ヘルスチェックAPI、DBダウンロード、リンクの定期自動チェックを提供する。

import { serveDir } from "jsr:@std/http@^1.1.3/file-server";
import { fromFileUrl } from "jsr:@std/path@^1.1.6";
import {
  backupDatabase,
  getConfig,
  getHistoryEntry,
  getHistoryList,
  getVersion,
  readDbFileBytes,
  recordClick,
  recordLinkCheckResults,
  replaceConfig,
  resetToSeed,
  VersionConflictError,
} from "./db.ts";
import { isValidUrl } from "./validate.ts";

const PORT = Number(Deno.env.get("PORT") ?? "3000");
const PUBLIC_DIR = fromFileUrl(new URL("../public/", import.meta.url));
const ACCESS_LOG_PATH = new URL("../data/access.log", import.meta.url);
const MAX_BODY_BYTES = 1024 * 1024; // 1MB
const LINK_CHECK_TIMEOUT_MS = 5000;
const MAX_LINKS_TO_CHECK = 200;
const BACKUP_INTERVAL_MINUTES = Number(Deno.env.get("BACKUP_INTERVAL_MINUTES") ?? "60");
const LINK_CHECK_INTERVAL_MINUTES = Number(Deno.env.get("LINK_CHECK_INTERVAL_MINUTES") ?? "360");
const SERVER_START_TIME = Date.now();

function jsonResponse(body: unknown, status = 200, version?: number | null): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (version !== undefined && version !== null) {
    headers.set("etag", `"${version}"`);
  }
  return new Response(JSON.stringify(body), { status, headers });
}

// アクセスログ/エラーログを標準出力と data/access.log の両方に出力する(SPEC.md §8)。
// ログ書き込み自体の失敗はリクエスト処理を妨げないよう握りつぶす。
function logLine(line: string): void {
  console.log(line);
  Deno.writeTextFile(ACCESS_LOG_PATH, line + "\n", { append: true, create: true }).catch(() => {});
}

async function readJsonBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new Error("リクエストボディが大きすぎます");
  }
  return await req.json();
}

function parseIfMatch(req: Request): number | undefined {
  const header = req.headers.get("if-match");
  if (!header) return undefined;
  const n = Number(header.replace(/"/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

interface LinkCheckResult {
  url: string;
  ok: boolean;
  status: number | null;
  error: string | null;
}

async function checkOneLink(url: string): Promise<LinkCheckResult> {
  if (!isValidUrl(url)) {
    return { url, ok: false, status: null, error: "URLの形式が不正です" };
  }
  for (const method of ["HEAD", "GET"] as const) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LINK_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch(url, { method, signal: controller.signal, redirect: "follow" });
      clearTimeout(timeout);
      // 一部のサーバーはHEADを許可しない(405)ため、その場合のみGETで再試行する
      if (res.status === 405 && method === "HEAD") continue;
      return { url, ok: res.ok, status: res.status, error: null };
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof DOMException && err.name === "AbortError"
        ? "タイムアウトしました"
        : (err as Error).message;
      return { url, ok: false, status: null, error: message };
    }
  }
  return { url, ok: false, status: null, error: "確認に失敗しました" };
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/healthz" && req.method === "GET") {
    return jsonResponse({ status: "ok", uptimeSeconds: Math.round((Date.now() - SERVER_START_TIME) / 1000) });
  }

  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = getConfig();
    if (!config) {
      return jsonResponse({ error: "設定データが見つかりません" }, 404);
    }
    return jsonResponse(config, 200, getVersion());
  }

  if (url.pathname === "/api/config" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const expectedVersion = parseIfMatch(req);
      const updated = replaceConfig(body, expectedVersion);
      return jsonResponse(updated, 200, getVersion());
    } catch (err) {
      if (err instanceof VersionConflictError) {
        return jsonResponse({ error: err.message }, 409);
      }
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  if (url.pathname === "/api/config/reset" && req.method === "POST") {
    try {
      const reset = resetToSeed();
      return jsonResponse(reset, 200, getVersion());
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 500);
    }
  }

  if (url.pathname === "/api/check-links" && req.method === "POST") {
    try {
      const body = await readJsonBody(req) as { urls?: unknown };
      if (!Array.isArray(body.urls)) {
        throw new Error("urls配列を指定してください");
      }
      if (body.urls.length > MAX_LINKS_TO_CHECK) {
        throw new Error(`一度に確認できるリンク数は${MAX_LINKS_TO_CHECK}件までです`);
      }
      const results = await Promise.all(
        body.urls.map((u) => checkOneLink(typeof u === "string" ? u : "")),
      );
      return jsonResponse({ results });
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  if (url.pathname === "/api/click" && req.method === "POST") {
    try {
      const body = await readJsonBody(req) as { url?: unknown };
      if (typeof body.url !== "string" || !isValidUrl(body.url)) {
        throw new Error("urlが不正です");
      }
      recordClick(body.url);
      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  if (url.pathname === "/api/history" && req.method === "GET") {
    return jsonResponse({ entries: getHistoryList() });
  }

  const historyEntryMatch = url.pathname.match(/^\/api\/history\/(\d+)$/);
  if (historyEntryMatch && req.method === "GET") {
    const entry = getHistoryEntry(Number(historyEntryMatch[1]));
    if (!entry) {
      return jsonResponse({ error: "指定された変更履歴が見つかりません" }, 404);
    }
    return jsonResponse(entry);
  }

  if (url.pathname === "/api/backup/download" && req.method === "GET") {
    try {
      const bytes = await readDbFileBytes();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      return new Response(new Blob([new Uint8Array(bytes)]), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="portal-${timestamp}.db"`,
        },
      });
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 500);
    }
  }

  return jsonResponse({ error: "Not Found" }, 404);
}

Deno.serve({ port: PORT }, async (req) => {
  const start = performance.now();
  const url = new URL(req.url);
  let res: Response;
  try {
    if (url.pathname.startsWith("/api/") || url.pathname === "/healthz") {
      res = await handleApi(req, url);
    } else {
      res = await serveDir(req, { fsRoot: PUBLIC_DIR, quiet: true });
    }
  } catch (err) {
    console.error(err);
    logLine(`${new Date().toISOString()} ERROR ${req.method} ${url.pathname} - ${(err as Error).message}`);
    res = jsonResponse({ error: "Internal Server Error" }, 500);
  }
  const durationMs = Math.round(performance.now() - start);
  logLine(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.status} ${durationMs}ms`);
  return res;
});

// data/portal.db の定期バックアップ(SPEC.md §2.3)。BACKUP_INTERVAL_MINUTES=0 で無効化できる。
if (BACKUP_INTERVAL_MINUTES > 0) {
  backupDatabase().catch((err) => console.error("初回バックアップに失敗しました:", err));
  setInterval(() => {
    backupDatabase().catch((err) => console.error("定期バックアップに失敗しました:", err));
  }, BACKUP_INTERVAL_MINUTES * 60 * 1000);
}

// 全リンクの定期自動チェック(SPEC.md §5.1.2)。手動チェック(POST /api/check-links)とは別に、
// サーバー側で定期的に到達可否を確認し、結果を閲覧画面のバッジ表示に使う。
// LINK_CHECK_INTERVAL_MINUTES=0 で無効化できる。
async function runScheduledLinkCheck(): Promise<void> {
  const config = getConfig();
  if (!config) return;
  const urls = config.categories.flatMap((cat) => cat.links.map((link) => link.url));
  if (urls.length === 0) return;
  const results = await Promise.all(
    urls.map(async (url) => ({ url, ok: (await checkOneLink(url)).ok })),
  );
  recordLinkCheckResults(results);
}

if (LINK_CHECK_INTERVAL_MINUTES > 0) {
  runScheduledLinkCheck().catch((err) => console.error("初回の定期リンクチェックに失敗しました:", err));
  setInterval(() => {
    runScheduledLinkCheck().catch((err) => console.error("定期リンクチェックに失敗しました:", err));
  }, LINK_CHECK_INTERVAL_MINUTES * 60 * 1000);
}

console.log(`Adlaire Portal System サーバーを起動しました: http://localhost:${PORT}`);
