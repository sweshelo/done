export { DATABASE_NAME, DATABASE_VERSION, runMigrations } from './migrations';
export {
  saveGenres,
  saveSongCatalog,
  saveStarCounts,
  saveTierData,
  upsertGenre,
  upsertSong,
  upsertChart,
  linkGenreSong,
  type SongCatalogItem,
} from './songs';
export {
  saveRecords,
  insertRecordIfChanged,
  buildRecordQuery,
  rowToRecord,
  resolveTargetsByTitle,
  type RecordFilter,
  type RecordSort,
  type RecordSortKey,
} from './records';
export { listPlayers, addPlayer, removePlayer } from './players';
export {
  getMeta,
  setMeta,
  getAlmostConfig,
  SELF_TAIKO_NO_KEY,
  ALMOST_MODE_KEY,
  ALMOST_VALUE_KEY,
  type AlmostMode,
  type AlmostConfig,
} from './meta';
export {
  listManualFolders,
  createFolder,
  renameFolder,
  deleteFolder,
  addSongToFolder,
  removeSongFromFolder,
  getFoldersForSong,
  getFolderSongs,
  getFolderSongNumbers,
  type FolderRef,
  type FolderSongRow,
  type ManualFolderRow,
} from './folders';
export { exportDatabase, importDatabase } from './backup';
