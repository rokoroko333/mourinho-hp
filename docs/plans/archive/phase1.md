# Infinito Mourinho 改善 第1段階（ターミナルの Claude Code への指示）

提案レポート: https://claude.ai/artifact/NFA2dSDGLcXYabkk6Ttcc9
第2段階（名言100本・数字・ライバル・On this day・カウントダウン）と第3段階（ファン予想・クイズ・記録トラッカー）はレポートを参照。

目的: 1日1.5万PVに向けて、検索で拾われる個別ページを増やし、SNSで共有されたときの見た目を整える。
背景: 現在は3言語 × 3ページ（トップ・名言・経歴）の9URLだけ。OGP画像が未設定で、動画は YouTube の検索リンク。
やらないこと: 新しい名言や事実の追加（第2段階で出典つきで行う）、投票などサーバー保存が必要な機能。

1つずつ別のブランチ・PRで進めてください。CLAUDE.md の作業の流れとサイトのルールに従うこと。

1. 名言とエピソードの個別ページ
   - `/quotes/{id}/`、`/stories/{id}/`（es・pt は言語ごとのスラッグ）を `scripts/build.mjs` で生成する。
   - 各ページに hreflang・canonical・sitemap の alternates を付け、関連する名言・エピソードを3〜6本リンクする。
   - 一覧ページのカードは個別ページへリンクする。
2. クラブ時代ごとのページ
   - `/history/{club}/`（例 `/history/inter/`）を `history.json` から生成。経歴トップは各時代へのカード一覧にする。
3. シェア画像とシェアボタン
   - 名言ごとに 1200×630 の OGP 画像をビルド時に生成（`scripts/screenshot.mjs` の Playwright を流用）し、`og:image` に設定。
     `twitter:card` を `summary_large_image` にする。トップ・経歴にも既定の画像を用意する。
   - ボタンは WhatsApp・X・Facebook・リンクコピーの4つ。スマホでは Web Share API を先に出す。外部 SDK は読み込まない。
4. 動画の実体化
   - `videos.json` を YouTube の動画ID指定に変え、実際のサムネイルを表示。クリックしたら youtube-nocookie で再生する軽量埋め込みにする。
   - `_headers` の CSP を必要な範囲だけ広げる。動画IDは実在を確認したものだけ載せる。
5. トップの並び替え
   - ヒーローを低くし、ファーストビューに「次の試合までのカウントダウン」と直近の結果を出す。
   - 順番: 試合 → ニュース（1本大きく＋リスト）→ 今日の名言 → 時代カード → 動画。
   - アンカー（`/#news` など）は専用ページができたらそちらへのリンクに置き換える。

完了条件: `npm run build` と `npm test` が通り、新しいページが3言語分出力され、sitemap に載っていること。PR に検証結果を書くこと。
