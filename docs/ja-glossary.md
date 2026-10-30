# 日本語訳の用語集と書き方

`src/content/*.json` の `ja` を書くときの決まり。表記は日本の主要なスポーツ報道（共同通信・スポーツ紙・DAZN の日本語表記）に合わせる。

## 書き方

- 文体は常体（だ・である）。説明文は短く、断定的に。体言止めも可。感嘆符と絵文字は使わない（docs/design.md）。
- 事実は英語の文から足さず、引かない。英語にない評価・形容（「伝説の」「劇的な」など）を加えない。
- 数字・日付・スコアは英語の文と同じ値。年は西暦（2004年）。スコアは「1-0」。
- スコアは主語のチーム側から書く（日本の報道の書き方）。勝ちは「2-1で勝った」、負けは「0-1で敗れた」（英語の「lost 1-0」も「0-1で敗れた」にする）。
- 名言の本文（`text`）は訳さない（英語の原文のまま）。訳すのは場面の説明（`context`・`occasion`）、見出し、本文の説明など。
- 引用符は「」。英語の引用を説明文の中で示すときも「」。
- 全角・半角: 数字とアルファベットは半角。中黒「・」で人名・クラブ名を区切る。

## 人名

| 英語 | 日本語 |
|---|---|
| José Mourinho | ジョゼ・モウリーニョ（2回目以降は「モウリーニョ」） |
| Pep Guardiola | ペップ・グアルディオラ |
| Arsène Wenger | アーセン・ヴェンゲル |
| Jürgen Klopp | ユルゲン・クロップ |
| Rafael Benítez | ラファエル・ベニテス |
| Antonio Conte | アントニオ・コンテ |
| Carlo Ancelotti | カルロ・アンチェロッティ |
| Louis van Gaal | ルイ・ファン・ハール |
| Mauricio Pochettino | マウリシオ・ポチェッティーノ |
| Bobby Robson | ボビー・ロブソン |
| Alex Ferguson | アレックス・ファーガソン |
| Claudio Ranieri | クラウディオ・ラニエリ |

上にない人名は、日本の報道で一般的なカタカナ表記にする。迷ったら英語の綴りを括弧で添えない（そのまま一般的な表記で）。

## クラブ

| 英語 | 日本語 |
|---|---|
| FC Porto | FCポルト（文中は「ポルト」でも可） |
| Chelsea | チェルシー |
| Inter Milan | インテル |
| Real Madrid | レアル・マドリード |
| Manchester United | マンチェスター・ユナイテッド |
| Tottenham Hotspur | トッテナム・ホットスパー |
| AS Roma | ASローマ（文中は「ローマ」でも可） |
| Fenerbahçe | フェネルバフチェ |
| Benfica | ベンフィカ |
| União de Leiria | ウニオン・レイリア |
| Sporting CP | スポルティングCP |
| Barcelona | バルセロナ |
| Sporting CP, FC Porto & Barcelona | スポルティングCP・FCポルト・バルセロナ |
| Atlético Madrid | アトレティコ・マドリード |
| Arsenal / Liverpool / Manchester City | アーセナル / リヴァプール / マンチェスター・シティ |
| Bayern Munich / AC Milan / Juventus | バイエルン・ミュンヘン / ACミラン / ユヴェントス |

## 大会

| 英語 | 日本語 |
|---|---|
| UEFA Champions League | UEFAチャンピオンズリーグ（文中は「CL」でも可） |
| UEFA Cup | UEFAカップ |
| UEFA Europa League | UEFAヨーロッパリーグ |
| UEFA Europa Conference League | UEFAヨーロッパ・カンファレンスリーグ |
| Premier League | プレミアリーグ |
| League Cup | リーグカップ |
| FA Cup | FAカップ |
| FA Community Shield | FAコミュニティ・シールド |
| Primeira Liga | プリメイラ・リーガ |
| Taça de Portugal | タッサ・デ・ポルトガル |
| Portuguese Super Cup | スーペルタッサ（ポルトガル・スーパーカップ） |
| Serie A | セリエA |
| Coppa Italia | コッパ・イタリア |
| Italian Super Cup | スーペルコッパ・イタリアーナ |
| La Liga / LaLiga | ラ・リーガ |
| Copa del Rey | コパ・デル・レイ |
| Spanish Super Cup | スーペルコパ・デ・エスパーニャ |
| treble | 3冠 |

## 言葉

| 英語 | 日本語 |
|---|---|
| manager / head coach | 監督 |
| assistant / interpreter | アシスタントコーチ / 通訳 |
| press conference | 記者会見 |
| the Special One | スペシャル・ワン |
| spell | 在任期間（「第1期」「第2期」） |
| Clásico | クラシコ |
| derby | ダービー |

## 翻訳で決めた表記（追加）

| 英語 | 日本語 |
|---|---|
| Zlatan Ibrahimović | ズラタン・イブラヒモヴィッチ（「ヴィ」にそろえる） |
| Cristiano Ronaldo / Didier Drogba / Frank Lampard / Eden Hazard | クリスティアーノ・ロナウド / ディディエ・ドログバ / フランク・ランパード / エデン・アザール |
| Diego Milito / Marco Materazzi / Costinha / Deco | ディエゴ・ミリート / マルコ・マテラッツィ / コスチーニャ / デコ |
| Roman Abramovich / Tito Vilanova / Anthony Taylor | ロマン・アブラモビッチ / ティト・ビラノバ / アンソニー・テイラー |
| Camp Nou / Bernabéu / Old Trafford / Stamford Bridge / San Siro | カンプ・ノウ / ベルナベウ / オールド・トラッフォード / スタンフォード・ブリッジ / サン・シーロ |
| Sevilla / Galatasaray / Beşiktaş / Atlético / Celtic | セビージャ / ガラタサライ / ベシクタシュ / アトレティコ / セルティック |
| Süper Lig / Cup Winners' Cup / UEFA Super Cup | スュペル・リグ / カップウィナーズカップ / UEFAスーパーカップ |
| on penalties / after extra time / on aggregate / first leg | PK戦で / 延長戦の末 / 2試合合計 / 第1戦 |
| unveiled as manager / sacked / by mutual consent | 監督として発表された / 解任した / 双方の合意により |
| touchline ban / sent off (manager) | ベンチ入り禁止処分 / 退席処分 |
| parking the bus / the happy one | 「バスを停める」 / ハッピー・ワン |

- 名言の場面説明（`quotes.json` の `context`）では、短くするため「CL」と略してよい。ほかの説明文は「チャンピオンズリーグ」。
- `/stats/` の記録の説明は、大きな数字の下に置くので「〜の数」「〜試合数」のような名詞句で終える。
