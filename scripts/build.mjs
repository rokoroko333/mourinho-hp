// Static site generator: renders src/content/*.json into dist/ as plain HTML, one copy per language.
// No framework and no runtime dependencies, so the build runs anywhere `node` does (including Cloudflare Pages).
import { readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HIGHLIGHTS_URL } from '../lib/feeds.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'dist');
// Production origin, used for canonical/hreflang/sitemap. Set SITE_URL in the Pages build settings
// once the custom domain is decided.
const SITE_URL = (process.env.SITE_URL || 'https://infinito-mourinho.pages.dev').replace(/\/$/, '');
const LANGS = ['en', 'es', 'pt'];
const PAGES = ['home', 'quotes', 'history'];

const load = async (name) => JSON.parse(await readFile(join(ROOT, 'src/content', name), 'utf8'));
const [ui, quotes, episodes, history, videos] = await Promise.all(
  ['ui.json', 'quotes.json', 'episodes.json', 'history.json', 'videos.json'].map(load),
);

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
};

function head(lang, paths, t, { type = 'WebPage', mainEntity } = {}) {
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
    ...(mainEntity && { mainEntity }),
  };
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
<link rel="canonical" href="${urls[lang]}">
${alternates}
<link rel="alternate" hreflang="x-default" href="${urls.en}">
<meta property="og:type" content="${type === 'WebSite' ? 'website' : 'article'}">
<meta property="og:site_name" content="${esc(ui[lang].siteName)}">
<meta property="og:title" content="${esc(t.title)}">
<meta property="og:description" content="${esc(t.description)}">
<meta property="og:url" content="${urls[lang]}">
<meta property="og:locale" content="${ui[lang].ogLocale}">
${LANGS.filter((l) => l !== lang).map((l) => `<meta property="og:locale:alternate" content="${ui[l].ogLocale}">`).join('\n')}
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#121212">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/assets/styles.css">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
</head>`;
}

// `active` is the top-level section to highlight; the language switch links to this page in each language.
function header(lang, paths, active) {
  const u = ui[lang];
  const home = pathOf(lang, 'home');
  const links = [
    [`${home}#daily`, u.nav.quotes],
    [`${home}#news`, u.nav.news],
    [`${home}#matches`, u.nav.matches],
    [`${home}#videos`, u.nav.videos],
  ];
  const langLinks = LANGS.map(
    (l) =>
      `<a href="${paths[l]}" hreflang="${l}" lang="${l}"${l === lang ? ' aria-current="true"' : ''}>${l.toUpperCase()}</a>`,
  ).join('');
  return `<header class="site-header">
  <div class="wrap header-row">
    <a class="brand" href="${home}">${icon.infinity}<span>Infinito Mourinho</span></a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="site-nav" aria-label="Menu">${icon.menu}</button>
    <nav id="site-nav" class="site-nav">
      ${links.map(([href, label]) => `<a href="${href}">${esc(label)}</a>`).join('\n      ')}
      <a class="nav-history${active === 'history' ? ' active' : ''}" href="${pathOf(lang, 'history')}">${esc(u.nav.history)}</a>
      <div class="lang-switch" aria-label="Language">${langLinks}</div>
    </nav>
  </div>
</header>`;
}

function footer(lang) {
  const u = ui[lang];
  return `<footer class="site-footer">
  <div class="wrap">
    <p class="footer-name">Infinito Mourinho</p>
    <p class="footer-tag">"${esc(u.tagline)}"</p>
    <nav class="footer-nav">
      ${PAGES.map((p) => `<a href="${pathOf(lang, p)}">${esc(p === 'home' ? u.nav.home : u.nav[p])}</a>`).join(' · ')}
    </nav>
    <p class="footer-note">${esc(u.footer)}</p>
  </div>
</footer>
<script type="application/json" id="lang-suggest">${JSON.stringify(Object.fromEntries(LANGS.map((l) => [l, ui[l].suggest]))).replace(/</g, '\\u003c')}</script>
<script src="/assets/app.js" defer></script>
</body>
</html>`;
}

function quoteBody(q, lang) {
  return `<blockquote class="quote-text">“${esc(q.text)}”</blockquote>
<p class="quote-context">— ${esc(q.context[lang])}${q.year ? `, ${q.year}` : ''}</p>`;
}

function homePage(lang) {
  const u = ui[lang];
  const h = u.home;
  const t = { title: h.title, description: h.description };
  // Client picks a fresh pair on shuffle; the first render is deterministic per day so crawlers see real text.
  const day = Math.floor(Date.now() / 86400000);
  const q = quotes[day % quotes.length];
  const e = episodes[day % episodes.length];
  const daily = {
    quotes: quotes.map((x) => ({ text: x.text, context: x.context[lang], year: x.year || null })),
    episodes: episodes.map((x) => ({ title: x.title[lang], text: x.text[lang] })),
  };
  const strings = {
    newsEmpty: h.newsEmpty, newsUpdated: h.newsUpdated, readArticle: h.readArticle,
    matchesEmpty: h.matchesEmpty, latest: h.latest, next: h.next, home: h.home_, away: h.away,
  };
  return `${head(lang, pathsOf('home'), t, { type: 'WebSite' })}
<body data-lang="${lang}">
${header(lang, pathsOf('home'), 'home')}
<main>
<section class="hero">
  <div class="wrap hero-inner">
    <div class="hero-icon">${icon.infinity}</div>
    <h1>Infinito <span class="gold">Mourinho</span></h1>
    <p class="hero-tag">“${esc(u.tagline)}”</p>
    <a class="btn btn-gold" href="${pathOf(lang, 'history')}">${esc(h.heroCta)}</a>
  </div>
</section>

<div class="wrap sections">
<section id="daily" class="section">
  <div class="section-head">
    <h2>${esc(h.dailyHeading)}</h2>
    <button type="button" class="btn btn-gold btn-sm" id="shuffle">${icon.shuffle}${esc(h.shuffle)}</button>
  </div>
  <div class="grid grid-2">
    <article class="card card-quote">
      <p class="card-label">${esc(h.quoteLabel)}</p>
      <div id="daily-quote">${quoteBody(q, lang)}</div>
      <div class="card-foot">
        <button type="button" class="btn btn-dark btn-sm" id="share-quote">𝕏 ${esc(h.share)}</button>
      </div>
    </article>
    <article class="card">
      <p class="card-label">${esc(h.episodeLabel)}</p>
      <h3 id="daily-episode-title">${esc(e.title[lang])}</h3>
      <p id="daily-episode-text" class="muted">${esc(e.text[lang])}</p>
    </article>
  </div>
  <p class="more"><a href="${pathOf(lang, 'quotes')}">${esc(h.allQuotes)} ${icon.arrow}</a></p>
  <script type="application/json" id="daily-data">${JSON.stringify(daily).replace(/</g, '\\u003c')}</script>
  <script type="application/json" id="strings">${JSON.stringify(strings).replace(/</g, '\\u003c')}</script>
</section>

<section id="news" class="section">
  <div class="section-head">
    <div><h2>${esc(h.newsHeading)}</h2><p class="sub">${esc(h.newsSub)}</p></div>
    <p class="sub" id="news-updated"></p>
  </div>
  <div class="grid grid-3" id="news-list" aria-live="polite"><p class="loading">${esc(h.loading)}</p></div>
</section>

<section id="matches" class="section">
  <div class="section-head"><div><h2>${esc(h.matchesHeading)}</h2><p class="sub">${esc(h.matchesSub)}</p></div></div>
  <div class="grid grid-2" id="match-list"><p class="loading">${esc(h.loading)}</p></div>
  <a class="card card-link highlights" href="${HIGHLIGHTS_URL}" target="_blank" rel="noopener">
    <div><h3>${esc(h.highlights)}</h3><p class="muted">${esc(h.highlightsSub)}</p></div>
    <span class="btn btn-red">${icon.play}${esc(h.watch)}</span>
  </a>
</section>

<section id="videos" class="section">
  <div class="section-head"><div><h2>${esc(h.videosHeading)}</h2><p class="sub">${esc(h.videosSub)}</p></div></div>
  <div class="grid grid-3">
    ${videos
      .map(
        (v) => `<a class="card card-link video" href="https://www.youtube.com/results?search_query=${encodeURIComponent(v.query)}" target="_blank" rel="noopener">
      <span class="video-play">${icon.play}</span>
      <h3>${esc(v.title[lang])}</h3>
      <p class="card-label">YouTube</p>
    </a>`,
      )
      .join('\n    ')}
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

// Cuts at a word boundary and drops punctuation left dangling before the ellipsis.
const clip = (s, max) => (s.length <= max ? s : `${s.slice(0, s.lastIndexOf(' ', max - 1)).replace(/[\s,;:.–—-]+$/, '')}…`);
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

function detailPage(lang, kind, id) {
  const u = ui[lang];
  const d = u.detail;
  const paths = detailPaths(kind, id);
  let t;
  let body;
  let mainEntity;
  if (kind === 'quotes') {
    const q = quotes.find((x) => x.id === id);
    const year = q.year ? `, ${q.year}` : '';
    t = {
      title: `${fill(d.quoteTitle, { text: clip(q.text, 70) })} | ${u.siteName}`,
      description: clip(fill(d.quoteDescription, { text: q.text, context: q.context[lang] + year }), 160),
    };
    mainEntity = { '@type': 'Quotation', text: q.text, inLanguage: 'en', creator: MOURINHO, ...(q.year && { dateCreated: String(q.year) }) };
    body = `<p class="card-label">${esc(d.quoteLabel)}</p>
    <h1 class="quote-text detail-quote">“${esc(q.text)}”</h1>
    <p class="quote-context">— ${esc(q.context[lang])}${year}</p>`;
  } else {
    const e = episodes.find((x) => x.id === id);
    t = {
      title: `${fill(d.storyTitle, { title: e.title[lang] })} | ${u.siteName}`,
      description: clip(e.text[lang], 160),
    };
    body = `<p class="card-label">${esc(d.storyLabel)} · ${e.year}</p>
    <h1 class="detail-title">${esc(e.title[lang])}</h1>
    <p class="detail-text">${esc(e.text[lang])}</p>`;
  }
  return `${head(lang, paths, t, { mainEntity })}
<body data-lang="${lang}">
${header(lang, paths, 'quotes')}
<main class="wrap page">
  <p class="more back"><a href="${pathOf(lang, 'quotes')}">${icon.arrow}${esc(d.back)}</a></p>
  <article class="card detail${kind === 'quotes' ? ' card-quote' : ''}">
    ${body}
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
  </div>
  <ol class="timeline">
    ${history
      .map(
        (h) => `<li class="timeline-item" id="${h.id}">
      <article class="card">
        <p class="pill">${esc(h.years)} · ${esc(h.era[lang])}</p>
        <h2>${esc(h.club[lang])}</h2>
        <p class="trophies">${icon.trophy}<span><span class="sr-only">${esc(p.trophies)}: </span>${esc(h.trophies[lang])}</span></p>
        <ul>${h.points[lang].map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
      </article>
    </li>`,
      )
      .join('\n    ')}
  </ol>
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

const render = { home: homePage, quotes: quotesPage, history: historyPage };
const routes = [
  ...PAGES.map((page) => ({ paths: pathsOf(page), changefreq: page === 'home' ? 'hourly' : 'monthly', render: render[page] })),
  ...ITEMS.map(({ kind, id }) => ({
    paths: detailPaths(kind, id),
    changefreq: 'yearly',
    render: (lang) => detailPage(lang, kind, id),
  })),
];
for (const { paths, render: page } of routes) {
  for (const lang of LANGS) await write(join(paths[lang], 'index.html'), page(lang));
}
await write('sitemap.xml', sitemap(routes));
await write('robots.txt', `User-agent: *\nAllow: /\n\nSitemap: ${SITE_URL}/sitemap.xml\n`);

console.log(`Built ${LANGS.length * routes.length} pages into dist/ for ${SITE_URL}`);
