// Adlaire Portal System - Denoサーバー
// 静的ファイル(public/配下)の配信と、設定データのREST APIを提供する。

import { serveDir } from "jsr:@std/http@^1.1.3/file-server";
import { fromFileUrl } from "jsr:@std/path@^1.1.6";
import { getConfig, replaceConfig, resetToSeed } from "./db.ts";

const PORT = Number(Deno.env.get("PORT") ?? "3000");
const PUBLIC_DIR = fromFileUrl(new URL("../public/", import.meta.url));
const MAX_BODY_BYTES = 1024 * 1024; // 1MB

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function readJsonBody(req: Request): Promise<unknown> {
  const contentLength = req.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_BODY_BYTES) {
    throw new Error("リクエストボディが大きすぎます");
  }
  return await req.json();
}

async function handleApi(req: Request, url: URL): Promise<Response> {
  if (url.pathname === "/api/config" && req.method === "GET") {
    const config = getConfig();
    if (!config) {
      return jsonResponse({ error: "設定データが見つかりません" }, 404);
    }
    return jsonResponse(config);
  }

  if (url.pathname === "/api/config" && req.method === "PUT") {
    try {
      const body = await readJsonBody(req);
      const updated = replaceConfig(body);
      return jsonResponse(updated);
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 400);
    }
  }

  if (url.pathname === "/api/config/reset" && req.method === "POST") {
    try {
      const reset = resetToSeed();
      return jsonResponse(reset);
    } catch (err) {
      return jsonResponse({ error: (err as Error).message }, 500);
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
