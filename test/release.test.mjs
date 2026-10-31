import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repoProblems, releaseSteps, D1_NAME } from '../scripts/release.mjs';

const sha = 'a'.repeat(40);

test('release runs only from a clean main that matches origin/main', () => {
  assert.deepEqual(repoProblems({ branch: 'main', dirty: false, head: sha, remote: sha }), []);
  assert.equal(repoProblems({ branch: 'claude/x', dirty: false, head: sha, remote: sha }).length, 1);
  assert.equal(repoProblems({ branch: 'main', dirty: true, head: sha, remote: sha }).length, 1);
  assert.match(repoProblems({ branch: 'main', dirty: false, head: 'b'.repeat(40), remote: sha })[0], /not origin\/main/);
});

test('release tests first, then D1, Worker, Pages, and tags what went out', async () => {
  const steps = releaseSteps(new Date('2026-11-01T09:05:00Z'));
  assert.deepEqual(steps.map((s) => s.label), ['tests', 'D1 migrations', 'Worker', 'Pages', 'tag', 'push tag']);
  assert.ok(steps[1].args.includes('--remote') && steps[1].args.includes(D1_NAME));
  assert.deepEqual(steps[3].args.slice(-2), ['--branch', 'main']);
  assert.ok(steps[4].args.includes('deploy-20261101-0905'));
  // The npm scripts it calls exist, and the D1 name is the one in wrangler.toml.
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const s of ['feeds:deploy', 'deploy', 'release']) assert.ok(pkg.scripts[s], `npm script ${s}`);
  assert.match(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'), new RegExp(`database_name = "${D1_NAME}"`));
});
