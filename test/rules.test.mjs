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
    const row = map.split('\n').find((line) => line.startsWith(`| \`${page}\` |`));
    assert.ok(row, `docs/feature-map.md has no row for the page \`${page}\``);
    // The row's paths must follow the slugs, so a renamed slug cannot leave the map pointing at the old path.
    for (const lang of ['en', 'es', 'pt']) {
      const slug = ui[lang].slugs[page];
      const path = slug ? `\`/${slug}/` : '`/`';
      assert.ok(row.includes(path), `docs/feature-map.md: the \`${page}\` row does not have the ${lang} path ${path}\``);
    }
    // Japanese is not listed per row; the map states the rule instead: /ja/ plus the English slug.
    const en = ui.en.slugs[page];
    assert.equal(ui.ja.slugs[page], en ? `ja/${en}` : 'ja', `ui.json ja.slugs.${page} breaks the rule in docs/feature-map.md (/ja/ + the English slug)`);
  }
  assert.ok(map.includes('`/ja/` に英語のスラッグ'), 'docs/feature-map.md no longer states the Japanese path rule');

  const flows = (await readdir(join(ROOT, 'test/flows'))).filter((f) => f.endsWith('.json'));
  assert.ok(flows.length, 'no flows found in test/flows/');
  for (const f of flows) assert.ok(map.includes(`test/flows/${f}`), `docs/feature-map.md does not mention test/flows/${f}`);
  const named = [...map.matchAll(/test\/flows\/([\w-]+\.json)/g)].map((m) => m[1]);
  for (const f of named) assert.ok(flows.includes(f), `docs/feature-map.md names test/flows/${f}, which does not exist`);

  // An id in the map must be one the build writes or app.js looks up.
  const sources = (await readFile(join(ROOT, 'scripts/build.mjs'), 'utf8')) + (await readFile(join(ROOT, 'src/assets/app.js'), 'utf8'));
  // Take the code spans first, so a span without an id cannot shift the match into the prose.
  const spans = [...map.matchAll(/`([^`\n]*)`/g)].map((m) => m[1]);
  const ids = [...new Set(spans.flatMap((s) => [...s.matchAll(/#([a-z][\w-]*)/g)].map((m) => m[1])))];
  assert.ok(ids.length >= 10, `expected the ids in the map's tables, found ${ids.length}; update this test if the map changed`);
  for (const id of ids) {
    assert.ok(sources.includes(`id="${id}"`) || sources.includes(`'${id}'`), `docs/feature-map.md names #${id}, which neither scripts/build.mjs nor app.js has`);
  }
});

// Kick-off times are shown in the club's own time zone, labelled with its city. On a move, the comment above
// TEAM_ID names the new club, and this fails until the zone beside it (and the constants) follow (#52).
test('the match time zone and city are those of the current club, as the comment above TEAM_ID says', async () => {
  const feeds = await readFile(join(ROOT, 'lib/feeds.js'), 'utf8');
  const head = feeds.slice(0, feeds.indexOf('export const TEAM_ID'));
  const comment = head.slice(head.lastIndexOf('\n\n')).split('\n').filter((l) => l.startsWith('//')).join(' ');
  const [, club] = comment.match(/\(\d+ = ([^)]+)\)/) ?? [];
  const [, zone] = comment.match(new RegExp(`\\(([\\w/]+) for ${club}\\)`)) ?? [];
  assert.ok(zone, `the comment above TEAM_ID does not say "(<time zone> for ${club})"; write the new club's time zone there`);
  const { MATCH_TIME_ZONE, MATCH_CITY } = await import('../lib/feeds.js');
  assert.equal(MATCH_TIME_ZONE, zone, `MATCH_TIME_ZONE is not ${club}'s time zone (${zone})`);
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: MATCH_TIME_ZONE }), 'MATCH_TIME_ZONE is a real time zone');
  assert.equal(MATCH_CITY.en, zone.split('/').pop().replace(/_/g, ' '), `MATCH_CITY.en is not the city of ${zone}`);
  const ui = JSON.parse(await readFile(join(ROOT, 'src/content/ui.json'), 'utf8'));
  for (const lang of Object.keys(ui)) assert.ok(MATCH_CITY[lang], `MATCH_CITY has no ${lang} name`);
});

// When Mourinho moves, the club name sits in several ui.json strings next to TEAM_ID, and a missed one
// (or one language) keeps showing the old club (#2, #34). The list of places is the comment above TEAM_ID.
test('every ui.json string naming the current club is listed beside TEAM_ID, and names it in every language', async () => {
  const feeds = await readFile(join(ROOT, 'lib/feeds.js'), 'utf8');
  const head = feeds.slice(0, feeds.indexOf('export const TEAM_ID'));
  const comment = head.slice(head.lastIndexOf('\n\n')).split('\n').filter((l) => l.startsWith('//')).join(' ');
  const [, id, club] = comment.match(/\((\d+) = ([^)]+)\)/) ?? [];
  // Languages that write the club in another script name it in the comment too, as "(ja: …)".
  const clubIn = (lang) => comment.match(new RegExp(`\\(${lang}: ([^)]+)\\)`))?.[1] ?? club;
  assert.ok(club, 'the comment above TEAM_ID no longer says "(<id> = <club>)"; update this test');
  assert.equal(Number(id), (await import('../lib/feeds.js')).TEAM_ID, `the comment above TEAM_ID names team ${id}; change it with TEAM_ID`);
  // Any `section.key` span is a ui.json key; paths like `src/content/ui.json` have slashes and do not match.
  const listed = [...comment.matchAll(/`(\w+\.\w+)`/g)].map((m) => m[1]);
  assert.ok(listed.length >= 3, `expected the ui.json keys in the comment above TEAM_ID, found ${listed.length}; update this test`);

  // Career text that stays true after a move; add a key here only when it names the club as history.
  const history = new Set(['history.description']);
  const ui = JSON.parse(await readFile(join(ROOT, 'src/content/ui.json'), 'utf8'));
  const strings = (o, path = '') => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'string' ? [[`${path}${k}`, v]] : v && typeof v === 'object' ? strings(v, `${path}${k}.`) : []);
  for (const lang of Object.keys(ui)) {
    const all = new Map(strings(ui[lang]));
    for (const key of listed) {
      // A language may also keep the club's own name (the Japanese home page heads the matches in English).
      assert.ok([club, clubIn(lang)].some((name) => all.get(key)?.includes(name)), `ui.json ${lang}.${key} does not name ${clubIn(lang)}; it is listed beside TEAM_ID as a place to change on a move`);
    }
    for (const [key, text] of all) {
      const named = [club, clubIn(lang)].find((name) => text.includes(name));
      if (!named || history.has(key)) continue;
      assert.ok(listed.includes(key), `ui.json ${lang}.${key} names ${named} but is not in the list above TEAM_ID in lib/feeds.js; add it there`);
    }
  }
});

// Tone and manner (docs/design.md): colours live in :root only, and every font the CSS or a page asks for
// is bundled, so a renamed or missing file cannot quietly fall back to another typeface.
test('styles keep colours in :root and every font file they or the pages name exists', async () => {
  const css = await readFile(join(ROOT, 'src/assets/styles.css'), 'utf8');
  const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')));
  const outside = css.replace(root, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(outside.match(/#[0-9a-f]{3,8}\b|\b(?:rgb|hsl)a?\(/gi) ?? [], [], 'colours outside :root; add a token in :root (docs/design.md)');
  const build = await readFile(join(ROOT, 'scripts/build.mjs'), 'utf8');
  const og = await readFile(join(ROOT, 'scripts/og.mjs'), 'utf8');
  const fonts = [
    ...css.matchAll(/url\('\/assets\/(fonts\/[^']+)'\)/g),
    ...build.matchAll(/href="\/assets\/(fonts\/[^"]+)"/g),
    ...og.matchAll(/'(barlow-condensed-\d+\.woff2)'/g).map((m) => [m[0], `fonts/${m[1]}`]),
  ].map((m) => m[1]);
  assert.ok(fonts.length >= 6, 'expected the @font-face sources, the preloads and the share image fonts');
  for (const f of fonts) await readFile(join(ROOT, 'src/assets', f));
});

// News is one list for every language under KV `news:local` (#57); a leftover per-language key in the docs
// would seed or read a key the site no longer uses.
test('docs name only the news key the site reads', async () => {
  for (const f of ['README.md', ...(await readdir(join(ROOT, 'docs'))).map((d) => `docs/${d}`)]) {
    if (!f.endsWith('.md') || f === 'docs/review-lessons.md') continue;
    assert.doesNotMatch(await readFile(join(ROOT, f), 'utf8'), /news:(en|es|pt|ja)\b/, `${f}: use news:local`);
  }
});

// Every language the site builds is complete: any text in src/content/ with English, Spanish and Portuguese
// also has Japanese, and ui.json has the same keys in every language (#56, #58).
test('every content text and every ui.json key exists in every language', async () => {
  const ui = JSON.parse(await readFile(join(ROOT, 'src/content/ui.json'), 'utf8'));
  const langs = Object.keys(ui);
  const keys = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}`]));
  const en = keys(ui.en).sort();
  // countdownUnits.sep is the only optional key: Japanese sets it to '' to write 1日22時間 without spaces.
  const optional = (k) => k === 'home.countdownUnits.sep';
  for (const l of langs) assert.deepEqual(keys(ui[l]).filter((k) => !optional(k)).sort(), en.filter((k) => !optional(k)), `ui.json ${l}: same keys as en`);
  assert.equal(ui.ja.home.countdownUnits.sep, '', 'ui.json ja: the countdown writes number and unit together');
  for (const f of (await readdir(join(ROOT, 'src/content'))).filter((f) => f.endsWith('.json') && f !== 'ui.json')) {
    JSON.stringify(JSON.parse(await readFile(join(ROOT, 'src/content', f), 'utf8')), (k, v) => {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'en' in v && 'pt' in v) {
        for (const l of langs) assert.ok(v[l] && (Array.isArray(v.en) ? v[l].length === v.en.length : true), `${f}: "${String(v.en).slice(0, 40)}" has no ${l}`);
      }
      return v;
    });
  }
});

// Data names shown on Japanese pages: every rival has a Japanese name, so a new rival cannot show its name
// in English on /ja/ only (#58).
test('every rival has its name in each language that writes names differently', async () => {
  const rivals = JSON.parse(await readFile(join(ROOT, 'src/content/rivals.json'), 'utf8'));
  // Japanese at least; any other language given for one rival must be given for all of them.
  const langs = new Set(['ja', ...rivals.flatMap((r) => Object.keys(r.localName ?? {}))]);
  for (const r of rivals) for (const l of langs) assert.ok(r.localName?.[l], `rivals.json ${r.id}: no localName.${l}`);
});

// The overflow flows repeat one long check (flow JSON cannot share a function); a fix to one copy must reach
// every copy, so the copies must stay identical (#60).
test('every overflow check in the overflow flows is the same check', async () => {
  const checks = [];
  for (const f of ['no-overflow.json', 'no-overflow-320.json']) {
    const flow = JSON.parse(await readFile(join(ROOT, 'test/flows', f), 'utf8'));
    checks.push(...flow.steps.map((s) => s.eval).filter((e) => e?.includes('scrollWidth')));
  }
  assert.ok(checks.length >= 10, `expected the overflow checks, found ${checks.length}`);
  assert.equal(new Set(checks).size, 1, 'the overflow checks differ; change every copy together');
});
