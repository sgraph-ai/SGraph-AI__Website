/**
 * sg-edge-render — Lambda@Edge bootstrap (Layer 1)
 *
 * The ENTIRE function. It deliberately knows almost nothing:
 *   1. which request URIs to intercept (INTERCEPT)
 *   2. that it should load + run the orchestrator JS shipped on the SAME site
 *      (RENDER_PATH, resolved against the request Host)
 *
 * Everything else — content, structure, output shaping — lives in the
 * orchestrator (sg-edge-render.mjs) and the JSON manifests, both served from the
 * website and controlled by @Dev / @Content via normal CI. This function should
 * rarely, if ever, need to change.
 *
 * Why Host-derived (not a hardcoded URL): one Lambda version is attached to all
 * four CloudFront distributions (qa / dev / main / sgraph.ai). Each request's
 * Host header selects the right origin, so every environment runs ITS OWN
 * branch's orchestrator + manifests. Test on dev → qa → main → prod through the
 * normal deploy flow; the Lambda is never touched.
 *
 * Trigger: origin-request (fires on cache miss; result is cached by CloudFront).
 * Deploy:  us-east-1, publish a version, attach the version ARN to each
 *          distribution's behavior(s) for /llms.txt (+ *.md, *.llm.json later).
 */

import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const RENDER_PATH = '/core/edge-render/v1/sg-edge-render.mjs'

// Which requests this function answers. Everything else passes straight through
// to the SPA / S3 origin untouched.
const INTERCEPT = uri =>
  uri === '/llms.txt' ||
  uri.endsWith('.md') ||
  uri.endsWith('.llm.json')

// Per-host module cache with a short TTL so CI deploys propagate within ~1 min
// without waiting for the warm container to cycle.
const cache = new Map() // host -> { mod, at }
const TTL_MS = 60_000

async function loadModule(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`load orchestrator ${url}: ${res.status}`)
  const code = await res.text()
  // Node can't import() an https URL without experimental flags; the orchestrator
  // is self-contained (no internal imports), so write-and-import is safe + simple.
  const file = `/tmp/sg-orch-${createHash('sha256').update(url + code).digest('hex').slice(0, 16)}.mjs`
  writeFileSync(file, code)
  return import(file)
}

export const handler = async (event) => {
  const req = event.Records[0].cf.request
  if (!INTERCEPT(req.uri)) return req // ← pass through

  const host = req.headers.host[0].value
  let hit = cache.get(host)
  if (!hit || Date.now() - hit.at > TTL_MS) {
    hit = { mod: await loadModule(`https://${host}${RENDER_PATH}`), at: Date.now() }
    cache.set(host, hit)
  }

  try {
    const out = await hit.mod.render(req.uri, { host })
    return {
      status: '200',
      statusDescription: 'OK',
      headers: {
        'content-type':  [{ key: 'Content-Type',  value: out.content_type }],
        'cache-control': [{ key: 'Cache-Control', value: 'public, max-age=60' }],
        'x-sg-commit':   [{ key: 'X-Sg-Commit',   value: out.commit ?? '' }],
      },
      body: out.body,
    }
  } catch (err) {
    return {
      status: '502',
      statusDescription: 'Bad Gateway',
      headers: { 'content-type': [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
      body: `edge-render failed: ${err.message}\n`,
    }
  }
}
