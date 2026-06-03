/**
 * sg-sub-nav v3 — sub-site identity band (two-tone paper design)
 *
 * Attributes:
 *   site-title        — display name: "Library" or "Dev"
 *   site-description  — tagline shown below the title in the band
 *   links             — JSON string: [{ "title": "...", "href": "..." }] (cross-links)
 *   src               — URL of a nav JSON file (reads cross_links)
 *   vault-id          — vault id for vault-sourced cross_links
 *   read-key          — AES-256-GCM read key (base64url)
 *   nav-object-id     — vault object id of the nav JSON (explicit; overrides nav-path)
 *   nav-path          — stable path in vault tree (e.g. "library/_nav.json"); resolved
 *                       via ref→commit→tree walk; reads cross_links from the resolved object
 *   search-placeholder — input placeholder override
 *
 * Fires:
 *   sub-nav:search — detail: { query } — on input in search box
 *
 * Keyboard:
 *   ⌘K / Ctrl+K — focuses the search input
 */
class SgSubNav extends HTMLElement {
  static get observedAttributes() {
    return ['site-title', 'site-description', 'links', 'src',
            'vault-id', 'read-key', 'nav-object-id', 'nav-path', 'search-placeholder'];
  }

  connectedCallback() { this._scheduleRender(); }
  attributeChangedCallback() { this._scheduleRender(); }

  _scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    queueMicrotask(() => { this._renderScheduled = false; this._render(); });
  }

  async _render() {
    const title       = this.getAttribute('site-title') ?? '';
    const description = this.getAttribute('site-description') ?? '';
    const linksAttr   = this.getAttribute('links');
    const src         = this.getAttribute('src');
    const vaultId     = this.getAttribute('vault-id');
    const readKey     = this.getAttribute('read-key');
    const navObjectId = this.getAttribute('nav-object-id');
    const navPath     = this.getAttribute('nav-path');
    const placeholder = this.getAttribute('search-placeholder')
                        ?? `Search ${title.toLowerCase()}...`;
    const letter      = title.charAt(0).toUpperCase();

    let crossLinks = [];
    if (linksAttr) {
      try { crossLinks = JSON.parse(linksAttr); } catch (_) {}
    } else if ((navObjectId || navPath) && vaultId && readKey) {
      try {
        const { importReadKey, readObject } =
          await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
        let resolvedId = navObjectId;
        if (navPath && !navObjectId) {
          this._vaultCtx = await _openVaultCtx('https://send.sgraph.ai', vaultId, readKey);
          resolvedId = await _resolvePathWithCtx(this._vaultCtx, navPath);
        }
        const cryptoKey = this._vaultCtx?.cryptoKey ?? await importReadKey(readKey);
        const buf = await readObject('https://send.sgraph.ai', vaultId, resolvedId, cryptoKey);
        const data = JSON.parse(new TextDecoder().decode(buf));
        crossLinks = data.cross_links
          ?? data.library?.cross_links
          ?? data.dev?.cross_links
          ?? [];
      } catch (_) {}
    } else if (src) {
      try {
        const res  = await fetch(src);
        const data = await res.json();
        crossLinks = data.cross_links
          ?? data.library?.cross_links
          ?? data.dev?.cross_links
          ?? [];
      } catch (_) {}
    }

    const homeHref = `/en-gb/${title.toLowerCase()}/`;

    this.innerHTML = `
      <div class="sg-sub-nav__band" aria-label="${title} sub-site">

        <a class="sg-sub-nav__home-link" href="${homeHref}" aria-label="${title} home">
          <div class="sg-sub-nav__monogram">${letter}</div>
          <div class="sg-sub-nav__text">
            <div class="sg-sub-nav__eyebrow">Sub-site · sgraph.ai/${title.toLowerCase()}</div>
            <div class="sg-sub-nav__title">${title}</div>
            ${description ? `<p class="sg-sub-nav__intro">${description}</p>` : ''}
          </div>
        </a>

        <div class="sg-sub-nav__controls">
          <div class="sg-sub-nav__tabs" role="tablist">
            ${[{ title, active: true }, ...crossLinks.map(l => ({ title: l.title, href: l.href, active: false }))]
              .sort((a, b) => a.title.localeCompare(b.title))
              .map(t => t.active
                ? `<span class="sg-sub-nav__tab sg-sub-nav__tab--active" role="tab" aria-selected="true">${t.title.toUpperCase()}</span>`
                : `<a class="sg-sub-nav__tab" href="${t.href}" role="tab" aria-selected="false">${t.title.toUpperCase()}</a>`)
              .join('')}
          </div>

          <div class="sg-sub-nav__search-wrap">
            <svg class="sg-sub-nav__search-icon" width="13" height="13"
                 viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <circle cx="6.5" cy="6.5" r="5"
                      stroke="currentColor" stroke-width="1.5"/>
              <path d="M10.5 10.5L14 14"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
            <input class="sg-sub-nav__search-input"
                   type="search"
                   placeholder="${placeholder}"
                   aria-label="Search ${title}">
            <kbd class="sg-sub-nav__kbd">⌘K</kbd>
          </div>
        </div>

      </div>`;

    const input = this.querySelector('.sg-sub-nav__search-input');

    input?.addEventListener('input', e => {
      this.dispatchEvent(new CustomEvent('sub-nav:search', {
        bubbles: true,
        detail: { query: e.target.value },
      }));
    });

    document.removeEventListener('keydown', this._onKey);
    this._onKey = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        input?.focus();
      }
    };
    document.addEventListener('keydown', this._onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._onKey);
  }
}

customElements.define('sg-sub-nav', SgSubNav);

async function _openVaultCtx(apiBaseUrl, vaultId, readKeyBase64Url) {
  const client = await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
  const b64  = readKeyBase64Url.replace(/-/g, '+').replace(/_/g, '/');
  const pad  = b64.padEnd(b64.length + (4 - b64.length % 4) % 4, '=');
  const bstr = atob(pad);
  const readKeyBytes = Uint8Array.from({ length: bstr.length }, (_, i) => bstr.charCodeAt(i));
  const cryptoKey = await client.importReadKey(readKeyBase64Url);
  const refHex    = await client.deriveFileIdHex(readKeyBytes, `sg-vault-v1:file-id:ref:${vaultId}`);
  const refFileId = client.formatFileId('ref', 'pid', 'muw', refHex);
  const vault = {
    keys:       { readKey: cryptoKey, readKeyBytes, refFileId, vaultId },
    apiBaseUrl: apiBaseUrl.replace(/\/$/, ''),
    vaultId,
  };
  const ref      = await client.readFileAsJson(vault, refFileId);
  const commitId = ref.commit_id ?? ref.commitId ?? ref.target;
  if (!commitId) throw new Error('sg-sub-nav: vault ref has no commit ID');
  return { client, vault, commitId, cryptoKey };
}

async function _resolvePathWithCtx(ctx, path) {
  const cacheKey = `sg-nav:${ctx.vault.vaultId}:${path}:${ctx.commitId}`;
  const cached   = sessionStorage.getItem(cacheKey);
  if (cached) return cached;

  const commit  = await ctx.client.readFileAsJson(ctx.vault, ctx.commitId);
  const treeId  = commit.tree_id ?? commit.treeId ?? commit.tree;
  if (!treeId) throw new Error('sg-sub-nav: commit has no tree ID');

  let entries = (await ctx.client.walkTree(ctx.vault, treeId)).entries ?? [];
  const parts = path.split('/').filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const entry = entries.find(e => e.name === parts[i]);
    if (!entry) throw new Error(`sg-sub-nav: '${parts[i]}' not found in vault tree`);
    if (i === parts.length - 1) {
      if (!entry.blob_id) throw new Error(`sg-sub-nav: '${path}' is a directory, not a file`);
      sessionStorage.setItem(cacheKey, entry.blob_id);
      return entry.blob_id;
    }
    if (!entry.tree_id) throw new Error(`sg-sub-nav: '${parts[i]}' is not a directory`);
    entries = (await ctx.client.walkTree(ctx.vault, entry.tree_id)).entries ?? [];
  }
  throw new Error(`sg-sub-nav: '${path}' could not be fully resolved`);
}
