// Plain playwright script — no @playwright/test runner needed.
// Run: node tests/e2e/qa-vault-content.spec.js [access-token]
// Access token may also be passed via env: SG_ACCESS_TOKEN=<token>

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = 'https://qa.sgraph.ai';
const VAULT_TIMEOUT = 20_000;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const ACCESS_TOKEN = process.argv[2] || process.env.SG_ACCESS_TOKEN || '';

let passed = 0;
let failed = 0;

async function check(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message.split('\n')[0]}`);
    failed++;
  }
}

async function newAuthedPage(browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  if (ACCESS_TOKEN) {
    await ctx.addCookies([{
      name: 'x-sgraph-access-token',
      value: ACCESS_TOKEN,
      domain: 'qa.sgraph.ai',
      path: '/',
      httpOnly: false,
      secure: true,
      sameSite: 'Lax',
    }]);
  }
  return ctx.newPage();
}

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--ignore-certificate-errors'] });

  // ── /en-gb/dev/ ─────────────────────────────────────────────
  console.log('\n/en-gb/dev/');
  {
    const page = await newAuthedPage(browser);
    const vault404s = [];
    page.on('response', r => {
      if (r.url().includes('obj-cas-imm') && r.status() >= 400)
        vault404s.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${BASE}/en-gb/dev/`);

    await check('page title is "Dev — sgraph.ai"', async () => {
      const title = await page.title();
      if (title !== 'Dev — sgraph.ai') throw new Error(`Got: ${title}`);
    });

    await check('3 sg-vault-content elements present', async () => {
      const count = await page.locator('sg-vault-content').count();
      if (count !== 3) throw new Error(`Expected 3, got ${count}`);
    });

    await check('all 3 sections have visible text content', async () => {
      const sections = page.locator('sg-vault-content');
      for (let i = 0; i < 3; i++) {
        const el = sections.nth(i).locator('h1, h2, h3, p').first();
        await el.waitFor({ state: 'visible', timeout: VAULT_TIMEOUT });
      }
    });

    await check('no vault 404s', async () => {
      if (vault404s.length) throw new Error(vault404s.join(', '));
    });

    await page.close();
  }

  // ── /en-gb/library/ ─────────────────────────────────────────
  console.log('\n/en-gb/library/');
  {
    const page = await newAuthedPage(browser);
    const vault404s = [];
    page.on('response', r => {
      if (r.url().includes('obj-cas-imm') && r.status() >= 400)
        vault404s.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${BASE}/en-gb/library/`);

    await check('page title is "Library — sgraph.ai"', async () => {
      const title = await page.title();
      if (title !== 'Library — sgraph.ai') throw new Error(`Got: ${title}`);
    });

    await check('hero heading "Technology & Dependencies"', async () => {
      const h1 = page.locator('h1.display');
      await h1.waitFor({ state: 'visible', timeout: VAULT_TIMEOUT });
      const text = await h1.textContent();
      if (!text?.includes('Technology')) throw new Error(`Got: ${text}`);
    });

    await check('4 sg-vault-content elements present', async () => {
      const count = await page.locator('sg-vault-content').count();
      if (count !== 4) throw new Error(`Expected 4, got ${count}`);
    });

    await check('all 4 cards have visible text content', async () => {
      const cards = page.locator('sg-vault-content');
      for (let i = 0; i < 4; i++) {
        const el = cards.nth(i).locator('h1, h2, h3, p').first();
        await el.waitFor({ state: 'visible', timeout: VAULT_TIMEOUT });
      }
    });

    await check('no vault 404s', async () => {
      if (vault404s.length) throw new Error(vault404s.join(', '));
    });

    await page.close();
  }

  // ── /en-gb/library/ — SPA article nav (depth ≤ 3) ──────────
  console.log('\n/en-gb/library/ — SPA article (depth 3)');
  {
    const page = await newAuthedPage(browser);
    await page.goto(`${BASE}/en-gb/library/`);
    await page.waitForSelector('sg-article-viewer', { timeout: VAULT_TIMEOUT });

    // Navigate to a known depth-3 article via the nav:select event
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('nav:select', {
        detail: { slug: 'get-started/overview' }, bubbles: true
      }));
    });

    await check('depth-3 article: sg-article-viewer renders content (not blank)', async () => {
      await page.waitForFunction(() => {
        const av = document.querySelector('sg-article-viewer');
        if (!av) return false;
        const content = av.querySelector('.sg-av__content');
        return content && content.innerText.trim().length > 50;
      }, { timeout: VAULT_TIMEOUT });
    });

    await check('depth-3 article: loading reopener appears after load', async () => {
      await page.waitForSelector('.sg-av__reopener.sg-av__reopener--visible', { timeout: VAULT_TIMEOUT });
    });

    await page.close();
  }

  // ── /en-gb/library/ — SPA article nav (depth 4, issue 007) ──
  console.log('\n/en-gb/library/ — SPA article (depth 4, issue 007)');
  {
    const page = await newAuthedPage(browser);
    const vault404s = [];
    page.on('response', r => {
      if (r.url().includes('obj-cas-imm') && r.status() >= 400)
        vault404s.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`${BASE}/en-gb/library/`);
    await page.waitForSelector('sg-article-viewer', { timeout: VAULT_TIMEOUT });

    // Navigate to depth-4 journalist article
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('nav:select', {
        detail: { slug: 'sg-teams/content-team/roles/journalist' }, bubbles: true
      }));
    });

    await check('depth-4 article: sg-article-viewer renders content (not blank)', async () => {
      await page.waitForFunction(() => {
        const av = document.querySelector('sg-article-viewer');
        if (!av) return false;
        const content = av.querySelector('.sg-av__content');
        return content && content.innerText.trim().length > 50;
      }, { timeout: VAULT_TIMEOUT });
    });

    await check('depth-4 article: breadcrumb shows 4 levels', async () => {
      const crumbs = await page.locator('.breadcrumb li, .breadcrumb-item, nav[aria-label="breadcrumb"] a').count();
      if (crumbs < 4) throw new Error(`Expected ≥4 breadcrumb items, got ${crumbs}`);
    });

    await check('depth-4 article: loading reopener appears after load', async () => {
      await page.waitForSelector('.sg-av__reopener.sg-av__reopener--visible', { timeout: VAULT_TIMEOUT });
    });

    await check('depth-4 article: no vault 404s', async () => {
      if (vault404s.length) throw new Error(vault404s.join(', '));
    });

    await page.close();
  }

  // ── /en-gb/library/ — loading UX layer 2 panel ──────────────
  console.log('\n/en-gb/library/ — loading UX layer 2 panel');
  {
    const page = await newAuthedPage(browser);
    await page.goto(`${BASE}/en-gb/library/`);
    await page.waitForSelector('sg-article-viewer', { timeout: VAULT_TIMEOUT });

    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('nav:select', {
        detail: { slug: 'get-started/overview' }, bubbles: true
      }));
    });

    // Wait for reopener then click it
    await page.waitForSelector('.sg-av__reopener.sg-av__reopener--visible', { timeout: VAULT_TIMEOUT });

    await check('reopener click opens layer 2 summary panel', async () => {
      await page.locator('.sg-av__reopener').click();
      await page.waitForSelector('.sg-av__layer2', { timeout: 5_000 });
    });

    await check('layer 2 shows vault and commit fields', async () => {
      const text = await page.locator('.sg-av__layer2').textContent();
      if (!text?.includes('vault') && !text?.includes('commit'))
        throw new Error('Expected vault/commit info in layer 2');
    });

    await check('"Full trace" button present in layer 2', async () => {
      const btn = page.locator('.sg-av__layer2 button, .sg-av__layer2 a').filter({ hasText: /full trace/i });
      await btn.waitFor({ state: 'visible', timeout: 3_000 });
    });

    await page.close();
  }

  await browser.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
