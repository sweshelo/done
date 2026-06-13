# done

doneは、太鼓の達人のプレイヤーサイト「ドンだーひろば」からデータをスクレイピングして収集し、やりこみプレイヤー向けにスコアの可視化やフィルタを本家サイトよりも快適に行うことができるアプリ。  
ドンだーひろばの問題点として、楽曲のソート、スコアのソート、記録の一瞥が出来ない。これをスクレイピングしてデータ収集し、ローカルDBに保存することで管理・ソートを容易にする。

## 技術情報

- React Native (expo)
- Bun

## アプリの構成 (メインタブ)

以下のタブを実装し、画面下部から移動できるようにする

- データ取得
  - WebViewでドンだーひろばを表示し、ここでJavaScriptを実行してデータを収集する
  - プロトタイプの実装にある C:\Users\sweshelo\work\done\packages\scrape を流用する
    - プロトタイプの問題点として、スクレイピング不可能な状態(現在訪れているURLが、donderhiroba.jp/index.phpかどうか)を、特にアプリを再起動して自動的にログイン状態にある場合において、正常に判定できていない問題があるため、再設計が必要である可能性がある。
  - プレイ履歴のない楽曲についても、下に示す `Song` `Genre` オブジェクトはDBに格納/更新する
- 記録閲覧
  - 記録されているリザルトを各種フィルタ等の機能を提供しつつ閲覧
  - 記録の詳細へのポップアップ導線を表示、記録を一覧化
  - フィルタ、ソートなど、多彩な機能をあとから実装する
- 設定
  - 設定画面となる予定だが、現時点では特に何も用意しない

データはローカルにDBを持たせ、そこに格納する。
ドンだーひろばは、最高記録を1つしか保持しないが、本アプリではスクレイピングした時点での記録が更新されているものであれば、過去の記録を上書きせずに保持しておく。

## データ構成

```js
export type Crown = 'NO_PLAY' | 'PLAYED' | 'CLEAR' | 'FULL_COMBO' | 'DONDAFUL_COMBO'
export type Class = 'NO_MARK' | 'IKI_WHITE' | 'IKI_BRONZE' | 'IKI_SILVER' | 'GOLD_MIYABI' | 'PINK_MIYABI' | 'PURPLE_MIYABI' | 'KIWAMI'
export type Course = 'EASY' | 'NORMAL' | 'DIFFICULT' | 'ONI' | 'EXTRA'
export type Option = string

// プレイ履歴
export interface History {
  play: number
  clear: number
  fullcombo: number
  dondafulcombo: number
}

// プレイの記録
export interface Record {
  songNumber: number
  course: Course // 難易度
  crown: string
  class: string
  score: {
    total: number
    good: number
    ok: number
    ng: number
    combo: number
    pound: number
    options: Option[]
    ranking: number
  }

  history?: History
  updatedAt?: number
}

// 楽曲データ
export interface Song {
  number: number // 実質的なID
  id?: string // 楽曲の識別に内部で用いられる値で、スクレイピングによっては取得できない
  level: Level[]
}

// 譜面データ
export interface Level {
  course: Course
  star: number // 難易度を示す☆の数。https://wikiwiki.jp/taiko-fumen/%E4%BD%9C%E5%93%81/%E6%96%B0AC/{Genre.title} にアクセスすると、対象ジャンルの星の数テーブルを取得できる。
  link: string // 上記の☆の数を取得する際に譜面へのリンクを取得できる。これを保持しておく。
  tier?: Tier // ☆10の譜面の難易度を有志が細分化したもので、F~SSまでのランクがある。https://taiko.wiki/diffchart/dfc/10?lang=ja にアクセスするとテーブルを取得できる。
}

export interface Genre {
  id: string
  title: string
  songs: Song['number'][]
}
```

## カラースキーム

以下のページを訪れて確認できる、難易度及びジャンルのテーブル背景色を流用せよ。

- <https://wikiwiki.jp/taiko-fumen/%E4%BD%9C%E5%93%81/%E6%96%B0AC/%E3%83%9D%E3%83%83%E3%83%97%E3%82%B9>

その他は以下を使用せよ

|用途|色|
|--|--|
|プレイ済み|#888|
|クリア|#ababab *|
|フルコンボ|#f3c621 *|
|ドンダフルコンボ|#f170ff または 虹色のグラデーション *|

*: 光るハイライトのアニメーションがあることが望ましい
