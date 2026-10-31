// Deploys production in one go, from main exactly as it is on GitHub, so the steps cannot be done half-way, in the
// wrong order, or from a branch (maintenance review). Production then always matches a commit on main.
//
//   npm run release              # check, install, test, then D1 migrations -> Worker -> Pages, tag, health
//   npm run release -- --dry-run # the same checks, the pending D1 migrations, and the steps it would run
//
// Order matters: the D1 schema first (migrations only ever add, so old code keeps working with the new schema),
// then the Worker (it bundles lib/ on its own), then Pages. Both are deployed every time, so a change to lib/ can
// never reach one and not the other. `npm ci` first, so the wrangler that deploys is the locked one CI checked.
// Each release is tagged `deploy-<UTC date and time>` on the deployed commit and the tag is pushed: `git tag -l
// 'deploy-*'` lists what went out when. Rolling back is in README.md ("Rolling back").
// Secrets are not set here (README, "Deploying"). SITE_URL is passed through to the build when set.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { SITE_ORIGIN } from '../lib/site.js';

export const D1_NAME = 'infinito-mourinho-votes';

// Why the repository is not in a state to release from; an empty list means it is.
export function repoProblems({ branch, dirty, head, remote, tagExists = false, tag = '' }) {
  const problems = [];
  if (branch !== 'main') problems.push(`on branch ${branch}, not main`);
  if (dirty) problems.push('uncommitted changes (git status)');
  if (head !== remote) problems.push(`HEAD ${head.slice(0, 7)} is not origin/main ${remote.slice(0, 7)} (git pull, or push first)`);
  // Checked before anything goes out, so a release never ends live but untagged.
  if (tagExists) problems.push(`tag ${tag} already exists (wait a second and run again)`);
  return problems;
}

export const tagName = (now = new Date()) => `deploy-${now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-')}`;

// The commands, in order. `piped` runs without a terminal: wrangler then applies migrations without asking (checked
// with a local database), and takes a backup first.
export function releaseSteps(tag) {
  return [
    { label: 'install', cmd: 'npm', args: ['ci'] },
    { label: 'tests', cmd: 'npm', args: ['test'] },
    { label: 'D1 migrations', cmd: 'npx', args: ['wrangler', 'd1', 'migrations', 'apply', D1_NAME, '--remote'], piped: true },
    { label: 'Worker', cmd: 'npm', args: ['run', 'feeds:deploy'] },
    { label: 'Pages', cmd: 'npm', args: ['run', 'deploy', '--', '--branch', 'main'] },
    { label: 'tag', cmd: 'git', args: ['tag', '-a', tag, '-m', `Deployed ${tag}`] },
    { label: 'push tag', cmd: 'git', args: ['push', 'origin', tag] },
  ];
}

// Runs the steps in order and stops at the first failure: nothing after a failed step runs, so nothing newer goes
// out after a broken one. A dry run runs none. Returns the label of the failed step, or null.
export function runSteps(steps, { run, log = console.log, dryRun = false }) {
  for (const step of steps) {
    log(`\n== ${step.label}: ${step.cmd} ${step.args.join(' ')}`);
    if (dryRun) continue;
    try {
      run(step);
    } catch {
      return step.label;
    }
  }
  return null;
}

function exec(step) {
  try {
    const out = execFileSync(step.cmd, step.args, { stdio: step.piped ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
    if (step.piped) console.log(out.trim().split('\n').slice(-6).join('\n'));
  } catch (err) {
    if (step.piped) console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    throw err;
  }
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const tag = tagName();
  git('fetch', '--quiet', '--tags', 'origin', 'main');
  const problems = repoProblems({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    head: git('rev-parse', 'HEAD'),
    remote: git('rev-parse', 'origin/main'),
    tag,
    tagExists: git('tag', '-l', tag) !== '',
  });
  if (problems.length) {
    console.error(`Not released:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  if (dryRun) {
    // Read-only: what the D1 step would apply. Not logged in or offline: say so and still show the steps.
    try {
      exec({ cmd: 'npx', args: ['wrangler', 'd1', 'migrations', 'list', D1_NAME, '--remote'], piped: true });
    } catch {
      console.error('(could not list the pending D1 migrations: npx wrangler login?)');
    }
  }
  const failed = runSteps(releaseSteps(tag), { run: exec, dryRun });
  if (failed) {
    // Install and tests change nothing in production; from the D1 step on, earlier steps may be live.
    const live = !['install', 'tests'].includes(failed);
    console.error(`\nRelease stopped at "${failed}". ${live ? 'The steps before it are live; see README.md "Rolling back".' : 'Nothing was deployed.'}`);
    process.exit(1);
  }
  if (dryRun) return console.log('\n(dry run: nothing was deployed)');
  // Reports only: the cron writes on its own schedule, so a stale copy here is not this release's doing.
  try {
    exec({ cmd: process.execPath, args: ['scripts/health.mjs'] });
  } catch {
    console.error('Health check failed (see above); the release itself went out.');
  }
  console.log(`\nReleased as ${tag}. Check the pages: npm run verify -- --base ${SITE_ORIGIN}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
