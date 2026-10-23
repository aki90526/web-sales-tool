<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# web-sales-tool: プロジェクト概要（Claude Code・Codex 共通）

阿部（aaWebCreate）が、自分のWeb制作の営業のために開発・運用している、営業支援ツール。
**Googleスプレッドシートをデータベースとして使う**。営業先の収集 → 連絡先の発見 → メール送信／フォーム自動入力 → 返信の同期 → 再送、までを扱う。
このファイルが、AIエージェント向けの「いまの仕様」の正。`SPEC.md` は初期の構想メモで、古い（先頭の注記を参照）。使い方の説明は `README.md`。

## 最優先のルール

- **実際のリード・クライアントに影響する操作を、検証のために行わない。** 本物のメール送信、本物のフォーム送信、実リードのステータス変更・メモ変更は、阿部の指示がない限りしない。確認は `--dry-run`、`--test-to`（自分宛）、テスト用データで行い、触ったものは必ず元に戻す。
- 秘密情報（`.env`）をコード・ログ・コミットに出さない。公開してよいキーと秘密キーを混同しない。
- 従量課金（OpenAI など）を使う処理を足すときは、課金の単位と想定コストを先に伝え、上限を入れる。
- 本番シートへの破壊的な変更（列の削除、型の変更、データの一括上書き）は、必ず事前に確認する。シート構造の変更は、何度実行しても同じ結果になる移行スクリプト（`src/scripts/migrateResendSettings.ts` を参考）にする。
- コミットは、1つの作業が終わるごとに行う。**AIの署名（Co-Authored-By など）は付けない。push は、阿部に頼まれたときだけ。**
- 返答・コミットメッセージ・コード内コメントは、既存に合わせる（コメントは日本語が多い）。

## 技術構成

- Next.js 16（App Router）+ React 19 + Tailwind v4 のダッシュボード（`app/`）。この Next.js は一般的な知識と違う点がある。書く前に `node_modules/next/dist/docs/` を読む（上の注意を参照）。
- CLI は ts-node の TypeScript（`src/scripts/*`、`package.json` の `scripts`）。ダッシュボードは、同じコードを呼ぶ（`src/dashboard/jobRunner.ts` が子プロセスとして起動し、標準出力の `[DASHBOARD_UPDATE]` / `[DASHBOARD_SUMMARY]` を画面に反映する）。
- Google Sheets は REST を自前で呼ぶ（`src/google/sheetsClient.ts`。`getValues` / `getFormulas` / `updateValues` / `appendValues` / `ensureColumns`）。
- フォーム自動入力は、リモートデバッグ付きの Chrome（ポート 9222）を `chrome-remote-interface` で操作する（`src/form/browserFormAutofill.ts`）。**送信ボタンは押さない**（人が確認して送る）。CAPTCHAは回避しない。
- メールは SMTP（nodemailer）で送り、返信・不達・面談予約の検知は Gmail API（`gmail:sync-replies`）。
- OpenAI は、営業先候補の収集と分析（`src/openai/`）。
- 認証: ダッシュボードは Tailscale Serve（tailnet 内のみ）経由。`proxy.ts` が `Tailscale-User-Login` ヘッダーと `DASHBOARD_ALLOWED_TAILSCALE_USER`（`.env`）を検査し、書き込み系の同一オリジンと JSON を強制する。

## ディレクトリ

- `app/` ページ（`/` ダッシュボード、`/leads` リード一覧、`/collect` 候補収集、`/actions` 実行操作、`/settings` 設定）と `app/api/*`（Route Handlers）。
- `src/domain/` ステータス・スコア・再送ルール（`lead.ts`, `resend.ts`, `resendRevert.ts`, `skipTracking.ts`, `scoring.ts`, `salesForbiddenDetection.ts`）。
- `src/collection/` 候補収集、連絡先の発見・検証、見送りの再確認（`rejectedRecheck.ts`）。
- `src/contact/` 文面の組み立て（`salesMessage.ts`）と、送信対象の判定（`formCandidates.ts`）。
- `src/email/` 送信ロック（二重送信防止）、不達・配信停止の検知。
- `src/form/` フォーム自動入力と関連の判定。
- `src/google/` シートの読み書き。`src/settings/` 設定画面の読み書き。
- `test/form-fixtures/` フォーム自動入力の回帰テスト用 HTML と期待値。
- `scripts/` macOS の LaunchAgent 関連（ダッシュボード常駐、毎朝の同期）。

## スプレッドシート（データベース）

シート名は `src/domain/lead.ts` の `SHEETS`。列は**見出しの名前で対応づける**（`salesManagementRepository.ts`。列の順序に依存しない）。

- **営業管理**: 1行1リード。リードID、企業名、ステータス、最終アプローチ日（数式）、次回対応日（数式）、営業先種別、業種、地域、公式サイトURL、連絡方法、フォームURL、メールアドレス、営業スコア、メモ、連絡回数（数式）、再確認までの日数。
- **アプローチ履歴**: 送信ごとに1行。A リードID / B 送信日時 / C 連絡方法 / D 宛先 / E 件名 / F 営業メッセージ / G 人間確認 / H 送信ステータス / I 返信状況（未返信・返信あり・再送案内・不達）/ J メモ。送信回数・グラフ・返信検知は、ここが元。
- **分析データ**（サイト分析・営業の切り口）、**設定**（再送間隔、送信者情報など。A=項目名, B=値）、**メッセージテンプレート**（A〜L。K=用途 初回/再送, L=連絡方法 メール/フォーム/空）、**除外リスト**（検索から除く会社）、**月次集計**。
- 「記録されていないもの」は、グラフや返信検知の対象にならない。送信済みにするときは、アプローチ履歴も残すこと。

## ステータスと連絡方法

- ステータス: 未確認 / 確認済み / 送信待ち / 送信済み / 返信あり / 面談済み / 商談中 / 保留 / 見送り / 除外。
- 連絡方法: フォーム / メール / 電話 / 未定。メールを登録したら、ステータスを問わず連絡方法はメール優先。
- **除外**: 配信停止・営業お断りの記載、返信での停止依頼など。自動処理は、除外のリードに触れない（再送・再確認の対象外）。
- **見送り**: 今は送れないリード（連絡先なし、フォームが使えない等）。メモに理由を残す。
- ステータスを変えるときは、メモに「ステータス変更: A → B (日時)」を1行足す（`app/api/leads/status/route.ts`。「元に戻す」はその行を消して戻す）。

## 再送・再確認の仕組み

- 再送の間隔: 初回の再送は前回送信から90日後、2回目以降は180日後（設定シート「再送間隔日数」「再送間隔日数（2回目以降）」。次回対応日の数式も同じ規則）。回数の上限はない。
- 毎朝9:00（LaunchAgent `com.websalestool.gmailsync` → `scripts/gmail-sync-scheduled.sh` → `npm run gmail:sync-replies`）に、(1) 返信・配信停止・不達・面談予約の反映、(2) 期日を過ぎて反応のない「送信済み」を「送信待ち」に戻す（`resendRevert.ts`。送信は手動のまま）、(3) 「見送り」の再確認（`rejectedRecheck.ts`。1回15件まで）、を順に行う。
- 見送りの再確認: 公式サイトが開く・営業お断りの記載がない・連絡先がある・フォームが依頼専用でない、を満たせば「送信待ち」に戻す。間隔は、リードごとの「再確認までの日数」（見送りにするとき選ぶ。「なし」は再確認しない）、なければ設定シートの「見送り再確認間隔日数」（30日）。返信のあったリードと「除外」は対象外。
- 2回目以降の送信は、メッセージテンプレートの「用途=再送」の文面を自動で使う（`{前回送信月}` などを差し込む）。文面は、シートまたは `/settings` で編集できる。
- 送信の安全装置: 送信直前の再確認、二重送信を防ぐロック（`src/email/sendLock.ts`）、送信記録を先に残してから SMTP、フォームは10分以内の二重記録を拒否。

## よく使うコマンド

```bash
npm run dashboard:build          # app/ を含む本番ビルド。型チェックの代わりにもなる
npm run dashboard:dev            # 開発サーバー（ポート 3100）
npx tsc --noEmit -p .            # 型チェック。対象は src/ のみ（app/ は dashboard:build で確認する）
npm run test:forms               # フォーム自動入力の回帰テスト（test/form-fixtures）
npm run send:emails -- --dry-run # メール送信の確認。--test-to 自分のアドレス で試験送信
npm run gmail:sync-replies -- --dry-run
npm run leads:recheck-rejected -- --dry-run
npm run settings:migrate-resend  # 再送・見送りまわりのシート整備（何度でも実行できる）
./scripts/services.sh restart    # コード更新後に、常駐のダッシュボードを再起動する
```

常駐のダッシュボードは `next start`（LaunchAgent `com.websalestool.dashboard`、ポート 3100）。**コードを変えたら `npm run dashboard:build` のあとに再起動する**。画面の確認は、Tailscale のURL（`https://aasales.tail682a27.ts.net:8443`）をユーザーの Chrome で開く。

## ハマりやすい点

- `tsc --noEmit -p .` は `app/` を検査しない。画面側の型エラーは `npm run dashboard:build` で初めて出る。
- Tailwind v4: `text-[var(--accent)]` のような任意値は CSS が生成されない場合がある（`.link-accent` を使う）。保存したサイトの HTML（`test/`、`data/`）を Tailwind が走査しないよう、`app/globals.css` の `@source not` で除外している。
- フォーム自動入力の判定ロジック（`pageAutofill` と、そこから呼ばれる関数）は、ブラウザ内に注入するため、ヘルパー関数が複製されている。直すときは複製側も同じに直す。直したら `npm run test:forms` を通す。実サイトで直した不具合は、HTML を `test/form-fixtures/` に保存し、期待値の `*.expected.json` を足して再発を防ぐ。
- macOS の `sed -i` は、拡張子の引数（`-i ''`）が要る。複数行の置換は、Python などで行うと安全。
- シートの数式セルは、`updateValues` に `allowFormulas: true` を付けないと、文字列として無効化される（`=` で始まる文字列を守るため）。
- 営業スコアの閾値・営業先種別ごとの判定は `src/domain/scoring.ts`。収集の検索除外は、検索エリア内の登録済みの会社 + 「除外リスト」シート。

## 法務・運用の注意

- 営業メールには、送信者の住所・連絡先と、配信停止の案内を必ず入れる（特定電子メール法。`buildSalesBody` が自動で付ける）。
- スクレイピング・個人情報・業法に関わる変更は、着手前に阿部に伝える。
