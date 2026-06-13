# done — 実装設計書

SPEC.md を実装に落とし込むための詳細設計。技術スタックは Expo (SDK 56) / React Native / Bun。

---

## 1. アーキテクチャ概要

```
┌─────────────────────────────────────────────────────────┐
│  Expo App (React Native, expo-router)                     │
│                                                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │ データ取得    │  │ 記録閲覧      │  │ 設定          │    │
│  │ (WebView)    │  │ (List/Filter)│  │ (placeholder)│    │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘    │
│         │ postMessage     │ query                          │
│  ┌──────▼─────────────────▼───────────────────────────┐  │
│  │  Repository 層 (lib/db)  ← expo-sqlite              │  │
│  └──────┬──────────────────────────────────────────────┘ │
│         │                                                  │
│  ┌──────▼──────┐   ┌────────────────────────────────────┐│
│  │ SQLite       │   │ 外部データ取り込み (★数 / tier)      ││
│  │ (local)      │   │  wikiwiki.jp / taiko.wiki           ││
│  └──────────────┘   └────────────────────────────────────┘│
└────────────────────────────────────────────────────────────┘
```

データの流れは2系統:

1. **記録データ** … ドンだーひろば → WebView 内 `fetch` でスクレイプ → `postMessage` で RN 側へ → SQLite に upsert。
2. **譜面メタデータ（★数 / tier）** … wikiwiki.jp（★数）/ taiko.wiki（☆10 tier）→ `levels` テーブルへ。記録とは独立に更新可能。

---

## 2. 技術スタックとプロジェクト構成

### 2.1 主要ライブラリ（SDK 56 で確認済み）

| 役割 | ライブラリ | 確定した API |
|--|--|--|
| ルーティング/タブ | `expo-router` (Tabs) | file-based、`app/(tabs)/` |
| WebView | `react-native-webview` (`npx expo install`) | `source` / `injectedJavaScript` / `injectedJavaScriptBeforeContentLoaded` / `onMessage` / `onNavigationStateChange` / `userAgent` / `sharedCookiesEnabled` / `ref.injectJavaScript()` |
| ローカルDB | `expo-sqlite` | `openDatabaseAsync` / `SQLiteProvider`(`onInit`) / `runAsync` / `getAllAsync` / `getFirstAsync` / `withTransactionAsync` / `PRAGMA user_version` |

> ORM は任意。`expo-sqlite` は Drizzle 連携を公式に案内しているが、本設計ではまず**素の SQL + 薄い Repository 層**で開始し、クエリが複雑化したら Drizzle 導入を再検討する（フィルタ/ソートはほぼ SQL で表現できるため）。

### 2.2 ディレクトリ構成（standalone Expo app）

```
done-mobile/
├─ app/
│  ├─ _layout.tsx              # SQLiteProvider + Theme provider
│  └─ (tabs)/
│     ├─ _layout.tsx           # 下部タブ定義
│     ├─ collect.tsx           # データ取得（WebView）
│     ├─ records.tsx           # 記録閲覧
│     └─ settings.tsx          # 設定（現状プレースホルダ）
├─ components/
│  ├─ collect/                 # WebView ラッパ・進捗オーバーレイ
│  └─ records/                 # 一覧行・フィルタUI・詳細ポップアップ
├─ lib/
│  ├─ db/
│  │  ├─ schema.ts             # CREATE TABLE / マイグレーション
│  │  ├─ migrations.ts         # user_version ベース
│  │  ├─ songs.ts              # Song/Genre/Level リポジトリ
│  │  ├─ records.ts            # Record リポジトリ（履歴保持ロジック）
│  │  └─ index.ts
│  ├─ scrape/                  # ★ プロトタイプ packages/scrape を移植
│  │  ├─ scraper.ts            # fetchGenreSongs / fetchDetailRecord
│  │  ├─ parsers.ts            # crown/class/count パーサ
│  │  ├─ concurrency.ts
│  │  ├─ session.ts            # ★新規: ログイン状態判定（§5.2）
│  │  └─ inject.entry.ts       # WebView に注入する mobile.ts 相当
│  ├─ external/
│  │  ├─ wikiwiki.ts           # ★数テーブル取得（genre 単位）
│  │  └─ taikowiki.ts          # ☆10 tier 取得（__data.json）
│  ├─ inject-script.ts         # ★ ビルド生成物（編集禁止）
│  └─ types.ts                 # SPEC のドメイン型
├─ scripts/
│  └─ build-inject.ts          # bun build → lib/inject-script.ts 生成
└─ theme/colors.ts             # カラースキーム
```

### 2.3 inject スクリプトのビルド

プロトタイプ (`packages/scrape`) の方式を踏襲する。`lib/scrape/inject.entry.ts` を Bun で IIFE バンドルし、文字列として `lib/inject-script.ts` に書き出す（`gen-mobile-inject.ts` と同じ仕組み）。

```jsonc
// package.json scripts
"build:inject": "bun build --bundle --target browser --format iife ./lib/scrape/inject.entry.ts --outfile /tmp/inject.js && bun scripts/build-inject.ts"
```

RN 側は `import { INJECT_SCRIPT } from '@/lib/inject-script'` し、`WebView.injectedJavaScript` または `ref.injectJavaScript(INJECT_SCRIPT)` で実行する。

> プロトタイプは monorepo (`@done/shared` 参照) だったが、done-mobile は単独リポジトリ。`@done/shared` の型は `lib/types.ts` に内製化する（§3 参照、SPEC に合わせて再定義）。

---

## 3. ドメイン型とDB スキーマ

### 3.1 ドメイン型（`lib/types.ts`）

SPEC の型をそのまま採用。ただしプロトタイプとの差分に注意:

| 項目 | SPEC（採用） | プロトタイプ（要修正） |
|--|--|--|
| 識別子 | `Record.songNumber` | `songId` |
| 難易度 | `Record.course` | `difficulity`（typo） |
| ランキング | `score.ranking` あり | 無し → パーサに追加 |
| 曲名 | Song に無い | `Record.title` で運搬 |

`Song` に表示用の `title` が無いため、実用上 `songs` テーブルに `title` を保持する（SPEC 拡張。記録閲覧での曲名表示に必須）。

### 3.2 テーブル定義（`lib/db/schema.ts`）

```sql
-- ジャンル
CREATE TABLE genres (
  id    TEXT PRIMARY KEY,   -- Genre.id
  title TEXT NOT NULL       -- wikiwiki / 色テーブルのキーにもなる
);

-- 楽曲（number が実質ID）
CREATE TABLE songs (
  number      INTEGER PRIMARY KEY,  -- donderhiroba song_no
  internal_id TEXT,                 -- Song.id（取得できない場合 NULL）
  title       TEXT                  -- 表示用（SPEC拡張）
);

-- ジャンル⇔楽曲（多対多。1曲が複数ジャンルに属しうる）
CREATE TABLE genre_songs (
  genre_id    TEXT NOT NULL REFERENCES genres(id),
  song_number INTEGER NOT NULL REFERENCES songs(number),
  PRIMARY KEY (genre_id, song_number)
);

-- 譜面（難易度ごと）
CREATE TABLE levels (
  song_number INTEGER NOT NULL REFERENCES songs(number),
  course      TEXT NOT NULL,   -- Course enum
  star        INTEGER,         -- ★数（wikiwiki由来、未取得は NULL）
  link        TEXT,            -- 譜面ページへのリンク
  tier        TEXT,            -- ☆10 tier（taiko.wiki由来、未取得は NULL）
  PRIMARY KEY (song_number, course)
);

-- 記録（履歴保持のため append-only）
CREATE TABLE records (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  song_number  INTEGER NOT NULL REFERENCES songs(number),
  course       TEXT NOT NULL,
  crown        TEXT NOT NULL,   -- Crown enum
  class        TEXT NOT NULL,   -- Class enum
  score_total  INTEGER NOT NULL,
  good         INTEGER NOT NULL,
  ok           INTEGER NOT NULL,
  ng           INTEGER NOT NULL,
  combo        INTEGER NOT NULL,
  pound        INTEGER NOT NULL,
  ranking      INTEGER,
  options      TEXT NOT NULL DEFAULT '[]',  -- JSON 文字列（Option[]）
  -- history（プレイ回数等。詳細ページにある場合のみ）
  play          INTEGER,
  clear         INTEGER,
  fullcombo     INTEGER,
  dondafulcombo INTEGER,
  updated_at   INTEGER NOT NULL  -- 記録時刻（epoch ms）
);

CREATE INDEX idx_records_song_course ON records(song_number, course, updated_at DESC);
```

### 3.3 マイグレーション戦略

`SQLiteProvider` の `onInit` で `PRAGMA user_version` を読み、段階的に DDL を適用（SDK 56 公式パターン）。`DATABASE_VERSION` 定数を上げるたびに差分 DDL を追記。

### 3.4 履歴保持ロジック（SPEC の核心要件）

> 「スクレイピングした時点での記録が更新されているものであれば、過去の記録を上書きせずに保持」

`records.ts` の upsert は次の判定を行う:

1. `(song_number, course)` の **最新行**（`updated_at DESC LIMIT 1`）を取得。
2. 最新行が無い → 常に INSERT。
3. 最新行と比較し、**スコア関連が変化していれば** INSERT（履歴を1行追加）。
   - 比較キー: `score_total, crown, class, good, ok, ng, combo`（少なくとも `score_total` の改善で判定。要件確定は §8-Q3）。
4. 変化なし → 何もしない（重複行を作らない）。

これにより「最高記録1つしか持たない本家」に対し、**改善のたびのスナップショット履歴**をローカルに蓄積する。記録閲覧では既定で各譜面の最新行を表示し、詳細ポップアップで過去履歴を時系列表示できる。

---

## 4. タブ構成（expo-router）

`app/(tabs)/_layout.tsx` で下部タブ3つ。`@expo/vector-icons` 使用。

| ルート | 表示名 | 役割 |
|--|--|--|
| `collect` | データ取得 | WebView。§5 |
| `records` | 記録閲覧 | 一覧・フィルタ・詳細。§6 |
| `settings` | 設定 | 現状プレースホルダ |

---

## 5. データ取得タブ（WebView スクレイピング）

### 5.1 基本方式（プロトタイプ踏襲）

- WebView でドンだーひろばを表示し、ログイン済みセッション Cookie を使って **WebView 内 `fetch`** で `score_list.php?genre=N`（N=1..8）と `score_detail.php?song_no=X&level=Y` を取得、`DOMParser` でパースする。
- 進捗・完了・エラーは `window.ReactNativeWebView.postMessage(JSON)` で RN に通知（`{type:'progress'|'complete'|'error'}`）。
- RN 側 `onMessage` で受信し、`complete` の `records` を SQLite に保存。
- 並列度は `withConcurrency(tasks, 10)` を流用。
- `sharedCookiesEnabled` を有効化し、ネイティブ Cookie ストアを共有する。

確認済み DOM セレクタ（プロトタイプより、本家現行構造）:

- 楽曲リスト: `.contentBox` 単位 / 曲名 `.songName` / 難易度ボタン `.buttonList > li > a`（href の `song_no=` `level=`、未プレイ判定は img src に `_none_`）
- 詳細: `.crown`(img src `crown_large_N_`) / `.best_score_icon`(img src `best_score_rank_N_`) / `.high_score` `.good_cnt` `.ok_cnt` `.ng_cnt` `.combo_cnt` `.pound_cnt` / オプション `.optionImage > img` / 履歴 `.stage_cnt` `.clear_cnt` `.full_combo_cnt` `.dondaful_combo_cnt` / `.ranking`

### 5.2 ログイン状態判定の再設計（SPEC 指摘の不具合）

**問題**: 「現在 URL が `donderhiroba.jp/index.php` か」で判定していたが、アプリ再起動→自動ログインのケースで誤判定する。実地調査でも、`index.php` を素の HTTP で叩くと **User-Agent 次第でブラウザ警告ページが返る**ことを確認しており、URL/UA 依存の判定は脆い。

**再設計方針 — URL ではなく「認証済みエンドポイントの応答内容」で判定する:**

1. WebView ロード後、`onNavigationStateChange` は**遷移トリガ**としてのみ使い、判定には使わない。
2. 判定は注入 JS から **`fetch('/score_list.php?genre=1', {redirect:'manual'|'follow'})`** を1回投げ、応答 DOM を検査する `probeLoginState()` を新設（`lib/scrape/session.ts`）。
   - ログイン済みシグナル: `.contentBox` または `.songName` が**1つ以上存在**する（＝スコアデータが返っている）。
   - 未ログインシグナル: ログインフォーム / 「ログイン」ボタン / `index.php` への redirect / 警告ページ要素。
3. 結果を `postMessage({type:'session', loggedIn:boolean})` で RN に返し、ボタン活性/非活性を制御。スクレイプ開始ボタンは `loggedIn === true` のときのみ有効化。
4. **UA 固定**: 本家 PC 版を安定して得るため `WebView` の `userAgent` をデスクトップ Chrome 相当に固定（SP 版へのフォールバックや警告ページを避ける）。SP 版 DOM を使う設計に切り替える場合はセレクタ差分の追加調査が必要（§8-Q1）。

> ポイントは「ログインしているか」を**画面URLの形**ではなく**保護リソースが取れるか**で定義し直すこと。自動ログインの非同期なリダイレクトに左右されない。

### 5.3 未プレイ曲の Song/Genre 登録（SPEC 要件）

> 「プレイ履歴のない楽曲についても Song / Genre オブジェクトは DB に格納/更新する」

Phase 1（`fetchGenreSongs`）で得た**全曲**（played に関わらず）を `songs` / `genres` / `genre_songs` / `levels(course)` に upsert する。Phase 2 の詳細取得（`records`）は played のみ対象、という二層構造にする。プロトタイプは played のみ targets 化していたため、**Song 登録を played フィルタ前に行うよう変更**する。

### 5.4 リトライ

プロトタイプの `__retryTargets` 機構を踏襲。`complete.failedTargets` を RN 側に保持し、「失敗分を再試行」で Phase 1 をスキップして再注入。

---

## 6. 記録閲覧タブ

### 6.1 一覧

- 既定表示: 各 `(song_number, course)` の**最新記録**を1行。`records` を `updated_at DESC` の各組先頭で取得（`GROUP BY` + サブクエリ、または window 関数）。
- 行の要素: 曲名 / ジャンル色帯 / 難易度（course 色 + ★数 + tier バッジ）/ crown アイコン / class アイコン / スコア。
- 仮想化リスト（`FlashList` 推奨、大量行のため）。

### 6.2 フィルタ・ソート（拡張前提だが土台を用意）

`records.ts` にクエリビルダを置き、UI から条件オブジェクトを渡す:

- フィルタ: ジャンル / course / crown / class / ★数 / tier / スコア閾値 / プレイ有無。
- ソート: スコア / ★数 / tier / 更新日時 / ランキング。

土台として `buildRecordQuery(filter, sort)` を実装し、後から条件追加を容易にする。

### 6.3 詳細ポップアップ

行タップで Modal/BottomSheet を開き:

- 当該譜面の**全履歴**（`records` の時系列）をグラフ/リスト表示。
- score 内訳（good/ok/ng/combo/pound/ranking/options）。
- history（play/clear/fullcombo/dondafulcombo）。

---

## 7. 外部メタデータ取り込み（★数 / tier）

記録スクレイプとは独立。`levels` テーブルを後追いで埋める。

### 7.1 ★数（taiko.wiki を正規ルートとする）

- **確定（ユーザー回答 Q4）**: ★数も taiko.wiki の JSON から取得する。`https://taiko.wiki/song/{taikowiki_id}/__data.json` が per-difficulty の `level`(★) を返す（`dani` に tier も含む）。曲の列挙と songNo↔taikowiki_id の対応は `diffchart/dfc/10/__data.json` 等の曲DB（`genre`/`songNo`/`title`）から得て、`songs.number == songNo` で join し `levels.star`/`levels.tier` に格納する。
- **注意**: per-song JSON の `level` フィールドの厳密な意味（★数そのものか別スケールか）は、実装時に生レスポンスを1件読んで確認すること（WebFetch 要約では値が不審だった）。
- wikiwiki.jp は**難易度/ジャンルの背景色テーブルのみ**に使用（§8.2）。エージェントから取得不可のためユーザー手動提供。→ [[wikiwiki-blocks-agents]] 譜面ページへのリンク (`Level.link`) が必要なら wikiwiki または taiko.wiki の song ページ URL を流用する。

### 7.2 ☆10 tier（taiko.wiki）

- 表示ページ: `https://taiko.wiki/diffchart/dfc/10?lang=ja`。
- **プログラム取得可**: SvelteKit の `https://taiko.wiki/diffchart/dfc/10/__data.json` が利用でき、曲DB（`genre` / `songNo` / `title` / `titleKo`）と tier 構造を JSON で返す。`songNo` は本家 song_no と一致するため `songs.number` で join 可能。
- tier ランク（高→低）: `SS` / `地力S+` / `個人差S+` / `地力S` / `個人差S` / `地力A+` / `個人差A+` / `地力A` / `個人差A` / `地力B..F` / `個人差B..E`。
  - SPEC の `Tier`（F〜SS）型はこの実データに合わせて enum を確定する（§8-Q2）。
- 個別曲リンクは `/song/{taikowiki_id}?diff=oni|ura`（この id は taiko.wiki 内部 id で songNo とは別系。join は songNo を使う）。

---

## 8. カラースキーム

`theme/colors.ts` に集約。

### 8.1 状態色（SPEC 指定）

| 用途 | 色 | 演出 |
|--|--|--|
| プレイ済み | `#888` | – |
| クリア | `#ababab` | 光るハイライトのアニメーション |
| フルコンボ | `#f3c621` | 光るハイライトのアニメーション |
| ドンダフルコンボ | `#f170ff` または虹色グラデーション | 光るハイライトのアニメーション |

- ハイライト演出は `react-native-reanimated` の `useSharedValue` + ループで実装（透明度/グラデ位置のシマー）。虹色は `expo-linear-gradient` のアニメ。

### 8.2 難易度/ジャンル背景色（wikiwiki 由来）

- §7.1 のテーブル背景色を流用する方針。**wikiwiki がエージェントから取得できないため、ユーザーから色テーブル提供を受けて `theme/colors.ts` に転記する**（→ [[wikiwiki-blocks-agents]]）。
- 暫定までの間は course 名（かんたん/ふつう/むずかしい/おに/おに裏）→色のマップとジャンル→色のマップを空テーブルとして用意し、確定後に値を流し込む。

---

## 9. 確定した判断（ユーザー回答済み）と残課題

確定:
- **Q1 / WebView UA**: デスクトップ Chrome 相当に固定し本家 PC 版 (`score_list.php`) を使用。→ `src/app/collect.tsx` の `PC_USER_AGENT`。
- **Q3 / 履歴判定**: 任意フィールド変化（`score_total/crown/class/good/ok/ng/combo` のいずれかが最新行と異なれば INSERT）。→ `src/db/records.ts` `hasChanged`。
- **Q4 / ★・tier 取得**: taiko.wiki の JSON を正規ルート（§7.1）。wikiwiki は色テーブルのみ。

残課題:
- **Q2 / Tier enum**: 実装上は `Tier = string`（例 `'地力S+'`）とした。確定リストに固める場合は taiko.wiki 実データに合わせる。
- **Q5**: ☆10 以外の tier は対象外（SPEC は☆10 のみ言及）。必要になれば `diffchart/dfc/{N}` を追加。
- **ジャンル並び順 / 色テーブル**: `src/scrape/genres.ts` の `GENRE_TITLES` は暫定。難易度/ジャンル背景色（`src/constants/taiko-colors.ts`）は wikiwiki 確定後に転記。

> 実装状況: 「基盤 + データ取得」フェーズは実装済み（タブ/SQLite/スクレイプ移植/ログイン判定再設計/取得画面）。記録閲覧UI（フィルタ/ソート/詳細ポップアップ）と taiko.wiki 取り込みは次フェーズ。実装計画は承認済みプランファイル参照。
```
