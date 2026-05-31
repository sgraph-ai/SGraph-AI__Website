/**
 * sg-edge-render v1 — LLM/API representation orchestrator
 *
 * This is the BRAIN of the edge-rendering stack (Layer 2). It is shipped on the
 * website like any other asset and loaded at runtime by the tiny Lambda@Edge
 * bootstrap (Layer 1). The Lambda knows nothing about content — it only knows
 * which URIs to intercept and that it should load + call this module.
 *
 * Design principles (see docs/architecture__llm-api-representations.md):
 *   - The Lambda stays ~20 lines and almost never changes.
 *   - THIS file (@Dev-controlled, shipped via normal CI) decides what happens,
 *     including which renderer + manifest apply to a request.
 *   - ALL content, structure, and output-shaping is delegated to the Content
 *     Vault and to JSON manifests (Layer 3). Changing a manifest changes the
 *     output with no code change.
 *
 * Runtime: self-contained. No bare imports / no importmap dependency, so the
 * same file runs in Node (Lambda@Edge) and in a local test harness. Crypto uses
 * node:crypto; the chain is identical to the browser vault-client (sg-side-nav).
 *
 * Entry point:
 *   render(uri, { host, readManifest? }) -> { content_type, body, commit, ...meta }
 */

import crypto from 'node:crypto'

const VAULT_API = 'https://send.sgraph.ai'

// ───────────────────────── resolver core (vault crypto) ─────────────────────
// Mirrors the browser resolution chain: ref → commit → tree-walk → blob_id.
const b64url = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/')
                      .padEnd(s.length + (4 - s.length % 4) % 4, '='), 'base64')
const b64    = s => Buffer.from(s.padEnd(s.length + (4 - s.length % 4) % 4, '='), 'base64')
const hmac12 = (k, i) => crypto.createHmac('sha256', k).update(i).digest('hex').slice(0, 12)
const objPath = id => id.startsWith('ref-pid-') ? `bare/refs/${id}` : `bare/data/${id}`

function gcmDecrypt(key, buf) {
  const iv = buf.slice(0, 12), ct = buf.slice(12, buf.length - 16), tag = buf.slice(buf.length - 16)
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(ct), d.final()])
}
const decMeta = (key, s) => gcmDecrypt(key, b64(s)).toString('utf8')

async function readObject(vaultId, objectId, key) {
  const url = `${VAULT_API}/api/vault/read/${vaultId}/${encodeURIComponent(objPath(objectId))}`
  const r = await fetch(url)
  if (!r.ok) throw new Error(`vault read ${objectId}: ${r.status}`)
  return gcmDecrypt(key, Buffer.from(await r.arrayBuffer()))
}
const readJson = async (vaultId, objectId, key) =>
  JSON.parse((await readObject(vaultId, objectId, key)).toString('utf8'))

/** Resolve a stable vault path to its current blob_id + HEAD commit. */
async function resolvePath(vaultId, key, navPath) {
  const refId = `ref-pid-muw-${hmac12(key, `sg-vault-v1:file-id:ref:${vaultId}`)}`
  const ref = await readJson(vaultId, refId, key)
  const commit = await readJson(vaultId, ref.commit_id, key)
  const walk = async treeId => {
    const t = await readJson(vaultId, treeId, key)
    for (const e of t.entries) if (e.name_enc) e.name = decMeta(key, e.name_enc)
    return t
  }
  let entries = (await walk(commit.tree_id)).entries
  const parts = navPath.split('/').filter(Boolean)
  for (let i = 0; i < parts.length; i++) {
    const e = entries.find(x => x.name === parts[i])
    if (!e) return { blob: null, commit: ref.commit_id }
    if (i === parts.length - 1) return { blob: e.blob_id, commit: ref.commit_id }
    entries = (await walk(e.tree_id)).entries
  }
  return { blob: null, commit: ref.commit_id }
}

// ───────────────────────────── renderers (Layer 2 format logic) ─────────────
// Format lives here (@Dev-controlled JS); WHAT to include is driven by the
// manifest (Layer 3). Add a renderer here to support a new file type — the
// Lambda never changes.

function renderLlmsTxt(manifest, nav, ctx) {
  const sections = (nav.library ?? nav).sections ?? []
  const exSection = new Set(manifest.include?.exclude_sections ?? [])
  const exSlug = new Set(manifest.include?.exclude_slugs ?? [])
  const max = manifest.include?.max_pages ?? Infinity
  const { title, summary, page_suffix = '.md' } = manifest.site
  const baseUrl = ctx.baseUrl

  let out = `# ${title}\n\n> ${summary}\n\n`
  out += `Content is served live from an encrypted, content-addressed vault `
  out += `(id: ${manifest.vault.id}). Each page links to its Markdown source.\n\n`

  let pages = 0
  const compound = (parent, child) =>
    child?.startsWith(parent + '/') ? child : `${parent}/${child}`
  for (const s of sections) {
    if (exSection.has(s.title)) continue
    const kids = s.children ?? s.articles ?? []
    if (!kids.length) continue
    out += `## ${s.title}\n`
    if (s.description) out += `${s.description}\n`
    out += `\n`
    const emit = a => {
      if (!a.slug || exSlug.has(a.slug) || pages >= max) return
      out += `- [${a.title}](${baseUrl}/${a.slug}${page_suffix})${a.summary ? `: ${a.summary}` : ''}\n`
      pages++
    }
    for (const a of kids) {
      emit(a)
      for (const c of (a.children ?? [])) emit({ ...c, slug: compound(a.slug, c.slug) })
    }
    out += `\n`
  }
  return { body: out, meta: { pages, sections: sections.length } }
}

const RENDERERS = {
  'llms.txt': renderLlmsTxt,
  // 'markdown': renderMarkdown,   // per-page *.md  (next)
  // 'json':     renderJson,       // *.llm.json for @QA  (next)
}

// ───────────────────────── uri → manifest routing ──────────────────────────
// Keep this dumb: map an intercepted URI to a manifest name. The manifest does
// the rest. (When *.md / *.llm.json land, this also extracts the page slug.)
function manifestNameFor(uri) {
  if (uri === '/llms.txt') return 'llms.txt'
  return null
}

// ───────────────────────────── entry point ─────────────────────────────────
/**
 * @param {string} uri   request path (e.g. "/llms.txt")
 * @param {object} opts
 * @param {string} opts.host           request Host header (selects environment)
 * @param {Function} [opts.readManifest] (name) => Promise<object>; defaults to
 *        fetching /core/edge-render/v1/manifests/{name}.json from the same host
 */
export async function render(uri, opts = {}) {
  const host = opts.host
  const readManifest = opts.readManifest ?? (async name => {
    const r = await fetch(`https://${host}/core/edge-render/v1/manifests/${name}.json`)
    if (!r.ok) throw new Error(`manifest ${name}: ${r.status}`)
    return r.json()
  })

  const name = manifestNameFor(uri)
  if (!name) throw new Error(`no manifest mapping for ${uri}`)

  const manifest = await readManifest(name)
  const renderer = RENDERERS[manifest.type]
  if (!renderer) throw new Error(`no renderer for type ${manifest.type}`)

  const key = b64url(manifest.vault.read_key)
  const { blob, commit } = await resolvePath(manifest.vault.id, key, manifest.vault.nav_path)
  if (!blob) throw new Error(`could not resolve ${manifest.vault.nav_path}`)
  const nav = await readJson(manifest.vault.id, blob, key)

  const baseUrl = `https://${host}${manifest.site.base_path ?? ''}`
  const { body, meta } = renderer(manifest, nav, { baseUrl, host })

  return { content_type: manifest.content_type, body, commit, ...meta }
}
