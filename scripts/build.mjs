// Static site generator: renders src/content/*.json into dist/ as plain HTML, one copy per language.
// No framework and no runtime dependencies, so the build runs anywhere `node` does (including Cloudflare Pages).
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIGHLIGHTS_URL, MATCH_TIME_ZONE, MATCH_CITY } from '../lib/feeds.js';
import { withYears, pickOnThisDay, quizQuestions, dealQuiz } from './content.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
// Production origin, used for canonical/hreflang/sitemap. Set SITE_URL in the Pages build settings
// once the custom domain is decided.
const SITE_URL = (process.env.SITE_URL || 'https://infinito-mourinho.pages.dev').replace(/\/$/, '');
const LANGS = ['en', 'es', 'pt', 'ja'];
const PAGES = ['home', 'quotes', 'history', 'trophies', 'stats', 'rivals', 'remarks', 'onthisday', 'quiz'];

const load = async (name) => JSON.parse(await readFile(join(ROOT, 'src/content', name), 'utf8'));
const [ui, quotes, episodes, history, videos, trophies, stats, remarks, rivals, onThisDay] = await Promise.all(
  ['ui.json', 'quotes.json', 'episodes.json', 'history.json', 'videos.json', 'trophies.json', 'stats.json', 'remarks.json', 'rivals.json', 'onthisday.json'].map(load),
);
// In calendar order (month and day), then by year.
onThisDay.sort((a, b) => a.date.slice(5).localeCompare(b.date.slice(5)) || a.date.localeCompare(b.date));
// Newest first. Added by hand with their sources, never from the feeds (docs/plans/archive/phase2.md, item 6).
remarks.sort((a, b) => b.date.localeCompare(a.date));

withYears(quotes);

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const pathOf = (lang, page) => {
  const slug = ui[lang].slugs[page];
  return slug ? `/${slug}/` : '/';
};
// Every page exists in all three languages; `paths` maps each language to that page's path.
const pathsOf = (page) => Object.fromEntries(LANGS.map((l) => [l, pathOf(l, page)]));
// Individual quote and story pages share their id across languages: /quotes/special-one/,
// /es/frases/special-one/, /pt/frases/special-one/ (and /stories/, /es/anecdotas/, /pt/historias/).
const detailPaths = (kind, id) => Object.fromEntries(LANGS.map((l) => [l, `${pathOf(l, kind)}${id}/`]));

const MOURINHO = {
  '@type': 'Person',
  name: 'José Mourinho',
  sameAs: ['https://en.wikipedia.org/wiki/Jos%C3%A9_Mourinho', 'https://www.wikidata.org/wiki/Q49589'],
};

const icon = {
  infinity:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.6 6.6c-1.5 0-2.9.6-4 1.7L12 10.9 9.4 8.3a5.6 5.6 0 1 0 0 7.4l2.6-2.6 2.6 2.6a5.6 5.6 0 1 0 4-9.1zM8 14.3a3 3 0 1 1 0-4.6l2.3 2.3L8 14.3zm10.6.7c-.8 0-1.6-.3-2.2-.9L14.1 12l2.3-2.3a3 3 0 1 1 2.2 5.3z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h12m-5-6 6 6-6 6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  shuffle:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4v6h6M20 20v-6h-6M5.6 15a7.5 7.5 0 0 0 13.1 1.5M18.4 9A7.5 7.5 0 0 0 5.3 7.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>',
  trophy:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4h10v4a5 5 0 0 1-10 0V4zm0 2H4a3 3 0 0 0 3 4m10-4h3a3 3 0 0 1-3 4M12 13v4m-4 3h8" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/></g></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

// Share images are made by `npm run og` (scripts/og.mjs) and committed under src/public/og/.
const OG_IMAGE = { path: '/og/default.png', width: 1200, height: 630 };

function head(lang, paths, t, { type = 'WebPage', mainEntity, image = OG_IMAGE.path, imageAlt = ui[lang].siteName, noindex = false } = {}) {
  const urls = Object.fromEntries(LANGS.map((l) => [l, SITE_URL + paths[l]]));
  const alternates = LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${urls[l]}">`).join('\n');
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': type,
    name: type === 'WebSite' ? ui[lang].siteName : t.title,
    url: urls[lang],
    inLanguage: lang,
    description: t.description,
    about: MOURINHO,
    image: SITE_URL + image,
    ...(mainEntity && { mainEntity }),
  };
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
${noindex ? '<meta name="robots" content="noindex, follow">\n' : ''}<link rel="canonical" href="${urls[lang]}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${urls.en}">
<meta property="og:type" content="${type === 'WebSite' ? 'website' : 'article'}">
<meta property="og:site_name" content="${esc(ui[lang].siteName)}">
<meta property="og:title" content="${esc(t.title)}">
<meta property="og:description" content="${esc(t.description)}">
<meta property="og:url" content="${urls[lang]}">
<meta property="og:locale" content="${ui[lang].ogLocale}">
${LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${ui[l].ogLocale}">`).join('\n')}
<meta property="og:image" content="${SITE_URL + image}">
<meta property="og:image:width" content="${OG_IMAGE.width}">
<meta property="og:image:height" content="${OG_IMAGE.height}">
<meta property="og:image:alt" content="${esc(imageAlt)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0b0d10">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preload" href="/assets/fonts/barlow-condensed-800.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/barlow-condensed-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/styles.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>`;
}

// `active` is the top-level section to highlight; the language switch links to this page in each language.
function header(lang, paths, active) {
  const u = ui[lang];
  const home = pathOf(lang, 'home');
  const links = [
    [pathOf(lang, 'quotes'), u.nav.quotes],
    [pathOf(lang, 'news'), u.nav.news],
    [pathOf(lang, 'matches'), u.nav.matches],
    [`${home}#videos`, u.nav.videos],
  ];
  // A small menu (works without JS): the current language's code, then each language under its own name.
  const langLinks = LANGS.map(
    (l) =>
      `<li><a href="${paths[l]}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}><span>${esc(ui[l].langName)}</span><small>${l.toUpperCase()}</small></a></li>`,
  ).join('');
  return `<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${home}">${icon.infinity}<span>Infinito Mourinho</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="${esc(u.menuLabel)}">${icon.menu}</button>
    <nav id="site-nav" class="site-nav">
      ${links.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('\n      ')}
      <a class="nav-history${active === 'history' ? ' active' : ''}" href="${pathOf(lang, 'history')}">${esc(u.nav.history)}</a>
      <details class="lang-switch">
        <summary aria-label="${esc(u.langMenuLabel)}">${icon.globe}<span>${lang.toUpperCase()}</span>${icon.chevron}</summary>
        <ul>${langLinks}</ul>
      </details>
    </nav>
  </div>
</header>`;
}

function footer(lang) {
  const u = ui[lang];
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="footer-name">Infinito Mourinho</p>
    <p class="footer-tag">${esc(taglineText(u))}</p>
    <nav class="footer-nav">
      ${PAGES.map((p) => `<a href="${pathOf(lang, p)}">${esc(p === 'home' ? u.nav.home : u.nav[p])}</a>`).join(' · ')}
    </nav>
    <p class="footer-note">${esc(u.footer)}</p>
  </div>
</footer>
<script type="application/json" id="lang-suggest">${JSON.stringify(Object.fromEntries(LANGS.map((l) => [l, ui[l].suggest]))).replace(/</g, '\\u003c')}</script>
<script type="application/json" id="lang-close">${JSON.stringify(Object.fromEntries(LANGS.map((l) => [l, ui[l].closeLabel]))).replace(/</g, '\\u003c')}</script>
<script src="/assets/kickoff.js" defer></script>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function quoteBody(q, lang) {
  return `<blockquote class="quote-text" lang="en">“${esc(q.text)}”</blockquote>
<p class="quote-context">— ${esc(q.context[lang])}${q.year ? `, ${q.year}` : ''}</p>`;
}

// The tagline in the quote marks of the language it is written in: the Japanese pages keep the English one.
const taglineText = (u) => fill(u.tagline === ui.en.tagline ? ui.en.quoteMarks : u.quoteMarks, { text: u.tagline });

// A link to the video on YouTube with its real thumbnail, so it works without JavaScript. app.js swaps
// in a youtube-nocookie player on click, except for videos whose owner disabled embedding.
// Every id was checked to exist with YouTube's oEmbed endpoint (401 there means embedding is off).
function videoCard(v, lang) {
  return `<a class="card card-link video" href="https://www.youtube.com/watch?v=${esc(v.id)}" target="_blank" rel="noopener"${v.embed === false ? '' : ` data-video-id="${esc(v.id)}"`}>
      <span class="video-thumb"><img src="https://i.ytimg.com/vi/${esc(v.id)}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy"><span class="video-play">${icon.play}</span></span>
      <h3>${esc(v.title[lang])}</h3>
      <p class="card-label">YouTube · ${esc(v.channel)}</p>
    </a>`;
}

// Text app.js needs for the live news and match cards, on every page that has them.
function liveStrings(lang) {
  const h = ui[lang].home;
  return {
    newsEmpty: h.newsEmpty, newsUpdated: h.newsUpdated, readArticle: h.readArticle,
    matchesEmpty: h.matchesEmpty, latest: h.latest, next: h.next, home: h.home_, away: h.away,
    kickoffIn: h.kickoffIn, units: h.countdownUnits, siteUrl: SITE_URL, tbd: ui[lang].matches.tbd,
    // Kick-off times in the club's own time zone, whatever the visitor's (lib/feeds.js).
    timeZone: MATCH_TIME_ZONE, localTime: fill(ui[lang].matches.localTime, { city: MATCH_CITY[lang] }),
    predict: ui[lang].predict,
  };
}
const stringsScript = (lang) =>
  `<script type="application/json" id="strings">${JSON.stringify(liveStrings(lang)).replace(/</g, '\\u003c')}</script>`;

function homePage(lang) {
  const u = ui[lang];
  const h = u.home;
  const t = { title: h.title, description: h.description };
  // Client picks a fresh pair on shuffle; the first render is deterministic per day so crawlers see real text.
  const day = Math.floor(Date.now() / 86400000);
  const q = quotes[day % quotes.length];
  const e = episodes[day % episodes.length];
  const daily = {
    quotes: quotes.map((x) => ({ text: x.text, context: x.context[lang], year: x.year || null, path: detailPaths('quotes', x.id)[lang] })),
    episodes: episodes.map((x) => ({ title: x.title[lang], text: x.text[lang], path: detailPaths('stories', x.id)[lang] })),
  };
  const strings = liveStrings(lang);
  const more = (href, label, id) => `<a class="more-link"${id ? ` id="${id}"` : ''} href="${href}">${esc(label)} ${icon.arrow}</a>`;
  return `${head(lang, pathsOf('home'), t, { type: 'WebSite' })}
<body data-lang="${lang}">
${header(lang, pathsOf('home'), 'home')}
<main>
<section class="hero">
  <div class="wrap hero-inner">
    <h1>Infinito <span class="gold">Mourinho</span></h1>
    <p class="hero-tag">${esc(taglineText(u))}</p>
  </div>
</section>

<div class="wrap sections">
<section id="matches" class="section">
  <div class="section-head"><div><h2>${esc(h.matchesHeading)}</h2><p class="sub">${esc(h.matchesSub)}</p></div></div>
  <!-- app.js moves this into the next match's card. It stays in the HTML for an app.js cached from before
       that change (up to an hour), which expects to find it. -->
  <p class="countdown" id="countdown" hidden></p>
  <div class="grid grid-2" id="match-list"><p class="loading">${esc(h.loading)}</p></div>
  <!-- Fan prediction for the next match, drawn by app.js from /api/predict (lib/predict.js). -->
  <section class="card predict" id="predict" aria-live="polite" hidden></section>
  <a class="card card-link highlights" href="${HIGHLIGHTS_URL}" target="_blank" rel="noopener">
    <div><h3>${esc(h.highlights)}</h3><p class="muted">${esc(h.highlightsSub)}</p></div>
    <span class="btn btn-red">${icon.play}${esc(h.watch)}</span>
  </a>
  <p class="more"><a href="${pathOf(lang, 'matches')}">${esc(u.matches.all)} ${icon.arrow}</a></p>
</section>

<section id="news" class="section">
  <div class="section-head">
    <div><h2>${esc(h.newsHeading)}</h2><p class="sub">${esc(h.newsSub)}</p></div>
    <p class="sub" id="news-updated"></p>
  </div>
  <div class="grid grid-3" id="news-list" data-limit="6" aria-live="polite"><p class="loading">${esc(h.loading)}</p></div>
  <p class="more"><a href="${pathOf(lang, 'news')}">${esc(u.news.all)} ${icon.arrow}</a></p>
</section>

${remarks.length ? `<section id="remarks" class="section">
  <div class="section-head"><div><h2>${esc(u.remarks.heading)}</h2><p class="sub">${esc(u.remarks.sub)}</p></div></div>
  <div class="grid grid-3">
    ${remarks.slice(0, 3).map((r) => remarkCard(r, lang)).join('\n    ')}
  </div>
  <p class="more"><a href="${pathOf(lang, 'remarks')}">${esc(u.remarks.all)} ${icon.arrow}</a></p>
</section>

` : ''}<section id="daily" class="section">
  <div class="section-head">
    <h2>${esc(h.dailyHeading)}</h2>
    <button type="button" class="btn btn-gold btn-sm" id="shuffle">${icon.shuffle}${esc(h.shuffle)}</button>
  </div>
  <div class="grid grid-2">
    <article class="card card-quote">
      <p class="card-label">${esc(h.quoteLabel)}</p>
      <div id="daily-quote">${quoteBody(q, lang)}</div>
      <div class="card-foot daily-foot">
        ${more(detailPaths('quotes', q.id)[lang], u.detail.readMore, 'daily-quote-link')}
        <button type="button" class="btn btn-dark btn-sm" id="share-quote">𝕏 ${esc(h.share)}</button>
      </div>
    </article>
    <article class="card">
      <p class="card-label">${esc(h.episodeLabel)}</p>
      <h3 id="daily-episode-title">${esc(e.title[lang])}</h3>
      <p id="daily-episode-text" class="muted">${esc(e.text[lang])}</p>
      <div class="card-foot daily-foot">${more(detailPaths('stories', e.id)[lang], u.detail.readMore, 'daily-episode-link')}</div>
    </article>
  </div>
  ${otdCard(lang)}
  <p class="more"><a href="${pathOf(lang, 'quotes')}">${esc(h.allQuotes)} ${icon.arrow}</a></p>
  <script type="application/json" id="daily-data">${JSON.stringify(daily).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="strings">${JSON.stringify(strings).replace(/</g, '\\u003c')}</script>
</section>

<section id="eras" class="section">
  <div class="section-head"><h2>${esc(u.history.chapters)}</h2></div>
  <div class="era-grid">
    ${history
      .map(
        (x) => `<a class="card card-link era-card" href="${eraPaths(x.id)[lang]}">
      <p class="card-label">${esc(x.years)}</p>
      <h3>${esc(x.club[lang])}</h3>
    </a>`,
      )
      .join('\n    ')}
  </div>
  <p class="more"><a href="${pathOf(lang, 'history')}">${esc(h.heroCta)} ${icon.arrow}</a></p>
</section>

<section id="videos" class="section">
  <div class="section-head"><div><h2>${esc(h.videosHeading)}</h2><p class="sub">${esc(h.videosSub)}</p></div></div>
  <div class="grid grid-3">
    ${videos.map((v) => videoCard(v, lang)).join('\n    ')}
  </div>
</section>
</div>
</main>
${footer(lang)}`;
}

function quotesPage(lang) {
  const u = ui[lang];
  const p = u.quotes;
  return `${head(lang, pathsOf('quotes'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('quotes'), 'quotes')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  ${tagNav(lang)}
  <section class="section">
    <h2>${esc(p.quotesHeading)}</h2>
    <div class="grid grid-2">
      ${quotes
        .map(
          (q) => `<a class="card card-quote card-link" id="${q.id}" href="${detailPaths('quotes', q.id)[lang]}">${quoteBody(q, lang)}</a>`,
        )
        .join('\n      ')}
    </div>
  </section>
  <section class="section">
    <h2>${esc(p.episodesHeading)}</h2>
    <div class="grid grid-2">
      ${episodes
        .map(
          (e) => `<a class="card card-link" id="${e.id}" href="${detailPaths('stories', e.id)[lang]}">
        <p class="card-label">${e.year}</p>
        <h3>${esc(e.title[lang])}</h3>
        <p class="muted">${esc(e.text[lang])}</p>
      </a>`,
        )
        .join('\n      ')}
    </div>
  </section>
</main>
${footer(lang)}`;
}

// Tag pages: /quotes/tag/rivals/, /es/frases/tema/rivals/, /pt/frases/tema/rivals/ — the tag id is shared
// across languages, its name is translated. Only tags that some quote uses get a page.
const TAGS = [...new Set(quotes.flatMap((q) => q.tags))].sort();
const tagPaths = (tag) => Object.fromEntries(LANGS.map((l) => [l, `${pathOf(l, 'tags')}${tag}/`]));
const tagName = (tag, lang) => ui[lang].quotes.tagNames[tag];

function tagNav(lang, current) {
  return `<nav class="tag-list" aria-label="${esc(ui[lang].quotes.byTag)}">
    ${TAGS.map((t) => {
      const n = quotes.filter((q) => q.tags.includes(t)).length;
      return `<a class="pill" href="${tagPaths(t)[lang]}"${t === current ? ' aria-current="page"' : ''}>${esc(tagName(t, lang))} <span class="count">${n}</span></a>`;
    }).join('\n    ')}
  </nav>`;
}

function tagPage(lang, tag) {
  const u = ui[lang];
  const p = u.quotes;
  const list = quotes.filter((q) => q.tags.includes(tag));
  const name = tagName(tag, lang);
  const t = {
    title: fill(p.tagTitle, { tag: name }),
    description: fill(p.tagDescription, { tag: name, tagLower: name.toLowerCase(), count: list.length }),
  };
  return `${head(lang, tagPaths(tag), t)}
<body data-lang="${lang}">
${header(lang, tagPaths(tag), 'quotes')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'quotes')}">${icon.arrow}${esc(u.detail.back)}</a></p>
  <div class="page-head">
    <h1>${esc(name)}</h1>
  </div>
  ${tagNav(lang, tag)}
  <div class="grid grid-2">
    ${list.map((q) => `<a class="card card-quote card-link" href="${detailPaths('quotes', q.id)[lang]}">${quoteBody(q, lang)}</a>`).join('\n    ')}
  </div>
</main>
${footer(lang)}`;
}

// Quotes and stories in one list, so a page can point to related ones of either kind.
const ITEMS = [
  ...quotes.map((q) => ({ kind: 'quotes', id: q.id, year: q.year, item: q })),
  ...episodes.map((e) => ({ kind: 'stories', id: e.id, year: e.year, item: e })),
];
const RELATED_COUNT = 4;

// The quote and story sharing an id come first (they tell the same moment), then the closest in time;
// ties keep the content order, so the links are stable from build to build.
function relatedTo(kind, id) {
  const self = ITEMS.find((x) => x.kind === kind && x.id === id);
  return ITEMS.filter((x) => x !== self)
    .map((x, order) => ({ x, order, twin: x.id === id ? 0 : 1, gap: Math.abs((x.year ?? 9999) - (self.year ?? 9999)) }))
    .sort((a, b) => a.twin - b.twin || a.gap - b.gap || a.order - b.order)
    .slice(0, RELATED_COUNT)
    .map(({ x }) => x);
}

// Cuts at a word boundary (or at `max` when there is none) and drops punctuation left before the ellipsis.
const clip = (s, max) => {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(' ', max - 1);
  return `${s.slice(0, cut > 0 ? cut : max - 1).replace(/[\s,;:.–—-]+$/, '')}…`;
};
const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

function relatedCards(lang, kind, id) {
  const d = ui[lang].detail;
  return relatedTo(kind, id)
    .map(({ kind: k, id: rid, year, item }) => {
      const label = `${k === 'quotes' ? d.quoteLabel : d.storyLabel}${year ? ` · ${year}` : ''}`;
      const title = k === 'quotes' ? `“${clip(item.text, 90)}”` : item.title[lang];
      return `<a class="card card-link" href="${detailPaths(k, rid)[lang]}">
        <p class="card-label">${esc(label)}</p>
        <h3>${esc(title)}</h3>
      </a>`;
    })
    .join('\n      ');
}

// The quote's era and tags as links; nothing at all when it has neither.
function eraAndTags(era, tags, lang) {
  const links = [
    ...(era ? [`<a class="pill" href="${eraPaths(era.id)[lang]}">${esc(era.years)} · ${esc(era.club[lang])}</a>`] : []),
    ...tags.map((tg) => `<a class="pill pill-tag" href="${tagPaths(tg)[lang]}">${esc(tagName(tg, lang))}</a>`),
  ];
  return links.length ? `<p class="quote-era">${links.join(' ')}</p>` : '';
}

// Where the quote was reported. Every quote must have at least one (test/build.test.mjs checks).
function sourceList(sources, lang) {
  return `<p class="sources"><span class="card-label">${esc(ui[lang].detail.sources)}</span> ${sources
    .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}${s.date ? ` (${esc(s.date)})` : ''}</a>`)
    .join(' · ')}</p>`;
}

// Plain links to each network's own share page, so sharing works without JavaScript and without
// loading any third-party SDK. app.js reveals the phone's share sheet (first) and the copy button.
function shareButtons(lang, url, title, text) {
  const u = ui[lang];
  const e = encodeURIComponent;
  const links = [
    ['WhatsApp', `https://wa.me/?text=${e(`${text} ${url}`)}`],
    ['X', `https://twitter.com/intent/tweet?text=${e(text)}&url=${e(url)}`],
    ['Facebook', `https://www.facebook.com/sharer/sharer.php?u=${e(url)}`],
  ];
  return `<div class="card-foot share" data-share-title="${esc(title)}" data-share-text="${esc(text)}" data-share-url="${esc(url)}">
      <p class="card-label">${esc(u.home.share)}</p>
      <div class="share-buttons">
        <button type="button" class="btn btn-gold btn-sm share-native" hidden>${esc(u.home.share)}</button>
        ${links.map(([name, href]) => `<a class="btn btn-dark btn-sm" href="${esc(href)}" target="_blank" rel="noopener">${name}</a>`).join('\n        ')}
        <button type="button" class="btn btn-dark btn-sm share-copy" data-copied="${esc(u.detail.copied)}" hidden>${esc(u.detail.copy)}</button>
        <span class="sr-only share-status" role="status"></span>
      </div>
    </div>`;
}

function detailPage(lang, kind, id) {
  const u = ui[lang];
  const d = u.detail;
  const paths = detailPaths(kind, id);
  let t;
  let body;
  let mainEntity;
  let shareText;
  let image;
  if (kind === 'quotes') {
    const q = quotes.find((x) => x.id === id);
    const year = q.year ? `, ${q.year}` : '';
    t = {
      title: `${fill(d.quoteTitle, { text: clip(q.text, 70) })} | ${u.siteName}`,
      description: clip(fill(d.quoteDescription, { text: q.text, context: q.context[lang] + year }), 160),
    };
    mainEntity = {
      '@type': 'Quotation',
      text: q.original?.text ?? q.text,
      inLanguage: q.original?.lang ?? 'en',
      creator: MOURINHO,
      ...(q.date && { dateCreated: q.date }),
      citation: q.sources.map((s) => s.url),
    };
    shareText = `“${q.text}” — José Mourinho`;
    image = `/og/quotes/${q.id}.png`;
    const era = history.find((h) => h.id === q.era);
    body = `<p class="card-label">${esc(d.quoteLabel)}</p>
    <h1 class="quote-text detail-quote" lang="en">“${esc(q.text)}”</h1>
    ${q.original ? `<p class="quote-original" lang="${esc(q.original.lang)}"><span class="card-label">${esc(d.original)}</span> “${esc(q.original.text)}”</p>` : ''}
    <p class="quote-context">— ${esc(q.context[lang])}${year}</p>
    ${eraAndTags(era, q.tags, lang)}
    ${sourceList(q.sources, lang)}`;
  } else {
    const e = episodes.find((x) => x.id === id);
    t = {
      title: `${fill(d.storyTitle, { title: e.title[lang] })} | ${u.siteName}`,
      description: clip(e.text[lang], 160),
    };
    mainEntity = { '@type': 'Article', headline: e.title[lang], description: t.description, inLanguage: lang, about: MOURINHO };
    shareText = `${e.title[lang]} — José Mourinho`;
    body = `<p class="card-label">${esc(d.storyLabel)} · ${e.year}</p>
    <h1 class="detail-title">${esc(e.title[lang])}</h1>
    <p class="detail-text">${esc(e.text[lang])}</p>`;
  }
  return `${head(lang, paths, t, { mainEntity, ...(image && { image, imageAlt: shareText }) })}
<body data-lang="${lang}">
${header(lang, paths, 'quotes')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'quotes')}">${icon.arrow}${esc(d.back)}</a></p>
  <article class="card detail${kind === 'quotes' ? ' card-quote' : ''}">
    ${body}
    ${shareButtons(lang, SITE_URL + paths[lang], t.title, shareText)}
  </article>
  <section class="section">
    <h2>${esc(d.related)}</h2>
    <div class="grid grid-2">
      ${relatedCards(lang, kind, id)}
    </div>
  </section>
</main>
${footer(lang)}`;
}

function historyPage(lang) {
  const u = ui[lang];
  const p = u.history;
  return `${head(lang, pathsOf('history'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('history'), 'history')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
    <p class="muted intro">${esc(p.intro)}</p>
    <p class="more"><a href="${pathOf(lang, 'trophies')}">${icon.trophy} ${esc(u.trophies.heading)} ${icon.arrow}</a></p>
    <p class="more"><a href="${pathOf(lang, 'stats')}">${esc(u.stats.link)} ${icon.arrow}</a></p>
  </div>
  <ol class="timeline">
    ${history
      .map(
        (h) => `<li class="timeline-item" id="${h.id}">
      <a class="card card-link" href="${eraPaths(h.id)[lang]}">
        <p class="pill">${esc(h.years)} · ${esc(h.era[lang])}</p>
        <h2>${esc(h.club[lang])}</h2>
        ${trophyLine(h, lang)}
      </a>
    </li>`,
      )
      .join('\n    ')}
  </ol>
</main>
${footer(lang)}`;
}

function trophyCard(t, lang) {
  return `<li class="card trophy" id="${t.id}">
        <p class="card-label">${esc(t.season)}</p>
        <h3>${icon.trophy}${esc(t.competition[lang])}</h3>
        ${sourceList(t.sources, lang)}
      </li>`;
}

// Trophies as a head coach, grouped by era in career order. Each one carries its own sources
// (trophies.json; test/build.test.mjs checks that none is missing).
function trophiesPage(lang) {
  const u = ui[lang];
  const p = u.trophies;
  const eras = history.filter((h) => trophies.some((t) => t.era === h.id));
  return `${head(lang, pathsOf('trophies'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('trophies'), 'history')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
    <p class="muted">${esc(fill(p.count, { count: trophies.length }))}</p>
    <p class="more"><a href="${pathOf(lang, 'stats')}">${esc(u.stats.link)} ${icon.arrow}</a></p>
  </div>
  ${eras
    .map(
      (h) => `<section class="section trophy-era" id="${h.id}">
    <h2><a href="${eraPaths(h.id)[lang]}">${esc(h.club[lang])}</a> <span class="pill">${esc(h.years)}</span></h2>
    <ul class="trophy-list">
      ${trophies
        .filter((t) => t.era === h.id)
        .map((t) => trophyCard(t, lang))
        .join('\n      ')}
    </ul>
  </section>`,
    )
    .join('\n  ')}
</main>
${footer(lang)}`;
}

// Era pages live under the history page: /history/inter/, /es/historia/inter/, /pt/historia/inter/.
const eraPaths = (id) => Object.fromEntries(LANGS.map((l) => [l, `${pathOf(l, 'history')}${id}/`]));

function trophyLine(h, lang) {
  return `<p class="trophies">${icon.trophy}<span><span class="sr-only">${esc(ui[lang].history.trophies)}: </span>${esc(h.trophies[lang])}</span></p>`;
}

// "12 September 2021" in the page's language. Dates are calendar days, so they are read in UTC.
const longDate = (iso, lang) =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso));
// 63.8% in English, 63,8 % in Spanish and Portuguese.
const winRate = (r, lang) =>
  new Intl.NumberFormat(lang, { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(r.wins / r.matches);
const num = (n, lang) => (n == null ? '—' : n.toLocaleString(lang));

// The era's record in all competitions, with its sources (stats.json). Nothing for eras without one.
// The current spell (stats.current) is not in the clubs table: it holds only for its `asOf` date, so it
// always shows with that note.
function eraRecord(eraId, lang) {
  const current = stats.current?.era === eraId;
  const r = current ? stats.current : stats.clubs.find((c) => c.era === eraId);
  if (!r) return '';
  const p = ui[lang].stats;
  return `<div class="era-record">
      <p><span class="card-label">${esc(p.record)}</span> ${esc(fill(p.recordLine, { matches: num(r.matches, lang), wins: num(r.wins, lang), rate: winRate(r, lang) }))}${
        r.draws == null ? '' : ` · ${esc(fill(p.drawsLosses, { draws: num(r.draws, lang), losses: num(r.losses, lang) }))}`
      }</p>
      ${current ? `<p class="muted">${esc(fill(p.currentNote, { date: longDate(r.asOf, lang) }))}</p>` : ''}
      ${sourceList(r.sources, lang)}
    </div>`;
}

// Numbers only from stats.json, each with its sources and the date it holds for (docs/plans/archive/phase2.md, item 3).
function statsPage(lang) {
  const u = ui[lang];
  const p = u.stats;
  const m = stats.milestone;
  const eraOf = (id) => history.find((h) => h.id === id);
  return `${head(lang, pathsOf('stats'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('stats'), 'history')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <section class="section">
    <article class="card stat-milestone">
      <p class="stat-value">${num(m.matches, lang)}</p>
      <p>${esc(fill(p.milestone, { wins: num(m.wins, lang), draws: num(m.draws, lang), losses: num(m.losses, lang), rate: winRate(m, lang) }))}</p>
      <p class="muted">${esc(fill(p.asOf, { date: longDate(m.asOf, lang) }))}</p>
      ${sourceList(m.sources, lang)}
    </article>
  </section>
  <section class="section">
    <div class="section-head"><h2>${esc(p.recordsHeading)}</h2></div>
    <div class="grid grid-2">
      ${stats.records
        .map(
          (r) => `<article class="card stat" id="${r.id}">
        <p class="stat-value">${esc(r.value)}</p>
        <p>${esc(r.text[lang])}</p>
        ${sourceList(r.sources, lang)}
      </article>`,
        )
        .join('\n      ')}
    </div>
  </section>
  <section class="section" id="clubs">
    <div class="section-head"><div><h2>${esc(p.clubsHeading)}</h2><p class="sub">${esc(p.clubsSub)}</p></div></div>
    <div class="table-wrap">
      <table class="stats-table">
        <thead><tr><th scope="col">${esc(p.club)}</th><th scope="col">${esc(p.matches)}</th><th scope="col">${esc(p.wins)}</th><th scope="col">${esc(p.draws)}</th><th scope="col">${esc(p.losses)}</th><th scope="col">${esc(p.rate)}</th><th scope="col">${esc(u.detail.sources)}</th></tr></thead>
        <tbody>
          ${stats.clubs
            .map((r) => {
              const h = eraOf(r.era);
              return `<tr id="${r.era}"><th scope="row"><a href="${eraPaths(r.era)[lang]}">${esc(h.club[lang])}</a> <span class="muted">${esc(h.years)}</span></th><td>${num(r.matches, lang)}</td><td>${num(r.wins, lang)}</td><td>${num(r.draws, lang)}</td><td>${num(r.losses, lang)}</td><td>${winRate(r, lang)}</td><td>${r.sources
                .map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.publisher)}</a>`)
                .join(', ')}</td></tr>`;
            })
            .join('\n          ')}
        </tbody>
      </table>
    </div>
    <p class="muted stats-note">${esc(p.dashNote)}</p>
  </section>
  ${
    stats.current
      ? `<section class="section" id="current">
    <div class="section-head"><h2>${esc(p.currentHeading)}</h2></div>
    <article class="card stat-current">
      <h3><a href="${eraPaths(stats.current.era)[lang]}">${esc(eraOf(stats.current.era).club[lang])}</a> <span class="muted">${esc(eraOf(stats.current.era).years)}</span></h3>
      ${eraRecord(stats.current.era, lang)}
    </article>
  </section>`
      : ''
  }
</main>
${footer(lang)}`;
}

// A remark as reported, with the occasion, the date it was reported (sources rarely state the day it
// was said, and we never guess it) and where it was printed. Remarks made in Spanish
// or Portuguese keep the original next to the English translation, as quotes do.
function remarkCard(r, lang) {
  const d = ui[lang].detail;
  return `<article class="card card-quote remark" id="${esc(r.id)}">
      <p class="card-label"><time datetime="${esc(r.date)}">${esc(fill(ui[lang].remarks.reported, { date: longDate(r.date, lang) }))}</time></p>
      <p class="muted remark-occasion">${esc(r.occasion[lang])}</p>
      <blockquote class="quote-text" lang="en">“${esc(r.text)}”</blockquote>
      ${r.original ? `<p class="quote-original" lang="${esc(r.original.lang)}"><span class="card-label">${esc(d.original)}</span> “${esc(r.original.text)}”</p>` : ''}
      ${sourceList(r.sources, lang)}
    </article>`;
}

function remarksPage(lang) {
  const u = ui[lang];
  const p = u.remarks;
  return `${head(lang, pathsOf('remarks'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('remarks'), 'remarks')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <div class="grid grid-2">
    ${remarks.length ? remarks.map((r) => remarkCard(r, lang)).join('\n    ') : `<p class="muted">${esc(p.empty)}</p>`}
  </div>
</main>
${footer(lang)}`;
}

// Quiz (#50): one question per sourced trophy, nothing new to source. The HTML holds ten
// questions dealt by the build's day, each with its answer and sources in a <details>, so it works without
// JS; app.js marks answers, keeps the score and deals ten more from the embedded list.
const QUIZ_SIZE = 10;
const quiz = quizQuestions(trophies, history, [...stats.clubs.map((c) => c.era), stats.current.era]);
function quizItems(lang) {
  const club = (era) => history.find((h) => h.id === era).club[lang];
  return quiz.map((q) => ({
    id: q.id,
    label: fill(ui[lang].quiz.question, { competition: q.trophy.competition[lang], season: q.trophy.season }),
    answer: q.answer,
    answerClub: club(q.answer),
    answerPath: eraPaths(q.answer)[lang],
    options: q.options.map((era) => ({ era, club: club(era) })),
    sources: q.trophy.sources,
  }));
}

function quizQuestion(q, lang) {
  const p = ui[lang].quiz;
  return `<li class="card quiz-q" data-id="${q.id}" data-answer="${q.answer}">
        <p class="card-label">${esc(q.label)}</p>
        <h3>${esc(p.prompt)}</h3>
        <div class="quiz-options">${q.options.map((o) => `<button type="button" class="btn btn-sm btn-dark" data-era="${o.era}">${esc(o.club)}</button>`).join('')}</div>
        <p class="quiz-result" aria-live="polite"></p>
        <details><summary>${esc(p.show)}</summary><p><a href="${q.answerPath}">${esc(fill(p.answer, { club: q.answerClub }))}</a></p>${sourceList(q.sources, lang)}</details>
      </li>`;
}

function quizPage(lang) {
  const p = ui[lang].quiz;
  const items = quizItems(lang);
  const shown = dealQuiz(items, Math.floor(Date.now() / 86400000), QUIZ_SIZE);
  const data = { size: QUIZ_SIZE, strings: { show: p.show, answer: p.answer, correct: p.correct, wrong: p.wrong, score: p.score, shareScore: p.shareScore, prompt: p.prompt, sources: ui[lang].detail.sources }, items };
  return `${head(lang, pathsOf('quiz'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('quiz'), 'quiz')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <section class="section">
    <ol class="quiz-list" id="quiz-list">
      ${shown.map((q) => quizQuestion(q, lang)).join('\n      ')}
    </ol>
    <p class="quiz-score" id="quiz-score" aria-live="polite" hidden></p>
    <!-- Shown with the score; app.js puts the score into the shared text (quiz.shareScore). -->
    <div class="quiz-share" id="quiz-share" hidden>
    ${shareButtons(lang, SITE_URL + pathOf(lang, 'quiz'), p.title, p.sub)}
    </div>
    <p><button type="button" class="btn btn-gold" id="quiz-again" hidden>${esc(p.again)}</button></p>
    <p class="muted">${esc(p.note)} <a href="${pathOf(lang, 'trophies')}">${esc(p.trophiesLink)}</a></p>
  </section>
  <script type="application/json" id="quiz-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
</main>
${footer(lang)}`;
}

// On this day: /on-this-day/may/, /es/efemerides/mayo/, /pt/neste-dia/maio/. Month slugs are the month's
// name in each language, without accents ("março" -> "marco").
const monthName = (m, lang) =>
  new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, m - 1, 1)));
// Japanese month names ("5月") would put non-ASCII in the URL, so the Japanese pages use the number.
const monthSlug = (m, lang) => (lang === 'ja' ? String(m) : monthName(m, lang).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase());
const monthPaths = (m) => Object.fromEntries(LANGS.map((l) => [l, `${pathOf(l, 'onthisday')}${monthSlug(m, l)}/`]));
const otdMonths = [...new Set(onThisDay.map((e) => Number(e.date.slice(5, 7))))];
const dayMonth = (mmdd, lang) =>
  new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`2000-${mmdd}T00:00:00Z`));

// The card's timeline: the On this day events and every quote with a full date, in this language.
const datedQuotes = quotes.filter((q) => /^\d{4}-\d{2}-\d{2}$/.test(q.date || ''));
const otdItems = (lang) => [
  ...onThisDay.map((e) => ({ date: e.date, event: true, text: e.text[lang], path: monthPaths(Number(e.date.slice(5, 7)))[lang] })),
  ...datedQuotes.map((q) => ({ date: q.date, quote: q.text, text: q.context[lang], path: detailPaths('quotes', q.id)[lang] })),
];
const otdLabel = (p, kind, mmdd, lang) =>
  kind === 'month' ? fill(p.monthHeading, { month: monthName(Number(mmdd.slice(0, 2)), lang) }) : fill(p[kind], { day: dayMonth(mmdd, lang) });
// One entry of the card, as text only (app.js builds the same with textContent).
function otdItem(x, lang) {
  const body = x.quote
    ? `<p class="otd-quote" lang="en"><a href="${x.path}">“${esc(x.quote)}”</a></p><p class="muted">${esc(x.text)}</p>`
    : `<p>${esc(x.text)}</p>`;
  return `<li><p class="otd-when"><time datetime="${x.date}"><span class="otd-year">${x.date.slice(0, 4)}</span> ${esc(dayMonth(x.date.slice(5), lang))}</time></p>${body}</li>`;
}

function otdCard(lang) {
  if (!onThisDay.length) return '';
  const p = ui[lang].onthisday;
  const all = otdItems(lang);
  const { kind, day, items } = pickOnThisDay(all);
  const data = {
    labels: { today: p.today, month: p.monthHeading, next: p.next },
    items: all.map((x) => ({ ...x, day: dayMonth(x.date.slice(5), lang) })),
    months: Object.fromEntries(otdMonths.map((m) => [m, monthPaths(m)[lang]])),
  };
  return `<article class="card otd" id="on-this-day" data-built="${new Date().toISOString().slice(0, 10)}">
    <p class="card-label" id="otd-label">${esc(otdLabel(p, kind, day, lang))}</p>
    <ol class="otd-list" id="otd-list">
      ${items.map((x) => otdItem(x, lang)).join('\n      ')}
    </ol>
    <div class="card-foot"><a class="more-link" id="otd-link" href="${monthPaths(Number(day.slice(0, 2)))[lang]}">${esc(p.more)} ${icon.arrow}</a></div>
    <script type="application/json" id="otd-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
  </article>`;
}

function otdEvent(e, lang) {
  return `<li class="card trophy" id="${e.date}">
        <p class="card-label"><time datetime="${e.date}">${esc(longDate(e.date, lang))}</time>${
          e.era ? ` · <a href="${eraPaths(e.era)[lang]}">${esc(history.find((h) => h.id === e.era).club[lang])}</a>` : ''
        }</p>
        <p>${esc(e.text[lang])}</p>
        ${sourceList(e.sources, lang)}
      </li>`;
}

function onThisDayPage(lang) {
  const u = ui[lang];
  const p = u.onthisday;
  return `${head(lang, pathsOf('onthisday'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('onthisday'), 'history')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <nav class="tag-list" aria-label="${esc(p.months)}">
    ${otdMonths.map((m) => `<a class="pill" href="${monthPaths(m)[lang]}">${esc(monthName(m, lang))}</a>`).join(' ')}
  </nav>
  ${otdMonths
    .map(
      (m) => `<section class="section">
    <div class="section-head"><h2><a href="${monthPaths(m)[lang]}">${esc(monthName(m, lang))}</a></h2></div>
    <ul class="trophy-list">
      ${onThisDay.filter((e) => Number(e.date.slice(5, 7)) === m).map((e) => otdEvent(e, lang)).join('\n      ')}
    </ul>
  </section>`,
    )
    .join('\n  ')}
</main>
${footer(lang)}`;
}

// The quotes dated in a month, oldest first, under its events.
function monthQuotes(m, lang) {
  const list = datedQuotes.filter((q) => Number(q.date.slice(5, 7)) === m).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return '';
  return `<section class="section">
    <div class="section-head"><h2>${esc(fill(ui[lang].onthisday.monthQuotes, { month: monthName(m, lang) }))}</h2></div>
    <div class="grid grid-2">
      ${list.map((q) => `<a class="card card-quote card-link" href="${detailPaths('quotes', q.id)[lang]}"><p class="card-label"><time datetime="${q.date}">${esc(longDate(q.date, lang))}</time></p>${quoteBody(q, lang)}</a>`).join('\n      ')}
    </div>
  </section>`;
}

function monthPage(lang, m) {
  const u = ui[lang];
  const p = u.onthisday;
  const name = monthName(m, lang);
  const t = { title: fill(p.monthTitle, { month: name }), description: fill(p.monthDescription, { month: name }) };
  return `${head(lang, monthPaths(m), t)}
<body data-lang="${lang}">
${header(lang, monthPaths(m), 'history')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'onthisday')}">${icon.arrow}${esc(p.back)}</a></p>
  <div class="page-head">
    <h1>${esc(fill(p.monthHeading, { month: name }))}</h1>
  </div>
  <ul class="trophy-list">
    ${onThisDay.filter((e) => Number(e.date.slice(5, 7)) === m).map((e) => otdEvent(e, lang)).join('\n    ')}
  </ul>
  ${monthQuotes(m, lang)}
</main>
${footer(lang)}`;
}

// Rival pages: /rivals/guardiola/, /es/rivales/guardiola/, /pt/rivais/guardiola/.
const rivalPaths = (id) => Object.fromEntries(LANGS.map((l) => [l, `${pathOf(l, 'rivals')}${id}/`]));

// A match date as precise as its source: "3 May 2011", "February 2007" or "2005".
function fuzzyDate(date, lang) {
  if (date.length === 10) return longDate(date, lang);
  if (date.length === 7)
    return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}-01`));
  return date;
}

// Head-to-head from Mourinho's side, exactly as one source counted it on its date (docs/plans/archive/phase2.md, item 4).
// A rival's name as each language writes it: the name itself, or its local form (`localName`, e.g. katakana).
const rivalName = (r, lang) => r.localName?.[lang] ?? r.name;

function h2hLine(r, lang) {
  const p = ui[lang].rivals;
  const h = r.h2h;
  return fill(p.record, { matches: num(h.matches, lang), wins: num(h.wins, lang), draws: num(h.draws, lang), losses: num(h.losses, lang) });
}

function rivalsPage(lang) {
  const u = ui[lang];
  const p = u.rivals;
  return `${head(lang, pathsOf('rivals'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('rivals'), 'history')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <div class="grid grid-2">
    ${rivals
      .map(
        (r) => `<a class="card card-link rival-card" href="${rivalPaths(r.id)[lang]}">
      <h2>${esc(rivalName(r, lang))}</h2>
      <p>${esc(h2hLine(r, lang))}</p>
      <p class="card-label">${esc(fill(p.asOf, { date: longDate(r.h2h.asOf, lang) }))}</p>
    </a>`,
      )
      .join('\n    ')}
  </div>
  <p class="muted stats-note">${esc(p.note)}</p>
</main>
${footer(lang)}`;
}

function rivalPage(lang, r) {
  const u = ui[lang];
  const p = u.rivals;
  const h = r.h2h;
  const paths = rivalPaths(r.id);
  const t = {
    title: fill(p.detailTitle, { name: rivalName(r, lang) }),
    description: clip(fill(p.detailDescription, { name: rivalName(r, lang), record: h2hLine(r, lang), date: longDate(h.asOf, lang) }), 160),
  };
  const quoteCard = (q) => `<article class="card card-quote">
        <p class="card-label">${esc(fill(q.by === 'mourinho' ? p.byMourinho : p.byRival, { name: rivalName(r, lang) }))}${q.said ? ` · ${esc(q.said)}` : ''}</p>
        <blockquote class="quote-text" lang="en">“${esc(q.text)}”</blockquote>
        ${sourceList(q.sources, lang)}
      </article>`;
  return `${head(lang, paths, t)}
<body data-lang="${lang}">
${header(lang, paths, 'history')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'rivals')}">${icon.arrow}${esc(p.back)}</a></p>
  <article class="card detail">
    <p class="pill">${esc(p.vs)}</p>
    <h1 class="detail-title">${esc(fill(ui[lang].rivals.versus, { name: rivalName(r, lang) }))}</h1>
    <div class="h2h">
      ${[['matches', h.matches], ['wins', h.wins], ['draws', h.draws], ['losses', h.losses]]
        .map(([k, v]) => `<p><span class="stat-value">${num(v, lang)}</span><span class="card-label">${esc(p[k])}</span></p>`)
        .join('')}
    </div>
    <p class="muted">${esc(fill(p.asOfNote, { date: longDate(h.asOf, lang) }))}</p>
    ${sourceList(h.sources, lang)}
  </article>
  <section class="section">
    <div class="section-head"><h2>${esc(p.games)}</h2></div>
    <ul class="trophy-list">
      ${r.games
        .map(
          (g) => `<li class="card trophy">
        <p class="card-label">${esc(fuzzyDate(g.date, lang))} · ${esc(g.competition[lang])}</p>
        <h3>${esc(g.home)} ${esc(g.score)} ${esc(g.away)}</h3>
        ${g.note ? `<p class="muted">${esc(g.note[lang])}</p>` : ''}
        ${g.date > h.asOf ? `<p class="muted">${esc(p.later)}</p>` : ''}
        ${sourceList(g.sources, lang)}
      </li>`,
        )
        .join('\n      ')}
    </ul>
  </section>
  <section class="section">
    <div class="section-head"><div><h2>${esc(p.quotes)}</h2><p class="sub">${esc(p.quotesSub)}</p></div></div>
    <div class="grid grid-2">
      ${r.quotes.map(quoteCard).join('\n      ')}
    </div>
  </section>
</main>
${footer(lang)}`;
}

// The same cards as the trophies page, so every title on an era page shows its sources too.
function eraTrophies(eraId, lang) {
  const list = trophies.filter((t) => t.era === eraId);
  if (!list.length) return '';
  const p = ui[lang].history;
  return `<section class="section trophy-era">
    <h2>${esc(p.eraTrophies)}</h2>
    <ul class="trophy-list">
      ${list.map((t) => trophyCard(t, lang)).join('\n      ')}
    </ul>
    <p class="more"><a href="${pathOf(lang, 'trophies')}#${eraId}">${esc(p.allTrophies)} ${icon.arrow}</a></p>
  </section>`;
}

// Quotes are tied to an era only through their explicit `era`, never guessed from the year (PR #13).
function eraQuotes(eraId, lang) {
  const list = quotes.filter((q) => q.era === eraId);
  if (!list.length) return '';
  return `<section class="section">
    <h2>${esc(ui[lang].history.eraQuotes)}</h2>
    <div class="grid grid-2">
      ${list
        .map(
          (q) => `<a class="card card-quote card-link" href="${detailPaths('quotes', q.id)[lang]}">${quoteBody(q, lang)}</a>`,
        )
        .join('\n      ')}
    </div>
  </section>`;
}

function eraPage(lang, index) {
  const u = ui[lang];
  const p = u.history;
  const h = history[index];
  const paths = eraPaths(h.id);
  const values = { club: h.club[lang], years: h.years, era: h.era[lang] };
  // "—" marks an era without trophies, and the current era ("2026–") has no final tally yet; their
  // descriptions start with what happened instead.
  const won = h.trophies[lang] === '—' || h.years.endsWith('–') ? [] : [`${p.trophies}: ${h.trophies[lang]}.`];
  const t = {
    title: `${fill(p.eraTitle, values)} | ${u.siteName}`,
    description: clip([...won, ...h.points[lang]].join(' '), 160),
  };
  const step = (i, label, cls) =>
    history[i]
      ? `<a class="card card-link ${cls}" href="${eraPaths(history[i].id)[lang]}">
        <p class="card-label">${esc(label)} · ${esc(history[i].years)}</p>
        <h3>${esc(history[i].club[lang])}</h3>
        <p class="muted">${esc(history[i].era[lang])}</p>
      </a>`
      : '';
  return `${head(lang, paths, t)}
<body data-lang="${lang}">
${header(lang, paths, 'history')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'history')}">${icon.arrow}${esc(p.back)}</a></p>
  <article class="card detail era">
    <p class="pill">${esc(h.years)} · ${esc(h.era[lang])}</p>
    <h1 class="detail-title">${esc(h.club[lang])}</h1>
    ${trophyLine(h, lang)}
    <ul class="era-points">${h.points[lang].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    ${eraRecord(h.id, lang)}
  </article>
  ${eraTrophies(h.id, lang)}
  ${eraQuotes(h.id, lang)}
  <nav class="grid grid-2 era-steps" aria-label="${esc(p.chapters)}">
    ${step(index - 1, p.previous, 'era-prev')}
    ${step(index + 1, p.next, 'era-next')}
  </nav>
</main>
${footer(lang)}`;
}

// /news/ is a shell that app.js fills from /api/news. Its content changes all the time and only the heading
// is in the HTML, so it is noindex and left out of the sitemap: leaving it out alone would not keep it out
// of search, since every page links to it (docs/plans/archive/phase2.md, item 7).
function newsPage(lang) {
  const u = ui[lang];
  const p = u.news;
  return `${head(lang, pathsOf('news'), p, { noindex: true })}
<body data-lang="${lang}">
${header(lang, pathsOf('news'), 'news')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(u.home.newsSub)}</p>
    <p class="muted" id="news-updated"></p>
  </div>
  <div class="grid grid-3" id="news-list" aria-live="polite"><p class="loading">${esc(u.home.loading)}</p></div>
  ${stringsScript(lang)}
</main>
${footer(lang)}`;
}

// /matches/ is served through functions/matches/ (and its es/pt twins), which fill the two lists from KV
// before the page leaves the edge (lib/matches-page.js), so it is indexed and in the sitemap. The lists
// here are what visitors get only when KV is empty; app.js then fills them as on /news/.
function matchesPage(lang) {
  const u = ui[lang];
  const p = u.matches;
  return `${head(lang, pathsOf('matches'), p)}
<body data-lang="${lang}">
${header(lang, pathsOf('matches'), 'matches')}
<main class="wrap page">
  <div class="page-head">
    <h1>${esc(p.heading)}</h1>
    <p class="hero-tag">${esc(p.sub)}</p>
  </div>
  <p class="countdown" id="countdown" hidden></p>
  <section class="card predict" id="predict" aria-live="polite" hidden></section>
  <section class="section">
    <div class="section-head"><div><h2>${esc(p.fixtures)}</h2><p class="sub">${esc(fill(p.timeNote, { city: MATCH_CITY[lang] }))}</p></div></div>
    <ol class="match-rows" id="fixture-list"><li class="loading">${esc(u.home.loading)}</li></ol>
  </section>
  <section class="section">
    <div class="section-head"><h2>${esc(p.results)}</h2></div>
    <ol class="match-rows" id="result-list"><li class="loading">${esc(u.home.loading)}</li></ol>
  </section>
  <a class="card card-link highlights" href="${HIGHLIGHTS_URL}" target="_blank" rel="noopener">
    <div><h3>${esc(u.home.highlights)}</h3><p class="muted">${esc(u.home.highlightsSub)}</p></div>
    <span class="btn btn-red">${icon.play}${esc(u.home.watch)}</span>
  </a>
  ${stringsScript(lang)}
</main>
${footer(lang)}`;
}

// One entry per page and language, each listing all three languages as alternates.
function sitemap(routes) {
  const entries = routes.flatMap(({ paths, changefreq }) =>
    LANGS.map(
      (lang) => `  <url>
    <loc>${SITE_URL + paths[lang]}</loc>
${LANGS.map((l) => `    <xhtml:link rel="alternate" hreflang="${l}" href="${SITE_URL + paths[l]}"/>`).join('\n')}
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL + paths.en}"/>
    <changefreq>${changefreq}</changefreq>
  </url>`,
    ),
  );
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join('\n')}
</urlset>
`;
}

async function write(path, content) {
  const file = join(OUT, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
}

await rm(OUT, { recursive: true, force: true });
await cp(join(ROOT, 'src/public'), OUT, { recursive: true });
await cp(join(ROOT, 'src/assets'), join(OUT, 'assets'), { recursive: true });

const render = { home: homePage, quotes: quotesPage, history: historyPage, trophies: trophiesPage, stats: statsPage, rivals: rivalsPage, remarks: remarksPage, onthisday: onThisDayPage, quiz: quizPage };
// Built like every page, but noindex and never listed in the sitemap.
const liveRoutes = [
  { paths: pathsOf('news'), render: newsPage },
];
const routes = [
  ...PAGES.map((page) => ({ paths: pathsOf(page), changefreq: page === 'home' ? 'hourly' : 'monthly', render: render[page] })),
  { paths: pathsOf('matches'), changefreq: 'daily', render: matchesPage },
  ...history.map((h, i) => ({ paths: eraPaths(h.id), changefreq: 'monthly', render: (lang) => eraPage(lang, i) })),
  ...TAGS.map((tag) => ({ paths: tagPaths(tag), changefreq: 'monthly', render: (lang) => tagPage(lang, tag) })),
  ...rivals.map((r) => ({ paths: rivalPaths(r.id), changefreq: 'monthly', render: (lang) => rivalPage(lang, r) })),
  ...otdMonths.map((m) => ({ paths: monthPaths(m), changefreq: 'monthly', render: (lang) => monthPage(lang, m) })),
  ...ITEMS.map(({ kind, id }) => ({
    paths: detailPaths(kind, id),
    changefreq: 'yearly',
    render: (lang) => detailPage(lang, kind, id),
  })),
];
for (const { paths, render: page } of [...routes, ...liveRoutes]) {
  for (const lang of LANGS) await write(join(paths[lang], 'index.html'), page(lang));
}
// Without a 404.html, Pages answers any unknown path with the home page and status 200, so anyone could hand
// out a made-up address that looks like a page of the site. The visitor's language is not known here, so the
// page says it in all four, each linking to that language's home. Not in the sitemap, and noindex.
await write('404.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(ui.en.notFound.title)} | ${esc(ui.en.siteName)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
</head>
<body data-lang="en">
<main class="wrap page">
${LANGS.map((l) => `  <section class="section" lang="${l}">
    <h1>${esc(ui[l].notFound.title)}</h1>
    <p>${esc(ui[l].notFound.text)}</p>
    <p class="more"><a href="${pathOf(l, 'home')}">${esc(ui[l].notFound.home)} ${icon.arrow}</a></p>
  </section>`).join('\n')}
</main>
</body>
</html>
`);
await write('sitemap.xml', sitemap(routes));
await write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`Built ${LANGS.length * (routes.length + liveRoutes.length)} pages into dist/ for ${SITE_URL}`);
