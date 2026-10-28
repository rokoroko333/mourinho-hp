# Infinito Mourinho

Unofficial José Mourinho fan site. Rebuilt from scratch in October 2026 to replace the old single-file
Netlify site (https://magenta-otter-30fcbe.netlify.app/).

## Goals and audience
- Audience: English, Spanish and Portuguese speakers worldwide (not Japanese). The owner writes to Claude in Japanese.
- Goal: traffic on the level of popular international fan sites. International SEO matters:
  every page exists in en/es/pt with hreflang, canonical, sitemap alternates and localized slugs.
- Plan for at least 15,000 visitors/day on Cloudflare's free plan.

## Architecture
- `scripts/build.mjs` – zero-dependency static generator. Renders `src/content/*.json` into `dist/`.
  English lives at `/`, Spanish at `/es/`, Portuguese at `/pt/` (`/history/`, `/es/historia/`, `/pt/frases/`, …).
- `src/content/` – all text. `ui.json` (UI strings per language), `quotes.json`, `episodes.json`,
  `history.json`, `videos.json`. Every user-facing string must have `en`, `es` and `pt`.
- `src/assets/` – `styles.css` and `app.js` (vanilla JS, no framework, no Tailwind/CDN). `src/public/` is copied
  to the root of `dist/` (`_headers`, `_redirects`, favicon).
- `lib/feeds.js` – server-side fetching/parsing of Google News RSS (two editions per language) and the ESPN
  schedule of Mourinho's current club (`TEAM_ID`, 86 = Real Madrid; change it when he moves).
- `workers/feeds/` – separate Cloudflare Worker on a Cron Trigger (every 20 min) that writes JSON into the
  `FEEDS` KV namespace. It never overwrites KV with an empty result, so the last good data is always served.
- `functions/api/news.js`, `functions/api/matches.js` – Pages Functions that serve KV through the edge cache
  (`lib/serve.js`). The browser only ever calls our own `/api/*`.

## Rules
- Never fetch news or third-party APIs from the browser, and never use free CORS/RSS proxies
  (rss2json, allorigins…). That is why the old site's news broke.
- Never put feed text into `innerHTML`; build DOM nodes with `textContent` (see `app.js`).
- Facts in quotes/episodes/history must be verifiable. If unsure of a year or detail, leave it out.
- Keep pages server-rendered: content must be in the HTML for search engines; JS only enhances.
- Don't auto-redirect by browser language (hurts SEO); `app.js` only shows a dismissible suggestion banner.

## Commands
- `npm install` – installs wrangler (dev only).
- `npm run build` – builds `dist/`. Set `SITE_URL` to the production origin (defaults to the pages.dev URL).
- `npm test` – unit tests for the feed parser and fallback logic (`node --test`).
- `npm run dev` – build and serve locally with Pages Functions at http://localhost:8788.
  Seed local KV with `npx wrangler kv key put --local --binding FEEDS news:en --path sample.json`.
- `npm run feeds:dev` – run the cron Worker locally; trigger with `curl "http://localhost:8787/__scheduled"`.

## Deployment (Cloudflare)
See README.md. Pages project `infinito-mourinho` (build `npm run build`, output `dist`), KV namespace `FEEDS`
bound to both the Pages project and the `infinito-mourinho-feeds` Worker.

## Repo
github.com/rokoroko333/mourinho-hp (private). Local clone: `~/dev-hp/pj_mourinho`.
