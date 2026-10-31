// Deploys production in one go, from main exactly as it is on GitHub, so the steps cannot be done half-way, in the
// wrong order, or from a branch (maintenance review). Production then always matches a commit on main.
//
//   npm run release              # check, test, then D1 migrations -> Worker -> Pages, tag, health check
//   npm run release -- --dry-run # only print what it would run
//
// Order matters: the D1 schema first (migrations only ever add, so old code keeps working with the new schema),
// then the Worker (it bundles lib/ on its own), then Pages. Both are deployed every time, so a change to lib/ can
// never reach one and not the other.
// Each release is tagged `deploy-<UTC date and time>` on the deployed commit and the tag is pushed: `git tag -l
// 'deploy-*'` lists what went out when. Rolling back is in README.md ("Rolling back").
// Secrets are not set here (README, "Deploying"). SITE_URL is passed through to the build when set.
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export const D1_NAME = 'infinito-mourinho-votes';

// Why the repository is not in a state to release from; an empty list means it is.
export function repoProblems({ branch, dirty, head, remote }) {
  const problems = [];
  if (branch !== 'main') problems.push(`on branch ${branch}, not main`);
  if (dirty) problems.push('uncommitted changes (git status)');
  if (head !== remote) problems.push(`HEAD ${head.slice(0, 7)} is not origin/main ${remote.slice(0, 7)} (git pull, or push first)`);
  return problems;
}

// The commands, in order.
export function releaseSteps(now = new Date()) {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');
  return [
    { label: 'tests', cmd: 'npm', args: ['test'] },
    // Not interactive (piped), so wrangler applies pending migrations without asking, and takes a backup first.
    { label: 'D1 migrations', cmd: 'npx', args: ['wrangler', 'd1', 'migrations', 'apply', D1_NAME, '--remote'], piped: true },
    { label: 'Worker', cmd: 'npm', args: ['run', 'feeds:deploy'] },
    { label: 'Pages', cmd: 'npm', args: ['run', 'deploy', '--', '--branch', 'main'] },
    { label: 'tag', cmd: 'git', args: ['tag', '-a', `deploy-${stamp}`, '-m', `Deployed ${now.toISOString()}`] },
    { label: 'push tag', cmd: 'git', args: ['push', 'origin', `deploy-${stamp}`] },
  ];
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

function main() {
  const dryRun = process.argv.includes('--dry-run');
  git('fetch', '--quiet', 'origin', 'main');
  const problems = repoProblems({
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    dirty: git('status', '--porcelain') !== '',
    head: git('rev-parse', 'HEAD'),
    remote: git('rev-parse', 'origin/main'),
  });
  if (problems.length) {
    console.error(`Not released:\n${problems.map((p) => `- ${p}`).join('\n')}`);
    process.exit(1);
  }
  for (const step of releaseSteps()) {
    console.log(`\n== ${step.label}: ${step.cmd} ${step.args.join(' ')}`);
    if (dryRun) continue;
    try {
      const out = execFileSync(step.cmd, step.args, { stdio: step.piped ? ['ignore', 'pipe', 'pipe'] : 'inherit', encoding: 'utf8' });
      if (step.piped) console.log(out.trim().split('\n').slice(-3).join('\n'));
    } catch (err) {
      if (step.piped) console.error(`${err.stdout ?? ''}${err.stderr ?? ''}`);
      // Stops at the first failure: later steps are not run, so nothing newer goes out after a broken one.
      console.error(`\nRelease stopped at "${step.label}". Steps before it are live; see README.md "Rolling back".`);
      process.exit(1);
    }
  }
  if (dryRun) return console.log('\n(dry run: nothing was run)');
  console.log('\nReleased. Check it: npm run health, and npm run verify -- --base https://infinito-mourinho.pages.dev');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
