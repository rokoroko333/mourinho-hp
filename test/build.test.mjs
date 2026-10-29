import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// Builds dist/ once for all tests in this file.
let built;
const build = () => (built ??= promisify(execFile)(process.execPath, [join(ROOT, 'scripts/build.mjs')]));
const htmlFiles = async () => (await readdir(DIST, { recursive: true })).filter((f) => f.endsWith('.html'));
const page = (path) => readFile(join(DIST, path, 'index.html'), 'utf8');
const load = async (name) => JSON.parse(await readFile(join(ROOT, 'src/content', name), 'utf8'));

// The Content-Security-Policy in src/public/_headers allows only same-origin scripts and styles,
// so anything inline would be blocked in production. These checks catch that before deploy.
test('built pages keep to the Content-Security-Policy', async () => {
  await build();
  const files = await htmlFiles();
  assert.ok(files.length > 0);
  for (const file of files) {
    const html = await readFile(join(DIST, file), 'utf8');
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
      assert.match(tag, /\bsrc="\/|type="application\/(ld\+)?json"/, `${file}: inline script ${tag}`);
    }
    assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+="/i, `${file}: inline style or event handler`);
    // JSON inside <script> must not be able to close the tag.
    for (const [, body] of html.matchAll(/<script type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.ok(!body.includes('<'), `${file}: unescaped < in inline JSON`);
    }
  }
});

test('_headers sets a Content-Security-Policy for every path', async () => {
  const headers = await readFile(join(ROOT, 'src/public/_headers'), 'utf8');
  const block = headers.split(/\n(?=\S)/).find((b) => b.startsWith('/*'));
  assert.match(block, /Content-Security-Policy: default-src 'self'; script-src 'self';/);
  assert.match(block, /frame-ancestors 'none'/);
});

const DETAIL = { quotes: { en: 'quotes', es: 'es/frases', pt: 'pt/frases' }, stories: { en: 'stories', es: 'es/anecdotas', pt: 'pt/historias' } };

test('every quote and story has its own page in all three languages, linked from the list page', async () => {
  await build();
  const items = [
    ...(await load('quotes.json')).map((q) => ['quotes', q.id]),
    ...(await load('episodes.json')).map((e) => ['stories', e.id]),
  ];
  const lists = { en: await page('quotes'), es: await page('es/frases'), pt: await page('pt/frases') };
  for (const [kind, id] of items) {
    const paths = Object.fromEntries(Object.entries(DETAIL[kind]).map(([l, base]) => [l, `/${base}/${id}/`]));
    for (const [lang, path] of Object.entries(paths)) {
      const html = await page(path);
      assert.match(html, new RegExp(`<html lang="${lang}">`), path);
      assert.ok(html.includes(`<link rel="canonical" href="https://infinito-mourinho.pages.dev${path}">`), `${path}: canonical`);
      for (const [l, p] of Object.entries(paths)) {
        assert.ok(html.includes(`hreflang="${l}" href="https://infinito-mourinho.pages.dev${p}"`), `${path}: hreflang ${l}`);
      }
      assert.ok(lists[lang].includes(`href="${path}"`), `${lang} list page links to ${path}`);
    }
  }
});

test('every career era has its own page in all three languages, linked from the timeline and in order', async () => {
  await build();
  const history = await load('history.json');
  const base = { en: 'history', es: 'es/historia', pt: 'pt/historia' };
  const timelines = Object.fromEntries(await Promise.all(Object.entries(base).map(async ([l, b]) => [l, await page(b)])));
  history.forEach((h, i) => {
    const paths = Object.fromEntries(Object.entries(base).map(([l, b]) => [l, `/${b}/${h.id}/`]));
    for (const [lang, path] of Object.entries(paths)) {
      assert.ok(timelines[lang].includes(`href="${path}"`), `${lang} timeline links to ${path}`);
    }
  });
  for (const [lang, b] of Object.entries(base)) {
    for (const [i, h] of history.entries()) {
      const path = `/${b}/${h.id}/`;
      const html = await page(path);
      assert.match(html, new RegExp(`<html lang="${lang}">`), path);
      assert.ok(html.includes(`<link rel="canonical" href="https://infinito-mourinho.pages.dev${path}">`), `${path}: canonical`);
      for (const [l, bb] of Object.entries(base)) {
        assert.ok(html.includes(`hreflang="${l}" href="https://infinito-mourinho.pages.dev/${bb}/${h.id}/"`), `${path}: hreflang ${l}`);
      }
      const prev = history[i - 1] && `/${b}/${history[i - 1].id}/`;
      const next = history[i + 1] && `/${b}/${history[i + 1].id}/`;
      assert.equal(html.includes('class="card card-link era-prev"'), Boolean(prev), `${path}: previous link`);
      assert.equal(html.includes('class="card card-link era-next"'), Boolean(next), `${path}: next link`);
      if (prev) assert.ok(html.includes(`era-prev" href="${prev}"`), `${path}: previous is ${prev}`);
      if (next) assert.ok(html.includes(`era-next" href="${next}"`), `${path}: next is ${next}`);
    }
  }
});

test('era descriptions mention trophies only for finished eras that won some', async () => {
  await build();
  const history = await load('history.json');
  const description = async (id) => (await page(`history/${id}`)).match(/<meta name="description" content="([^"]*)"/)[1];
  const current = history.at(-1);
  assert.ok(current.years.endsWith('–'), 'the last era is the one in progress');
  assert.ok(!(await description(current.id)).startsWith('Trophies:'));
  assert.ok(!(await description('leiria')).startsWith('Trophies:'), 'an era without trophies');
  assert.ok((await description('inter')).startsWith('Trophies: Champions League'));
});

test('related links on detail pages point to other existing pages', async () => {
  await build();
  const html = await page('stories/special-one');
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  const links = [...main.matchAll(/<a class="card card-link" href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.length, 4);
  assert.equal(links[0], '/quotes/special-one/', 'the quote with the same id comes first');
  assert.ok(!links.includes('/stories/special-one/'));
  for (const link of links) await page(link);
});

test('the sitemap lists every built page exactly once, with all three languages', async () => {
  await build();
  const xml = await readFile(join(DIST, 'sitemap.xml'), 'utf8');
  const locs = [...xml.matchAll(/<loc>https:\/\/infinito-mourinho\.pages\.dev([^<]*)<\/loc>/g)].map((m) => m[1]);
  const pages = (await htmlFiles()).map((f) => `/${f.replace(/index\.html$/, '')}`.replace(/^\/\/$/, '/'));
  assert.deepEqual([...locs].sort(), [...pages].sort());
  assert.equal(new Set(locs).size, locs.length);
  for (const block of xml.split('<url>').slice(1)) assert.equal((block.match(/hreflang=/g) || []).length, 4);
});

// Width and height from a PNG's IHDR chunk.
const pngSize = (buf) => ({ width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) });

test('every page has a 1200×630 share image that exists, and quotes get their own', async () => {
  await build();
  const quotes = await load('quotes.json');
  for (const file of await htmlFiles()) {
    const html = await readFile(join(DIST, file), 'utf8');
    const image = html.match(/<meta property="og:image" content="https:\/\/infinito-mourinho\.pages\.dev([^"]+)">/)?.[1];
    assert.ok(image, `${file}: og:image`);
    assert.deepEqual(pngSize(await readFile(join(DIST, image))), { width: 1200, height: 630 }, `${file}: ${image}`);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/, file);
  }
  for (const q of quotes) {
    for (const path of [`quotes/${q.id}`, `es/frases/${q.id}`, `pt/frases/${q.id}`]) {
      assert.ok((await page(path)).includes(`/og/quotes/${q.id}.png"`), `${path} uses its own image (run npm run og?)`);
    }
  }
});

test('share buttons link to each network with the page URL, without loading third-party scripts', async () => {
  await build();
  const html = await page('es/anecdotas/medal');
  const url = encodeURIComponent('https://infinito-mourinho.pages.dev/es/anecdotas/medal/');
  assert.ok(html.includes(`https://www.facebook.com/sharer/sharer.php?u=${url}`));
  assert.ok(html.includes(`&amp;url=${url}`), 'X');
  assert.ok(html.includes(`https://wa.me/?text=`) && html.includes(url), 'WhatsApp');
  // The phone share sheet and copy button start hidden; app.js reveals them where they work.
  assert.match(html, /class="btn btn-gold btn-sm share-native" hidden>/);
  assert.match(html, /class="btn btn-dark btn-sm share-copy" data-copied="[^"]+" hidden>/);
  for (const [tag] of html.matchAll(/<script\b[^>]*src="([^"]+)"/g)) assert.match(tag, /src="\//, 'scripts are same-origin');
});

test('videos show real thumbnails and play only from hosts the Content-Security-Policy allows', async () => {
  await build();
  const videos = await load('videos.json');
  const csp = (await readFile(join(ROOT, 'src/public/_headers'), 'utf8')).match(/Content-Security-Policy: (.*)/)[1];
  const directive = (name) => csp.match(new RegExp(`${name} ([^;]*)`))[1].split(' ');
  assert.ok(directive('img-src').includes('https://i.ytimg.com'), 'thumbnails');
  assert.ok(directive('frame-src').includes('https://www.youtube-nocookie.com'), 'player');
  const app = await readFile(join(ROOT, 'src/assets/app.js'), 'utf8');
  assert.ok(app.includes('https://www.youtube-nocookie.com/embed/'), 'app.js embeds from the allowed host');
  const home = await page('es');
  for (const v of videos) {
    assert.match(v.id, /^[\w-]{11}$/, `${v.id}: YouTube video id`);
    assert.ok(home.includes(`src="https://i.ytimg.com/vi/${v.id}/hqdefault.jpg"`), `${v.id}: thumbnail`);
    assert.ok(home.includes(`href="https://www.youtube.com/watch?v=${v.id}"`), `${v.id}: link to YouTube`);
    assert.equal(home.includes(`data-video-id="${v.id}"`), v.embed !== false, `${v.id}: plays in place unless embedding is off`);
  }
});

test('home page: matches first, then news, the daily quote, career chapters and videos', async () => {
  await build();
  for (const [lang, path, quotesPath] of [['en', '', '/quotes/'], ['es', 'es', '/es/frases/'], ['pt', 'pt', '/pt/frases/']]) {
    const html = await page(path);
    const order = ['matches', 'news', 'daily', 'eras', 'videos'].map((id) => html.indexOf(`<section id="${id}"`));
    assert.ok(order.every((i, n) => i > 0 && (n === 0 || i > order[n - 1])), `${lang}: section order ${order}`);
    const nav = html.slice(html.indexOf('<nav id="site-nav"'), html.indexOf('</nav>'));
    assert.ok(nav.includes(`href="${quotesPath}"`), `${lang}: Quotes in the header opens the quotes page`);
    // Every link the daily cards can show (first render and after Shuffle) points to a built page.
    const daily = JSON.parse(html.match(/<script type="application\/json" id="daily-data">([\s\S]*?)<\/script>/)[1]);
    const shown = [...html.matchAll(/id="daily-(?:quote|episode)-link" href="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(shown.length, 2, `${lang}: daily quote and story link to their pages`);
    for (const p of [...shown, ...daily.quotes.map((q) => q.path), ...daily.episodes.map((e) => e.path)]) await page(p);
    const eras = [...html.slice(html.indexOf('<section id="eras"')).matchAll(/class="card card-link era-card" href="([^"]+)"/g)];
    assert.equal(eras.length, (await load('history.json')).length, `${lang}: one card per era`);
  }
});

// Guards the CLAUDE.md rules together with test/rules.test.mjs, which checks app.js.
test('links that open a new tab do not give the opened page access to ours', async () => {
  await build();
  for (const f of await htmlFiles()) {
    const html = await readFile(join(DIST, f), 'utf8');
    for (const [tag] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(tag, /rel="[^"]*noopener/, `${f}: ${tag}`);
    }
  }
});

// Phase 2 rule: no quote without a source. Tags are a fixed list so tag pages stay meaningful.
const QUOTE_TAGS = ['self-belief', 'rivals', 'humour', 'referees', 'tactics', 'youth', 'fans'];

test('every quote has a dated source, a known era and known tags', async () => {
  const quotes = await load('quotes.json');
  const eras = new Set((await load('history.json')).map((h) => h.id));
  const ui = await load('ui.json');
  for (const q of quotes) {
    assert.ok(Array.isArray(q.sources) && q.sources.length > 0, `${q.id}: at least one source`);
    for (const s of q.sources) {
      // http is allowed: a few archived reports (ESPN.co.uk) exist only there, and these are plain links.
      assert.match(s.url, /^https?:\/\/[^\s]+$/, `${q.id}: source url`);
      assert.ok(s.publisher, `${q.id}: source publisher`);
      if (s.date) assert.match(s.date, /^\d{4}-\d{2}-\d{2}$/, `${q.id}: source date`);
    }
    if (q.date) assert.match(q.date, /^\d{4}(-\d{2}-\d{2})?$/, `${q.id}: date is YYYY or YYYY-MM-DD`);
    if (q.era) assert.ok(eras.has(q.era), `${q.id}: era ${q.era} exists in history.json`);
    for (const t of q.tags ?? []) {
      assert.ok(QUOTE_TAGS.includes(t), `${q.id}: tag ${t}`);
      for (const l of ['en', 'es', 'pt']) assert.ok(ui[l].quotes.tagNames[t], `${q.id}: tag ${t} has a ${l} name in ui.json`);
    }
    if (q.original) assert.ok(q.original.lang && q.original.text, `${q.id}: original needs lang and text`);
    assert.ok(!('year' in q), `${q.id}: the year comes from date, not a separate field`);
  }
});

test('each tag has a page in all three languages listing exactly its quotes, linked from the list and the quotes', async () => {
  await build();
  const quotes = await load('quotes.json');
  const base = { en: 'quotes/tag', es: 'es/frases/tema', pt: 'pt/frases/tema' };
  const detail = { en: 'quotes', es: 'es/frases', pt: 'pt/frases' };
  const lists = { en: await page('quotes'), es: await page('es/frases'), pt: await page('pt/frases') };
  for (const tag of new Set(quotes.flatMap((q) => q.tags))) {
    for (const [lang, b] of Object.entries(base)) {
      const path = `/${b}/${tag}/`;
      const html = await page(path);
      const main = html.slice(html.indexOf('<div class="grid grid-2">'), html.indexOf('</main>'));
      const shown = [...main.matchAll(/href="\/[^"]*\/([^/"]+)\/"/g)].map((m) => m[1]).sort();
      assert.deepEqual(shown, quotes.filter((q) => q.tags.includes(tag)).map((q) => q.id).sort(), `${path}: its quotes`);
      assert.ok(lists[lang].includes(`href="${path}"`), `${lang} list links to ${path}`);
      for (const l of Object.keys(base)) assert.ok(html.includes(`hreflang="${l}" href="https://infinito-mourinho.pages.dev/${base[l]}/${tag}/"`), `${path}: hreflang ${l}`);
    }
  }
  const q = quotes.find((x) => x.tags.length);
  for (const [lang, b] of Object.entries(base)) {
    const html = await page(`${detail[lang]}/${q.id}`);
    for (const tag of q.tags) assert.ok(html.includes(`href="/${b}/${tag}/"`), `${q.id} (${lang}) links to its tag ${tag}`);
  }
});

// A quote tied to an era must have been said during it ("2004–2007", "2000", or "2026–" for the
// current one). Catches a wrong `era` or `date` such as the Chelsea/Real Madrid mix-up found in PR #20.
test('every quote with an era and a date falls within that era', async () => {
  const quotes = await load('quotes.json');
  const eras = Object.fromEntries((await load('history.json')).map((h) => [h.id, h.years]));
  for (const q of quotes.filter((x) => x.era && x.date)) {
    assert.ok(eras[q.era], `${q.id}: era ${q.era} exists in history.json`);
    const [from, to] = eras[q.era].split('–');
    const year = Number(q.date.slice(0, 4));
    const last = to === undefined ? Number(from) : to === '' ? Infinity : Number(to);
    assert.ok(year >= Number(from) && year <= last, `${q.id}: ${q.date} is outside ${q.era} (${eras[q.era]})`);
  }
});

// Trophies follow the same rule as quotes: each one has a source, and its season falls in its era.
test('every trophy has a source, a known era and a season within that era', async () => {
  const trophies = await load('trophies.json');
  const eras = Object.fromEntries((await load('history.json')).map((h) => [h.id, h.years]));
  const ids = new Set();
  for (const t of trophies) {
    assert.ok(!ids.has(t.id), `${t.id}: unique id`);
    ids.add(t.id);
    assert.ok(t.sources?.length > 0, `${t.id}: at least one source`);
    for (const s of t.sources) assert.match(s.url, /^https?:\/\/\S+$/, `${t.id}: source url`);
    for (const l of ['en', 'es', 'pt']) assert.ok(t.competition?.[l], `${t.id}: competition name in ${l}`);
    const m = t.season.match(/^(\d{4})-(\d{2})$/);
    assert.ok(m && (Number(m[1]) + 1) % 100 === Number(m[2]), `${t.id}: season like 2003-04`);
    assert.ok(eras[t.era], `${t.id}: era ${t.era} exists`);
    const [from, to] = eras[t.era].split('–');
    const last = to === undefined ? Number(from) : to === '' ? Infinity : Number(to);
    assert.ok(Number(m[1]) >= Number(from) && Number(m[1]) <= last, `${t.id}: ${t.season} is outside ${t.era} (${eras[t.era]})`);
  }
});

test('the trophies page lists every trophy with its source in all three languages', async () => {
  await build();
  const trophies = await load('trophies.json');
  for (const [lang, path] of [['en', 'trophies'], ['es', 'es/titulos'], ['pt', 'pt/titulos']]) {
    const html = await page(path);
    for (const t of trophies) {
      const item = html.slice(html.indexOf(`id="${t.id}"`), html.indexOf('</li>', html.indexOf(`id="${t.id}"`)));
      assert.ok(item.length > 0, `${lang}: ${t.id} listed`);
      assert.ok(item.includes(t.competition[lang].replace(/'/g, '&#39;')), `${lang}: ${t.id} name`);
      assert.ok(item.includes(`href="${t.sources[0].url}"`), `${lang}: ${t.id} source link`);
    }
  }
});
