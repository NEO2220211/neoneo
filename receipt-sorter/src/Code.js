/**
 * マイドライブの「受信箱」フォルダにあるレシート画像を OCR で読み取り、
 * 日付・店名・金額でファイル名を付け直して、年月・カテゴリ別のフォルダへ振り分ける。
 *
 * 使い方(詳しくは README.md):
 *   1. Config.js の SOURCE_FOLDER_ID / DEST_ROOT_FOLDER_ID を設定
 *   2. previewReceipts() を実行して、読み取り結果をログで確認(ファイルは動かさない)
 *   3. processReceipts() を実行して振り分け
 *   4. 自動で動かしたいときは setupTrigger() を1回実行(1時間ごとに processReceipts が動く)
 */

var OCR_SUPPORTED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
// Drive の OCR は大きすぎる画像を受け付けないので、これを超える画像は縮小版で読み取る
var OCR_MAX_BYTES = 2 * 1024 * 1024;
var LOG_HEADERS = ['処理日時', '元のファイル名', '新しいファイル名', '日付', '店名', '金額', 'カテゴリ', '状態', '保存先', 'ファイルURL', 'メモ'];

/** 受信箱のレシートをすべて振り分ける(メインの処理)。 */
function processReceipts() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log('前回の処理がまだ動いているので、今回はスキップします。');
    return;
  }
  try {
    var startedAt = Date.now();
    var source = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID);
    var destRoot = DriveApp.getFolderById(CONFIG.DEST_ROOT_FOLDER_ID);
    var logSheet = getLogSheet_(destRoot);
    var folderCache = {};
    var counts = { done: 0, review: 0 };

    var files = source.getFiles();
    while (files.hasNext()) {
      if (Date.now() - startedAt > CONFIG.MAX_RUNTIME_MS) {
        Logger.log('時間の上限に達したので、残りは次回の実行で処理します。');
        break;
      }
      var file = files.next();
      var mimeType = file.getMimeType();
      if (mimeType.indexOf('image/') !== 0 && mimeType !== 'application/pdf') continue;

      var status = processOneReceipt_(file, destRoot, folderCache);
      appendLog_(logSheet, status);
      counts[status.state === '振り分け済み' ? 'done' : 'review']++;
    }
    Logger.log('振り分け済み: ' + counts.done + '件 / 要確認: ' + counts.review + '件');
  } finally {
    lock.releaseLock();
  }
}

/** 1枚のレシートを処理して、ログに書く内容を返す。 */
function processOneReceipt_(file, destRoot, folderCache) {
  var status = {
    originalName: file.getName(),
    newName: '',
    result: null,
    state: '',
    folderPath: '',
    url: file.getUrl(),
    memo: ''
  };
  try {
    if (OCR_SUPPORTED_MIME_TYPES.indexOf(file.getMimeType()) === -1) {
      return moveToReview_(file, destRoot, folderCache, status,
        'OCR 非対応の形式です(' + file.getMimeType() + ')。JPEG / PNG / PDF で保存し直してください。');
    }

    var text = ocrFile_(file);
    var result = analyzeReceipt(text, CONFIG, new Date());
    status.result = result;
    if (!result.date) {
      return moveToReview_(file, destRoot, folderCache, status, '日付を読み取れませんでした。');
    }

    var dest = buildDestination(result, CONFIG);
    var folder = getOrCreateFolderPath_(destRoot, dest.folders, folderCache);
    var newName = uniqueFileName_(folder, dest.fileName, getExtension_(file));
    file.setName(newName);
    file.moveTo(folder);

    status.newName = newName;
    status.state = '振り分け済み';
    status.folderPath = dest.folders.join('/');
    if (result.total === null) status.memo = '金額を読み取れませんでした。';
    if (!result.store) status.memo += '店名を読み取れませんでした。';
    return status;
  } catch (e) {
    return moveToReview_(file, destRoot, folderCache, status, 'エラー: ' + (e && e.message ? e.message : e));
  }
}

function moveToReview_(file, destRoot, folderCache, status, memo) {
  var folder = getOrCreateFolderPath_(destRoot, [CONFIG.REVIEW_FOLDER_NAME], folderCache);
  file.moveTo(folder);
  status.state = '要確認';
  status.folderPath = CONFIG.REVIEW_FOLDER_NAME;
  status.memo = memo;
  return status;
}

/**
 * Drive の OCR でファイルの文字を読み取る。
 * 一時的に Google ドキュメントに変換して本文を取り出し、変換したドキュメントはすぐに削除する。
 */
function ocrFile_(file) {
  var created = Drive.Files.create(
    { name: 'receipt-ocr-tmp-' + file.getId(), mimeType: MimeType.GOOGLE_DOCS },
    getOcrBlob_(file),
    { ocrLanguage: CONFIG.OCR_LANGUAGE, fields: 'id' }
  );
  try {
    return DocumentApp.openById(created.id).getBody().getText();
  } finally {
    Drive.Files.remove(created.id);
  }
}

/** 大きな画像は Drive のサムネイル機能で縮小した画像を使う(失敗したら元の画像のまま)。 */
function getOcrBlob_(file) {
  var blob = file.getBlob();
  if (file.getSize() <= OCR_MAX_BYTES || file.getMimeType() === 'application/pdf') return blob;
  try {
    var meta = Drive.Files.get(file.getId(), { fields: 'thumbnailLink' });
    if (!meta.thumbnailLink) return blob;
    var url = meta.thumbnailLink.replace(/=s\d+$/, '') + '=s2000';
    var response = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() !== 200) return blob;
    return response.getBlob().setName(file.getName());
  } catch (e) {
    Logger.log('縮小画像を取得できなかったので元の画像で読み取ります: ' + e);
    return blob;
  }
}

function getOrCreateFolderPath_(root, names, cache) {
  var folder = root;
  var key = root.getId();
  names.forEach(function (name) {
    key += '/' + name;
    if (!cache[key]) {
      var existing = folder.getFoldersByName(name);
      cache[key] = existing.hasNext() ? existing.next() : folder.createFolder(name);
    }
    folder = cache[key];
  });
  return folder;
}

function getExtension_(file) {
  var match = file.getName().match(/\.[A-Za-z0-9]{1,5}$/);
  if (match) return match[0].toLowerCase();
  var byMime = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'application/pdf': '.pdf' };
  return byMime[file.getMimeType()] || '';
}

/** 同じ名前のファイルがあれば「(2)」「(3)」…を付ける。 */
function uniqueFileName_(folder, baseName, extension) {
  var name = baseName + extension;
  for (var i = 2; folder.getFilesByName(name).hasNext(); i++) {
    name = baseName + ' (' + i + ')' + extension;
  }
  return name;
}

/** 処理ログのシートを取得する。未設定なら振り分け先フォルダに新しく作る。 */
function getLogSheet_(destRoot) {
  var props = PropertiesService.getScriptProperties();
  var id = CONFIG.LOG_SPREADSHEET_ID || props.getProperty('LOG_SPREADSHEET_ID');
  var spreadsheet = null;
  if (id) {
    try {
      spreadsheet = SpreadsheetApp.openById(id);
    } catch (e) {
      Logger.log('ログ用スプレッドシートを開けなかったので作り直します: ' + e);
    }
  }
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('レシート処理ログ');
    DriveApp.getFileById(spreadsheet.getId()).moveTo(destRoot);
    props.setProperty('LOG_SPREADSHEET_ID', spreadsheet.getId());
  }
  var sheet = spreadsheet.getSheets()[0];
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(LOG_HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLog_(sheet, status) {
  var r = status.result || {};
  sheet.appendRow([
    new Date(),
    status.originalName,
    status.newName,
    r.date ? r.date.iso : '',
    r.store || '',
    r.total !== null && r.total !== undefined ? r.total : '',
    r.category || '',
    status.state,
    status.folderPath,
    status.url,
    status.memo
  ]);
}

/**
 * 受信箱のレシートを最大10件だけ読み取って、結果をログに出す。
 * ファイルは移動も名前変更もしないので、設定の確認に使ってください。
 */
function previewReceipts() {
  var files = DriveApp.getFolderById(CONFIG.SOURCE_FOLDER_ID).getFiles();
  var count = 0;
  while (files.hasNext() && count < 10) {
    var file = files.next();
    if (OCR_SUPPORTED_MIME_TYPES.indexOf(file.getMimeType()) === -1) continue;
    count++;
    var result = analyzeReceipt(ocrFile_(file), CONFIG, new Date());
    var line = '■ ' + file.getName() + '\n  日付: ' + (result.date ? result.date.iso : '(読み取れず → 要確認へ)') +
      '\n  店名: ' + (result.store || '(不明)') +
      '\n  金額: ' + (result.total !== null ? result.total + '円' : '(不明)') +
      '\n  カテゴリ: ' + result.category;
    if (result.date) {
      var dest = buildDestination(result, CONFIG);
      line += '\n  → ' + dest.folders.join('/') + '/' + dest.fileName + getExtension_(file);
    }
    Logger.log(line);
  }
  if (count === 0) Logger.log('受信箱に読み取れるレシート画像がありません。');
}

/** processReceipts を1時間ごとに自動実行するトリガーを設定する。 */
function setupTrigger() {
  removeTriggers();
  ScriptApp.newTrigger('processReceipts').timeBased().everyHours(1).create();
  Logger.log('1時間ごとの自動実行を設定しました。');
}

/** 自動実行を止める。 */
function removeTriggers() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'processReceipts') ScriptApp.deleteTrigger(trigger);
  });
}
