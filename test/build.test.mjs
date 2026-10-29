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
