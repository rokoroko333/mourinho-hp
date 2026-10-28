# Infinito Mourinho

Multilingual (EN / ES / PT) José Mourinho fan site for Cloudflare Pages. See `CLAUDE.md` for the architecture.

## Local development

```sh
npm install
npm test
npm run dev        # http://localhost:8788
```

The news and match sections read from KV. Locally the KV is empty, so the Functions fetch live data once;
if you are offline, seed it with `npx wrangler kv key put --local --binding FEEDS news:en --path sample.json`.

## First deployment

1. Log in: `npx wrangler login`
2. Create the KV namespace and paste its id into **both** `wrangler.toml` and `workers/feeds/wrangler.toml`:
   ```sh
   npx wrangler kv namespace create FEEDS
   ```
3. Deploy the cron Worker that fills KV every 20 minutes:
   ```sh
   npm run feeds:deploy
   ```
4. Create the Pages project in the Cloudflare dashboard (Workers & Pages → Create → Pages → connect
   `rokoroko333/mourinho-hp`):
   - Build command: `npm run build`
   - Output directory: `dist`
   - Environment variable: `SITE_URL=https://<your domain>` (once the domain is decided)

   The KV binding comes from `wrangler.toml`. Alternatively deploy from the terminal with `npm run deploy`.
5. Optional: set a `REFRESH_TOKEN` secret on the Worker
   (`npx wrangler secret put REFRESH_TOKEN --config workers/feeds/wrangler.toml`) to refresh KV on demand with
   `curl -H "Authorization: Bearer <token>" https://infinito-mourinho-feeds.<account>.workers.dev/refresh`.
6. Submit `https://<domain>/sitemap.xml` in Google Search Console.

## Free plan budget at 15,000 visitors/day

- Static pages: unlimited requests and bandwidth on Pages.
- `/api/*` Functions: about 2 calls per home page view. Responses are edge-cached for 5 minutes, but every
  Function invocation still counts toward the Workers free limit of 100,000 requests/day, which covers roughly
  50,000 home page views/day. Beyond that, move to Workers Paid ($5/month).
- KV: 144 writes/day from the cron (limit 1,000; matches every 20 minutes, each language's news hourly); reads are mostly absorbed by the edge cache.
