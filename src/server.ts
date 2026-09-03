// Adlaire Portal System - Denoサーバー
// 静的ファイル(public/配下)の配信と、設定データのREST APIを提供する。

import { serveDir } from "jsr:@std/http@^1.1.3/file-server";
import { fromFileUrl } from "jsr:@std/path@^1.1.6";
import { getConfig, getVersion, replaceConfig, resetToSeed, VersionConflictError } from "./db.ts";
import { isValidUrl } from "./validate.ts";

const PORT = Number(Deno.env.get("PORT") ?? "3000");
const PUBLIC_DIR = fromFileUrl(new URL("../public/", import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024; // 1MB
const LINK_CHECK_TIMEOUT_MS = 5000;
const MAX_LINKS_TO_CHECK = 200;

function jsonResponse(body: unknown, status = 200, version?: number | null): Response {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8" });
  if (version !== undefined && version !== null) {
    headers.set("etag", `"${version}"`);
  }
  return new Response(JSON.stringify(body), { status, headers });
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

  return jsonResponse({ error: "Not Found" }, 404);
}

Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) {
    return await handleApi(req, url);
  }
  return await serveDir(req, { fsRoot: PUBLIC_DIR, quiet: true });
});

console.log(`Adlaire Portal System サーバーを起動しました: http://localhost:${PORT}`);
