// Adlaire Portal System - Express サーバー
// 静的ファイル(portal.html / edit.html)の配信と、設定データのREST APIを提供します。

const express = require("express");
const path = require("node:path");
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/config", (req, res) => {
  const config = db.getConfig();
  if (!config) {
    return res.status(404).json({ error: "設定データが見つかりません" });
  }
  res.json(config);
});

app.put("/api/config", (req, res) => {
  try {
    const updated = db.replaceConfig(req.body);
    res.json(updated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/config/reset", (req, res) => {
  try {
    const reset = db.resetToSeed();
    res.json(reset);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Adlaire Portal System サーバーを起動しました: http://localhost:${PORT}`);
});
