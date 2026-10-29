# Infinito Mourinho（mourinho-hp）

José Mourinho の非公式ファンサイト。旧 Netlify の単一ファイル版（https://magenta-otter-30fcbe.netlify.app/）を置き換える。
このファイルは、このリポジトリで作業するエージェントが毎回読む前提です。
短く保ち（100行以内）、手順の詳細は `docs/`・`.claude/skills/`・`README.md` に置きます。

## 目的と読者

- 読者は世界中の英語・スペイン語・ポルトガル語話者（日本語ではない）。オーナーは日本語で依頼する。
- 人気の海外ファンサイト並みの流入が目標。全ページを en/es/pt で用意し、hreflang・canonical・
  sitemap の alternates・言語ごとのスラッグを付ける。
- Cloudflare 無料プランで 1日15,000訪問以上に耐える設計にする。

## 構成

- `scripts/build.mjs` 依存ゼロの静的生成。`src/content/*.json` を `dist/` に出力する。
  英語は `/`、スペイン語は `/es/`、ポルトガル語は `/pt/`（`/history/`、`/es/historia/`、`/pt/frases/` など）。
- `src/content/` 全テキスト（`ui.json`・`quotes.json`・`episodes.json`・`history.json`・`videos.json`）。
  表示する文字列は必ず `en`・`es`・`pt` をそろえる。
- `src/assets/` `styles.css` と `app.js`（素の JS。フレームワーク・Tailwind・CDN は使わない）。
  `src/public/` は `dist/` 直下にコピーする（`_headers`・`_redirects`・favicon）。
- `lib/feeds.js` Google News RSS（言語ごとに2エディション）と、現所属クラブの ESPN 日程をサーバー側で取得・解析。
  `TEAM_ID`（86 = Real Madrid）は移籍したら変える。
- `workers/feeds/` Cron Trigger（20分ごと）で `FEEDS` KV に JSON を書く Worker。空の結果では上書きしない。
- `functions/api/news.js`・`functions/api/matches.js` KV をエッジキャッシュ経由で返す Pages Functions（`lib/serve.js`）。
  ブラウザが呼ぶのは自サイトの `/api/*` だけ。
- `docs/dev-flow.md` 開発フローの詳細。`docs/review-lessons.md` 過去の指摘メモ。
- `.claude/skills/pr-review/` AIレビューの指示（レビューのスレッドでだけ使う）。`.claude/skills/verify-flow/` 実画面での検証（`test/flows/`）。`.claude/hooks/verify.sh` 作業終了時の自動検証。

デプロイ手順（Pages プロジェクト `infinito-mourinho`、Worker `infinito-mourinho-feeds`、共有の KV `FEEDS`）は `README.md` を読む。

## コマンド

- 依存の導入: `npm ci`（wrangler のみ、開発用）
- ビルド: `npm run build`。`SITE_URL` に本番のオリジンを設定する（未設定なら pages.dev の URL）
- テスト: `npm test`（フィード解析とフォールバックの単体テスト、`node --test`）
- ローカル確認: `npm run dev`（http://localhost:8788、Pages Functions 込み）
- 実画面の検証: `npm run dev` のあと `npm run verify`（`test/flows/*.json`、PASS・FAIL・BLOCKED を返す）
- Worker のローカル実行: `npm run feeds:dev` のあと `curl "http://localhost:8787/__scheduled"`

lint と型チェックのスクリプトはまだない。`package.json` に存在するスクリプトだけが、Hooks で自動実行されます。

## 作業の流れ

1. 依頼の「目的」「背景」「完了条件」「やらないこと」を確認する。
   完了条件が読み取れなければ、着手する前に質問して埋める。
2. `docs/review-lessons.md` から、今回の作業に関係する行だけを検索して読む（全文を読まない）。
3. 大きめの作業だけ、計画をチェックリストで示してから実装する。
4. ブランチを切って作業する。広い調査はサブエージェントに任せ、要約だけ受け取る。
5. lint・型チェック・テストが通るまで完了としない（Hooks が自動で確認する）。
   Hooks は1回だけ完了を止め、2回目は無限ループを避けて通す。通ったあとも失敗が残っていれば、
   完了とせず、失敗をそのまま PR の「検証結果」に書いてユーザーに伝える。
   「できました」という自己申告ではなく、緑になった結果を PR に書く。
6. PR は `.github/pull_request_template.md` に沿って書き、CI が落ちたら自分で直す。
7. ユーザーに報告する前に、**実装とは別のスレッド**で `pr-review` スキルを使って AI レビューを受ける。
   「必須」の指摘がなくなるまで直して再レビューする。3周で終わらなければユーザーに判断を仰ぐ。
8. レビューが「合格」になったら、最終確認を依頼する前に、学びを `docs/review-lessons.md` に
   1行ずつ追記して同じ PR にコミットする（マージ後に別の PR を作らない）。

詳しくは `docs/dev-flow.md` を読むこと。

## サイトのルール

- ニュースや外部 API をブラウザから取得しない。無料の CORS/RSS プロキシ（rss2json、allorigins など）も使わない
  （旧サイトのニュースが壊れた原因）。
- フィードの文字列を `innerHTML` に入れない。`textContent` で DOM を組み立てる（`app.js` を参照）。
- 名言・エピソード・経歴は検証できる事実だけを書く。年や細部が不確かなら書かない。
- ページはサーバー側で描画する。内容は HTML に含め、JS は補助に限る。
- ブラウザの言語で自動リダイレクトしない（SEO に悪い）。`app.js` は閉じられる提案バナーを出すだけ。

## 運用のルール

- CLAUDE.md・`.claude/` の設定は作業中に編集しない。変更は週1回の整理 PR にまとめる
  （先頭部分が変わるとキャッシュが効かなくなるため）。
  例外は、ユーザーがその変更を依頼したとき。
- CLAUDE.md に日付など毎回変わる値を書かない。
- 使わない MCP サーバー・サブエージェント・スキルを登録しない。
- 1つの依頼に1つのスレッド。別の作業は新しいスレッドで始める。
- 秘密情報（APIキー、トークン、パスワード）をコミットしない。
