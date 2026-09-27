# neoneo

## レシート処理(「処理して」と言われたら)

Google ドライブ(マイドライブ)のレシート画像を読み取って家計簿 CSV に記録する作業。Google Drive コネクタ(`mcp__Google_Drive__*`)を使う。

### 対象
- **`receipts` フォルダ直下の画像だけ**を処理する(フォルダID `1QSLdUJE0UopHmSu98a6OxrQgj9JDV521`)。
- ほかのフォルダの画像には触らない。
- `receipts/.claude/`、`process_receipts.py`、既存の CSV は変更しない。

### 手順
1. `receipts` 直下の画像を探す(`parentId = '1QSLdUJE0UopHmSu98a6OxrQgj9JDV521' and mimeType contains 'image/'`)。結果はページ分割されるので `nextPageToken` を最後までたどる。
2. 画像を `download_file_content` で取得する(大きいとツール結果がファイルに保存される)。HEIC は Pillow + pillow-heif で JPEG(長辺 1400px 程度)に変換して読む。
3. 1枚ずつ読み取って、次の列で記録する。
   `日付,店舗,カテゴリ,金額,ファイル名,備考`
   - 日付: `YYYY-MM-DD`
   - 店舗: チェーン名 + 店名(例: `カネスエ 大津レイクサイドガーデン店`、`得得 草津店`)
   - カテゴリ: 既存のものに合わせる(外食 / 食料品 / コンビニ / 薬局・日用品 / エンタメ・ゲーム / エンタメ / 家電・その他 / 車・サービス / 駐車場 / 雑貨 / 衣料品 / 家具・日用品 / ネットショッピング)
   - 金額: 税込の合計(数字のみ、円記号やカンマなし)
   - 備考: 支払方法(クレジット / 現金 / au PAY / SmartCode など)。特記事項があれば ` / ` で続ける
4. 月ごとに `expenses_YYYY-MM.csv` として `receipts` に保存する(UTF-8、BOM なし、`disableConversionToGoogleType: true`)。
   - コネクタでは既存ファイルの中身を書き換えられない。同じ月のファイルがすでにある場合は、既存の行を読み込んで新しい行と合わせ、日付順に並べた内容でファイルを作り直す。古いファイルの扱いはユーザーに確認する。
5. 記録した画像を `done` フォルダ(ID `1ZqXit7l0OUtOXM_9A8vNVq-JSKsr0Ffp`)へ移動する(`update_file` の `parentId`)。
6. `receipts` に画像が残っていないことを確認して報告する。

### 注意
- 同じ支払いのレシートと決済アプリの通知スクリーンショットが両方ある場合は、二重に記録しない(例: `IMG_1898.PNG` は `IMG_1896.HEIC` と同じ支払い)。
- 古い日付のレシートや、中身が分からない売上票(カード控えのみなど)は、記録したうえで報告時に伝える。
