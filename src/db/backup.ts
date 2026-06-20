import { File, Paths } from 'expo-file-system';
import { shareAsync } from 'expo-sharing';
import type { SQLiteDatabase } from 'expo-sqlite';

import { DATABASE_VERSION } from './migrations';

/**
 * DB 全体のダンプ（書き出し）と取り込み（復元）。
 *
 * - 書き出し: serializeAsync で WAL 反映済みの一貫したスナップショット（単一の SQLite ファイル）を
 *   作り、共有シートで保存・送信できるようにする。
 * - 取り込み: 選んだバックアップファイルを ATTACH し、ライブ接続のまま全テーブルを差し替える
 *   （接続を閉じたりアプリを再起動したりしないので安全）。スキーマ不一致による破損を避けるため、
 *   バックアップの user_version が現在の DATABASE_VERSION と一致する場合のみ取り込む。
 */

/** FK 依存順（親 → 子）。INSERT はこの順、DELETE は逆順で行う。 */
const TABLES = ['genres', 'songs', 'players', 'app_meta', 'charts', 'genre_songs', 'records'] as const;

function backupFileName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `done-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.db`;
}

/** DB を単一ファイルにダンプして共有シートを開く。 */
export async function exportDatabase(db: SQLiteDatabase): Promise<void> {
  const bytes = await db.serializeAsync();
  const out = new File(Paths.cache, backupFileName());
  if (out.exists) out.delete();
  out.create();
  out.write(bytes);
  await shareAsync(out.uri, {
    mimeType: 'application/x-sqlite3',
    dialogTitle: 'done DB バックアップ',
    UTI: 'public.database',
  });
}

/**
 * バックアップファイル（fileUri）を取り込み、現在の DB を完全に置き換える。
 * バージョン不一致や非DBファイルの場合は Error を投げる（呼び出し側で握ってメッセージ表示）。
 */
export async function importDatabase(db: SQLiteDatabase, fileUri: string): Promise<void> {
  // DocumentPicker の file:// URI を ATTACH 用のファイルパスへ変換する
  const path = decodeURIComponent(fileUri.replace(/^file:\/\//, ''));
  const escaped = path.replace(/'/g, "''");

  // ATTACH はトランザクション外で行う必要がある
  await db.execAsync(`ATTACH DATABASE '${escaped}' AS backup;`);
  try {
    let backupVersion: number;
    try {
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA backup.user_version');
      backupVersion = row?.user_version ?? 0;
    } catch {
      throw new Error('選択したファイルは有効なデータベースではありません。');
    }
    if (backupVersion !== DATABASE_VERSION) {
      throw new Error(
        `バックアップのバージョン (v${backupVersion}) が現在のアプリ (v${DATABASE_VERSION}) と異なるため取り込めません。`,
      );
    }

    // withExclusiveTransactionAsync は内部で別コネクションを使うため ATTACH した
    // backup スキーマが見えない。同一コネクション (db) で動く withTransactionAsync を使う。
    await db.withTransactionAsync(async () => {
      // トランザクション中は FK チェックを commit まで遅延させ、全消し→全投入を安全に行う
      await db.execAsync('PRAGMA defer_foreign_keys = ON;');
      for (const t of [...TABLES].reverse()) {
        await db.execAsync(`DELETE FROM main.${t};`);
      }
      for (const t of TABLES) {
        await db.execAsync(`INSERT INTO main.${t} SELECT * FROM backup.${t};`);
      }
    });
  } finally {
    await db.execAsync('DETACH DATABASE backup;');
  }
}
