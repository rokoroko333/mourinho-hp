// The site rules in CLAUDE.md and repeated review findings (docs/review-lessons.md), as checks that fail
// in CI instead of relying on someone remembering them. Each test names the rule it guards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Only the source folders: walking the root would also walk dist/, which build.test.mjs rebuilds in parallel.
const sourceFiles = async (dirs, pattern) => {
  const files = [];
  for (const dir of dirs) {
    files.push(...(await readdir(join(ROOT, dir), { recursive: true })).map((f) => join(dir, f)));
  }
  return files.filter((f) => pattern.test(f));
};
// Comments may mention what the code avoids, so they are left out before matching.
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = async (f) => code(await readFile(join(ROOT, f), 'utf8'));
// Every script the browser runs: src/assets/ is copied to dist/assets/.
const browserScripts = async () => {
  const files = await sourceFiles(['src/assets'], /\.m?js$/);
  assert.ok(files.includes(join('src/assets', 'app.js')), 'src/assets/app.js is missing; update this test');
  return Promise.all(files.map(async (f) => [f, await read(f)]));
};

// The text from `start` (an opening bracket) to its matching closing bracket.
function balanced(src, start) {
  const open = src[start], close = { '(': ')', '{': '}' }[open];
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++;
    else if (src[i] === close && --depth === 0) return src.slice(start, i + 1);
  }
  return src.slice(start);
}

test('browser scripts never parse strings as HTML (feed text could inject markup)', async () => {
  for (const [f, src] of await browserScripts()) {
    for (const sink of ['innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'createContextualFragment', 'DOMParser']) {
      assert.ok(!src.includes(sink), `${f} uses ${sink}; build the DOM with el() and textContent instead`);
    }
  }
});

test('the browser fetches only our own /api/* endpoints, never a news site or a CORS/RSS proxy', async () => {
  let checked = 0;
  for (const [f, src] of await browserScripts()) {
    // getJson's own body passes its parameter on; every call of getJson is checked below instead.
    const body = src.match(/const getJson = async \(url\) => \{\s*const res = await fetch\(url\);/);
    const rest = body ? src.replace(body[0], '') : src;
    for (const m of rest.matchAll(/\b(?:fetch|getJson|XMLHttpRequest|EventSource|WebSocket|sendBeacon)\b\s*\(/g)) {
      const arg = balanced(rest, m.index + m[0].length - 1).slice(1, -1).trim();
      assert.match(arg, /^[`'"]\/api\//, `${f} requests ${arg || '(nothing)'}; read external data on the server (lib/feeds.js) instead`);
      checked++;
    }
  }
  assert.ok(checked >= 2, 'expected the news and match requests; update this test if app.js changed how it loads data');
  for (const f of await sourceFiles(['src', 'lib', 'functions', 'workers', 'scripts'], /\.(m?js|json|html|toml)$/)) {
    const text = await readFile(join(ROOT, f), 'utf8');
    for (const proxy of ['rss2json', 'allorigins', 'corsproxy', 'cors-anywhere', 'thingproxy']) {
      assert.ok(!text.includes(proxy), `${f} mentions ${proxy}; free proxies broke the old site's news`);
    }
  }
});

test('the site never redirects by browser language or country (bad for search); it only offers a banner', async () => {
  for (const [f, src] of await browserScripts()) {
    assert.doesNotMatch(src, /\blocation\b(\.(href|pathname|search|hash))?\s*=(?!=)|\blocation\.(assign|replace)\(/, `${f} changes location`);
  }
  // Pages Functions and their helpers are where a server-side redirect by language would go.
  for (const f of await sourceFiles(['functions', 'lib'], /\.m?js$/)) {
    assert.doesNotMatch(await read(f), /accept-language|\bcf\??\.country\b|cf-ipcountry/i, `${f} reads the visitor's language or country`);
  }
  const redirects = await readFile(join(ROOT, 'src/public/_redirects'), 'utf8');
  assert.doesNotMatch(redirects, /Language=|Accept-Language|\bCountry=/i, '_redirects redirects by language or country');
});

// Built pages are checked in build.test.mjs, which owns dist/: test files run in parallel, and two builds
// into the same folder at once fail.
test('links scripts open in a new tab do not give the opened page access to ours', async () => {
  let links = 0;
  for (const [f, src] of await browserScripts()) {
    for (const m of src.matchAll(/\bel\(\s*'a'\s*,\s*\{/g)) {
      const attrs = balanced(src, m.index + m[0].length - 1);
      if (!/target:\s*'_blank'/.test(attrs)) continue;
      assert.match(attrs, /rel:\s*'[^']*noopener/, `${f}: ${attrs}`);
      links++;
    }
    for (const m of src.matchAll(/window\.open\(/g)) {
      const call = balanced(src, m.index + m[0].length - 1);
      assert.match(call, /noopener/, `${f}: window.open${call}`);
    }
  }
  assert.ok(links >= 2, 'expected the news cards and the video label; update this test if app.js changed');
});

test('the hidden attribute wins over classes that set display (#14)', async () => {
  const css = (await readFile(join(ROOT, 'src/assets/styles.css'), 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/);
});

test('in-page click handlers on links keep Cmd/Ctrl/Shift-click and middle-click (#15)', async () => {
  let handlers = 0;
  for (const [f, src] of await browserScripts()) {
    const prevents = (src.match(/\.preventDefault\(\)/g) ?? []).length;
    let found = 0;
    for (const m of src.matchAll(/addEventListener\(\s*(['"])(\w+)\1\s*,\s*/g)) {
      // The handler is everything up to the call's closing bracket, whatever form the function takes.
      const handler = balanced(src, m.index + 'addEventListener'.length);
      const e = handler.match(/\(\s*['"]\w+['"]\s*,\s*(?:async\s*)?(?:function\s*\w*\s*)?\(?\s*(\w+)/)?.[1];
      const cut = e ? handler.indexOf(`${e}.preventDefault()`) : -1;
      if (cut < 0) continue;
      found += (handler.match(/\.preventDefault\(\)/g) ?? []).length;
      if (m[2] !== 'click') continue;
      for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'button']) {
        assert.ok(handler.slice(0, cut).includes(`${e}.${key}`), `${f}: a click handler calls preventDefault() without checking ${e}.${key} first`);
      }
      handlers++;
    }
    // A preventDefault() this test could not tie to a handler would go unchecked.
    assert.equal(found, prevents, `${f}: a preventDefault() this test cannot tie to one handler (named functions and handlers nested in handlers are not understood); write the handler inline, or extend this test`);
  }
  assert.ok(handlers, 'no click handler with preventDefault() found; update this test if app.js changed');
});

// docs/feature-map.md is where agents look up a page, its elements and its flow before changing or
// verifying it, so a map that has drifted sends them to the wrong place.
test('the feature map lists every page and every flow, and names only ids that exist', async () => {
  const map = await readFile(join(ROOT, 'docs/feature-map.md'), 'utf8');
  const ui = JSON.parse(await readFile(join(ROOT, 'src/content/ui.json'), 'utf8'));
  const pages = Object.keys(ui.en.slugs);
  assert.ok(pages.length >= 10, 'expected the page keys in ui.json; update this test if slugs moved');
  for (const page of pages) {
    assert.match(map, new RegExp(`^\\| \`${page}\` \\|`, 'm'), `docs/feature-map.md has no row for the page \`${page}\``);
  }

  const flows = (await readdir(join(ROOT, 'test/flows'))).filter((f) => f.endsWith('.json'));
  assert.ok(flows.length, 'no flows found in test/flows/');
  for (const f of flows) assert.ok(map.includes(`test/flows/${f}`), `docs/feature-map.md does not mention test/flows/${f}`);
  const named = [...map.matchAll(/test\/flows\/([\w-]+\.json)/g)].map((m) => m[1]);
  for (const f of named) assert.ok(flows.includes(f), `docs/feature-map.md names test/flows/${f}, which does not exist`);

  // An id in the map must be one the build writes or app.js looks up.
  const sources = (await readFile(join(ROOT, 'scripts/build.mjs'), 'utf8')) + (await readFile(join(ROOT, 'src/assets/app.js'), 'utf8'));
  const ids = [...new Set([...map.matchAll(/`[^`]*#([a-z][\w-]*)[^`]*`/g)].map((m) => m[1]))];
  assert.ok(ids.length >= 10, `expected the ids in the map's tables, found ${ids.length}; update this test if the map changed`);
  for (const id of ids) {
    assert.ok(sources.includes(`id="${id}"`) || sources.includes(`'${id}'`), `docs/feature-map.md names #${id}, which neither scripts/build.mjs nor app.js has`);
  }
});
