/**
 * レシート振り分けツールの設定。
 * 使う前に SOURCE_FOLDER_ID と DEST_ROOT_FOLDER_ID を自分のフォルダIDに書き換えてください。
 * フォルダIDは Google ドライブでフォルダを開いたときの URL
 *   https://drive.google.com/drive/folders/XXXXXXXXXXXX
 * の XXXXXXXXXXXX の部分です。
 */
var CONFIG = {
  // レシート画像を入れておく「受信箱」フォルダ
  SOURCE_FOLDER_ID: 'ここに受信箱フォルダのIDを入れる',

  // 振り分け先のルートフォルダ(この下に年月・カテゴリのフォルダが自動で作られる)
  DEST_ROOT_FOLDER_ID: 'ここに振り分け先フォルダのIDを入れる',

  // 振り分け先のフォルダ構成。{yyyy} {mm} {category} が使えます。
  // 例: '{category}/{yyyy}-{mm}' にするとカテゴリ別 → 月別になります。
  FOLDER_PATH_TEMPLATE: '{yyyy}年/{mm}月/{category}',

  // 振り分け後のファイル名。{date} {store} {amount} {category} が使えます(拡張子は自動)。
  FILE_NAME_TEMPLATE: '{date}_{store}_{amount}円',

  // 日付が読み取れなかったレシートを入れるフォルダ名(DEST_ROOT_FOLDER_ID の直下に作られる)
  REVIEW_FOLDER_NAME: '要確認',

  // 処理結果を記録するスプレッドシートのID。空欄なら初回実行時に振り分け先フォルダ内へ自動作成します。
  LOG_SPREADSHEET_ID: '',

  // 1回の実行で処理する時間の上限(ミリ秒)。Apps Script の6分制限より短くしておく。
  MAX_RUNTIME_MS: 5 * 60 * 1000,

  // OCR の言語
  OCR_LANGUAGE: 'ja',

  // カテゴリ判定ルール。まず店名、次にレシート本文全体で、上から順にキーワードを探します。
  // (支払方法の「Suica」などは本文のどこにでも出るので、キーワードには入れないのがおすすめ)
  // どれにも当てはまらなければ DEFAULT_CATEGORY になります。
  CATEGORIES: [
    { name: '交通費', keywords: ['JR', '鉄道', '乗車券', '切符', 'タクシー', '交通', 'バス運賃', '高速', 'ETC', '駐車場', 'パーキング', 'ガソリン', 'ENEOS', '出光', 'コスモ石油'] },
    { name: '飲食', keywords: ['レストラン', '食堂', 'カフェ', 'CAFE', 'Cafe', 'コーヒー', '珈琲', 'スターバックス', 'STARBUCKS', 'ドトール', 'タリーズ', 'マクドナルド', '吉野家', 'すき家', '松屋', '居酒屋', 'ラーメン', '寿司', '焼肉', 'ガスト', 'サイゼリヤ', 'ランチ', '飲食'] },
    { name: '食料品・日用品', keywords: ['スーパー', 'イオン', 'AEON', 'イトーヨーカドー', '西友', 'ライフ', 'マルエツ', 'セブン-イレブン', 'セブンイレブン', 'ローソン', 'LAWSON', 'ファミリーマート', 'FamilyMart', 'ミニストップ', 'ドラッグ', 'マツモトキヨシ', 'ウエルシア', 'ツルハ', 'スギ薬局', 'ダイソー', 'DAISO', 'セリア', 'ニトリ'] },
    { name: '書籍・文具', keywords: ['書店', '書房', 'ブックス', 'BOOKS', '紀伊國屋', '丸善', 'ジュンク堂', 'TSUTAYA', '文具', '文房具', 'ロフト', 'LOFT', '東急ハンズ'] },
    { name: '家電・PC', keywords: ['ヨドバシ', 'ビックカメラ', 'BIC CAMERA', 'ヤマダ電機', 'ケーズデンキ', 'エディオン', 'ノジマ', 'Apple', 'アップル'] },
    { name: '通信・郵便', keywords: ['郵便局', '日本郵便', 'ヤマト運輸', '佐川', 'docomo', 'ドコモ', 'KDDI', 'ソフトバンク', 'SoftBank', '切手'] },
    { name: '医療', keywords: ['病院', 'クリニック', '医院', '歯科', '調剤', '薬局', '診療'] },
    { name: '宿泊', keywords: ['ホテル', 'HOTEL', 'Hotel', '旅館', '宿泊'] }
  ],
  DEFAULT_CATEGORY: 'その他'
};
