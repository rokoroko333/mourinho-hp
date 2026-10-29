---
name: verify-flow
description: 変更したページを実際に動かして確かめる。src/ や scripts/build.mjs を変えたあと、PR を出す前に、ボタン・メニュー・言語・動画などの動作を npm run verify で検証し、PASS・FAIL・BLOCKED と証拠を PR に書くときに使う。
---

# 実画面での検証

テストが緑でも、ページで実際に動くとは限りません。「できました」という自己申告ではなく、
実際に動いているサイトで操作した結果を証拠にします。

## 進め方

1. 別のターミナルで `npm run dev` を起動する（http://localhost:8788）。
2. 変更で動作が変わる操作ごとに、`test/flows/` にフローがあるか確かめる。なければ作る（下の書き方）。
   既存のフローが今回の変更で古くなったら直す。
3. `npm run verify` を実行する（特定のフローだけなら `npm run verify -- test/flows/menu.json`）。
4. 結果ごとに次のように扱う。
   - **PASS**: 完了の証拠として、出力を PR の「検証結果」に貼る。
   - **FAIL**: 実装を直して再実行する。フローの期待が間違っていたときだけフローを直し、理由を PR に書く。
   - **BLOCKED**: 前提がそろっていない（サーバーが動いていない、Chrome がない、開いたページが存在しないなど）。
     検証できていないので、完了とせず、何が足りないかを PR とユーザーへの報告に書く。
5. `screenshots/verify/` のスクショを自分で見て、崩れがないか確かめる。

FAIL を消すためにステップを削ったり、期待値を実際の結果に合わせて書き換えたりしない。

## フローの書き方

`test/flows/<名前>.json`。1つのフローで確かめるのは、利用者から見た1つの動作だけにする。

```json
{
  "description": "利用者から見た動作を1文で（英語）",
  "viewport": { "width": 500, "height": 900 },
  "languages": ["es-ES", "es"],
  "steps": [
    { "goto": "/es/" },
    { "click": ".menu-btn" },
    { "visible": "#site-nav" },
    { "hidden": "#countdown" },
    { "absent": ".lang-banner" },
    { "text": { "selector": "h1", "includes": "Mourinho" } },
    { "attr": { "selector": "#daily-quote-link", "name": "href", "save": "before" } },
    { "attr": { "selector": "#daily-quote-link", "name": "href", "changedFrom": "before" } },
    { "eval": "document.querySelectorAll('.card').length >= 3" }
  ]
}
```

- `viewport` と `languages`（ブラウザの言語設定）は省略できる。幅の既定は1280。
- `hidden` は要素があって見えていないこと、`absent` は要素がないこと。セレクタの打ち間違いで通らないよう、`hidden` は要素がないと失敗する。
- 各ステップは5秒まで待つ。`eval` は true を返す式（Promise も可）で、他のステップで書けないときだけ使う。
- コンソールのエラー、捕まえていない例外、CSP などでブロックされたリクエストがあれば、ステップが通っても FAIL になる。
  届かない外部ホスト（オフラインやクラウドのネットワーク制限）は「-」で一覧に出るだけで、FAIL にはしない。
- ニュースと試合は KV の中身しだいで変わるので、件数や見出しの文言を決め打ちしない。
