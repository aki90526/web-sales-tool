# Web制作営業支援ツール

Ver.1 の最初のマイルストーンとして、Google Sheets API に接続し、`営業管理` タブへテストデータを1件登録する最小構成です。

## セットアップ

1. 依存関係をインストールします。

```bash
npm install
```

2. `.env.example` を元に `.env` を作成し、Googleサービスアカウントの認証情報を設定します。

```env
GOOGLE_SPREADSHEET_ID=1F8VgiLEdtQ1Fs6qiN3FXtDl1Da1v6lR1nt_CDjBcCkk
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@your-project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
```

3. 対象スプレッドシートを、`GOOGLE_SERVICE_ACCOUNT_EMAIL` のメールアドレスに編集者として共有します。

4. 接続確認を実行します。

```bash
npm run test:sheets
```

成功すると、`営業管理` タブに `L-TEST-...` のテストリードが1件追加されます。

## 現在の対象

- Node.js
- TypeScript
- Google Sheets API

OpenAI API、Playwright、候補収集、サイト分析、送信支援は次フェーズで追加します。

## GitHub管理

`.env`、`node_modules/`、`dist/` はコミット対象外です。
GitHubにはソースコード、設定サンプル、仕様書、READMEのみを保存します。

## 次の実装ステップ

1. 候補企業の入力元を決める
   - 手動CSV
   - Google検索結果
   - Google Maps
   - 業界ポータル
2. 公式サイトURLと問い合わせURLを取得する
3. Playwrightで公式サイトをクロールする
4. OpenAI APIで改善ポイントと営業スコアを生成する
5. `営業管理` シートへ登録する
6. `メッセージテンプレート` を元に営業メッセージ案を生成する
7. 人間が確認して送信可否を判断する
