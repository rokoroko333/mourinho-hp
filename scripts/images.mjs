// Third-party images served from our own site, so a visitor's browser never contacts YouTube or ESPN before
// they click (security review, #70): the video thumbnails and the team logos.
//
//   npm run images   # run after adding a video, or when a new opponent has no logo; then commit the files
//
// Like `npm run og`, the files are fetched here and committed, so `npm run build`, CI and Cloudflare never
// fetch them. test/build.test.mjs fails if a video has no thumbnail.
//
// - Thumbnails: src/public/thumbs/<video id>.jpg for every video in src/content/videos.json (rebuilt in full).
// - Logos: src/public/logos/<ESPN team id>.png (104×104) for the teams of LaLiga, the Champions League and the
//   Supercopa, and every team in this season's matches. Logos are only added or replaced, never deleted, so a
//   past opponent keeps its logo. A team without a file is shown without a logo (src/assets/app.js).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const THUMBS = join(ROOT, 'src/public/thumbs');
const LOGOS = join(ROOT, 'src/public/logos');
const LEAGUES = ['esp.1', 'uefa.champions', 'esp.super_cup'];
const SITE = process.env.SITE_URL || 'https://infinito-mourinho.pages.dev';
const MAX_BYTES = 200_000;

const MAGIC = { jpg: [0xff, 0xd8, 0xff], png: [0x89, 0x50, 0x4e, 0x47] };
async function image(url, kind) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // Only real images of a sane size are written: the site serves these files as they are.
  if (!MAGIC[kind].every((b, i) => buf[i] === b)) throw new Error(`not a ${kind}: ${url}`);
  if (buf.length > MAX_BYTES) throw new Error(`too large (${buf.length} bytes): ${url}`);
  return buf;
}

// Thumbnails: written to a fresh folder first, swapped in only when all of them arrived (an interrupted run
// must not leave the site without thumbnails).
const videos = JSON.parse(readFileSync(join(ROOT, 'src/content/videos.json'), 'utf8'));
// Next to the target, so the rename stays on one disk.
const tmp = mkdtempSync(join(ROOT, 'src/public/.thumbs-'));
for (const v of videos) {
  if (!/^[\w-]{11}$/.test(v.id)) throw new Error(`unexpected video id: ${v.id}`);
  writeFileSync(join(tmp, `${v.id}.jpg`), await image(`https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`, 'jpg'));
}
rmSync(THUMBS, { recursive: true, force: true });
renameSync(tmp, THUMBS);
console.log(`thumbs: ${videos.length}`);

// Logos: the teams of the leagues above, plus every team in this season's matches as the site has them.
const ids = new Set();
for (const league of LEAGUES) {
  const data = await (await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/teams`)).json();
  for (const { team } of data.sports?.[0]?.leagues?.[0]?.teams || []) if (team?.logos?.length) ids.add(String(team.id));
}
try {
  const { matches } = await (await fetch(`${SITE}/api/home?lang=en`)).json();
  for (const m of [matches?.next, matches?.latest, ...(matches?.results || []), ...(matches?.fixtures || [])]) {
    for (const t of [m?.home, m?.away]) if (t?.id && t.logo) ids.add(String(t.id));
  }
} catch (err) {
  console.warn(`logos: could not read this season's matches from ${SITE} (${err.message}); league teams only`);
}
mkdirSync(LOGOS, { recursive: true });
let written = 0;
const failed = [];
for (const id of [...ids].sort((a, b) => a - b)) {
  if (!/^\d{1,8}$/.test(id)) continue;
  try {
    const png = await image(`https://a.espncdn.com/combiner/i?img=/i/teamlogos/soccer/500/${id}.png&h=104&w=104`, 'png');
    writeFileSync(join(LOGOS, `${id}.png`), png);
    written++;
  } catch (err) {
    failed.push(`${id} (${err.message})`);
  }
}
console.log(`logos: ${written} written, ${readdirSync(LOGOS).length} in total${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
if (!existsSync(join(LOGOS, '86.png'))) console.warn('logos: no logo for the current club (86)');
