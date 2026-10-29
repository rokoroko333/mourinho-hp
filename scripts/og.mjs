// Share images (Open Graph, 1200×630 PNG): one per quote plus a default for every other page.
//
//   npm run og      # rewrites src/public/og/ — run it after adding or editing quotes, then commit the PNGs
//
// Rendered with the local Chrome (scripts/chrome.mjs) and committed, so `npm run build`, CI and
// Cloudflare never need a browser. test/build.test.mjs fails if a quote has no image.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// Same palette and fonts as src/assets/styles.css. Inline styles are fine here: these pages are only
// opened by the local Chrome, never served under the site's Content-Security-Policy.
const page = (body) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${OG_SIZE.width}px; height: ${OG_SIZE.height}px; overflow: hidden; }
  /* A flat background keeps each PNG small (a gradient made them ~200 KB). */
  body { background: #121212; color: #e5e5e5; border-left: 12px solid #d4af37;
    font-family: 'Helvetica Neue', Arial, sans-serif; display: flex; flex-direction: column;
    justify-content: space-between; padding: 64px 80px; box-sizing: border-box; border-bottom: 12px solid #d4af37; }
  .brand { display: flex; align-items: center; gap: 16px; font-weight: 800; letter-spacing: 0.12em; font-size: 26px; color: #fff; }
  .brand svg { width: 52px; height: 52px; }
  .gold { color: #d4af37; }
  blockquote { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #fff; line-height: 1.3; }
  .by { font-size: 30px; color: #d4af37; font-weight: 700; }
  .big { font-size: 112px; font-weight: 900; line-height: 1; color: #fff; letter-spacing: -0.02em; }
  .sub { font-size: 40px; font-family: Georgia, serif; font-style: italic; color: #d4af37; }
</style></head><body>${body}</body></html>`;

const brand = `<div class="brand">${logo}<span>INFINITO <span class="gold">MOURINHO</span></span></div>`;

// Longer quotes get a smaller size so every one fits in the card without being cut.
const quoteSize = (text) => (text.length < 60 ? 68 : text.length < 110 ? 54 : text.length < 180 ? 44 : 38);

function quoteImage(q) {
  return page(`${brand}
<blockquote style="font-size:${quoteSize(q.text)}px">“${esc(q.text)}”</blockquote>
<div class="by">— José Mourinho${q.year ? `, ${q.year}` : ''}</div>`);
}

// Used by every language, so it carries only names that read the same in English, Spanish and Portuguese.
function defaultImage() {
  return page(`${brand}
<div><div class="big">JOSÉ <span class="gold">MOURINHO</span></div><div class="sub">The Special One</div></div>
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
