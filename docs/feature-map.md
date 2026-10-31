# 機能マップ

「どのページに何があり、どう操作し、何で確かめるか」の地図です。バグ報告や依頼を受けたら、
まずここで場所（ページ・テンプレートの関数・要素）と既存の検証フローを探し、実装と `npm run verify` の対象を決めます。

- ページを足す・消す、操作できる要素を足す、`test/flows/` にフローを足すときは、同じ PR でここも直します。
- `test/rules.test.mjs` が、ページの種類・フロー・要素の id がここと実物で食い違っていないかを CI で確かめます。
- パスは英語・スペイン語・ポルトガル語の順です（`src/content/ui.json` の `slugs`）。日本語は `/ja/` に英語のスラッグを付けたパスです（`/ja/history/`、On this day の月は `/ja/on-this-day/5/` のように数字）。

## ページ

| キー | パス（en / es / pt） | 描画する関数（`scripts/build.mjs`） | 主な中身 |
|---|---|---|---|
| `home` | `/` ・ `/es/` ・ `/pt/` | `homePage` | 次の試合とカウントダウン、ニュース、発言、今日の名言とエピソード、今日の出来事、経歴の入口、動画 |
| `quotes` | `/quotes/` ・ `/es/frases/` ・ `/pt/frases/` | `quotesPage` | 名言とエピソードの一覧、テーマ（タグ）の一覧 |
| `tags` | `/quotes/tag/<タグ>/` ・ `/es/frases/tema/<タグ>/` ・ `/pt/frases/tema/<タグ>/` | `tagPage` | テーマごとの名言 |
| `stories` | `/stories/<id>/` ・ `/es/anecdotas/<id>/` ・ `/pt/historias/<id>/` | `detailPage` | エピソードの個別ページ、共有ボタン |
| （名言の個別） | `/quotes/<id>/` ・ `/es/frases/<id>/` ・ `/pt/frases/<id>/` | `detailPage` | 名言の個別ページ、共有ボタン、共有画像（`src/public/og/quotes/`） |
| `history` | `/history/` ・ `/es/historia/` ・ `/pt/historia/` | `historyPage` | 時代（クラブ）ごとの経歴、タイトル・成績への入口 |
| （時代の個別） | `/history/<時代>/` ・ `/es/historia/<時代>/` ・ `/pt/historia/<時代>/` | `eraPage` | その時代の経歴・名言・タイトル |
| `trophies` | `/trophies/` ・ `/es/titulos/` ・ `/pt/titulos/` | `trophiesPage` | 出典付きのタイトル一覧 |
| `stats` | `/stats/` ・ `/es/estadisticas/` ・ `/pt/estatisticas/` | `statsPage` | クラブ別の通算成績と勝率 |
| `rivals` | `/rivals/` ・ `/es/rivales/` ・ `/pt/rivais/` | `rivalsPage`・`rivalPage` | 因縁の相手の一覧と個別ページ（`<id>/`） |
| `remarks` | `/remarks/` ・ `/es/declaraciones/` ・ `/pt/declaracoes/` | `remarksPage` | 最近の発言 |
| `onthisday` | `/on-this-day/` ・ `/es/efemerides/` ・ `/pt/neste-dia/` | `onThisDayPage`・`monthPage` | 日付ごとの出来事と、月ごとのページ（`may/`・`mayo/`・`maio/` など） |
| `quiz` | `/quiz/` ・ `/es/trivia/` ・ `/pt/quiz/` | `quizPage` | タイトル一覧から作る10問のクイズ（答えと出典は `<details>`、`app.js` が正誤・点数・別の10問） |
| `news` | `/news/` ・ `/es/noticias/` ・ `/pt/noticias/` | `newsPage` | ニュース一覧（`/api/news` から表示、`noindex` でサイトマップには載せない） |
| `matches` | `/matches/` ・ `/es/partidos/` ・ `/pt/jogos/` | `matchesPage` | 結果と日程（Pages Function が KV から HTML に入れ、`app.js` が閲覧者の時刻で描き直す。サイトマップに載せる） |

存在しないパスはトップページが 200 で返るので、ページがあるかは canonical のパスで確かめます。

## 操作と動き（`src/assets/app.js`）

| 機能 | ページ | 要素 | 検証フロー |
|---|---|---|---|
| 言語メニュー | 全ページ | `.lang-switch`（`<details>`）。地球のアイコンと今の言語、開くと各言語の名前でこのページの各言語版へ。外側のクリックと Esc で閉じる | `test/flows/lang-menu.json` |
| スマホの幅 | `home`・`matches`・`stats`・`rivals` | 375px の画面で、どの要素も画面の右端からはみ出さない（表は `.table-wrap` の中で横に送る） | `test/flows/no-overflow.json`（375px、全言語、横スクロールの有無も）・`test/flows/no-overflow-320.json`（320px） |
| スマホのメニュー | 全ページ | `.menu-btn` で `#site-nav` を開閉 | `test/flows/menu.json` |
| 言語の提案バナー | 全ページ | ブラウザの言語と違うページで `.lang-banner` を出す（自動リダイレクトはしない） | `test/flows/language-banner.json`（es）・`test/flows/language-banner-ja.json`（ja） |
| 名言のシャッフル | `home` | `#shuffle` で `#daily-quote` と `#daily-episode-title` を入れ替える。データは `#daily-data` | `test/flows/shuffle.json` |
| 今日の名言の共有 | `home` | `#share-quote` で X（Twitter）の投稿画面を新しいタブで開く | なし |
| クイズ | `quiz` | 選択肢の `button[data-era]` で正誤（`.is-right`・`.is-wrong`）と `<details>` を開き、全問で `#quiz-score` と、点数入りのシェア `#quiz-share`。`#quiz-again` で別の10問。データは `#quiz-data` | `test/flows/quiz.json` |
| 動画の再生 | `home` | `.video[data-video-id]` をクリックすると、その場で `iframe.video-frame`（youtube-nocookie）に差し替える | `test/flows/video.json` |
| 動画の並び | `home` | `#videos .grid` の動画を、表示のたびに `app.js` がランダムに並べ替える（HTML は `videos.json` の順） | `test/flows/video-order.json` |
| 今日の出来事 | `home` | `#on-this-day`。出来事（`onthisday.json`）と日付のある名言を合わせ、当日のもの、なければ今月のもの、それもなければ次の日付のものを古い順に `#otd-list` に並べる（`pickOnThisDay`、最大8件）。ビルドした日と表示する日が違えば `#otd-data` から選び直す。月別ページにはその月の名言も載せる | `test/flows/on-this-day.json`・`test/build.test.mjs`（`pickOnThisDay`） |
| ニュース | `home`・`news` | `/api/news?lang=` から `#news-list` と `#news-updated` を描く | なし（KV の中身しだい） |
| ファン予想 | `home`・`matches` | `#predict`：次の試合のスコアを −/＋ で選んで送る（キックオフまで、1接続1票）。送信後・キックオフ後は勝ち・引き分け・負けの割合（10票から）と人気のスコア、試合後は的中の割合。`/api/predict`（`lib/predict.js`、D1 `VOTES`） | `test/flows/predict.json`（送信は localhost のときだけ） |
| 試合とカウントダウン | `home`・`matches` | `/api/matches` から `#match-list`（次の試合→前回の結果の順。トップの `#countdown` は次の試合のカードの中）・`#result-list`・`#fixture-list` と `#countdown` を描く。`#countdown` は毎秒更新し、キックオフ時刻が未定（`timeTbd`）なら出さない。時刻はクラブの現地時間（`lib/feeds.js` の `MATCH_TIME_ZONE`、「Madrid time」と明記）。時刻未定の試合は日付と「TBC」だけ。判定と文字列は `src/assets/kickoff.js` | `test/flows/countdown.json`（トップと `/matches/`。次の試合がなければ非表示を確かめる）・`test/flows/match-times.json` |
| 共有ボタン | 名言・エピソードの個別ページ | `.share` の中の `.share-native`（端末の共有）と `.share-copy`（リンクのコピー） | なし |

「検証フロー」が「なし」の機能を変えるときは、同じ PR でフローを足します（`.claude/skills/verify-flow/`）。

## 裏側（ブラウザからは見えない）

| 機能 | 場所 | 確かめ方 |
|---|---|---|
| フィードの取得（Google News・媒体の RSS・ESPN） | `lib/feeds.js`、Worker `workers/feeds/`（20分ごと） | `npm test`（`test/feeds.test.mjs`）、`npm run feeds:dev` |
| `/api/news`・`/api/matches` | `functions/api/`、`lib/serve.js` | `npm run dev` のあと `curl localhost:8788/api/news?lang=en` |
| 共有画像の生成 | `scripts/og.mjs` | `npm run og` |
| CSP などのヘッダー | `src/public/_headers` | `npm run dev`（ヘッダーを返す）と `npm run verify`（CSP 違反は FAIL） |
