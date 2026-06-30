// Plain playwright script — no @playwright/test runner needed.
// Run: node tests/e2e/qa-vault-content.spec.js [access-token]
//      SG_BASE_URL=https://dev.sgraph.ai node tests/e2e/qa-vault-content.spec.js
//
// Validates that the vault-backed sub-sites actually render content end-to-end
// (CloudFront → shell → sg-side-nav/sg-article-viewer → decrypted vault blob).
// Assertions are structural (against the current sub-site-shell architecture),
// not tied to specific copy, so content edits don't break the gate. Every page
// interaction runs inside check() so one failure can't abort the rest.

let chromium;
try { ({ chromium } = require('playwright')); }
catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const BASE = (process.env.SG_BASE_URL || 'https://qa.sgraph.ai').replace(/\/$/, '');
const T = 25_000;
const EXEC = process.env.PLAYWRIGHT_EXECUTABLE || '';
const ACCESS_TOKEN = process.argv[2] || process.env.SG_ACCESS_TOKEN || '';

let passed = 0, failed = 0;

async function check(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); passed++; }
  catch (e) { console.log(`  FAIL  ${name}`); console.log(`        ${e.message.split('\n')[0]}`); failed++; }
}

async function newPage(browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  if (ACCESS_TOKEN) {
    const domain = new URL(BASE).hostname;
    await ctx.addCookies([{
      name: 'x-sgraph-access-token', value: ACCESS_TOKEN,
      domain, path: '/', httpOnly: false, secure: true, sameSite: 'Lax',
    }]);
  }
  return ctx.newPage();
}

function track404s(page) {
  const hits = [];
  page.on('response', r => {
    if (r.url().includes('obj-cas-imm') && r.status() >= 400) hits.push(`${r.status()} ${r.url()}`);
  });
  return hits;
}

// An article has rendered into #article-render once the body carries real text.
async function waitForArticleContent(page, min = 80) {
  await page.waitForSelector('sg-article-viewer', { timeout: T });
  await page.waitForFunction(
    (m) => (document.getElementById('article-render')?.innerText.trim().length ?? 0) > m,
    min, { timeout: T });
}

// Run one section's steps with its own page, guaranteed not to crash the suite.
async function section(browser, label, steps) {
  console.log(`\n${label}`);
  const page = await newPage(browser);
  const v404 = track404s(page);
  try { await steps(page, v404); }
  catch (e) { await check(`${label} (setup)`, () => { throw e; }); }
  finally { await page.close().catch(() => {}); }
}

async function run() {
  const launchOpts = { headless: true, args: ['--ignore-certificate-errors'] };
  if (EXEC) launchOpts.executablePath = EXEC;
  const browser = await chromium.launch(launchOpts);

  // Library landing renders the curated home article.
  await section(browser, '/en-gb/library/', async (page, v404) => {
    await page.goto(`${BASE}/en-gb/library/`);
    await check('title contains "Library"', async () => {
      const t = await page.title(); if (!/Library/.test(t)) throw new Error(`Got: ${t}`);
    });
    await check('home article renders content (not blank)', () => waitForArticleContent(page));
    await check('no vault 404s', async () => { if (v404.length) throw new Error(v404.join(', ')); });
  });

  // Deep-link to a known article — exercises the shell's routing + breadcrumbs.
  await section(browser, '/en-gb/library/building-on-sgraph/ (deep-link)', async (page, v404) => {
    await page.goto(`${BASE}/en-gb/library/building-on-sgraph/`);
    await check('deep-linked article renders content', () => waitForArticleContent(page));
    await check('breadcrumbs populated', () => page.waitForFunction(
      () => (document.getElementById('article-crumbs')?.innerText.trim().length ?? 0) > 0, { timeout: T }));
    await check('no vault 404s', async () => { if (v404.length) throw new Error(v404.join(', ')); });
  });

  // Loading UX: reopener → layer 2 summary panel → vault/commit fields.
  await section(browser, '/en-gb/library/ — loading UX layer 2', async (page) => {
    await page.goto(`${BASE}/en-gb/library/`);
    await check('article renders before checking loading UX', () => waitForArticleContent(page));
    await check('loading reopener appears after load',
      () => page.waitForSelector('.sg-av__reopener.sg-av__reopener--visible', { timeout: T }));
    await check('reopener click opens layer 2 summary panel', async () => {
      await page.locator('.sg-av__reopener').click();
      await page.waitForSelector('.sg-av__layer2', { timeout: 5_000 });
    });
    await check('layer 2 shows vault / commit info', async () => {
      const text = await page.locator('.sg-av__layer2').textContent();
      if (!/vault|commit/i.test(text || '')) throw new Error('no vault/commit info in layer 2');
    });
  });

  // Invest sub-site — home article renders (no TOC, no search; CR-05 phase 2).
  await section(browser, '/en-gb/invest/', async (page, v404) => {
    await page.goto(`${BASE}/en-gb/invest/`);
    await check('invest home renders content', () => waitForArticleContent(page));
    await check('no vault 404s', async () => { if (v404.length) throw new Error(v404.join(', ')); });
  });

  // Dev sub-site — a JSON board renders (deep-link to workstreams).
  await section(browser, '/en-gb/dev/workstreams/ (board)', async (page, v404) => {
    await page.goto(`${BASE}/en-gb/dev/workstreams/`);
    await check('workstreams board renders content', () => page.waitForFunction(
      () => (document.getElementById('article-render')?.innerText.trim().length ?? 0) > 40, { timeout: T }));
    await check('no vault 404s', async () => { if (v404.length) throw new Error(v404.join(', ')); });
  });

  await browser.close();
  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
