import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { repoProblems, releaseSteps, runSteps, tagName, D1_NAME } from '../scripts/release.mjs';

const sha = 'a'.repeat(40);
const clean = { branch: 'main', dirty: false, head: sha, remote: sha };

test('release runs only from a clean main that matches origin/main, with a new tag name', () => {
  assert.deepEqual(repoProblems(clean), []);
  assert.equal(repoProblems({ ...clean, branch: 'claude/x' }).length, 1);
  assert.equal(repoProblems({ ...clean, dirty: true }).length, 1);
  assert.match(repoProblems({ ...clean, head: 'b'.repeat(40) })[0], /not origin\/main/);
  assert.match(repoProblems({ ...clean, tag: 'deploy-x', tagExists: true })[0], /already exists/);
});

test('release installs and tests first, then D1, Worker, Pages, and tags what went out', async () => {
  const tag = tagName(new Date('2026-11-01T09:05:07Z'));
  assert.equal(tag, 'deploy-20261101-090507');
  const steps = releaseSteps(tag);
  assert.deepEqual(steps.map((s) => s.label), ['install', 'tests', 'D1 migrations', 'Worker', 'Pages', 'tag', 'push tag']);
  assert.deepEqual(steps[0].args, ['ci']);
  assert.ok(steps[2].piped && steps[2].args.includes('--remote') && steps[2].args.includes(D1_NAME));
  assert.deepEqual(steps[4].args.slice(-2), ['--branch', 'main']);
  assert.ok(steps[5].args.includes(tag) && steps[6].args.includes(tag));
  // The npm scripts it calls exist, and the D1 name is the one in wrangler.toml.
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  for (const s of ['feeds:deploy', 'deploy', 'release']) assert.ok(pkg.scripts[s], `npm script ${s}`);
  assert.match(await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8'), new RegExp(`database_name = "${D1_NAME}"`));
});

test('release stops at the first failed step and runs nothing after it; a dry run runs nothing', () => {
  const steps = releaseSteps('deploy-x');
  const ran = [];
  const failed = runSteps(steps, {
    log: () => {},
    run: (s) => {
      ran.push(s.label);
      if (s.label === 'Worker') throw new Error('down');
    },
  });
  assert.equal(failed, 'Worker');
  assert.deepEqual(ran, ['install', 'tests', 'D1 migrations', 'Worker'], 'Pages and the tag never ran');
  assert.equal(runSteps(steps, { log: () => {}, run: () => {} }), null);
  const dry = [];
  assert.equal(runSteps(steps, { log: () => {}, dryRun: true, run: (s) => dry.push(s) }), null);
  assert.equal(dry.length, 0);
});
