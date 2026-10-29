// The site rules in CLAUDE.md and repeated review findings (docs/review-lessons.md), as checks that fail
// in CI instead of relying on someone remembering them. Each test names the rule it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

let built;
const build = () => (built ??= promisify(execFile)(process.execPath, [join(ROOT, 'scripts/build.mjs')]));
const appJs = () => readFile(join(ROOT, 'src/assets/app.js'), 'utf8');
// Comments may mention what the code avoids, so they are left out before matching.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

test('app.js never parses strings as HTML (feed text could inject markup)', async () => {
  const src = code(await appJs());
  for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment']) {
    assert.ok(!src.includes(sink), `app.js uses ${sink}; build the DOM with el() and textContent instead`);
  }
});

test('the browser fetches only our own /api/* endpoints, never a news site or a CORS/RSS proxy', async () => {
  const src = code(await appJs());
  const calls = [...src.matchAll(/\b(?:fetch|getJson)\(\s*([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(calls.length, 'no fetch calls found; update this test if app.js changed how it loads data');
  for (const arg of calls) {
    // `url` is getJson's own parameter; every caller passes a literal checked here.
    if (arg === 'url') continue;
    assert.match(arg, /^[`'"]\/api\//, `app.js fetches ${arg}; read external data on the server (lib/feeds.js) instead`);
  }
  const files = await readdir(ROOT, { recursive: true });
  for (const f of files.filter((f) => /\.(m?js|json|html|toml)$/.test(f) && !/^(node_modules|dist|\.wrangler|test)\//.test(f))) {
    const text = await readFile(join(ROOT, f), 'utf8');
    for (const proxy of ['rss2json', 'allorigins', 'corsproxy', 'cors-anywhere', 'thingproxy']) {
      assert.ok(!text.includes(proxy), `${f} mentions ${proxy}; free proxies broke the old site's news`);
    }
  }
});

test('the site never redirects by browser language (bad for search); it only offers a banner', async () => {
  const src = code(await appJs());
  assert.doesNotMatch(src, /location\s*(\.href\s*=|\.assign\(|\.replace\(|=)/, 'app.js changes location');
  const pub = await readFile(join(ROOT, 'src/public/_redirects'), 'utf8');
  assert.doesNotMatch(pub, /Language=|Accept-Language|\bCountry=/i, '_redirects redirects by language or country');
});

test('links that open a new tab do not give the opened page access to ours', async () => {
  await build();
  const pages = (await readdir(DIST, { recursive: true })).filter((f) => f.endsWith('.html'));
  for (const f of pages) {
    const html = await readFile(join(DIST, f), 'utf8');
    for (const [tag] of html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)) {
      assert.match(tag, /rel="[^"]*noopener/, `${f}: ${tag}`);
    }
  }
  const src = code(await appJs());
  for (const [call] of src.matchAll(/el\('a',\s*\{[^}]*target:\s*'_blank'[^}]*\}/g)) {
    assert.match(call, /rel:\s*'[^']*noopener/, `app.js: ${call}`);
  }
  for (const [call] of src.matchAll(/window\.open\([^)]*\)/g)) {
    assert.match(call, /noopener/, `app.js: ${call}`);
  }
});

test('the hidden attribute wins over classes that set display (#14)', async () => {
  const css = await readFile(join(ROOT, 'src/assets/styles.css'), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('in-page click handlers on links keep Cmd/Ctrl/Shift-click and middle-click (#15)', async () => {
  const src = code(await appJs());
  // Every handler that cancels a click must first let modified and non-left clicks through.
  const handlers = [...src.matchAll(/addEventListener\('click',\s*\((\w+)\)\s*=>\s*\{([\s\S]*?)\1\.preventDefault\(\)/g)];
  assert.ok(handlers.length, 'no click handler with preventDefault() found; update this test if app.js changed');
  for (const [, e, before] of handlers) {
    for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'button']) {
      assert.ok(before.includes(`${e}.${key}`), `a click handler calls preventDefault() without checking ${e}.${key} first`);
    }
  }
});
