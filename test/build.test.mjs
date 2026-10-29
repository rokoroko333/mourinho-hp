import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

// The Content-Security-Policy in src/public/_headers allows only same-origin scripts and styles,
// so anything inline would be blocked in production. These checks catch that before deploy.
test('built pages keep to the Content-Security-Policy', async () => {
  await promisify(execFile)(process.execPath, [join(ROOT, 'scripts/build.mjs')]);
  const files = (await readdir(DIST, { recursive: true })).filter((f) => f.endsWith('.html'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const html = await readFile(join(DIST, file), 'utf8');
    for (const [tag] of html.matchAll(/<script\b[^>]*>/g)) {
      assert.match(tag, /\bsrc="\/|type="application\/(ld\+)?json"/, `${file}: inline script ${tag}`);
    }
    assert.doesNotMatch(html, /<style\b|\sstyle="|\son[a-z]+="/i, `${file}: inline style or event handler`);
    // JSON inside <script> must not be able to close the tag.
    for (const [, body] of html.matchAll(/<script type="application\/(?:ld\+)?json"[^>]*>([\s\S]*?)<\/script>/g)) {
      assert.ok(!body.includes('<'), `${file}: unescaped < in inline JSON`);
    }
  }
});

test('_headers sets a Content-Security-Policy for every path', async () => {
  const headers = await readFile(join(ROOT, 'src/public/_headers'), 'utf8');
  const block = headers.split(/\n(?=\S)/).find((b) => b.startsWith('/*'));
  assert.match(block, /Content-Security-Policy: default-src 'self'; script-src 'self';/);
  assert.match(block, /frame-ancestors 'none'/);
});
