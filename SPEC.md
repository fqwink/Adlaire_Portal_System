# Adlaire Portal System - マスター仕様書

本ドキュメントは Adlaire Portal System の**唯一の仕様の正**（Single Source of Truth）です。
機能仕様・データモデル・API仕様・画面仕様・セキュリティ仕様など、システムに関するすべての仕様はこのファイルに記載します。
他のドキュメント（README等）やコード中のコメントで仕様について触れる場合も、詳細はこのファイルを参照してください。
仕様を変更する場合は、実装の変更とあわせて必ず本ファイルを更新すること。

- **システム名**: Adlaire Portal System
- **バージョン**: 5.3
- **最終更新**: 2026-09-03

---

## 1. システム概要

Deno + TypeScript + SQLiteデータベースで動作する社内ポータルシステム。
社内でよく使うリンクをカテゴリ別に整理して一覧表示する「閲覧画面」と、その内容を編集する「編集画面」の2画面で構成される。
設定データ（タイトル・テーマカラー・お知らせ・カテゴリ・リンク）は SQLite データベースに保存され、
サーバーを起動しておけば複数のブラウザ・端末から同一のデータを参照できる。

**すべてのソースコードはTypeScript(`src/`配下)が正本であり、実行時に使用するJavaScript(`dist/`・`public/js/`配下)は
ビルド（`deno task build`）によってTypeScriptから生成される。生成されたJavaScriptを直接編集してはならない。**
バックエンド・フロントエンドを問わず、新しいコードは必ずTypeScriptで書き、ビルドでJavaScriptを生成する方式に統一する。

**バックエンドの実行環境は、ビルドで生成されたJavaScript（`dist/server.js`）である。** 本番運用（`deno task start` /
`deno task serve`）は必ず `dist/server.js` を実行し、TypeScriptソース（`src/server.ts`等）を直接実行しない。
`deno task dev` は `src/server.ts` を直接実行するが、これは開発時にビルド待ちなしで動作確認するための利便機能に
過ぎず、本番運用の方式ではない。

データベースの初期値（初回起動時のシードデータ）は `src/portal-config.json` というJSONファイルで管理する。
これは「唯一の設定の正本」ではなく「初期値」である点に注意（詳細は §3、§4）。

### 1.1 対象範囲
- 閲覧画面（`public/portal.html` + `src/client/portal.ts`）
- 編集画面（`public/edit.html` + `src/client/edit.ts`）
- バックエンドサーバー（`src/server.ts`）
- データアクセス層（`src/db.ts`）
- バリデーション（`src/validate.ts`）
- 共有型定義（`src/types.ts`）
- 初期シードデータ（`src/portal-config.json`）

### 1.2 非対象範囲（現時点で実装しない）
- ユーザー認証・アクセス制御
- クリック履歴、アクセス統計（将来拡張候補。実装する場合も§1.3の制約に従うこと）

複数ユーザーの同時編集については、`settings.version`によるバージョン番号を用いた楽観的排他制御（§4.2）を実装している。
自分が読み込んだ後に他の人が先に保存していた場合、`PUT /api/config`は`409`を返し上書きを拒否する（誰の変更を残すかを
自動でマージする機能ではなく、後から保存しようとした側に競合を通知し、最新内容を再取得させる方式）。

### 1.3 設計制約: LocalStorage等のブラウザ内永続化の禁止
**LocalStorage・sessionStorage・IndexedDB・Cookie等、ブラウザ内にデータを永続化する仕組みに依存する仕様・機能は、
理由の如何を問わず一切禁止とする。** 閲覧者ごとの個人的な状態（お気に入り、クリック履歴、閲覧設定の記憶等）を
ブラウザ内保存で実現する機能は提案・実装しない。

理由: バックエンド（SQLiteデータベース）は存在するが、これは「編集者が管理する共有データ」を保存する場所であり、
「閲覧者個人の状態」を保存する場所ではない。閲覧者ごとの認証・セッション管理を新たに導入しない限り、
サーバー側で個人を識別する手段もない。ブラウザ内保存を許すと、閲覧者ごと・端末ごとに異なる「隠れた状態」が生まれ、
「データベースを見れば全ての表示内容が再現できる」という単純さが失われる。新機能を検討する際は、この制約を
先に確認し、ブラウザ内保存なしで実現できる形に限定すること。

考え方: 「お気に入り」等、閲覧者ごとの個人状態に見える要件でも、**編集者があらかじめデータベースに指定する、
全閲覧者共通の静的データ**として代替できる場合がある。機能要件を「個人ごとの状態」から「編集者が管理する共有データ」
に置き換えられないか、まず検討すること。閲覧者ごとの真の個人化がどうしても必要な場合は、認証・セッション管理の
導入を別途検討する（本ファイル未策定）。

---

## 2. システム構成

```
adlaire_portal/
├── deno.json          # Denoタスク定義 (ビルド/起動/開発/型チェック)・コンパイラオプション
├── deno.lock            # 依存関係ロックファイル
├── src/                  # TypeScript正本 (すべての実装はここを変更する)
│   ├── types.ts          # 共有型定義 (PortalConfig等)
│   ├── validate.ts        # 設定データのバリデーション
│   ├── portal-config.json  # 初回起動時のシードデータ (JSON)
│   ├── db.ts               # SQLiteデータアクセス層 (jsr:@db/sqlite)
│   ├── server.ts            # Denoサーバー本体 (静的配信 + REST API)
│   └── client/
│       ├── portal.ts         # 閲覧画面のクライアントロジック
│       └── edit.ts            # 編集画面のクライアントロジック
├── scripts/
│   └── check-config.ts    # ビルド前に portal-config.json (シード) を検証するスクリプト
├── public/
│   ├── portal.html        # 閲覧画面 (HTML/CSSのみ。ロジックはjs/portal.jsを読み込む)
│   ├── edit.html            # 編集画面 (同上、js/edit.jsを読み込む)
│   └── js/                    # ビルド生成物 (自動生成・gitignore対象・直接編集禁止)
│       ├── portal.js
│       └── edit.js
├── dist/
│   └── server.js             # ビルド生成物 (src/server.tsのバンドル。自動生成・gitignore対象)
├── data/
│   └── portal.db              # SQLiteデータベースファイル (自動生成・gitignore対象)
├── README.md                  # セットアップ・運用ガイド
└── SPEC.md                    # 本ファイル (マスター仕様書)
```

### 2.1 技術スタック
| 項目 | 内容 |
|---|---|
| 言語（正本） | TypeScript（`src/`配下すべて。strict モード） |
| 実行時生成物 | JavaScript（`deno bundle`によりTypeScriptから生成。`dist/`・`public/js/`配下） |
| 実行環境 | Deno v2.9以上 |
| HTTPサーバー | Deno標準API（`Deno.serve`）+ `jsr:@std/http`（静的ファイル配信） |
| データベース | SQLite（`jsr:@db/sqlite`。FFI経由でネイティブsqlite3を利用） |
| フロントエンド | TypeScriptをビルドしたプレーンJavaScript（フレームワーク不使用） |
| 通信 | フロントエンド ⇔ バックエンド間はJSON REST API (`fetch`) |

### 2.2 ビルド・起動方法
```bash
deno task build   # portal-config.jsonの検証 → src/*.ts から dist/server.js, public/js/*.js を生成
deno task start   # dist/server.js を実行 (既定ポート: 3000)
deno task serve   # build + start をまとめて実行

PORT=8080 deno task start   # ポートを変更する場合

deno task dev      # ビルドせず src/server.ts を直接実行 + ファイル変更監視 (開発用)
deno task check    # 型チェックのみ実行 (ビルドしない)
deno task validate-config   # portal-config.json (シード) の検証のみ実行
```
初回起動時、`data/portal.db` が存在しなければ自動生成し、`src/portal-config.json` の内容で初期化する
（`src/db.ts` の `ensureSeeded()`）。**2回目以降の起動では `portal-config.json` の内容は参照されない。**
DBが既に存在する状態でこのファイルを書き換えても、明示的に「デフォルトに戻す」操作（§5.2.2）を行わない限り
反映されない。

> ℹ️ `src/client/portal.ts` / `src/client/edit.ts` はブラウザで実行されるコードのため、
> `deno bundle --platform browser --format iife` でプレーンJavaScript（IIFE形式）にコンパイルし、
> `public/js/portal.js` / `public/js/edit.js` として出力する。
> `src/server.ts` / `src/db.ts` はDenoランタイム上で実行されるコードのため、
> `deno bundle --platform deno` で `dist/server.js` に単一ファイルとしてバンドルする。

---

## 3. データモデル / DBスキーマ

SQLite (`data/portal.db`) に以下4テーブルで正規化して保存する。

### 3.1 `settings`（1行のみ）
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY, CHECK(id=1) | 常に1固定（単一設定のみ許容） |
| title | TEXT | NOT NULL | ポータルのタイトル |
| theme_color | TEXT | NOT NULL | テーマカラー（`#rrggbb`形式） |
| version | INTEGER | NOT NULL DEFAULT 1 | 楽観的排他制御用のバージョン番号。`PUT /api/config`で更新するたびに1つ進む（§4.2参照） |

### 3.2 `news`
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| date | TEXT | NOT NULL | 表示用の日付文字列（形式自由、例: `2026/02/14`） |
| text | TEXT | NOT NULL | お知らせ本文 |
| sort_order | INTEGER | NOT NULL | 表示順（昇順） |

### 3.3 `categories`
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| name | TEXT | NOT NULL | カテゴリ名 |
| sort_order | INTEGER | NOT NULL | 表示順（昇順） |

### 3.4 `links`
| カラム | 型 | 制約 | 説明 |
|---|---|---|---|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | |
| category_id | INTEGER | NOT NULL, REFERENCES categories(id) ON DELETE CASCADE | 所属カテゴリ |
| name | TEXT | NOT NULL | リンク名 |
| url | TEXT | NOT NULL | リンクURL |
| icon | TEXT | NOT NULL | 絵文字アイコン1文字 |
| sort_order | INTEGER | NOT NULL | カテゴリ内での表示順（昇順） |

### 3.5 論理データ構造（API入出力形式）
API（`/api/config`）は上記テーブルを以下のJSON構造に組み立てて返す。編集画面の内部状態（`config`変数）もこの形式に一致する。
`src/portal-config.json`（シードデータ）も同じ形式で記述する。

```json
{
  "title": "Adlaireポータル",
  "themeColor": "#00a968",
  "news": [
    { "date": "2026/02/14", "text": "お知らせ内容" }
  ],
  "categories": [
    {
      "name": "カテゴリ名",
      "links": [
        { "name": "リンク名", "url": "https://example.com", "icon": "🔍" }
      ]
    }
  ]
}
```

### 3.6 共有型定義（`src/types.ts`）
```typescript
interface NewsItem {
  date: string;
  text: string;
}

interface LinkItem {
  name: string;
  url: string;
  icon: string;
}

interface Category {
  name: string;
  links: LinkItem[];
}

interface PortalConfig {
  title: string;
  themeColor: string;
  news: NewsItem[];
  categories: Category[];
}
```

---

## 4. API仕様

すべてJSON形式。ベースパスなし（サーバールート直下）。

### 4.1 `GET /api/config`
現在の設定を取得する。

- **リクエストボディ**: なし
- **成功時**: `200 OK`、上記「論理データ構造」のJSONを返す。レスポンスヘッダー `ETag` に現在の設定バージョン（整数、`"1"`のような文字列表現）を付与する
- **失敗時**: 設定データが存在しない場合 `404 Not Found`、`{ "error": "設定データが見つかりません" }`
  - 通常は初回起動時にシードデータで自動初期化されるため発生しない

### 4.2 `PUT /api/config`
設定全体を置き換える（部分更新は不可。常に全項目を送信する）。楽観的排他制御に対応する。

- **リクエストボディ**: 「論理データ構造」と同じJSON
- **リクエストヘッダー**: `If-Match`（任意）— 直前に`GET`で取得した`ETag`の値をそのまま指定する。指定した場合、サーバー側の現在のバージョンと一致しない（＝自分が読み込んだ後に他の変更が保存された）ときは更新を拒否する。省略した場合はバージョンチェックを行わない
- **処理**: サーバー側で §6 のバリデーションおよび`If-Match`の検証を実施した後、`settings`のバージョンを1つ進めつつ更新し、`news`/`categories`/`links`を全削除してから再挿入する（トランザクション内で実行、失敗時はロールバック）
- **成功時**: `200 OK`、更新後の設定をJSONで返す。レスポンスヘッダー `ETag` に更新後の新しいバージョンを付与する
- **失敗時**:
  - バリデーションエラー時は `400 Bad Request`、`{ "error": "<エラーメッセージ>" }`
  - `If-Match`のバージョンが現在のDBのバージョンと一致しない場合は `409 Conflict`、`{ "error": "<競合を説明するメッセージ>" }`（更新は適用されない）

### 4.3 `POST /api/config/reset`
データベースの内容を `src/portal-config.json` の内容にリセットする（`PUT`と同じ置き換え処理をシードデータに対して実行）。`If-Match`によるバージョンチェックは行わない（確認ダイアログを経た明示的な操作のため）。

- **リクエストボディ**: なし
- **成功時**: `200 OK`、リセット後の設定をJSONで返す。レスポンスヘッダー `ETag` に更新後のバージョンを付与する
- **失敗時**: `500 Internal Server Error`、`{ "error": "<エラーメッセージ>" }`

### 4.4 `POST /api/check-links`
指定されたURL群それぞれについて、サーバーからHEADリクエスト（405が返る場合はGETで再試行）を送信し、到達可否を確認する。
DBへの読み書きは一切行わない、その場限りの確認用エンドポイント。

- **リクエストボディ**: `{ "urls": string[] }`（最大200件。超過時は`400`）
- **成功時**: `200 OK`、`{ "results": [{ "url": string, "ok": boolean, "status": number | null, "error": string | null }] }`（`urls`と同じ順序）
  - `url`がURL検証（§7.2）を満たさない場合は、通信を行わず `ok: false, status: null, error: "URLの形式が不正です"` を返す
  - 通信タイムアウトは5秒。タイムアウト・DNS失敗等のネットワークエラー時は `ok: false, status: null, error: "<エラー内容>"` を返す
- **失敗時**: `urls`が配列でない、または200件を超える場合は `400 Bad Request`、`{ "error": "<エラーメッセージ>" }`

### 4.5 入力サイズ制限
APIリクエストボディは `Content-Length` ヘッダーをもとに最大1MBに制限される（`src/server.ts` `readJsonBody()`）。

---

## 5. 画面仕様

### 5.1 閲覧画面（`public/portal.html`）

#### 5.1.1 画面構成
- **サイドバー**: ロゴ、今日の日付、カテゴリ一覧ナビゲーション（各カテゴリのリンク件数バッジ付き）
- **メインエリア**:
  - エラー表示欄（API取得失敗時のみ表示）
  - お知らせ欄（お知らせが1件以上ある場合のみ表示）
  - 検索ボックス
  - カテゴリ別リンクカードのグリッド表示
  - フッター（バージョン表記）

#### 5.1.2 機能仕様
| 機能 | 仕様 |
|---|---|
| データ読み込み | ページロード時に `GET /api/config` をfetchし、取得したJSONを`renderPortal()`でDOMに描画する。失敗時はエラー欄を表示する |
| ナビゲーション | サイドバーのカテゴリリンクをクリックすると、該当セクションへスムーズスクロールする（アンカーリンクの既定動作は`preventDefault`） |
| お知らせ表示 | `news`配列を日付+本文で一覧表示。0件の場合は欄ごと非表示。リスト部分は最大高さ120pxでスクロール可能 |
| テーマカラー反映 | `themeColor`からCSS変数 `--primary` を設定し、そこから `--primary-light`（10%不透明度相当のrgba）と`--primary-dark`（RGB各値-30）を自動算出してCSS変数に反映する |
| 日付表示 | サイドバーに `YYYY.MM.DD` 形式で今日の日付をクライアント側で計算して表示 |
| リアルタイム検索 | 検索ボックスへの入力（`keyup`）ごとに、リンク名+カテゴリ名（小文字化して結合した`data-search`属性）に検索語を含むリンクのみ表示。該当リンクが0件のカテゴリセクションごと非表示にする。検索語が空の場合は全件表示に戻す |
| リンククリック | 新規タブ（`target="_blank"`、`rel="noopener noreferrer"`）でURLを開く |
| ダークモード | `prefers-color-scheme: dark` により自動的に配色を切り替える（手動切り替えは未実装。§1.3参照） |
| レスポンシブ | 画面幅768px以下でサイドバーが横並びのスクロール可能なタブ形式に変化する |

### 5.2 編集画面（`public/edit.html`）

#### 5.2.1 画面構成
- **左ペイン（エディタパネル）**: 幅可変（ドラッグでリサイズ可能、最小300px）
  - ヘッダー: タイトル、バージョンバッジ、DB接続ステータス表示
  - フォームエリア: 基本設定・お知らせ・カテゴリ/リンクの編集フォーム
  - フッター: 保存・エクスポート・インポート・リンクチェック・リセットの各ボタン
- **右ペイン（プレビューパネル）**: `iframe`によるライブプレビュー（PC表示/スマホ表示のトグル切り替え可）

#### 5.2.2 機能仕様
| 機能 | 仕様 |
|---|---|
| 初期読み込み | ページロード時に `GET /api/config` を非同期fetchし、`config`変数に格納。レスポンスの`ETag`ヘッダーを`currentVersion`として保持する。取得完了までフォームは「読み込み中...」表示、保存ボタンは無効化。失敗時はステータス欄にエラー表示 |
| 基本設定編集 | タイトル（テキスト入力）、テーマカラー（カラーピッカー）を編集すると、即座に`config`とプレビューに反映（自動保存はされない） |
| お知らせ管理 | 追加（先頭に本日日付で追加）・削除・日付/本文のインライン編集 |
| カテゴリ管理 | 追加（末尾に「新規カテゴリ」を追加）・削除（確認ダイアログあり）・名称編集・上下並び替え |
| リンク管理 | 追加（カテゴリ末尾に空リンクを追加）・削除・名称/URL編集・上下並び替え |
| アイコン選択 | アイコン欄クリックでパレット（30種類の絵文字）をポップアップ表示し選択。パレット外クリックで自動的に閉じる |
| ライブプレビュー | `config`が変更されるたびに、閲覧画面相当のHTML/CSSを組み立てて`iframe.srcdoc`に反映（実際のサーバーレンダリングとは別ロジックで簡易再現） |
| プレビュー表示切替 | 「💻 PC」「📱 スマホ」ボタンで`iframe`の表示サイズを切り替え（PC: 100%幅、スマホ: 375×750pxの端末フレーム風表示） |
| リンクチェック | 「🔗 リンクをチェック」ボタンで、画面に表示中の全リンクのURLを`POST /api/check-links`に送信し、到達可否を確認する。結果は各リンク行にバッジ（✅/❌、❌はエラー内容をtitle属性で表示）として反映される。**結果はDBに保存されず、この編集セッション中のみ**表示される。リンクの追加・削除・並び替え・カテゴリの追加・削除・並び替えを行うと、インデックスのずれを避けるため表示中の結果は破棄される |
| 保存 | 「💾 保存」ボタンで現在の`config`を`PUT /api/config`に送信する。`currentVersion`を`If-Match`ヘッダーとして送信し、サーバー側で他の変更と競合していないか検証する（§1.2, §4.2）。バリデーション成功かつ競合なしの場合は返却データで`config`と`currentVersion`を更新し、成功アラートを表示。バリデーションエラー時はエラー内容をアラート表示し`config`は変更しない。**競合（`409`）時**は競合内容をアラート表示した上でサーバーの最新内容を自動的に再取得し、編集中の内容を破棄する |
| JSONエクスポート | 現在の`config`を`{version, exportDate, config}`形式のJSONファイルとしてダウンロード（クライアント側のみで完結、DBへの影響なし） |
| JSONインポート | エクスポート形式のJSONファイルを読み込み、クライアント側で簡易バリデーション（§5.2.3参照）した上で`config`を置き換える。**この時点ではDBには反映されない**。反映するには別途「保存」を押す必要がある |
| デフォルトに戻す | 確認ダイアログの上で `POST /api/config/reset` を呼び出し、DBを`portal-config.json`のシードデータにリセットする。取り消し不可 |

#### 5.2.3 クライアント側インポートバリデーション（`handleImportFile()`）
| 項目 | 検証内容 | 不正時の挙動 |
|---|---|---|
| `data.config` | 存在すること | エラーとして処理を中断 |
| `data.config.title` | 文字列であること | エラーとして処理を中断 |
| `data.config.categories` | 配列であること | エラーとして処理を中断 |
| `data.config.themeColor` | `^#[0-9A-Fa-f]{6}$` に一致すること | 不一致時は警告ログを出し、`#00a968`に補正（処理は継続） |
| `news` | 配列でない場合は`[{date:"News", text:<値>}]`に、未定義の場合は`[]`に補正 | 処理は継続 |
| `categories[].name` | 未設定の場合 `"未設定"` に補正 | 処理は継続 |
| `categories[].links` | 配列でない場合は`[]`に補正 | 処理は継続 |

なお、インポートされた内容は「保存」時にサーバー側バリデーション（§6）で再検証されるため、クライアント側のチェックをすり抜けた不正なURL等はサーバー側で拒否される。

---

## 6. バリデーション仕様（`src/validate.ts`）

`PUT /api/config` 実行時、また `deno task build` からの `scripts/check-config.ts` 実行時（`src/portal-config.json` に対して）、
以下を満たさない場合はエラーとして拒否する（`validateConfig()`）。

| 項目 | 検証内容 |
|---|---|
| `title` | 文字列であり、かつ空でないこと |
| `themeColor` | `^#[0-9A-Fa-f]{6}$` に一致すること（例: `#00a968`） |
| `categories` | 配列であること |
| `categories[].name` | 文字列であること |
| `categories[].links` | 配列であること |
| `categories[].links[].name` | 文字列であること |
| `categories[].links[].icon` | 文字列であること |
| `categories[].links[].url` | §7.2「URL検証仕様」を満たすこと |
| `news` | 配列であること（省略時は空配列として扱う） |
| `news[].date` / `news[].text` | いずれも文字列であること |

いずれかの検証に失敗した場合、当該項目を特定するメッセージ（例: `カテゴリ[0]のリンク[0]のURLが不正です`）とともに例外を投げ、
APIは`400`を返す（ビルド前チェックの場合はビルドを中断する）。

---

## 7. セキュリティ仕様

### 7.1 XSS対策
- 閲覧画面・編集画面ともに、ユーザー入力に由来する値（タイトル・お知らせ・カテゴリ名・リンク名・アイコン・URL文字列）をHTMLに埋め込む際は、必ず`escapeHtml()`関数（`&<>"'`をHTMLエンティティに変換）を通す
- `escapeHtml()`は両画面それぞれの`<script>`内に同一実装を保持する（共有モジュール化はしていない）

### 7.2 URL検証
- **フロントエンド**（`src/client/portal.ts` `sanitizeUrl()`）: `http://`または`https://`で始まるURL、あるいは`/`または`.`で始まる相対パスのみそのまま許可。それ以外（`javascript:`スキーム等）は`#`に置き換える
- **バックエンド**（`src/validate.ts` `isValidUrl()`）: 同等の基準（`^https?:\/\//i` または `^[./]`）で検証し、満たさない場合は`PUT /api/config`を`400`で拒否する

### 7.3 認証・アクセス制御
- 本システムには**認証機能は実装されていない**
- `PUT /api/config`・`POST /api/config/reset`・`POST /api/check-links` は、APIにアクセスできる者であれば誰でも実行可能
- そのため、**信頼できるネットワーク内（社内LANなど）でのみ運用すること**を前提とする
- インターネットに公開する場合は、リバースプロキシでのBASIC認証やVPN経由でのアクセス制限など、システム外側での保護を別途講じること（本システム自体には実装しない）

### 7.4 `POST /api/check-links` のSSRFに関する注意
このエンドポイントは、リクエストで指定された任意のURLへサーバーがHTTPリクエストを送信する（§4.4）。
認証がない前提（§7.3）と合わせると、APIにアクセスできる者は社内ネットワーク内の他ホスト（`http://`で始まる
プライベートIP・localhost等）に対してサーバーを踏み台にした調査リクエストを送らせることが可能である。
§7.3と同じく信頼できるネットワーク内での運用を前提とし、それ以上の対策（宛先ホストの許可リスト化等）は
現時点では実装していない。

### 7.5 入力サイズ制限
§4.5参照。

---

## 8. 非機能仕様

| 項目 | 仕様 |
|---|---|
| 対応Denoバージョン | v2.9以上 |
| ソースの正本 | TypeScript（`src/`配下）。JavaScript（`dist/`・`public/js/`配下）は `deno task build` によるビルド生成物であり、直接編集しない |
| 型チェック | `deno task check`（`deno check`）で`strict`モードの型チェックを実施する |
| ポート | 環境変数`PORT`で指定可能。既定値は`3000` |
| データ永続化 | SQLiteファイル（`data/portal.db`）。プロセス再起動後もデータは保持される |
| SQLiteドライバ | `jsr:@db/sqlite`（FFI経由でネイティブsqlite3を利用。`--allow-ffi`が必要） |
| 同時実行 | `Database`は同期API。単一プロセス内での逐次アクセスを前提とし、大規模な同時書き込み負荷は想定していない |
| ロギング | サーバー起動時に起動メッセージを標準出力に出力する程度。アクセスログ・エラーログの永続化は未実装 |
| ブラウザ対応 | モダンブラウザ（`fetch`、CSS変数、`prefers-color-scheme`に対応したもの） |

---

## 9. 用語集

| 用語 | 説明 |
|---|---|
| 設定（config） | タイトル・テーマカラー・お知らせ・カテゴリ・リンクをまとめた1つのJSONオブジェクト。システム全体で単一のみ存在する |
| シードデータ | 初回起動時にDBが空の場合に投入される初期設定（`src/portal-config.json`）。DB作成後は「デフォルトに戻す」操作を行わない限り参照されない |
| カテゴリ | リンクをグループ化する単位。名称と表示順、複数のリンクを持つ |
| リンク | カテゴリに属する個別の外部/内部URL。名称・URL・アイコンを持つ |
| 正本（ソースオブトゥルース） | 人間が直接編集する原本のファイル。本システムでは仕様の正本は本ファイル（SPEC.md）、実装の正本は`src/`配下のTypeScriptファイルを指す |
| 楽観的排他制御 | 保存時に「自分が読み込んだ時点のバージョン」をサーバーに提示し、その後に他の変更が入っていないかを確認する競合検知方式。ロックは取得せず、競合時のみ`409`で通知する（§1.2, §4.2） |
| バージョン（`settings.version`） | 設定が何回更新されたかを表す整数。`PUT /api/config`のたびに1つ進み、`GET`/`PUT`のレスポンスヘッダー`ETag`として公開される |

---

## 10. 変更履歴

| バージョン | 日付 | 内容 |
|---|---|---|
| 5.3 | 2026-09-03 | 「保存の楽観的排他制御」と「リンクチェック」を追加。`settings`テーブルに`version`列を追加し、`GET/PUT/POST reset`の`ETag`/`If-Match`ヘッダーでバージョンを検証、競合時は`PUT`が`409`を返す仕様に変更(§1.2, §4.2)。`POST /api/check-links`エンドポイントを新設し、編集画面から画面上の全リンクの到達可否をその場でチェックできるようにした(DBには保存しない。§4.4, §5.2.2)。§7に`check-links`のSSRF注意事項を追記 |
| 5.2 | 2026-09-03 | §1に「バックエンドの実行環境は生成後のJavaScript(`dist/server.js`)である」ことを明文化。`deno task dev`によるTypeScript直接実行は開発時の利便機能であり本番運用の方式ではないことを明記(実装・ビルド構成自体は変更なし) |
| 5.1 | 2026-09-03 | 「ピン留めリンク」機能を削除。`LinkItem.pinned`、DBの`links.pinned`列、閲覧画面のピン留め欄、編集画面のピン留め切り替えボタンをすべて撤去し、v4.3以前の構造に戻した。§1.3(LocalStorage禁止制約)自体は維持するが、「実現例」として記載していたピン留めへの言及は一般的な考え方の説明に置き換えた |
| 5.0 | 2026-09-03 | バックエンドを復活。静的ホスティング方式(v4.x)を廃止し、Deno + TypeScript + SQLiteのサーバー(`src/server.ts`・`src/db.ts`)とREST APIを再導入。`src/portal-config.json`は「設定の正本」から「初回起動時のシードデータ」に役割変更。編集画面(`edit.html`)はファイル生成方式からDB保存(`PUT /api/config`)方式に戻し、v4.x で追加したピン留めリンク機能はDBスキーマ(`links.pinned`列)に統合して維持。バックエンドの新規コードもTypeScript実装+JavaScript生成のビルド方式を踏襲 |
| 4.3 | 2026-09-03 | 「ピン留めリンク」機能を追加。`LinkItem`に任意項目`pinned`(真偽値)を新設し、`true`のリンクを閲覧画面最上部に共通表示する。§1.3のLocalStorage禁止制約と両立する代替案として、個人ごとの状態ではなく編集者が管理する共有データとして実装。編集補助ツールにピン留め切り替えボタンを追加 |
| 4.2 | 2026-09-03 | §1.3を新設し、LocalStorage・sessionStorage・IndexedDB・Cookie等ブラウザ内永続化に依存する仕様・機能を明示的に禁止事項として明文化。お気に入り・クリック履歴・ダークモード手動切り替え等の「将来拡張候補」記載を削除し、この制約下では実装しない方針を明確化 |
| 4.1 | 2026-09-03 | 設定データ・フラットファイルの形式をTypeScript(`src/portal-config.ts`)からJSON(`src/portal-config.json`)に変更。構造検証は`src/types.ts`の型キャスト+ビルド前バリデーション(`scripts/check-config.ts`、`deno task build`から自動実行)で担保する方式に変更。編集補助ツールが生成するファイルもTypeScriptからJSONに変更 |
| 4.0 | 2026-09-03 | 実行環境を静的ホスティングに変更。サーバー(`src/server.ts`)・SQLiteデータベース(`src/db.ts`)・REST APIを廃止し、設定データをソースコード内のフラットファイル(`src/portal-config.ts`)へ変更。閲覧画面はビルド時に設定を静的バンドルする方式に変更し、編集画面はサーバー保存を行わないローカル編集補助ツール(TypeScriptファイル生成)に再設計 |
| 3.0 | 2026-09-03 | ランタイムをNode.js(Express)からDenoに移行し、実装言語をTypeScriptに統一。`src/`配下のTypeScriptを正本とし、`deno bundle`でJavaScript(`dist/`・`public/js/`)を生成するビルド方式を導入。SQLiteドライバを`node:sqlite`から`jsr:@db/sqlite`に変更 |
| 2.0 | 2026-09-03 | SQLiteデータベース + Expressバックエンドを導入。マスター仕様書（本ファイル）を新設し、仕様をREADMEから分離・集約 |
| 1.1 | 2026-02-27 | LocalStorage自動保存、JSONインポート/エクスポート、デフォルトに戻す機能を追加（静的サイト構成時代の仕様。現行仕様には非適用） |
| 1.0 | 2026-02-14 | 初回リリース（静的サイト構成。`data.js`手動編集方式） |
