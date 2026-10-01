// Minimal Chrome DevTools Protocol client built on Node's global WebSocket and fetch.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CHROME_PATHS = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(port, pathname, method = 'GET') {
  const res = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, signal: AbortSignal.timeout(2000) });
  if (!res.ok) throw new Error(`CDP ${method} ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

async function isDebuggerUp(port) {
  try {
    await getJson(port, '/json/version');
    return true;
  } catch {
    return false;
  }
}

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const found = (DEFAULT_CHROME_PATHS[process.platform] || []).find((p) => fs.existsSync(p));
  if (!found) throw new Error('Chrome not found; set CHROME_PATH');
  return found;
}

/** Start Chrome with --remote-debugging-port unless something is already listening there. */
async function ensureChrome(port) {
  if (await isDebuggerUp(port)) return null;

  // Chrome refuses remote debugging on the default profile, so use a dedicated one.
  const userDataDir = process.env.CHROME_USER_DATA_DIR || path.join(os.tmpdir(), 'jev-dino-chrome');
  const chrome = spawn(
    findChrome(),
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=900,500',
      'about:blank',
    ],
    { stdio: 'ignore', detached: false },
  );

  for (let i = 0; i < 50; i++) {
    if (await isDebuggerUp(port)) return chrome;
    await sleep(200);
  }
  chrome.kill();
  throw new Error(`Chrome did not open a debugging port on ${port}`);
}

class CDPSession {
  #ws;
  #nextId = 0;
  #pending = new Map();
  onClose = null;

  static async connect(webSocketUrl) {
    const session = new CDPSession();
    session.#ws = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      session.#ws.addEventListener('open', resolve, { once: true });
      session.#ws.addEventListener('error', () => reject(new Error(`Cannot connect to ${webSocketUrl}`)), { once: true });
    });
    session.#ws.addEventListener('message', (event) => session.#onMessage(event));
    session.#ws.addEventListener('close', () => {
      for (const { reject } of session.#pending.values()) reject(new Error('CDP connection closed'));
      session.#pending.clear();
      session.onClose?.();
    });
    return session;
  }

  #onMessage(event) {
    const msg = JSON.parse(event.data);
    const pending = this.#pending.get(msg.id);
    if (!pending) return;
    this.#pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(`${pending.method}: ${msg.error.message}`));
    else pending.resolve(msg.result);
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject, method });
      this.#ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Runtime.evaluate returning the value by JSON; throws on page exceptions. */
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, returnByValue: true });
    if (exceptionDetails) {
      throw new Error(`Page exception: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    }
    return result.value;
  }

  close() {
    this.#ws.close();
  }
}

/** Reuse a tab already showing the dino game, otherwise open a new one. */
async function openDinoTab(port, url) {
  const targets = await getJson(port, '/json/list');
  let target = targets.find((t) => t.type === 'page' && /^(chrome:\/\/dino|chrome-error:\/\/chromewebdata)/.test(t.url));
  if (!target) target = await getJson(port, '/json/new?about:blank', 'PUT');
  await getJson(port, `/json/activate/${target.id}`).catch(() => {});

  const session = await CDPSession.connect(target.webSocketDebuggerUrl);
  // chrome://dino is ignored on the command line, but Page.navigate works.
  if (!target.url.startsWith('chrome-error://chromewebdata')) {
    await session.send('Page.navigate', { url });
  }
  // Without this the game pauses itself whenever the Chrome window loses focus.
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  return session;
}

module.exports = { ensureChrome, openDinoTab, sleep };
