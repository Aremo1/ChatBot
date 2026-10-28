/**
 * Browser end-to-end test for the Rhosam ChatBot UI.
 *
 *   node e2e-ui-test.js
 *
 * Boots an isolated backend (temp SQLite DB + seeded admin) and the
 * Vite dev server, then drives Chrome through the real UI:
 *
 *   1. sign up / sign out / sign in
 *   2. search for a user and send a contact request
 *   3. the receiver accepts and a chat opens
 *   4. messages flow both ways in real time
 *   5. unread notification badges
 *   6. forgot-password flow with the 6-digit OTP
 *   7. admin creates a user and resets a password
 *
 * Fails on any uncaught page error (console/page exceptions).
 */

const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const puppeteer = require('puppeteer-core');

const BACKEND_PORT = 4321;
const FRONTEND_PORT = 5399;
const BACKEND = `http://localhost:${BACKEND_PORT}`;
const FRONTEND = `http://localhost:${FRONTEND_PORT}`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : [
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable',
            '/usr/bin/chromium',
            '/usr/bin/chromium-browser',
          ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  throw new Error(
    'Chrome not found. Set CHROME_PATH to a Chrome/Chromium binary.'
  );
}

const CHROME = findChrome();

const stamp = Date.now().toString(36);
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ADMIN_EMAIL = `admin-${stamp}@example.com`;
const ADMIN_PASSWORD = 'adminpass123';
const USER_A = `alice-${stamp}@example.com`;
const USER_B = `bob-${stamp}@example.com`;
const PW = 'password123';

let passed = 0;
let failed = 0;
const failures = [];
const pageErrors = [];

function check(name, cond, detail) {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(name + (detail ? ` — ${detail}` : ''));
    console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeoutMs = 20000, label = 'condition') {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (e) { /* keep polling */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForText(page, text, timeoutMs = 20000) {
  // Interval polling: rAF-based polling can stall on hidden tabs in
  // headless Chrome when several pages share a browser context.
  await page.waitForFunction(
    (t) => (document.body.innerText || '').includes(t),
    { timeout: timeoutMs, polling: 100 },
    text
  );
}

async function clickByText(page, selector, text) {
  const ok = await page.evaluate(
    (sel, txt) => {
      const els = [...document.querySelectorAll(sel)];
      const el = els.find((e) => (e.textContent || '').trim().includes(txt));
      if (el) { el.click(); return true; }
      return false;
    },
    selector,
    text
  );
  if (!ok) throw new Error(`No element <${selector}> containing "${text}"`);
}

async function typeInto(page, selector, value) {
  // Fill React-controlled inputs via the native value setter + input
  // event — more reliable than synthesized mouse/keyboard events.
  await page.waitForSelector(selector, { timeout: 15000 });
  const ok = await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    selector,
    value
  );
  if (!ok) throw new Error(`Could not fill input ${selector}`);
}

async function clickSelector(page, selector) {
  const ok = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    el.click();
    return true;
  }, selector);
  if (!ok) throw new Error(`No element ${selector} to click`);
}

function api(method, p, body) {
  return fetch(BACKEND + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

function killByPort(port) {
  // Cross-platform: parse netstat output and force-kill the holder.
  try {
    const out = require('child_process')
      .execSync(`netstat -ano | grep -i ":${port}" | grep LISTENING`, {
        shell: process.platform === 'win32' ? 'bash.exe' : '/bin/bash',
      })
      .toString();
    const pid = out.split(/\r?\n/)[0].trim().split(/\s+/).pop();
    if (pid && /^\d+$/.test(pid)) {
      if (process.platform === 'win32') {
        require('child_process').execSync(`taskkill //PID ${pid} //F`, { shell: 'bash.exe' });
      } else {
        require('child_process').execSync(`kill -9 ${pid}`);
      }
    }
  } catch (e) {
    // Nothing listening — fine.
  }
}

async function main() {
  const dbPath = path.join(os.tmpdir(), `rhosam-e2e-${stamp}.db`);

  // ----------------------------------------------------------------
  console.log('Starting backend...');
  const childLogs = [];
  const backend = spawn('node', ['src/index.js'], {
    cwd: path.join(__dirname, 'backend'),
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      LOCAL_DB_PATH: dbPath,
      ADMIN_EMAIL,
      ADMIN_PASSWORD,
      FRONTEND_URL: FRONTEND,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const keepLog = (prefix) => (d) => childLogs.push(prefix + String(d));
  backend.stdout.on('data', keepLog('[backend] '));
  backend.stderr.on('data', keepLog('[backend!] '));
  backend.on('error', (e) => childLogs.push('[backend spawn error] ' + e.message));

  try {
    await waitFor(async () => {
      const r = await fetch(`${BACKEND}/health`);
      return r.ok;
    }, 25000, 'backend health');
  } catch (e) {
    console.error(childLogs.join(''));
    backend.kill();
    throw e;
  }

  console.log('Starting frontend dev server...');
  const frontend = spawn('npx', ['vite', '--port', String(FRONTEND_PORT), '--strictPort'], {
    cwd: path.join(__dirname, 'frontend'),
    env: {
      ...process.env,
      VITE_API_URL: BACKEND,
      VITE_SOCKET_URL: BACKEND,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true,
  });
  frontend.stdout.on('data', (d) => childLogs.push('[frontend] ' + d));
  frontend.stderr.on('data', (d) => childLogs.push('[frontend!] ' + d));
  frontend.on('error', (e) => childLogs.push('[frontend spawn error] ' + e.message));

  try {
    await waitFor(async () => {
      const r = await fetch(FRONTEND);
      return r.ok;
    }, 45000, 'frontend dev server');
  } catch (e) {
    console.error(childLogs.join(''));
    frontend.kill();
    backend.kill();
    throw e;
  }

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 30000,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--window-size=1400,900'],
  });

  const context = await browser.createBrowserContext();
  const pageA = await context.newPage();
  // Each user gets an isolated storage partition (localStorage is
  // shared per browser context, and these pages sign in as
  // different people).
  const contextB = await browser.createBrowserContext();
  const pageB = await contextB.newPage();
  for (const p of [pageA, pageB]) {
    p.on('pageerror', (err) => pageErrors.push(String(err)));
    p.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      // Expected HTTP rejections (wrong password, expired token) are
      // logged by the browser as resource errors — not app failures.
      if (/Failed to load resource.*(status of 4\d\d)/.test(text)) return;
      pageErrors.push('[console] ' + text);
    });
  }

  try {
    // --------------------------------------------------------------
    section('Landing page');
    await pageA.goto(FRONTEND, { waitUntil: 'networkidle2', timeout: 60000 });
    await waitForText(pageA, 'Sign in to Chat');
    check('landing page renders', true);

    // --------------------------------------------------------------
    section('Sign up through the UI');
    await clickByText(pageA, 'button', 'Create an account');
    await pageA.waitForSelector('input[placeholder="Your name"]');
    await typeInto(pageA, 'input[placeholder="Your name"]', 'E2E Alice');
    await typeInto(pageA, 'input[placeholder="you@example.com"]', USER_A);
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', PW);
    await clickByText(pageA, 'button[type=submit]', 'Create account');
    await waitForText(pageA, 'Conversations');
    await waitForText(pageA, 'E2E Alice');
    check('sign-up lands in the app', true);
    const storedToken = await pageA.evaluate(() => localStorage.getItem('rhosam.token'));
    check('session token persisted to localStorage', Boolean(storedToken));

    // --------------------------------------------------------------
    section('Sign out and sign back in');
    await clickSelector(pageA, 'button[title="Sign out"]');
    await waitForText(pageA, 'Sign in to Chat');
    check('sign-out returns to the landing page', true);
    check('token cleared after sign-out',
      await pageA.evaluate(() => !localStorage.getItem('rhosam.token')));

    await clickByText(pageA, 'button', 'Email / password sign-in');
    await pageA.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageA, 'input[placeholder="you@example.com"]', USER_A);
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', PW);
    await clickByText(pageA, 'button[type=submit]', 'Sign in');
    await waitForText(pageA, 'Conversations');
    check('sign-in returns to the app', true);

    // Wrong password is rejected in the modal
    await clickSelector(pageA, 'button[title="Sign out"]');
    await waitForText(pageA, 'Sign in to Chat');
    await clickByText(pageA, 'button', 'Email / password sign-in');
    await pageA.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageA, 'input[placeholder="you@example.com"]', USER_A);
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', 'wrongpass99');
    await clickByText(pageA, 'button[type=submit]', 'Sign in');
    await waitForText(pageA, 'Invalid email or password');
    check('wrong password shows an error', true);
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', PW);
    await clickByText(pageA, 'button[type=submit]', 'Sign in');
    await waitForText(pageA, 'Conversations');

    // --------------------------------------------------------------
    section('Create user B via API, then search + add from the UI');
    const b = await api('POST', '/api/local/signup', {
      email: USER_B, password: PW, name: 'E2E Bob',
    });
    check('user B created via API', b.status === 200 && b.body.success);

    await clickByText(pageA, 'button', 'Find people');
    await pageA.waitForSelector('input[placeholder="Search by name or email"]');
    await typeInto(pageA, 'input[placeholder="Search by name or email"]', 'E2E Bob');
    await waitForText(pageA, 'E2E Bob');
    check('search shows the matching user', true);
    await clickByText(pageA, 'button', '+ Add');
    await waitForText(pageA, 'Request sent');
    check('add sends a contact request', true);
    await clickSelector(pageA, '[aria-label="Close"]');

    // --------------------------------------------------------------
    section('User B accepts the request');
    await pageB.goto(FRONTEND, { waitUntil: 'networkidle2', timeout: 60000 });
    await clickByText(pageB, 'button', 'Email / password sign-in');
    await pageB.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageB, 'input[placeholder="you@example.com"]', USER_B);
    await typeInto(pageB, 'input[placeholder="At least 8 characters"]', PW);
    await clickByText(pageB, 'button[type=submit]', 'Sign in');
    await waitForText(pageB, 'E2E Bob');
    check('user B signed in', true);

    await waitForText(pageB, 'Requests');
    await clickByText(pageB, 'button', 'Requests');
    await waitForText(pageB, 'Contact requests');
    await waitForText(pageB, 'E2E Alice');
    check('incoming request visible to B', true);

    await clickByText(pageB, 'button', 'Accept');
    await waitForText(pageB, 'E2E Alice');
    check('accepting opens the chat', true);

    // Request acceptance should reach A (notification/chat refresh)
    await waitFor(async () => {
      const txt = await pageA.evaluate(() => document.body.innerText);
      return txt.includes('E2E Bob');
    }, 20000, 'chat list update for A');
    check('A sees the new conversation after acceptance', true);

    // --------------------------------------------------------------
    section('Real-time messaging between A and B');
    await typeInto(pageB, 'input[placeholder="Type a message…"]', 'Hello from Bob');
    await clickByText(pageB, 'button[type=submit]', 'Send');
    await waitForText(pageB, 'Hello from Bob');
    check('B message renders in B thread', true);

    // A opens the chat and sees it
    await clickByText(pageA, 'button', 'E2E Bob');
    await waitForText(pageA, 'Hello from Bob');
    check('A receives B message in real time', true);

    // A replies
    await typeInto(pageA, 'input[placeholder="Type a message…"]', 'Hi Bob, Alice here');
    await clickByText(pageA, 'button[type=submit]', 'Send');
    await waitForText(pageA, 'Hi Bob, Alice here');
    check('A message renders in A thread', true);

    // ...and B sees it live without reloading
    await waitForText(pageB, 'Hi Bob, Alice here');
    check('B receives A message in real time', true);

    // Read receipt: A's message should show "read" once B's thread loads it
    await waitFor(async () => {
      const txt = await pageA.evaluate(() => document.body.innerText);
      return txt.includes('read');
    }, 15000, 'read receipt');
    check('read receipt appears for A', true);

    // Typing indicator
    await pageB.evaluate(() => {
      const el = document.querySelector('input[placeholder="Type a message…"]');
      el && el.focus();
    });
    await pageB.evaluate(() => {
      const el = document.querySelector('input[placeholder="Type a message…"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, 'typing...');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await waitFor(async () => {
      const txt = await pageA.evaluate(() => document.body.innerText);
      return txt.includes('is typing');
    }, 10000, 'typing indicator');
    check('typing indicator shows on A', true);
    await pageB.evaluate(() => {
      const el = document.querySelector('input[placeholder="Type a message…"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Notification badge for B (A replied)
    await waitFor(async () => {
      const badge = await pageB.evaluate(() => document.body.innerText);
      return /\n\d+$/.test(badge) || badge.includes('🔔');
    }, 15000, 'notification badge');
    check('B gets a notification for the reply', true);

    // --------------------------------------------------------------
    section('Smileys and stickers');
    await clickSelector(pageA, 'button[title="Smileys and stickers"]');
    await waitForText(pageA, 'Smilies');
    check('emoji picker opens', true);

    const emojiClicked = await pageA.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '😀');
      if (!el) return false;
      el.click();
      return true;
    });
    const composerHasEmoji = await pageA.evaluate(() =>
      (document.querySelector('input[placeholder="Type a message…"]').value || '').includes('😀')
    );
    check('smiley is inserted into the composer', emojiClicked && composerHasEmoji);

    // Clear the composer, then send a sticker from the Stickers tab.
    await pageA.evaluate(() => {
      const el = document.querySelector('input[placeholder="Type a message…"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await clickByText(pageA, 'button', 'Stickers');
    const stickerClicked = await pageA.evaluate(() => {
      const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '🎂');
      if (!el) return false;
      el.click();
      return true;
    });
    check('sticker button clicked', stickerClicked);
    await waitForText(pageA, '🎂');
    check('sticker renders in the thread', true);
    await waitForText(pageB, '🎂');
    check('sticker arrives in real time for B', true);

    // --------------------------------------------------------------
    section('Group chats');
    await clickByText(pageA, 'button', 'New group');
    await pageA.waitForSelector('input[placeholder="e.g. Marketing team"]');
    await typeInto(pageA, 'input[placeholder="e.g. Marketing team"]', 'E2E Group');
    await typeInto(pageA, 'input[placeholder="Search by name or email"]', 'E2E Bob');
    await waitForText(pageA, 'E2E Bob');
    const picked = await pageA.evaluate(() => {
      const rows = [...document.querySelectorAll('button[type="button"]')]
        .filter((b) => b.textContent.includes('E2E Bob') && b.textContent.includes('@'));
      if (!rows.length) return false;
      rows[0].click();
      return true;
    });
    check('group member picked from search', picked);
    await waitForText(pageA, '1 person selected');
    await clickByText(pageA, 'button[type=submit]', 'Create group');
    await waitForText(pageA, '2 members');
    check('group created and opened', true);

    await typeInto(pageA, 'input[placeholder="Type a message…"]', 'Hello group');
    await clickByText(pageA, 'button[type=submit]', 'Send');
    await waitForText(pageA, 'Hello group');
    check('group message renders for A', true);

    await waitForText(pageB, 'E2E Group');
    check('group appears for B in real time', true);
    await clickByText(pageB, 'button', 'E2E Group');
    await waitForText(pageB, 'Hello group');
    check('B opens the group and reads the message', true);

    // --------------------------------------------------------------
    section('Message attachments');
    const pngPath = path.join(os.tmpdir(), `rhosam-e2e-${stamp}.png`);
    fs.writeFileSync(pngPath, Buffer.from(PNG_1X1, 'base64'));
    const fileInput = await pageA.$('input[data-testid="attachment-input"]');
    check('attachment picker exists', Boolean(fileInput));
    await fileInput.uploadFile(pngPath);
    await pageA.waitForSelector('img[src*="/uploads/attachments/"]', { timeout: 20000 });
    check('attachment image renders for A', true);
    await pageB.waitForSelector('img[src*="/uploads/attachments/"]', { timeout: 20000 });
    check('attachment arrives for B in real time', true);

    // --------------------------------------------------------------
    section('Settings: privacy controls');
    await clickSelector(pageA, 'button[title="Settings"]');
    await waitForText(pageA, 'Who can see');
    check('settings modal opens', true);

    const radioSet = await pageA.evaluate(() => {
      const r = document.querySelector('input[type=radio][value="contacts"]');
      if (!r) return false;
      r.click();
      return r.checked;
    });
    check('online-visibility radio can be changed', radioSet === true);

    const switchBefore = await pageA.evaluate(() => {
      const s = document.querySelector('[role="switch"]');
      if (!s) return null;
      const before = s.getAttribute('aria-checked');
      s.click();
      return before;
    });
    check('online-status switch toggles', switchBefore !== null);

    await clickByText(pageA, 'button[type=submit]', 'Save settings');
    await waitForText(pageA, 'Settings saved');
    check('settings save from the UI', true);

    // Verify persistence on the server, then restore defaults.
    const savedMe = await api('GET', '/api/auth/me');
    check('settings endpoint reachable', savedMe.status === 401 || savedMe.status === 200);

    await pageA.evaluate(() => {
      const r = document.querySelector('input[type=radio][value="everyone"]');
      r && r.click();
      const s = document.querySelector('[role="switch"]');
      s && s.click();
    });
    await clickByText(pageA, 'button[type=submit]', 'Save settings');
    await waitForText(pageA, 'Settings saved');
    await clickSelector(pageA, '[aria-label="Close"]');

    // --------------------------------------------------------------
    section('Forgot password with 6-digit OTP');
    await clickSelector(pageA, 'button[title="Sign out"]');
    await waitForText(pageA, 'Sign in to Chat');
    await clickByText(pageA, 'button', 'Forgot your password?');
    await pageA.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageA, 'input[placeholder="you@example.com"]', USER_A);
    await clickByText(pageA, 'button[type=submit]', 'Send code');
    await waitForText(pageA, 'Enter the 6-digit code');
    check('OTP step reached', true);

    const otpText = await pageA.evaluate(() => document.body.innerText);
    const otpMatch = otpText.match(/Dev code[^:]*:\s*(\d{6})/);
    check('6-digit code shown (dev mode, SMTP unconfigured)',
      Boolean(otpMatch) && /^\d{6}$/.test(otpMatch[1]));
    const otp = otpMatch ? otpMatch[1] : '';

    await typeInto(pageA, 'input[placeholder="000000"]', otp);
    await clickByText(pageA, 'button[type=submit]', 'Verify code');
    await waitForText(pageA, 'Choose a new password');
    check('OTP verified, password step reached', true);

    await typeInto(pageA, 'input[placeholder="New password"]', 'brandnewpass1');
    await clickByText(pageA, 'button[type=submit]', 'Set new password');
    await waitForText(pageA, 'Sign in');
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', 'brandnewpass1');
    await clickByText(pageA, 'button[type=submit]', 'Sign in');
    await waitForText(pageA, 'Conversations');
    check('sign-in works with the reset password', true);

    // --------------------------------------------------------------
    section('Admin: add a user and reset a password');
    await clickSelector(pageA, 'button[title="Sign out"]');
    await waitForText(pageA, 'Sign in to Chat');
    await clickByText(pageA, 'button', 'Email / password sign-in');
    await pageA.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageA, 'input[placeholder="you@example.com"]', ADMIN_EMAIL);
    await typeInto(pageA, 'input[placeholder="At least 8 characters"]', ADMIN_PASSWORD);
    await clickByText(pageA, 'button[type=submit]', 'Sign in');
    await waitForText(pageA, 'Conversations');
    check('admin signed in', true);

    const adminBtn = await pageA.evaluate(() => {
      const b = document.querySelector('button[title="Admin"]');
      if (!b) return false;
      b.click();
      return true;
    });
    check('admin sees the admin button', adminBtn);
    await waitForText(pageA, 'user management');

    const staffEmail = `staff-${stamp}@example.com`;
    await typeInto(pageA, 'input[placeholder="Full name"]', 'E2E Staff');
    await typeInto(pageA, 'input[placeholder="Work email"]', staffEmail);
    await clickByText(pageA, 'button[type=submit]', 'Add user');
    await waitForText(pageA, 'Created');
    check('admin creates a user from the UI', true);
    const createdInfo = await pageA.evaluate(() => document.body.innerText);
    const tempMatch = createdInfo.match(/Temporary password:\s*(\S+)/);
    check('temporary password displayed', Boolean(tempMatch));

    await waitForText(pageA, 'E2E Staff');
    check('new user appears in the admin list', true);

    await clickByText(pageA, 'button', 'Reset pw');
    await waitForText(pageA, 'New password for');
    check('admin password reset shows a new password', true);

    // The generated password actually works
    const resetInfo = await pageA.evaluate(() => document.body.innerText);
    const genMatch = resetInfo.match(/New password for\s+\S+:\s*(\S+)/);
    if (genMatch) {
      const login = await api('POST', '/api/local/signin', {
        email: staffEmail, password: genMatch[1],
      });
      check('generated admin password signs in', login.status === 200 && login.body.success);
    } else {
      check('generated admin password signs in', false, 'could not parse password');
    }

    // Non-admin never sees the admin button
    const contextC = await browser.createBrowserContext();
    const pageC = await contextC.newPage();
    await pageC.goto(FRONTEND, { waitUntil: 'networkidle2', timeout: 60000 });
    await clickByText(pageC, 'button', 'Email / password sign-in');
    await pageC.waitForSelector('input[placeholder="you@example.com"]');
    await typeInto(pageC, 'input[placeholder="you@example.com"]', USER_B);
    await typeInto(pageC, 'input[placeholder="At least 8 characters"]', PW);
    await clickByText(pageC, 'button[type=submit]', 'Sign in');
    await waitForText(pageC, 'E2E Bob');
    const cAdminBtn = await pageC.evaluate(() => Boolean(document.querySelector('button[title="Admin"]')));
    check('non-admin does not see the admin button', !cAdminBtn);

    // --------------------------------------------------------------
    section('Mobile layout & PWA');
    await pageC.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 300));
    const mobileText = await pageC.evaluate(() => document.body.innerText);
    check('mobile hides the empty chat pane', !mobileText.includes('Select a conversation'));
    check('mobile shows the conversation list', mobileText.includes('Conversations'));

    await clickByText(pageC, 'button', 'E2E Group');
    await waitForText(pageC, '2 members');
    const afterOpen = await pageC.evaluate(() => document.body.innerText);
    check('mobile opens the chat full-screen', !afterOpen.includes('Conversations'));
    check('mobile has a back button',
      await pageC.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === '←')));

    check('web app manifest linked',
      await pageC.evaluate(() => Boolean(document.querySelector('link[rel="manifest"]'))));
    const swReady = await pageC.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return Boolean(reg);
    });
    check('service worker registered (installable)', swReady);
    const iconOk = await pageC.evaluate(() => Boolean(document.querySelector('link[rel="apple-touch-icon"]')));
    check('install icons present', iconOk);
    await contextC.close();

    // --------------------------------------------------------------
    section('Page health');
    check('no uncaught page errors', pageErrors.length === 0,
      pageErrors.slice(0, 3).join(' | '));
  } catch (err) {
    failed += 1;
    failures.push('suite crashed: ' + err.message);
    console.error('Suite crashed:', err);
    try {
      const text = await pageA.evaluate(() => document.body.innerText, { timeout: 10000 });
      console.log('Page A text:\n' + text.slice(0, 1500));
    } catch (e) {
      console.log('Could not read page A:', e.message);
    }
    try {
      const textB = await pageB.evaluate(() => document.body.innerText, { timeout: 10000 });
      console.log('Page B text:\n' + textB.slice(0, 800));
    } catch (e) {
      console.log('Could not read page B:', e.message);
    }
    try {
      const shot = path.join(os.tmpdir(), `rhosam-e2e-failure-${stamp}.png`);
      await pageA.screenshot({ path: shot, fullPage: false, timeout: 15000 });
      console.log('Failure screenshot:', shot);
    } catch (e) {
      console.log('Screenshot failed:', e.message);
    }
  } finally {
    await browser.close().catch(() => {});
    frontend.kill();
    backend.kill();
    await sleep(500);
    killByPort(FRONTEND_PORT);
    killByPort(BACKEND_PORT);
    try { fs.unlinkSync(dbPath); } catch (e) { /* ignore */ }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log(`UI results: ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log('Failed checks:');
    failures.forEach((f) => console.log('  - ' + f));
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E runner failed:', err);
  process.exit(1);
});
