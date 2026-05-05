/**
 * sg-sub-nav v2 — sub-site navigation bar
 *
 * Attributes:
 *   site-title         — display name: "Library" or "Dev"
 *   links              — JSON string: [{ "title": "...", "href": "..." }] (cross-links)
 *   src                — URL of a nav JSON file (reads cross_links)
 *   vault-id           — vault id for vault-sourced cross_links
 *   read-key           — AES-256-GCM read key (base64url)
 *   nav-object-id      — vault object id of the nav JSON
 *   current-context    — breadcrumb text (article/section title); lightweight update
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
    return ['site-title', 'links', 'src', 'vault-id', 'read-key',
            'nav-object-id', 'current-context', 'search-placeholder'];
  }

  connectedCallback() { this._render(); }

  attributeChangedCallback(name) {
    if (name === 'current-context') {
      // Lightweight: update breadcrumb text without full re-render
      const el = this.querySelector('.sg-sub-nav__context');
      if (el) { el.textContent = this.getAttribute('current-context') ?? ''; }
      return;
    }
    this._render();
  }

  async _render() {
    const title       = this.getAttribute('site-title') ?? '';
    const linksAttr   = this.getAttribute('links');
    const src         = this.getAttribute('src');
    const vaultId     = this.getAttribute('vault-id');
    const readKey     = this.getAttribute('read-key');
    const navObjectId = this.getAttribute('nav-object-id');
    const context     = this.getAttribute('current-context') ?? '';
    const placeholder = this.getAttribute('search-placeholder')
                        ?? `Search ${title.toLowerCase()}...`;

    let crossLinks = [];
    if (linksAttr) {
      try { crossLinks = JSON.parse(linksAttr); } catch (_) {}
    } else if (navObjectId && vaultId && readKey) {
      try {
        const { importReadKey, readObject } =
          await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
        const cryptoKey = await importReadKey(readKey);
        const buf = await readObject('https://send.sgraph.ai', vaultId, navObjectId, cryptoKey);
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

    this.innerHTML = `
      <nav class="sg-sub-nav__bar" aria-label="${title} navigation">

        <div class="sg-sub-nav__left">
          <span class="sg-sub-nav__dot" aria-hidden="true"></span>
          <span class="sg-sub-nav__site-name">${title.toUpperCase()}</span>
          <span class="sg-sub-nav__sep" aria-hidden="true"></span>
          <span class="sg-sub-nav__context">${context}</span>
        </div>

        <div class="sg-sub-nav__tabs" role="tablist">
          <span class="sg-sub-nav__tab sg-sub-nav__tab--active"
                role="tab" aria-selected="true">${title.toUpperCase()}</span>
          ${crossLinks.map(l => `
            <a class="sg-sub-nav__tab"
               href="${l.href}"
               role="tab"
               aria-selected="false">${l.title.toUpperCase()}</a>`).join('')}
        </div>

        <div class="sg-sub-nav__right">
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

      </nav>`;

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
