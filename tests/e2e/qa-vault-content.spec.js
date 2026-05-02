// Plain playwright script — no @playwright/test runner needed.
// Run: node tests/e2e/qa-vault-content.spec.js

const { chromium } = require('/opt/node22/lib/node_modules/playwright');

const BASE = 'https://qa.sgraph.ai';
const VAULT_TIMEOUT = 20_000;
const EXEC = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

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

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ['--ignore-certificate-errors'] });

  // ── /en-gb/dev/ ─────────────────────────────────────────────
  console.log('\n/en-gb/dev/');
  {
    const page = await browser.newPage();
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
    const page = await browser.newPage();
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

  await browser.close();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
