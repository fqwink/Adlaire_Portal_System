# Adlaire ポータルシステム

## 📌 概要
**Adlaire Portal System**は、Deno + TypeScript + SQLiteデータベースで動作する社内ポータルシステムです。
社内でよく使うリンクをカテゴリ別に整理して表示・編集できます。

> 📖 **機能・API・データベース・セキュリティなどの詳細な仕様は、すべて [`SPEC.md`](./SPEC.md)（マスター仕様書）に記載しています。**
> 本READMEはセットアップ・運用手順のみを扱います。仕様に関する疑問は必ず`SPEC.md`を参照してください。

> ⚙️ **実装はすべてTypeScript(`src/`配下)が正本です。** バックエンド・フロントエンドを問わず、
> 実行時に使うJavaScript(`dist/`・`public/js/`配下)は `deno task build` によってTypeScriptから自動生成されます。
> 生成されたJavaScriptファイルを直接編集しないでください。

## 🚀 セットアップ

```bash
deno task build   # 依存インストール不要。src/*.ts から dist/server.js, public/js/*.js を生成
deno task start
```
サーバーが起動したら、ブラウザで以下のURLを開きます（既定ポートは3000）。
- 閲覧画面: `http://localhost:3000/portal.html`
- 編集画面: `http://localhost:3000/edit.html`

まとめて実行したい場合は `deno task serve`（build + start）を使います。ポートを変更したい場合は `PORT` 環境変数を指定してください。
```bash
PORT=8080 deno task start
```

Denoのインストールがまだの場合:
```bash
curl -fsSL https://deno.land/install.sh | sh
deno --version   # v2.9以上推奨
```

> ℹ️ `jsr:@db/sqlite` はDeno FFIを利用するため、`deno task start`実行時に `--allow-ffi` 等の権限フラグが付与されます
> （`deno.json`のタスク定義に含まれているため、通常は意識する必要はありません）。

初回起動時、データベースファイル（`data/portal.db`）が自動的に作成され、初期データ（`src/portal-config.json`）で初期化されます。

## 🛠️ 基本的な使い方
1. `edit.html` をブラウザで開きます（データベースから現在の設定を自動的に読み込みます）
2. 左側のエディタでリンクやカテゴリを編集します
3. 右側のプレビューで即座に確認できます
4. 「💾 保存 (データベースに保存)」ボタンをクリック
5. `portal.html` を再読み込みすると変更が即座に反映されます

他の人が先に保存していた場合、保存時に競合が通知され最新の内容を再取得します（編集内容は失われるため、
長時間の編集の前に「📤 エクスポート」でバックアップを取ることを推奨します）。
また「🔗 リンクをチェック」ボタンで、画面上の全リンクの到達可否をその場で確認できます（結果はDBには保存されません）。

操作の詳細（各ボタンの挙動、バリデーション仕様など）は [`SPEC.md`](./SPEC.md) の「5. 画面仕様」を参照してください。

## 🔧 開発時のコマンド
```bash
deno task dev              # ビルドせず src/server.ts を直接実行 + ファイル変更監視
deno task check              # 型チェックのみ実行
deno task validate-config    # src/portal-config.json (シードデータ) の検証のみ実行
```

## 🔒 運用上の注意
- 編集画面のAPIには認証がありません。**信頼できる社内ネットワーク内でのみ運用してください**
- 詳細は [`SPEC.md`](./SPEC.md) の「7. セキュリティ仕様」を参照してください

## 🆘 トラブルシューティング

### Q. `portal.html` を開いてもデータが表示されない
A. サーバー（`deno task start`）が起動しているか確認してください。ブラウザから直接HTMLファイルを開く
   （`file://`）のではなく、`http://localhost:3000/portal.html` のようにサーバー経由でアクセスする必要があります。

### Q. 保存したのに変更が反映されない
A. 「保存」ボタンを押した後、`portal.html` を再読み込みしてください。
   それでも反映されない場合は、ブラウザのコンソールやサーバーのログにエラーが出ていないか確認してください。

### Q. `src/portal-config.json` を編集したのに反映されない
A. このファイルは**初回起動時のシードデータ**であり、2回目以降の起動では参照されません。
   既にデータベース（`data/portal.db`）が存在する場合、編集内容を反映するには編集画面の
   「🔄 デフォルトに戻す」を使うか、`data/portal.db` を削除して再起動してください。

### Q. 編集画面でプレビューが表示されない
A. サーバーが起動しており、`/api/config` が正しく応答しているか確認してください
   （ブラウザで直接 `http://localhost:3000/api/config` を開いてJSONが返るかチェックできます）。

### Q. インポートしたファイルが読み込めない
A. 正しいJSON形式のファイルか確認してください。
   「📤 エクスポート」ボタンで出力したファイルのみインポート可能です。

### Q. `ExperimentalWarning` や `deno bundle is experimental` という警告が出る
A. `jsr:@db/sqlite`（Deno組み込みではなくFFIベースのSQLiteライブラリ）および`deno bundle`コマンドが
   実験的機能であるための警告です。動作には影響ありません。

## 📄 ライセンス
このシステムは独自開発のため、自由にカスタマイズ・配布できます。

## ℹ️ バージョン情報
- **Version**: 5.3
- **Name**: Adlaire Portal System

変更履歴は [`SPEC.md`](./SPEC.md) の「10. 変更履歴」に記載しています。

---

**Adlaire Portal System** v5.3
© 2026 All Rights Reserved
