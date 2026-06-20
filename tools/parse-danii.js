/**
 * 段位道場テーブル → course.d.ts 準拠JSON 抽出スクリプト（ブラウザ devtools 用）
 *
 * 使い方:
 *   1. 攻略wiki(wikiwiki)の段位道場ページを開く
 *   2. devtools コンソールにこのファイルの内容をまるごと貼り付けて実行
 *   3. JSON が console に出力され、可能なら clipboard にもコピーされる
 *
 * 出力形:
 *   Record<段位名, {
 *     part: [PartExport, PartExport, PartExport],  // 各曲
 *     condition: Condition[]                       // 3曲共通の条件
 *   }>
 *   PartExport = {
 *     songNumber: null,        // HTMLに曲番号が無いため null。後段でタイトル照合して解決する
 *     title: string,
 *     chart: { level, star?, link? },  // level = 難易度(EASY/NORMAL/DIFFICULT/ONI/EXTRA)
 *     condition: Condition[]   // その曲固有の条件
 *   }
 *   Condition = { name, operator: '<'|'>=', value: { normal: number, gold?: number } }
 */

(function () {
  'use strict';

  // むずかしさ語 → Level(難易度enum)
  var LEVEL_MAP = {
    'かんたん': 'EASY',
    'ふつう': 'NORMAL',
    'むずかしい': 'DIFFICULT',
    'おに': 'ONI',
  };

  // お題(条件)の列インデックス（rowspan/colspan 展開後のグリッド基準）
  var CONDITION_COLS = [5, 6, 7, 8];

  function rowsOf(section) {
    return section.rows || section.querySelectorAll(':scope > tr');
  }
  function cellsOf(row) {
    return row.cells || row.querySelectorAll(':scope > td, :scope > th');
  }

  /** tbody を rowspan/colspan 展開したグリッドを作る。grid[r][c] = { td, originRow }。 */
  function buildGrid(rows) {
    var grid = [];
    for (var r = 0; r < rows.length; r++) {
      if (!grid[r]) grid[r] = [];
      var c = 0;
      var cells = cellsOf(rows[r]);
      for (var i = 0; i < cells.length; i++) {
        var td = cells[i];
        while (grid[r][c]) c++; // 直前行の rowspan で埋まった列を飛ばす
        var rs = td.rowSpan || parseInt(td.getAttribute('rowspan'), 10) || 1;
        var cs = td.colSpan || parseInt(td.getAttribute('colspan'), 10) || 1;
        for (var dr = 0; dr < rs; dr++) {
          for (var dc = 0; dc < cs; dc++) {
            if (!grid[r + dr]) grid[r + dr] = [];
            grid[r + dr][c + dc] = { td: td, originRow: r };
          }
        }
        c += cs;
      }
    }
    return grid;
  }

  function cellText(cell) {
    return cell && cell.td ? cell.td.textContent.trim() : '';
  }

  /** 条件セルをパース。条件なし('-' や空) は null。 */
  function parseCond(td, name) {
    var raw = td.textContent.trim();
    if (!raw || raw === '-') return null;

    var spans = td.querySelectorAll('span');
    var normalText = spans.length ? spans[0].textContent : raw;
    var goldText = spans.length > 1 ? spans[1].textContent : null;

    var toValue = function (text) {
      var digits = text.replace(/[^\d]/g, '');
      return digits === '' ? null : parseInt(digits, 10);
    };

    var normal = toValue(normalText);
    if (normal === null) return null;

    var operator = /未満/.test(normalText) ? '<' : '>=';
    var value = { normal: normal };
    var gold = goldText !== null ? toValue(goldText) : null;
    if (gold !== null) value.gold = gold;

    return { name: name, operator: operator, value: value };
  }

  /** 曲行(sr)から part を構築（条件は後で割り当てるので空で返す）。 */
  function buildPart(grid, sr) {
    var titleTd = grid[sr][2].td;
    var anchor = titleTd.querySelector('a.rel-wiki-page') || titleTd.querySelector('a');
    var anchorText = anchor ? anchor.textContent.trim() : titleTd.textContent.trim();
    var link = anchor ? anchor.getAttribute('href') : undefined;

    var isUra = /\(裏\)/.test(anchorText);
    var title = anchorText
      .replace(/\(裏\)/g, '')
      .replace(/\*\d+$/, '')
      .trim();

    // むずかしさ: 例 "ふつう★×3"
    var diffRaw = grid[sr][3].td.textContent.trim();
    var diffWord = diffRaw.split('★')[0].trim();
    var level = isUra ? 'EXTRA' : (LEVEL_MAP[diffWord] || undefined);

    var chart = { level: level };
    var starMatch = diffRaw.match(/×\s*(\d+)/);
    if (starMatch) chart.star = parseInt(starMatch[1], 10);
    if (link) chart.link = link;

    return { songNumber: null, title: title, chart: chart, condition: [] };
  }

  function parseDaniiTable(table) {
    var tbody = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table.querySelector('tbody');
    var rows = rowsOf(tbody);
    var grid = buildGrid(rows);
    var result = {};

    for (var h = 0; h < rows.length; h++) {
      var head = cellText(grid[h][0]);
      // 曲順(1st/2nd/3rd) は曲行。それ以外を段位ヘッダ行とみなす
      if (!head || /^\d+(st|nd|rd|th)$/.test(head)) continue;

      var danName = head;
      var songRows = [h + 1, h + 2, h + 3];

      // 条件名（お題ヘッダ）
      var namesByCol = {};
      for (var ci = 0; ci < CONDITION_COLS.length; ci++) {
        var col = CONDITION_COLS[ci];
        namesByCol[col] = cellText(grid[h][col]);
      }

      // 各曲 part
      var parts = songRows.map(function (sr) { return buildPart(grid, sr); });
      var courseCondition = [];

      // 条件の割り当て
      for (var k = 0; k < CONDITION_COLS.length; k++) {
        var c = CONDITION_COLS[k];
        var name = namesByCol[c];
        if (!name || name === '-') continue;

        var cell1 = grid[songRows[0]][c];
        var cell2 = grid[songRows[1]][c];
        var cell3 = grid[songRows[2]][c];

        // rowspan で3曲を被覆 → 共通条件
        if (cell1 && cell2 && cell3 && cell1.td === cell2.td && cell2.td === cell3.td) {
          var common = parseCond(cell1.td, name);
          if (common) courseCondition.push(common);
          continue;
        }

        // 曲別条件
        for (var s = 0; s < songRows.length; s++) {
          var sr = songRows[s];
          var cell = grid[sr][c];
          if (!cell || cell.originRow !== sr) continue;
          var cond = parseCond(cell.td, name);
          if (cond) parts[s].condition.push(cond);
        }
      }

      result[danName] = { part: parts, condition: courseCondition };
    }

    return result;
  }

  // Node など devtools 外から require/import した場合に備えてエクスポート
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseDaniiTable: parseDaniiTable };
  }

  // --- 実行部（ブラウザ devtools 上でのみ自動実行） ---------------------------
  if (typeof document === 'undefined') return;

  var tables = document.querySelectorAll('#body > #content > .nobr > .h-scrollable > table');
  var table = tables[1]; // [list, detail] の detail
  if (!table) {
    console.error('段位道場テーブル(detail)が見つかりませんでした。セレクタを確認してください。');
    return;
  }

  var output = parseDaniiTable(table);
  var json = JSON.stringify(output, null, 2);
  console.log(json);
  try {
    if (typeof copy === 'function') {
      copy(json);
      console.log('%cJSON をクリップボードにコピーしました', 'color:#0a0');
    }
  } catch (e) {
    /* devtools 外では copy が無い */
  }
})();
