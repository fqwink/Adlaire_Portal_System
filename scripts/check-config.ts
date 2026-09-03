// Adlaire Portal System - ビルド前チェックスクリプト
// src/portal-config.json が PortalConfig の形式・制約を満たしているかを検証する。
// `deno task build` から呼び出され、不正な場合はビルドを中断する。

import config from "../src/portal-config.json" with { type: "json" };
import { validateConfig } from "../src/validate.ts";

try {
  validateConfig(config);
  console.log("✅ src/portal-config.json は正常です");
} catch (error) {
  console.error("❌ src/portal-config.json が不正です:", (error as Error).message);
  Deno.exit(1);
}
