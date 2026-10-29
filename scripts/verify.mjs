// Checks user flows against the running site, so "done" rests on what the page actually did rather than
// on an agent's own report. Drives the local Chrome over the DevTools Protocol (no npm dependency).
//
//   npm run dev                                         # in another terminal (http://localhost:8788)
//   npm run verify                                      # every flow in test/flows/
//   npm run verify -- test/flows/menu.json              # only these flows
//
// Each flow ends PASS, FAIL or BLOCKED. BLOCKED means a precondition is missing (no server, no Chrome,
// a page that does not exist), so the flow says nothing about the change. Console errors, uncaught
// exceptions and requests the Content-Security-Policy blocked fail a flow even when its steps pass.
// Third-party hosts that cannot be reached are listed but do not fail a flow.
// A screenshot of the last state of each flow goes to screenshots/verify/.
//
// Options: --base <origin> (default http://localhost:8788), CHROME=<path to the Chrome binary>.
// Exit code: 0 all PASS, 1 any FAIL, 2 any BLOCKED and no FAIL.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome } from './chrome.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FLOWS = join(ROOT, 'test/flows');
const OUT = join(ROOT, 'screenshots/verify');
const STEP_TIMEOUT = 5000;

class Blocked extends Error {}

function parseArgs(argv) {
  const opts = { base: 'http://localhost:8788', files: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--base') opts.base = argv[++i].replace(/\/$/, '');
    else opts.files.push(argv[i]);
  }
  if (!opts.files.length) {
    opts.files = readdirSync(FLOWS).filter((f) => f.endsWith('.json')).sort().map((f) => join(FLOWS, f));
  }
  return opts;
}

// Starts Chrome with a throwaway profile and returns its DevTools port.
async function launch(chrome) {
  const profile = mkdtempSync(join(tmpdir(), 'verify-profile-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0',
    // Cloud sessions run as root, where Chrome refuses to start with its sandbox.
    ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'], detached: true }); // its own process group, so close() ends the helpers too
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Blocked('Chrome did not start within 15 s')), 15_000);
    let err = '';
    proc.stderr.on('data', (d) => {
      err += d;
      const m = err.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    proc.on('exit', () => { clearTimeout(timer); reject(new Blocked(`Chrome exited: ${err.slice(-300)}`)); });
  });
  // Chrome and its helper processes keep writing to the profile until they exit, so remove it only afterwards.
  const close = async () => {
    const exited = new Promise((r) => proc.once('exit', r));
    try { process.kill(-proc.pid); } catch { proc.kill(); }
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { port, close };
}

// A minimal DevTools Protocol client for one page target.
async function connect(port) {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = ({ data }) => {
    const msg = JSON.parse(data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) {
      for (const fn of listeners) fn(msg.method, msg.params);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    pending.set(++id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return { send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

// Runs `expr` in the page until it returns a truthy value or the step times out.
async function waitFor(cdp, expr, what) {
  const until = Date.now() + STEP_TIMEOUT;
  for (;;) {
    const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (!exceptionDetails && result.value) return result.value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

const q = (s) => JSON.stringify(s);
const read = (sel, prop) => `document.querySelector(${q(sel)})?.${prop}`;

// Each step is an object with one action key. Values that steps record with `save` can be compared later.
async function runStep(cdp, step, base, saved) {
  if (step.goto) {
    const url = base + step.goto;
    const res = await fetch(url, { redirect: 'manual' }).catch(() => null);
    if (!res) throw new Blocked(`server not reachable at ${base} (run \`npm run dev\`)`);
    if (res.status >= 400) throw new Blocked(`${step.goto} returned ${res.status}`);
    await cdp.send('Page.navigate', { url });
    await waitFor(cdp, `document.readyState === 'complete'`, 'the page to load');
    return `opened ${step.goto}`;
  }
  if (step.click) {
    await waitFor(cdp, `!!document.querySelector(${q(step.click)})`, `${step.click} to exist`);
    // A real mouse click at the element's centre, so handlers that check e.button or modifiers see a normal click.
    const box = await waitFor(cdp, `(() => { const e = document.querySelector(${q(step.click)}); e.scrollIntoView({ block: 'center', behavior: 'instant' }); // instant: the site scrolls smoothly, which would move the target after we measure it
      const r = e.getBoundingClientRect(); return r.width && r.height && { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    `${step.click} to be visible`);
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
    }
    return `clicked ${step.click}`;
  }
  if (step.visible) {
    await waitFor(cdp, `(() => { const e = document.querySelector(${q(step.visible)}); return !!e && e.checkVisibility(); })()`,
      `${step.visible} to be visible`);
    return `${step.visible} is visible`;
  }
  if (step.hidden) {
    await waitFor(cdp, `(() => { const e = document.querySelector(${q(step.hidden)}); return !e || !e.checkVisibility(); })()`,
      `${step.hidden} to be hidden`);
    return `${step.hidden} is hidden`;
  }
  if (step.text) {
    const { selector, includes } = step.text;
    const got = await waitFor(cdp, `(${read(selector, 'textContent')} ?? '').includes(${q(includes)}) && ${read(selector, 'textContent')}`,
      `${selector} to contain ${q(includes)}`).catch(async (e) => {
      const { result } = await cdp.send('Runtime.evaluate', { expression: read(selector, 'textContent'), returnByValue: true });
      throw new Error(`${e.message}; it reads ${q((result.value ?? '(missing)').trim().slice(0, 120))}`);
    });
    return `${selector} reads ${q(got.trim().slice(0, 80))}`;
  }
  if (step.attr) {
    const { selector, name, equals, save, changedFrom } = step.attr;
    const expr = read(selector, `getAttribute(${q(name)})`);
    const check = equals !== undefined ? `v === ${q(equals)}` : changedFrom ? `v !== ${q(saved[changedFrom])}` : 'v !== null';
    const value = await waitFor(cdp, `(() => { const v = ${expr}; return ${check} ? { v } : false; })()`,
      `${selector}[${name}] ${equals !== undefined ? `to be ${q(equals)}` : changedFrom ? `to change from ${q(saved[changedFrom])}` : 'to exist'}`);
    if (save) saved[save] = value.v;
    return `${selector}[${name}] = ${q(value.v)}`;
  }
  if (step.eval) {
    // For checks the other steps cannot express. The expression must return true.
    const value = await waitFor(cdp, step.eval, `\`${step.eval}\` to be true`);
    return `\`${step.eval}\` ${value === true ? 'is true' : `returned ${q(value)}`}`;
  }
  throw new Error(`unknown step ${q(step)}`);
}

async function runFlow(port, file, base) {
  const flow = JSON.parse(readFileSync(file, 'utf8'));
  const name = basename(file, '.json');
  const report = { name, description: flow.description, verdict: 'PASS', steps: [], problems: [], notes: [] };
  const cdp = await connect(port);
  const origin = new URL(base).origin;
  const urls = new Map();
  try {
    cdp.on((method, p) => {
      if (method === 'Runtime.exceptionThrown') report.problems.push(`uncaught: ${p.exceptionDetails.exception?.description ?? p.exceptionDetails.text}`);
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') report.problems.push(`console.error: ${p.args.map((a) => a.value ?? a.description).join(' ')}`);
      if (method === 'Network.requestWillBeSent') urls.set(p.requestId, p.request.url);
      if (method === 'Network.loadingFailed') {
        const url = urls.get(p.requestId) ?? p.requestId;
        // A third-party host that cannot be reached (offline, a sandboxed network) says nothing about the site,
        // so it is only noted. Anything the browser blocked on purpose (CSP, mixed content) is the site's fault.
        if (p.blockedReason) report.problems.push(`blocked (${p.blockedReason}): ${url}`);
        else if (!url.startsWith(origin)) report.notes.push(`unreachable: ${url} (${p.errorText})`);
        else if (p.errorText !== 'net::ERR_ABORTED') report.problems.push(`failed: ${url} (${p.errorText})`);
      }
      // Network failures are handled above; CSP violations and other errors the browser logs come through here.
      if (method === 'Log.entryAdded' && p.entry.level === 'error' && p.entry.source !== 'network') {
        report.problems.push(`${p.entry.source}: ${p.entry.text}${p.entry.url ? ` (${p.entry.url})` : ''}`);
      }
    });
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map((m) => cdp.send(m)));
    const { width = 1280, height = 900 } = flow.viewport ?? {};
    const { languages } = flow;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    if (languages) {
      await cdp.send('Network.setUserAgentOverride', { userAgent: (await cdp.send('Browser.getVersion')).userAgent, acceptLanguage: languages.join(','), platform: '' });
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `Object.defineProperty(navigator, 'languages', { get: () => ${q(languages)} });
                 Object.defineProperty(navigator, 'language', { get: () => ${q(languages[0])} });`,
      });
    }
    const saved = {};
    for (const step of flow.steps) {
      try {
        report.steps.push({ ok: true, note: await runStep(cdp, step, base, saved) });
      } catch (e) {
        report.steps.push({ ok: false, note: e.message });
        report.verdict = e instanceof Blocked ? 'BLOCKED' : 'FAIL';
        break;
      }
    }
    // Late errors (a fetch that fails after the last step) still count.
    await new Promise((r) => setTimeout(r, 300));
    report.problems = [...new Set(report.problems)];
    if (report.verdict === 'PASS' && report.problems.length) report.verdict = 'FAIL';
    if (report.verdict !== 'BLOCKED') {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      mkdirSync(OUT, { recursive: true });
      report.screenshot = join('screenshots/verify', `${name}.png`);
      writeFileSync(join(ROOT, report.screenshot), Buffer.from(data, 'base64'));
    }
  } finally {
    cdp.close();
  }
  return report;
}

function print(reports) {
  for (const r of reports) {
    console.log(`\n${r.verdict.padEnd(7)} ${r.name} — ${r.description ?? ''}`);
    for (const s of r.steps) console.log(`  ${s.ok ? '✓' : '✗'} ${s.note}`);
    for (const p of r.problems) console.log(`  ! ${p}`);
    for (const n of r.notes) console.log(`  - ${n}`);
    if (r.screenshot) console.log(`  screenshot: ${r.screenshot}`);
  }
  const count = (v) => reports.filter((r) => r.verdict === v).length;
  console.log(`\n${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('BLOCKED')} BLOCKED`);
}

const opts = parseArgs(process.argv.slice(2));
let chrome;
try {
  chrome = await launch(findChrome());
} catch (e) {
  console.log(`BLOCKED (all flows): ${e.message}`);
  process.exit(2);
}
const reports = [];
try {
  for (const file of opts.files) reports.push(await runFlow(chrome.port, file, opts.base));
} finally {
  await chrome.close();
}
print(reports);
process.exit(reports.some((r) => r.verdict === 'FAIL') ? 1 : reports.some((r) => r.verdict === 'BLOCKED') ? 2 : 0);
