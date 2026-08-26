# Web制作営業支援ツール

Ver.1 の最初のマイルストーンとして、Google Sheets API と OpenAI API に接続し、候補企業を検索して `営業管理` タブへ下書き登録する最小構成です。

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
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.6-luna
```

3. 対象スプレッドシートを、`GOOGLE_SERVICE_ACCOUNT_EMAIL` のメールアドレスに編集者として共有します。

4. 接続確認を実行します。

```bash
npm run test:sheets
```

成功すると、`営業管理` タブに `L-TEST-...` のテストリードが1件追加されます。

## 候補収集

OpenAI の web_search を使って候補企業を検索し、`営業管理` タブへ追加します。
初期運用では費用と誤登録を抑えるため、1回の実行上限は10件です。

```bash
npm run collect -- --area "埼玉県春日部市" --target "制作会社,直クライアント" --limit 10
```

スプレッドシートへ追加せず、結果だけ確認する場合:

```bash
npm run collect -- --area "埼玉県春日部市" --target "制作会社,直クライアント" --limit 5 --dry-run
```

このコマンドはリード登録までです。メール送信やフォーム送信は行いません。

## 現在の対象

- Node.js
- TypeScript
- Google Sheets API
- OpenAI Responses API
- OpenAI web_search

フォーム送信、メール送信、Playwright による深いサイトクロールは次フェーズで追加します。

## GitHub管理

`.env`、`node_modules/`、`dist/` はコミット対象外です。
GitHubにはソースコード、設定サンプル、仕様書、READMEのみを保存します。

## 次の実装ステップ

1. 収集結果を人間が確認し、スコアや送信可否の基準を調整する
2. 公式サイトの深いクロールを追加する
3. 送信前レビュー用の一覧・下書き生成を強化する
4. 人間承認後のメール送信またはフォーム入力支援を追加する
