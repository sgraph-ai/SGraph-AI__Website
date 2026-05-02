/**
 * sg-side-nav — vault-driven left sidebar navigation tree
 *
 * Attributes:
 *   src              — URL of a nav JSON file (local or absolute)
 *   vault-id         — content vault id (used when nav JSON is in vault)
 *   read-key         — base64url AES-256-GCM read key (for vault source)
 *   nav-object-id    — vault object-id of the nav JSON
 *   active-slug      — slug of the currently active article
 *   auto-select      — boolean; if present, fires nav:select for active/first article
 *                      on first render (enables SPA auto-load on page load)
 *
 * Nav JSON shape:
 *   { "library": { "sections": [{ "title", "articles": [{ "title", "slug",
 *     "content_object_id", "render", "href" }] }] } }
 *   OR { "dev": { "sections": [...] } }
 *   OR flat: { "sections": [...] }
 *
 * Articles with an "href" field are rendered as <a> tags (external/page nav).
 * Articles with "content_object_id" are rendered as <button> tags (SPA nav).
 *
 * Fires:
 *   nav:select — detail: { title, slug, content_object_id, render }
 *                (only fired from button-type nav items, not href-type)
 */
class SgSideNav extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'vault-id', 'read-key', 'nav-object-id', 'active-slug', 'auto-select'];
  }

  connectedCallback() { this._load(); }

  attributeChangedCallback(name) {
    // Reset _dataLoaded so auto-select fires again if vault/src changes
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
      this._render((data.library ?? data.dev ?? data).sections ?? []);
    } catch (err) {
      this.innerHTML = `<p class="sg-side-nav__error">Nav failed to load.</p>`;
      console.error('sg-side-nav:', err);
    }
  }

  _render(sections) {
    const activeSlug = this.getAttribute('active-slug') ?? '';

    const html = sections.map(section => `
      <div class="sg-side-nav__section">
        <p class="sg-side-nav__section-label">${section.title}</p>
        <ul class="sg-side-nav__list">
          ${(section.articles ?? []).map(article => {
            const isActive = article.slug === activeSlug;
            const cls = `sg-side-nav__item${isActive ? ' sg-side-nav__item--active' : ''}`;
            if (article.href) {
              return `<li>
                <a class="${cls}"
                   href="${article.href}"
                   data-slug="${article.slug ?? ''}">
                  ${article.title}
                </a>
              </li>`;
            }
            return `<li>
              <button class="${cls}"
                      data-slug="${article.slug ?? ''}"
                      data-object-id="${article.content_object_id ?? ''}"
                      data-render="${article.render ?? 'markdown'}"
                      data-title="${article.title}">
                ${article.title}
              </button>
            </li>`;
          }).join('')}
        </ul>
      </div>`).join('');

    this.innerHTML = html || '<p class="sg-side-nav__empty">No articles yet.</p>';

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

    // Auto-select: fire nav:select for the active/first article on first data load
    if (this.hasAttribute('auto-select') && !this._dataLoaded) {
      this._dataLoaded = true;
      const target = activeSlug
        ? this.querySelector(`.sg-side-nav__item[data-slug="${CSS.escape(activeSlug)}"]`)
        : this.querySelector('.sg-side-nav__item[data-object-id]');
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

customElements.define('sg-side-nav', SgSideNav);
