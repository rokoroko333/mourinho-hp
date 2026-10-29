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
