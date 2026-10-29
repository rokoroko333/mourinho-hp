// Headless Chrome for local tooling (PR screenshots, share images). Not used by the build, so CI and
// Cloudflare never need a browser.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/opt/pw-browsers/chromium', // Claude Code cloud sessions
].filter(Boolean);

export function findChrome() {
  const chrome = CANDIDATES.find((c) => existsSync(c));
  if (!chrome) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  return chrome;
}

// Screenshots `url` at width × height into `file` (PNG).
export function capture(chrome, url, { width, height, file, waitMs = 8000 }) {
  // A throwaway profile, so the run neither waits on nor touches a Chrome the user has open.
  const profile = mkdtempSync(join(tmpdir(), 'shots-profile-'));
  try {
    // The virtual time budget lets scripts (app.js filling the news and match cards) finish first.
    execFileSync(chrome, [
      '--headless=new', '--hide-scrollbars', '--disable-gpu', `--virtual-time-budget=${waitMs}`, `--user-data-dir=${profile}`,
      '--no-first-run', '--no-default-browser-check', '--force-device-scale-factor=1',
      `--window-size=${width},${height}`, `--screenshot=${file}`, url,
    ], { stdio: 'ignore', timeout: 60_000 }); // headless Chrome occasionally hangs; fail instead of waiting
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
