const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Apps Script と同じように、src のファイルを1つのグローバル空間に読み込む
const context = vm.createContext({});
for (const file of ['Config.js', 'Parser.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', file), 'utf8'), context, { filename: file });
}
const { CONFIG, analyzeReceipt, parseReceiptDate, parseReceiptTotal, parseReceiptStore, buildDestination, sanitizeName } = context;
const NOW = new Date(2026, 8, 27);

test('コンビニのレシート(全角数字・点数つき合計)', () => {
  const text = [
    'セブン-イレブン',
    '渋谷駅前店',
    '東京都渋谷区道玄坂1-2-3',
    'TEL 03-1234-5678',
    '領収書',
    '２０２６年９月２５日(木) １２:３４',
    'おにぎり        ¥150',
    'お茶            ¥138',
    '小計            ¥288',
    '(8%対象 ¥288)',
    '(内消費税等 ¥21)',
    '合計 2点        ¥311',
    'お預り          ¥1,000',
    'お釣            ¥689'
  ].join('\n');
  const r = analyzeReceipt(text, CONFIG, NOW);
  assert.strictEqual(r.date.iso, '2026-09-25');
  assert.strictEqual(r.total, 311);
  assert.strictEqual(r.store, 'セブン-イレブン');
  assert.strictEqual(r.category, '食料品・日用品');
});

test('合計と金額が別の行に分かれている', () => {
  const text = 'カフェ・ド・ホゲ\n2026/09/01 10:00\nブレンド 480\n合計\n¥1,280\nお預かり ¥2,000';
  assert.strictEqual(parseReceiptTotal(text), 1280);
  assert.strictEqual(analyzeReceipt(text, CONFIG, NOW).category, '飲食');
});

test('令和・2桁年・区切り文字のバリエーション', () => {
  assert.strictEqual(parseReceiptDate('令和8年9月3日', NOW).iso, '2026-09-03');
  assert.strictEqual(parseReceiptDate('R8.1.15 10:00', NOW).iso, '2026-01-15');
  assert.strictEqual(parseReceiptDate('日付 26/09/20 18:22', NOW).iso, '2026-09-20');
  assert.strictEqual(parseReceiptDate('2026-9-2', NOW).iso, '2026-09-02');
});

test('ありえない日付・未来の日付は使わない', () => {
  assert.strictEqual(parseReceiptDate('2026/13/40', NOW), null);
  assert.strictEqual(parseReceiptDate('2027/01/01', NOW), null);
  assert.strictEqual(parseReceiptDate('日付なし', NOW), null);
});

test('合計行がないときは ¥/円 付きの最大額(預り・釣は除く)', () => {
  const text = 'ホゲ商店\nりんご 300円\nみかん 500円\nお預り 1000円\nお釣 200円';
  assert.strictEqual(parseReceiptTotal(text), 500);
});

test('OCR で区切りに空白が入った金額・円マークのバックスラッシュ', () => {
  assert.strictEqual(parseReceiptTotal('合計 \\12, 345'), 12345);
  assert.strictEqual(parseReceiptTotal('お支払金額 3,300円'), 3300);
});

test('店名の推定で住所・電話・日付・記号行を飛ばす', () => {
  const text = '********\n〒150-0001\n2026/09/01\nTEL 03-0000-0000\nヨドバシカメラ 新宿西口本店';
  assert.strictEqual(parseReceiptStore(text), 'ヨドバシカメラ 新宿西口本店');
});

test('振り分け先フォルダとファイル名', () => {
  const dest = buildDestination(
    { date: { year: 2026, month: 9, day: 5, iso: '2026-09-05' }, total: 1500, store: 'A/B:店', category: '飲食' },
    CONFIG
  );
  assert.deepStrictEqual(Array.from(dest.folders), ['2026年', '09月', '飲食']);
  assert.strictEqual(dest.fileName, '2026-09-05_A_B_店_1500円');

  const unknown = buildDestination(
    { date: { year: 2026, month: 1, day: 2, iso: '2026-01-02' }, total: null, store: '', category: 'その他' },
    CONFIG
  );
  assert.strictEqual(unknown.fileName, '2026-01-02_店名不明_金額不明円');
});

test('ファイル名に使えない文字を置き換える', () => {
  assert.strictEqual(sanitizeName(' a\\b/c:d*e?f"g<h>i|j \n'), 'a_b_c_d_e_f_g_h_i_j _');
});
