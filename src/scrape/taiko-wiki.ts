/**
 * taiko.wiki の楽曲ページから難易度★数をスクレイプする。
 *
 * エンドポイント: https://taiko.wiki/song/{song_no}
 * 対象要素: .difficulty-container 内の span[data-ismobile="false"]
 * 表示順: かんたん / ふつう / むずかしい / おに / 裏
 *
 * 認証不要の公開サイトなので React Native の fetch() を直接使用する（WebView 不要）。
 */
import { parse } from 'node-html-parser';

import type { Course } from '../types';
import { withConcurrency } from './concurrency';

/** taiko.wiki の1曲分の★データ。songNo は donderhiroba の song_no と同じ整数。 */
export interface SongStar {
  songNo: number;
  easy?: number;
  normal?: number;
  hard?: number;
  oni?: number;
  ura?: number;
}

const DIFFICULTY_KEYS: Array<keyof Omit<SongStar, 'songNo'>> = [
  'easy',
  'normal',
  'hard',
  'oni',
  'ura',
];

/**
 * 1曲の★数を取得する。
 * ページが存在しないか難易度情報が取れない場合は null を返す。
 */
export async function fetchSongStar(songNo: number): Promise<SongStar | null> {
  try {
    const resp = await fetch(`https://taiko.wiki/song/${songNo}`);
    if (!resp.ok) return null;
    const html = await resp.text();

    // HTML を DOM として解釈し、.difficulty 内の desktop 表示 span の innerText を取得してから
    // ★数を正規表現で抽出する（生テキストへの直接 regex より確実）
    const dom = parse(html);
    const spans = dom.querySelectorAll('.difficulty > span');
    if (spans.length === 0) return null;

    const star: SongStar = { songNo };
    spans.forEach((span, i) => {
      const key = DIFFICULTY_KEYS[i];
      if (!key) return;
      const m = span.innerText.match(/★\s*(\d+)/);
      if (m) star[key] = parseInt(m[1], 10);
    });
    return star;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// 全良難易度表 (tier)
// ────────────────────────────────────────────────────────────────────────────

/** 全良難易度表から得られる1エントリ。songNo と course の組み合わせで levels 行を特定する。 */
export interface SongTier {
  songNo: number;
  course: Course;
  tier: string;
  /** ページ上の tier 出現順（0 = 最上位）。ソートに使用。 */
  tierRank: number;
}

const DIFF_TO_COURSE: Record<string, Course> = {
  oni: 'ONI',
  ura: 'EXTRA',
};

/**
 * taiko.wiki の全良難易度表をスクレイプして tier データを返す。
 *
 * ページ構造: `<h2>` が tier 見出し、その後に続く `<a href="/song/ID?diff=...">` が所属楽曲。
 * diff パラメータなし → ONI、diff=ura → EXTRA と判定する。
 *
 * @param starLevel ★数（デフォルト 10）
 */
export async function fetchTierChart(starLevel = 10): Promise<SongTier[]> {
  const resp = await fetch(`https://taiko.wiki/diffchart/dfc/${starLevel}`);
  if (!resp.ok) throw new Error(`taiko.wiki tier fetch failed: HTTP ${resp.status}`);
  const html = await resp.text();

  const dom = parse(html);
  // .section ごとに .name でtier名、.container 内のリンクで楽曲を取得
  const sections = dom.querySelectorAll('.section');

  const results: SongTier[] = [];
  // tier 名 → 出現順ランク（0 = 最上位）
  const tierRankMap = new Map<string, number>();

  for (const section of sections) {
    const tier = section.querySelector('.name')?.innerText.trim().replace('지력', '地力').replace('개인차', '個人差');
    if (!tier) continue;

    // 初出の tier にランクを割り当てる
    if (!tierRankMap.has(tier)) tierRankMap.set(tier, tierRankMap.size);
    const tierRank = tierRankMap.get(tier)!;

    // .container 要素自体が <a> タグ（楽曲リンク）なので href は直接取得する
    const links = section.querySelectorAll('.container');
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      const songMatch = href.match(/\/song\/(\d+)/);
      if (!songMatch) continue;
      const songNo = parseInt(songMatch[1], 10);

      const diffMatch = href.match(/[?&]diff=(\w+)/);
      const course: Course = DIFF_TO_COURSE[diffMatch?.[1] ?? ''] ?? 'ONI';

      results.push({ songNo, course, tier, tierRank });
    }
  }

  return results;
}

// ────────────────────────────────────────────────────────────────────────────
// ★数（star）
// ────────────────────────────────────────────────────────────────────────────

/**
 * 指定した楽曲番号リストの★数を並列取得する。
 * @param songNumbers donderhiroba の song_no 一覧（DB の songs テーブルから取得する想定）
 * @param concurrency 並列数（デフォルト 5）
 * @param onProgress 進捗コールバック (取得済み件数, 総件数)
 */
export async function fetchAllSongStars(
  songNumbers: number[],
  concurrency = 5,
  onProgress?: (done: number, total: number) => void,
): Promise<SongStar[]> {
  let done = 0;
  const all = await withConcurrency(
    songNumbers.map(
      (no) => async () => {
        const star = await fetchSongStar(no);
        onProgress?.(++done, songNumbers.length);
        return star;
      },
    ),
    concurrency,
  );
  return all.filter((s): s is SongStar => s !== null);
}
