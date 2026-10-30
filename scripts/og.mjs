// Share images (Open Graph, 1200×630 PNG): one per quote plus a default for every other page.
//
//   npm run og      # rewrites src/public/og/ — run it after adding or editing quotes, then commit the PNGs
//
// Rendered with the local Chrome (scripts/chrome.mjs) and committed, so `npm run build`, CI and
// Cloudflare never need a browser. test/build.test.mjs fails if a quote has no image.
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { capture, findChrome } from './chrome.mjs';
import { withYears } from './content.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'src/public/og');
const OG_SIZE = { width: 1200, height: 630 };

const quotes = JSON.parse(readFileSync(join(ROOT, 'src/content/quotes.json'), 'utf8'));
withYears(quotes);
const logo = readFileSync(join(ROOT, 'src/public/favicon.svg'), 'utf8');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Same tone as the site (docs/design.md; values copied from :root in src/assets/styles.css): night black,
// warm white, champagne gold for the bar, the name and the byline only; no red, which the site keeps for
// the moment of a match. Inline styles are fine here: these pages are only opened by the local Chrome,
// never served under the site's Content-Security-Policy. The display face is the bundled Barlow Condensed.
// Weight -> file. The @font-face rules below are built from this list, so the files checked are the
// files read. Chrome falls back to another face without a word when one is missing, which would redraw
// every image in it; stop instead (test/rules.test.mjs checks these names too).
const FONT_FILES = { 600: 'barlow-condensed-600.woff2', 800: 'barlow-condensed-800.woff2' };
const missing = Object.values(FONT_FILES).filter((f) => !existsSync(join(ROOT, 'src/assets/fonts', f)));
if (missing.length) throw new Error(`og: missing font files in src/assets/fonts: ${missing.join(', ')}`);
const FONTS = pathToFileURL(join(ROOT, 'src/assets/fonts')).href;
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  ${Object.entries(FONT_FILES).map(([weight, file]) => `@font-face { font-family: 'Barlow Condensed'; font-weight: ${weight}; src: url('${FONTS}/${file}') format('woff2'); }`).join('\n  ')}
  html, body { margin: 0; width: ${OG_SIZE.width}px; height: ${OG_SIZE.height}px; overflow: hidden; }
  /* A flat background keeps each PNG small (a gradient made them ~200 KB). */
  body { background: #0b0d10; color: #f2efea; font-family: 'Barlow Condensed', 'Arial Narrow', sans-serif;
    display: flex; flex-direction: column; justify-content: space-between; padding: 72px 88px; box-sizing: border-box;
    border-bottom: 1px solid rgb(201 164 92 / 0.35); }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 800; letter-spacing: 0.16em; font-size: 30px; text-transform: uppercase; }
  .brand svg { width: 48px; height: 48px; }
  .gold { color: #c9a45c; }
  .bar { width: 64px; height: 4px; background: #c9a45c; margin-bottom: 28px; }
  blockquote { margin: 0; font-family: Georgia, 'Times New Roman', serif; font-style: italic; color: #f2efea; line-height: 1.3; }
  .by { font-size: 32px; font-weight: 600; letter-spacing: 0.14em; text-transform: uppercase; color: #c9a45c; }
  .big { font-size: 168px; font-weight: 800; line-height: 0.88; text-transform: uppercase; letter-spacing: -0.01em; }
  .sub { font-size: 40px; font-family: Georgia, serif; font-style: italic; color: #9aa0a8; margin-top: 24px; }
</style></head><body>${body}</body></html>`;

const brand = `<div class="brand">${logo}<span>INFINITO <span class="gold">MOURINHO</span></span></div>`;

// Longer quotes get a smaller size so every one fits in the card without being cut.
const quoteSize = (text) => (text.length < 60 ? 68 : text.length < 110 ? 54 : text.length < 180 ? 44 : 38);

function quoteImage(q) {
  return page(`${brand}
<div><div class="bar"></div><blockquote style="font-size:${quoteSize(q.text)}px">“${esc(q.text)}”</blockquote></div>
<div class="by">— José Mourinho${q.year ? `, ${q.year}` : ''}</div>`);
}

// Used by every language, so it carries only names that read the same in English, Spanish and Portuguese.
function defaultImage() {
  return page(`${brand}
<div><div class="bar"></div><div class="big">JOSÉ <span class="gold">MOURINHO</span></div><div class="sub">The Special One</div></div>
<div class="by">infinito-mourinho</div>`);
}

const chrome = findChrome();
const work = mkdtempSync(join(tmpdir(), 'og-'));
// Everything is rendered into `next` first and only then swapped in, so a Chrome failure halfway
// leaves the committed images untouched.
const next = join(work, 'og');
mkdirSync(join(next, 'quotes'), { recursive: true });
try {
  const jobs = [['default', defaultImage()], ...quotes.map((q) => [`quotes/${q.id}`, quoteImage(q)])];
  for (const [name, html] of jobs) {
    const src = join(work, `${name.replace('/', '-')}.html`);
    writeFileSync(src, html);
    capture(chrome, pathToFileURL(src).href, { ...OG_SIZE, file: join(next, `${name}.png`), waitMs: 500 });
  }
  rmSync(OUT, { recursive: true, force: true });
  cpSync(next, OUT, { recursive: true }); // a copy, since the temp dir may be on another disk
  console.log(`Wrote ${jobs.length} share images to ${OUT}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
