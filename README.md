# Infinito Mourinho

Multilingual (EN / ES / PT / JA) José Mourinho fan site on Cloudflare Pages. `CLAUDE.md` has the architecture and the
rules; `docs/dev-flow.md` has the development flow.

## Local development

Wrangler 4 needs Node.js 22 or later (`.node-version` pins it for nodenv and similar tools).

```sh
npm ci
npm test
npm run dev        # http://localhost:8788, with the Pages Functions
npm run verify     # with the dev server running: the browser flows in test/flows/
```

- **Port 8788** is also used by another project on the same machine. Check that the server is this site with
  `curl -s localhost:8788 | grep 'Infinito Mourinho'`, or run `npx wrangler pages dev dist --port 8790` and
  `npm run verify -- --base http://localhost:8790`.
- **Edge cache**: `/matches/` is cached for 5 minutes by its Function, locally too. After changing its HTML, stop the
  server, delete `.wrangler/state/v3/cache` and start it again.
- **News and matches** are read from KV. Locally the KV is empty: run the Worker once with `npm run feeds:dev` and
  `curl "http://localhost:8787/__scheduled"` to fill the local KV.
- **Fan predictions** need the local D1 schema and a salt: run
  `npx wrangler d1 migrations apply infinito-mourinho-votes --local` once, and put `VOTE_SALT=<any random string>` in
  `.dev.vars` (git-ignored; never commit it).
- **Screenshots for a PR**: see `docs/dev-flow.md` (section 5).
- **Share images** (`src/public/og/`, 1200×630 PNG) are generated with the local Chrome and committed: after adding
  or editing a quote, run `npm run og` and commit the result. The build never needs a browser, and `npm test` fails
  if a quote has no image.

## Cloudflare resources

These already exist; the ids are in `wrangler.toml` and `workers/feeds/wrangler.toml`.

| Resource | Name | Used by |
|---|---|---|
| Pages project (direct upload from the terminal, not Git-connected) | `infinito-mourinho` | the site and `functions/` |
| Worker with a Cron Trigger every 20 minutes, no public URL (`workers_dev = false`) | `infinito-mourinho-feeds` | writes news and matches to KV, purges old votes |
| KV namespace | `FEEDS` | shared by the Worker (writes) and `functions/api/home` (and the older `news`, `matches`), the `/matches/` pages (reads) |
| D1 database | `infinito-mourinho-votes` (binding `VOTES`) | `functions/api/predict` (votes), `functions/api/home` (tallies) and the Worker (purge) |
| Pages secret | `VOTE_SALT` | hashes the voter's connection; without it `/api/predict` answers 503 |

Log in once with `npx wrangler login`.

## Deploying

Deploy only what changed, in this order:

1. **D1 schema** (a new file in `migrations/`): `npx wrangler d1 migrations apply infinito-mourinho-votes --remote`
2. **Secrets** (only when a new one is added), e.g. `openssl rand -hex 24 | npx wrangler pages secret put VOTE_SALT --project-name infinito-mourinho`
3. **Worker** (`lib/feeds.js`, `lib/predict.js` or `workers/feeds/` changed): `npm run feeds:deploy`
4. **Pages**: `npm run build` then `npm run deploy -- --branch main`. Set `SITE_URL=https://<domain>` for the build
   once a custom domain is used (without it, URLs point to the pages.dev address).

When the shape of the JSON in KV changes, deploy both the Worker and Pages, and keep the pages working with the old
shape until the next cron run (at most 20 minutes).

After deploying, check production with `npm run verify -- --base https://infinito-mourinho.pages.dev` (the flows
never post votes outside localhost) and the Worker's log with `npx wrangler tail --config workers/feeds/wrangler.toml`
(`outlets:empty`, `outlets:failed`, `feeds:failed`; without `--config`, Wrangler reads `wrangler.toml`, takes the
project for Pages and fails).

Once a domain is set: submit `https://<domain>/sitemap.xml` in Google Search Console.

## Free plan budget at 15,000 visitors/day

- **Static pages**: unlimited requests and bandwidth on Pages.
- **Functions** (`/api/*` and `/matches/`): one call per page view with live data (`/api/home`), plus a POST per
  prediction. Responses are edge-cached, but every
  invocation counts toward the Workers free limit of 100,000 requests/day (roughly 50,000 home page views/day).
  Beyond that, move to Workers Paid ($5/month).
- **KV**: 2 writes per cron run (the news list and the matches), 144 writes/day (limit 1,000); reads are mostly
  absorbed by the edge cache.
- **Worker subrequests**: at most 31 per run (limit 50); the breakdown is in the comment above `refreshAll` in
  `lib/feeds.js`.
- **D1**: 2 writes per vote (the vote and the burst counter) and a purge per cron run; limits are 100,000 writes and
  5 million rows read per day.
