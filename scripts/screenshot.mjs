// Screenshots of pages for a PR, using the local Chrome in headless mode (no npm dependency).
//
//   npm run dev                                   # in another terminal (http://localhost:8788)
//   node scripts/screenshot.mjs / /es/ /pt/       # writes screenshots/*.png
//   node scripts/screenshot.mjs --pr 12 / /es/    # also pushes them to the `screenshots` branch
//                                                 # and prints Markdown to paste into the PR
//
// Options: --base <origin> (default http://localhost:8788), --height <px> (default 2200; anything below
// is cut off, so raise it for long pages such as the history), CHROME=<path to the Chrome binary>.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture, findChrome } from './chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'screenshots');
const BRANCH = 'screenshots';
// Headless Chrome will not make a window narrower than 500px, so that is the phone-sized shot.
const WIDTHS = { desktop: 1280, mobile: 500 };

function parseArgs(argv) {
  const opts = { base: 'http://localhost:8788', height: 2200, pr: null, paths: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i].replace(/\/$/, '');
    else if (argv[i] === '--height') opts.height = Number(argv[++i]);
    else if (argv[i] === '--pr') opts.pr = Number(argv[++i]);
    else opts.paths.push(argv[i]);
  }
  if (!opts.paths.length) opts.paths = ['/', '/es/', '/pt/', '/ja/'];
  if (opts.pr !== null && !Number.isInteger(opts.pr)) throw new Error('--pr needs a PR number');
  return opts;
}

const fileName = (path, size) => `${path.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'home'}-${size}.png`;

// Keeps images out of the code branches: they go to an orphan branch, one folder per PR.
function publish(pr, files) {
  const git = (args, cwd = ROOT) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  // Only owner/repo: the remote URL may embed credentials, which must never reach the PR text.
  const repo = git(['remote', 'get-url', 'origin']).match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?$/)?.[1];
  if (!repo) throw new Error('origin is not a GitHub remote');
  const dir = mkdtempSync(join(tmpdir(), 'shots-'));
  git(['worktree', 'add', '--detach', dir]);
  try {
    let exists = true;
    try {
      // Into a remote-tracking ref: FETCH_HEAD belongs to the main worktree and is not visible from `dir`.
      // --no-prune: with `fetch.prune` set, git deletes the very ref this refspec writes.
      git(['fetch', '--no-prune', 'origin', `${BRANCH}:refs/remotes/origin/${BRANCH}`]);
    } catch {
      exists = false;
    }
    if (exists) git(['checkout', '-B', BRANCH, `origin/${BRANCH}`], dir);
    else {
      git(['checkout', '--orphan', BRANCH], dir);
      git(['rm', '-rfq', '.'], dir);
    }
    // Replace the PR's folder, so shots of pages no longer listed do not linger.
    rmSync(join(dir, `pr-${pr}`), { recursive: true, force: true });
    mkdirSync(join(dir, `pr-${pr}`), { recursive: true });
    for (const f of files) cpSync(join(OUT, f), join(dir, `pr-${pr}`, f));
    git(['add', '-A', `pr-${pr}`], dir);
    if (git(['status', '--porcelain'], dir)) {
      git(['commit', '-qm', `Screenshots for PR #${pr}`], dir);
      git(['push', '-q', 'origin', `HEAD:${BRANCH}`], dir);
    }
  } finally {
    git(['worktree', 'remove', '--force', dir]);
  }
  return (f) => `https://github.com/${repo}/blob/${BRANCH}/pr-${pr}/${f}?raw=true`;
}

const opts = parseArgs(process.argv.slice(2));
// Chrome would otherwise happily screenshot its own "can't reach this page" error.
try {
  await fetch(opts.base);
} catch {
  throw new Error(`${opts.base} is not reachable; start it with \`npm run dev\` first`);
}
const chrome = findChrome();
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT);

const rows = [];
for (const path of opts.paths) {
  const shots = Object.keys(WIDTHS).map((size) => {
    const f = fileName(path, size);
    capture(chrome, opts.base + path, { width: WIDTHS[size], height: opts.height, file: join(OUT, f) });
    return f;
  });
  rows.push({ path, shots });
}
console.log(`Saved ${rows.length * 2} screenshots in ${OUT}`);

if (opts.pr !== null) {
  const url = publish(opts.pr, rows.flatMap((r) => r.shots));
  console.log('\n| Page | Desktop | Mobile |\n|---|---|---|');
  for (const { path, shots } of rows) {
    console.log(`| \`${path}\` | <img src="${url(shots[0])}" width="320"> | <img src="${url(shots[1])}" width="200"> |`);
  }
}
