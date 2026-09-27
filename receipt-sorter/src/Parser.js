/**
 * OCR で読み取ったレシートの文字列から、日付・合計金額・店名・カテゴリを取り出す。
 * Google のサービスには依存しない純粋な関数だけを置いている(Node でテストできるように)。
 */

/** 全角英数字・全角記号を半角にそろえ、OCR でよく崩れる文字を直す。 */
function normalizeReceiptText(text) {
  return String(text || '')
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\\￥]/g, '¥')
    // 「1, 234」「1. 234」のように区切りの後ろに空白が入ったものをつなげる
    .replace(/(\d)([,.])\s+(\d{3})(?!\d)/g, '$1,$3');
}

function splitLines_(text) {
  return normalizeReceiptText(text)
    .split('\n')
    .map(function (line) { return line.replace(/\s+/g, ' ').trim(); })
    .filter(function (line) { return line.length > 0; });
}

function isValidDate_(y, m, d, now) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  var date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return false;
  if (y < 2000) return false;
  if (now) {
    var limit = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    if (date > limit) return false;
  }
  return true;
}

function pad2_(n) {
  return (n < 10 ? '0' : '') + n;
}

/**
 * レシート本文から日付を探す。見つからなければ null。
 * 対応: 2024年9月27日 / 2024/09/27 / 2024-9-27 / 2024.09.27 / 令和6年9月27日 / R6.9.27 / 24/09/27
 */
function parseReceiptDate(text, now) {
  var normalized = normalizeReceiptText(text);
  var patterns = [
    { re: /(?:令和|R)\s*(\d{1,2}|元)\s*[年.\/]\s*(\d{1,2})\s*[月.\/]\s*(\d{1,2})/g, year: function (s) { return 2018 + (s === '元' ? 1 : Number(s)); } },
    { re: /(20\d{2})\s*[年\/\-.]\s*(\d{1,2})\s*[月\/\-.]\s*(\d{1,2})/g, year: function (s) { return Number(s); } },
    { re: /(?:^|[^\d])(\d{2})[\/.](\d{1,2})[\/.](\d{1,2})(?!\d)/g, year: function (s) { return 2000 + Number(s); } }
  ];
  for (var i = 0; i < patterns.length; i++) {
    var p = patterns[i];
    p.re.lastIndex = 0;
    var m;
    while ((m = p.re.exec(normalized)) !== null) {
      var y = p.year(m[1]);
      var mo = Number(m[2]);
      var d = Number(m[3]);
      if (isValidDate_(y, mo, d, now)) {
        return { year: y, month: mo, day: d, iso: y + '-' + pad2_(mo) + '-' + pad2_(d) };
      }
    }
  }
  return null;
}

var TOTAL_KEYWORD_RE = /(合\s*計|総\s*計|お買上げ?計|お買い?上げ?金額|ご請求額|ご利用金額|領収金額|お支払い?金額|お会計|TOTAL)/i;
var AMOUNT_EXCLUDE_RE = /(小\s*計|対象|内税|消費税|税額|外税|預り|預かり|お預|釣|おつり|ポイント|値引|割引|点数)/;

/** 1行の中から金額らしい数字を取り出す。「3点」「10%」などは除く。 */
function extractAmounts_(line) {
  var re = /(¥\s*)?(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])\s*(円)?(\s*[点個%％])?/g;
  var all = [];
  var marked = [];
  var m;
  while ((m = re.exec(line)) !== null) {
    if (m[4]) continue;
    var value = Number(m[2].replace(/,/g, ''));
    if (!isFinite(value) || value <= 0 || value >= 10000000) continue;
    all.push(value);
    if (m[1] || m[3]) marked.push(value);
  }
  return { all: all, marked: marked };
}

/** 合計金額(円)を探す。見つからなければ null。 */
function parseReceiptTotal(text) {
  var lines = splitLines_(text);
  var candidates = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (!TOTAL_KEYWORD_RE.test(line) || AMOUNT_EXCLUDE_RE.test(line)) continue;
    var amounts = extractAmounts_(line);
    // 「合計」と金額が別の行に分かれて読み取られることがあるので、次の行も見る
    if (amounts.all.length === 0 && i + 1 < lines.length && !AMOUNT_EXCLUDE_RE.test(lines[i + 1])) {
      amounts = extractAmounts_(lines[i + 1]);
    }
    if (amounts.all.length > 0) {
      var list = amounts.marked.length > 0 ? amounts.marked : amounts.all;
      candidates.push(list[list.length - 1]);
    }
  }
  if (candidates.length > 0) return Math.max.apply(null, candidates);

  // 合計の行が見つからないときは、¥ や 円 の付いた金額のうち最大のものを使う
  var fallback = [];
  lines.forEach(function (line) {
    if (AMOUNT_EXCLUDE_RE.test(line)) return;
    fallback = fallback.concat(extractAmounts_(line).marked);
  });
  return fallback.length > 0 ? Math.max.apply(null, fallback) : null;
}

var STORE_SKIP_RE = /(領収|レシート|receipt|ありがと|いらっしゃ|毎度|登録番号|T\d{13}|TEL|電話|FAX|〒|営業時間|http|www\.|レジ|担当|No\.|伝票)/i;
var ADDRESS_RE = /[都道府県].{0,12}[市区町村郡]|\d+丁目|\d+-\d+-\d+/;
var PHONE_RE = /\d{2,4}-\d{2,4}-\d{3,4}/;

/** 店名を推定する(レシート上部の、住所・電話・日付ではない最初の行)。見つからなければ ''。 */
function parseReceiptStore(text) {
  var lines = splitLines_(text).slice(0, 10);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.length < 2) continue;
    if (/^[\d\s¥,.:\-\/()*#=_~+|]+$/.test(line)) continue;
    if (STORE_SKIP_RE.test(line) || ADDRESS_RE.test(line) || PHONE_RE.test(line)) continue;
    if (parseReceiptDate(line, null)) continue;
    return line.slice(0, 30).trim();
  }
  return '';
}

/** カテゴリを判定する。店名を優先し、見つからなければ本文全体で探す。 */
function categorizeReceipt(store, text, categories, defaultCategory) {
  var targets = [store || '', normalizeReceiptText(text)];
  for (var t = 0; t < targets.length; t++) {
    if (!targets[t]) continue;
    for (var i = 0; i < categories.length; i++) {
      var keywords = categories[i].keywords || [];
      for (var k = 0; k < keywords.length; k++) {
        if (targets[t].indexOf(keywords[k].normalize('NFKC')) !== -1) return categories[i].name;
      }
    }
  }
  return defaultCategory;
}

/** レシート本文をまとめて解析する。 */
function analyzeReceipt(text, config, now) {
  var store = parseReceiptStore(text);
  return {
    date: parseReceiptDate(text, now || new Date()),
    total: parseReceiptTotal(text),
    store: store,
    category: categorizeReceipt(store, text, config.CATEGORIES, config.DEFAULT_CATEGORY)
  };
}

/** Google ドライブのファイル名・フォルダ名に使えない/紛らわしい文字を置き換える。 */
function sanitizeName(name, maxLength) {
  var cleaned = String(name || '')
    .replace(/[\\\/:*?"<>|\n\r\t]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, maxLength || 80);
}

/** '{date}_{store}' のようなテンプレートに値を埋め込む。 */
function fillTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, function (all, key) {
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : all;
  });
}

/** 解析結果から、振り分け先のフォルダパス(配列)と新しいファイル名(拡張子なし)を作る。 */
function buildDestination(result, config) {
  var values = {
    yyyy: String(result.date.year),
    mm: pad2_(result.date.month),
    dd: pad2_(result.date.day),
    date: result.date.iso,
    store: sanitizeName(result.store || '店名不明', 30),
    amount: result.total !== null && result.total !== undefined ? String(result.total) : '金額不明',
    category: sanitizeName(result.category, 30)
  };
  var folders = fillTemplate(config.FOLDER_PATH_TEMPLATE, values)
    .split('/')
    .map(function (part) { return sanitizeName(part, 50); })
    .filter(function (part) { return part.length > 0; });
  return { folders: folders, fileName: sanitizeName(fillTemplate(config.FILE_NAME_TEMPLATE, values), 100) };
}
