# Adlaire ポータルシステム

## 📌 概要
**Adlaire Portal System**は、Deno + TypeScript + SQLiteデータベースで動作する社内ポータルシステムです。
社内でよく使うリンクをカテゴリ別に整理して表示・編集できます。

> 📖 **機能・API・データベース・セキュリティなどの詳細な仕様は、すべて [`SPEC.md`](./SPEC.md)（マスター仕様書）に記載しています。**
> 本READMEはセットアップ・運用手順のみを扱います。仕様に関する疑問は必ず`SPEC.md`を参照してください。

> ⚙️ **実装はすべてTypeScript(`src/`配下)が正本です。** 実行時に使われるJavaScript(`dist/`・`public/js/`配下)は
> `deno task build` によってTypeScriptから自動生成されます。生成されたJavaScriptファイルを直接編集しないでください。

## 🚀 セットアップ

### 1. Denoのインストール
[Denoの公式サイト](https://deno.com/)の手順に従ってインストールしてください（`v2.9`以上推奨）。
```bash
curl -fsSL https://deno.land/install.sh | sh
deno --version
```

### 2. ビルド & 起動
```bash
deno task build   # TypeScript(src/) からJavaScript(dist/, public/js/)を生成
deno task start    # 生成したJavaScriptでサーバーを起動 (既定ポート: 3000)

# まとめて実行する場合
deno task serve
```
サーバーが起動したら、ブラウザで以下のURLを開きます。
- 閲覧画面: `http://localhost:3000/portal.html`
- 編集画面: `http://localhost:3000/edit.html`

ポートを変更したい場合は `PORT` 環境変数を指定してください。
```bash
PORT=8080 deno task start
```

初回起動時、データベースファイル（`data/portal.db`）が自動的に作成され、初期データ（`src/seed-data.ts`）で初期化されます。

### 3. 開発時のコマンド
```bash
deno task dev     # ビルドせずTypeScriptを直接実行し、ファイル変更を監視 (開発用)
deno task check    # 型チェックのみ実行
```

## 🛠️ 基本的な使い方
1. `edit.html` をブラウザで開きます（データベースから現在の設定を自動的に読み込みます）
2. 左側のエディタでリンクやカテゴリを編集します
3. 右側のプレビューで即座に確認できます
4. 「💾 保存 (データベースに保存)」ボタンをクリック
5. `portal.html` を再読み込みすると変更が即座に反映されます

操作の詳細（各ボタンの挙動、バリデーション仕様など）は [`SPEC.md`](./SPEC.md) の「5. 画面仕様」を参照してください。

## 🔒 運用上の注意
- 編集画面のAPIには認証がありません。**信頼できる社内ネットワーク内でのみ運用してください**
- 詳細は [`SPEC.md`](./SPEC.md) の「6. セキュリティ仕様」を参照してください

## 🆘 トラブルシューティング

### Q. `portal.html` を開いてもデータが表示されない
A. サーバー（`deno task start`）が起動しているか確認してください。ブラウザから直接HTMLファイルを開く
   （`file://`）のではなく、`http://localhost:3000/portal.html` のようにサーバー経由でアクセスする必要があります。

### Q. 保存したのに変更が反映されない
A. 「保存」ボタンを押した後、`portal.html` を再読み込みしてください。
   それでも反映されない場合は、ブラウザのコンソールやサーバーのログにエラーが出ていないか確認してください。

### Q. 編集画面でプレビューが表示されない
A. サーバーが起動しており、`/api/config` が正しく応答しているか確認してください
   （ブラウザで直接 `http://localhost:3000/api/config` を開いてJSONが返るかチェックできます）。

### Q. インポートしたファイルが読み込めない
A. 正しいJSON形式のファイルか確認してください。
   「📤 エクスポート」ボタンで出力したファイルのみインポート可能です。

### Q. `src/`を編集したのに反映されない
A. `deno task start` は`dist/`・`public/js/`配下のビルド済みJavaScriptを実行します。
   `src/`配下のTypeScriptを編集した後は `deno task build` を実行してから起動し直してください。
   常にビルド→起動をまとめて行いたい場合は `deno task serve` を使うか、開発中は `deno task dev` を使ってください。

### Q. `deno bundle is experimental and subject to changes` という警告が出る
A. `deno task build` が内部で使用している `deno bundle` コマンドが実験的機能であるための警告です。動作には影響ありません。

## 📄 ライセンス
このシステムは独自開発のため、自由にカスタマイズ・配布できます。

## ℹ️ バージョン情報
- **Version**: 3.0
- **Name**: Adlaire Portal System

変更履歴は [`SPEC.md`](./SPEC.md) の「9. 変更履歴」に記載しています。

---

**Adlaire Portal System** v3.0
© 2026 All Rights Reserved
