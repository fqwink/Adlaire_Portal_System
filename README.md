# Adlaire ポータルシステム

## 📌 概要
**Adlaire Portal System**は、TypeScriptで実装された**静的サイト**の社内ポータルシステムです。
サーバーやデータベースを必要とせず、ビルドして生成した静的ファイル一式を任意の静的ホスティング
（GitHub Pages、Cloudflare Pages、Netlify、S3など）にアップロードするだけで動作します。

> 📖 **機能・データモデル・セキュリティなどの詳細な仕様は、すべて [`SPEC.md`](./SPEC.md)（マスター仕様書）に記載しています。**
> 本READMEはセットアップ・運用手順のみを扱います。仕様に関する疑問は必ず`SPEC.md`を参照してください。

> ⚙️ **実装はすべてTypeScript(`src/`配下)が正本です。** 配信に使うJavaScript(`public/js/`配下)は
> `deno task build` によってTypeScriptから自動生成されます。生成されたJavaScriptファイルを直接編集しないでください。
>
> 設定データ（タイトル・お知らせ・カテゴリ・リンク）はデータベースではなく、**ソースコード内のフラットファイル
> `src/portal-config.ts` そのもの**です。内容を変更する場合は、このファイルを編集してビルドし直し、
> 静的ホスティング先へ再デプロイしてください。

## 🚀 セットアップ

### 1. Denoのインストール（ビルド時のみ必要）
本番の実行環境（静的ホスティング）にDenoは不要です。ビルド作業を行う開発環境にのみインストールしてください。
```bash
curl -fsSL https://deno.land/install.sh | sh
deno --version   # v2.9以上推奨
```

### 2. ビルド
```bash
deno task build   # src/*.ts から public/js/*.js を生成
```
`public/` ディレクトリ一式（`portal.html`・`edit.html`・`js/`）がそのままデプロイ対象です。

### 3. ローカルでの確認
```bash
deno task preview   # ビルド後、public/ をローカルの簡易サーバーで配信 (既定ポート: 3000)
```
- 閲覧画面: `http://localhost:3000/portal.html`
- 編集補助ツール: `http://localhost:3000/edit.html`

`deno task preview` はあくまで動作確認用の簡易サーバーです。本番では `public/` を静的ホスティングサービスへ
そのままアップロードしてください（サーバーの常時起動は不要です）。

### 4. 型チェック（任意）
```bash
deno task check
```

## 🛠️ 設定内容の変更方法

設定（タイトル・お知らせ・カテゴリ・リンク）は `src/portal-config.ts` というTypeScriptファイルに直接書かれています。
変更するには次のいずれかの方法を使います。

### 方法1: `src/portal-config.ts` を直接編集する（基本）
1. `src/portal-config.ts` を開き、内容を編集します
2. `deno task build` でビルドし、`deno task preview` で見た目を確認します
3. 変更をコミットし、静的ホスティング先へ再デプロイします

### 方法2: 編集補助ツール（`edit.html`）を使う
GUIで編集したい場合は、以下の手順でファイルを生成できます。
1. `deno task preview` を実行し、ブラウザで `edit.html` を開きます
2. 左側のフォームでリンクやカテゴリを編集します（右側にライブプレビューが表示されます）
3. 「📄 portal-config.ts を生成」ボタンを押すと、編集内容を反映したファイルがダウンロードされます
4. ダウンロードした内容で `src/portal-config.ts` を置き換えます
5. 方法1の手順2.〜3.（ビルド確認・コミット・再デプロイ）を行います

**注意**: `edit.html` はサーバーに保存する画面ではありません。「📄 portal-config.ts を生成」ボタンを押すまでの
編集内容はブラウザのタブ内にのみ存在し、どこにも自動保存されません。

操作の詳細（各ボタンの挙動、バリデーション仕様など）は [`SPEC.md`](./SPEC.md) の「5. 画面仕様」を参照してください。

## 🔒 運用上の注意
- `edit.html` は開発者向けのローカル編集補助ツールです。公開する必要はなく、`portal.html` のみを
  本番の静的ホスティングにデプロイする運用を推奨します
- 詳細は [`SPEC.md`](./SPEC.md) の「7. セキュリティ仕様」を参照してください

## 🆘 トラブルシューティング

### Q. `src/portal-config.ts` を編集したのに `portal.html` に反映されない
A. `deno task build` を実行してビルドし直してください。ビルドしただけではローカルの `public/js/*.js` が
   更新されるだけなので、本番環境に反映するにはあらためて静的ホスティング先へ再デプロイする必要があります。

### Q. `edit.html` で編集した内容が消えた
A. `edit.html` は自動保存を行いません。タブを閉じたり再読み込みすると編集内容は失われます。
   作業を中断する場合は、先に「📤 エクスポート (JSON)」でバックアップを取ってください。

### Q. `deno bundle is experimental and subject to changes` という警告が出る
A. `deno task build` が内部で使用している `deno bundle` コマンドが実験的機能であるための警告です。動作には影響ありません。

### Q. 本番環境でもDenoやNode.jsのサーバーを起動しておく必要がありますか?
A. いいえ、不要です。`public/` ディレクトリの中身は純粋な静的ファイルであり、任意の静的ホスティングサービスに
   アップロードするだけで動作します。Denoはビルド時にのみ使用します。

## 📄 ライセンス
このシステムは独自開発のため、自由にカスタマイズ・配布できます。

## ℹ️ バージョン情報
- **Version**: 4.0
- **Name**: Adlaire Portal System

変更履歴は [`SPEC.md`](./SPEC.md) の「10. 変更履歴」に記載しています。

---

**Adlaire Portal System** v4.0
© 2026 All Rights Reserved
