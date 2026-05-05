/**
 * sg-side-nav v2 — vault-driven left sidebar navigation tree
 *
 * Attributes:
 *   src              — URL of a nav JSON file (local or absolute)
 *   vault-id         — content vault id
 *   read-key         — base64url AES-256-GCM read key
 *   nav-object-id    — vault object-id of the nav JSON
 *   active-slug      — slug of the currently active article
 *   auto-select      — boolean; fires nav:select for active-slug article on first
 *                      data load. Does NOT auto-select when active-slug is empty
 *                      (allows the page to show a landing/overview instead).
 *   version          — version string shown in footer (e.g. "v0.4.2")
 *
 * Nav JSON shapes handled:
 *   { "library": { "sections": [...] } }
 *   { "dev":     { "sections": [...] } }
 *   { "sections": [...] }
 *
 * Articles:
 *   href field   → rendered as <a> (link-out, not SPA)
 *   content_object_id → rendered as <button> (fires nav:select)
 *
 * Fires:
 *   nav:loaded  — detail: { sections, totalArticles } — once on first data load
 *   nav:select  — detail: { title, slug, content_object_id, render } — on button click
 *                 or auto-select (only when active-slug is set)
 */
class SgSideNav extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'vault-id', 'read-key', 'nav-object-id',
            'active-slug', 'auto-select', 'version'];
  }

  connectedCallback() { this._load(); }

  attributeChangedCallback(name) {
    if (name !== 'active-slug') this._dataLoaded = false;
    this._load();
  }

  async _load() {
    const src         = this.getAttribute('src');
    const vaultId     = this.getAttribute('vault-id');
    const readKey     = this.getAttribute('read-key');
    const navObjectId = this.getAttribute('nav-object-id');

    try {
      let data;
      if (navObjectId && vaultId && readKey) {
        const { importReadKey, readObject } =
          await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
        const cryptoKey = await importReadKey(readKey);
        const buf = await readObject('https://send.sgraph.ai', vaultId, navObjectId, cryptoKey);
        data = JSON.parse(new TextDecoder().decode(buf));
      } else if (src) {
        const res = await fetch(src);
        data = await res.json();
      } else {
        return;
      }
      this._lastSync = Date.now();
      this._render((data.library ?? data.dev ?? data).sections ?? []);
    } catch (err) {
      this.innerHTML = `<p class="sg-side-nav__error">Nav failed to load.</p>`;
      console.error('sg-side-nav:', err);
    }
  }

  _render(sections) {
    const activeSlug = this.getAttribute('active-slug') ?? '';
    const version    = this.getAttribute('version') ?? '';
    if (!this._collapsed) this._collapsed = new Set();

    const syncAge = this._lastSync
      ? this._timeAgo(this._lastSync)
      : null;

    const env = location.hostname.startsWith('qa.') ? 'qa'
              : location.hostname.startsWith('dev.') ? 'dev'
              : location.hostname === 'localhost' ? 'local'
              : 'prod';

    const html = sections.map((section, i) => {
      const collapsed  = this._collapsed.has(i);
      const articles   = section.articles ?? [];
      return `
        <div class="sg-side-nav__section" data-section-index="${i}">
          <button class="sg-side-nav__section-header"
                  aria-expanded="${!collapsed}"
                  data-index="${i}">
            <span class="sg-side-nav__section-label">${section.title}</span>
            <svg class="sg-side-nav__chevron${collapsed ? '' : ' sg-side-nav__chevron--open'}"
                 width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor"
                    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </button>
          <ul class="sg-side-nav__list${collapsed ? ' sg-side-nav__list--hidden' : ''}"
              aria-hidden="${collapsed}">
            ${articles.map(article => {
              const isActive = article.slug === activeSlug;
              const cls = `sg-side-nav__item${isActive ? ' sg-side-nav__item--active' : ''}`;
              if (article.href) {
                return `<li>
                  <a class="${cls}" href="${article.href}"
                     data-slug="${article.slug ?? ''}">${article.title}</a>
                </li>`;
              }
              return `<li>
                <button class="${cls}"
                        data-slug="${article.slug ?? ''}"
                        data-object-id="${article.content_object_id ?? ''}"
                        data-render="${article.render ?? 'markdown'}"
                        data-title="${article.title}">${article.title}</button>
              </li>`;
            }).join('')}
          </ul>
        </div>`;
    }).join('');

    const footer = (version || syncAge) ? `
      <div class="sg-side-nav__footer">
        ${version ? `<span class="sg-side-nav__version">${version} · ${env}</span>` : ''}
        ${syncAge  ? `<span class="sg-side-nav__sync">Last sync · ${syncAge}</span>` : ''}
      </div>` : '';

    this.innerHTML = (html || '<p class="sg-side-nav__empty">No articles yet.</p>') + footer;

    // Section toggle
    this.querySelectorAll('.sg-side-nav__section-header').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.index, 10);
        if (this._collapsed.has(idx)) this._collapsed.delete(idx);
        else this._collapsed.add(idx);
        this._render(sections);
      });
    });

    // Article click
    this.querySelectorAll('.sg-side-nav__item[data-object-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.sg-side-nav__item')
            .forEach(b => b.classList.remove('sg-side-nav__item--active'));
        btn.classList.add('sg-side-nav__item--active');
        this.setAttribute('active-slug', btn.dataset.slug);
        this.dispatchEvent(new CustomEvent('nav:select', {
          bubbles: true,
          detail: {
            title:             btn.dataset.title,
            slug:              btn.dataset.slug,
            content_object_id: btn.dataset.objectId,
            render:            btn.dataset.render,
          },
        }));
      });
    });

    // First-load behaviour
    if (this.hasAttribute('auto-select') && !this._dataLoaded) {
      this._dataLoaded = true;
      const totalArticles = sections.reduce((n, s) => n + (s.articles?.length ?? 0), 0);

      this.dispatchEvent(new CustomEvent('nav:loaded', {
        bubbles: true,
        detail: { sections, totalArticles },
      }));

      // Only auto-select when a specific slug was requested
      if (activeSlug) {
        const target = this.querySelector(
          `.sg-side-nav__item[data-slug="${CSS.escape(activeSlug)}"]`
        );
        if (target) {
          this.querySelectorAll('.sg-side-nav__item')
              .forEach(b => b.classList.remove('sg-side-nav__item--active'));
          target.classList.add('sg-side-nav__item--active');
          this.dispatchEvent(new CustomEvent('nav:select', {
            bubbles: true,
            detail: {
              title:             target.dataset.title,
              slug:              target.dataset.slug,
              content_object_id: target.dataset.objectId,
              render:            target.dataset.render,
            },
          }));
        }
      }
    }
  }

  _timeAgo(ts) {
    const mins = Math.round((Date.now() - ts) / 60000);
    if (mins < 1)  return 'just now';
    if (mins < 60) return `${mins}m ago`;
    return `${Math.round(mins / 60)}h ago`;
  }
}

customElements.define('sg-side-nav', SgSideNav);
