/**
 * sg-side-nav v3 — file-tree style sidebar navigation (two-tone paper design)
 *
 * Attributes:
 *   src              — URL of a nav JSON file (local or absolute)
 *   vault-id         — content vault id
 *   read-key         — base64url AES-256-GCM read key
 *   nav-object-id    — vault object-id of the nav JSON
 *   active-slug      — slug of the currently active article
 *   auto-select      — boolean; fires nav:select for active-slug article on first
 *                      data load. Does NOT auto-select when active-slug is empty
 *                      (page shows landing overview instead).
 *   tree-label       — label for sidebar header (default: "Contents")
 *   version          — version string shown in footer (e.g. "v0.2.0")
 *
 * Nav JSON shapes handled:
 *   { "library": { "sections": [...] } }
 *   { "dev":     { "sections": [...] } }
 *   { "sections": [...] }
 *
 * Articles:
 *   href field            → rendered as <a> (link-out, not SPA)
 *   content_object_id     → rendered as <button> (fires nav:select)
 *
 * Fires:
 *   nav:loaded  — detail: { sections, totalArticles } — once on first data load
 *   nav:select  — detail: { title, slug, content_object_id, render, sectionTitle }
 */
class SgSideNav extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'vault-id', 'read-key', 'nav-object-id',
            'active-slug', 'auto-select', 'tree-label', 'version', 'extra-links'];
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
      const sections = (data.library ?? data.dev ?? data).sections ?? [];
      this._injectExtraLinks(sections);
      this._render(sections);
    } catch (err) {
      this.innerHTML = `<p class="sg-side-nav__error">Nav failed to load.</p>`;
      console.error('sg-side-nav:', err);
    }
  }

  _injectExtraLinks(sections) {
    const raw = this.getAttribute('extra-links');
    if (!raw) return;
    let extras;
    try { extras = JSON.parse(raw); } catch { return; }
    for (const item of extras) {
      const section = sections.find(s => s.title === item.section);
      // Items with object_id become vault-backed buttons; items with href become links
      const entry = item.object_id
        ? { title:              item.title,
            slug:               item.slug ?? '',
            content_object_id:  item.object_id,
            vault_id:           item.vault_id  ?? undefined,
            read_key:           item.read_key  ?? undefined,
            render:             item.render    ?? 'markdown' }
        : { title: item.title, href: item.href, slug: item.slug ?? '' };
      if (section) {
        if (!(section.articles ?? []).some(a => a.slug === entry.slug)) {
          section.articles = [...(section.articles ?? []), entry];
        }
      } else {
        sections.push({ title: item.section, articles: [entry] });
      }
    }
  }

  _render(sections) {
    const activeSlug  = this.getAttribute('active-slug') ?? '';
    const version     = this.getAttribute('version') ?? '';
    const treeLabel   = this.getAttribute('tree-label') ?? 'Contents';
    // Initialise collapsed state: all sections collapsed by default on first render
    if (!this._collapsed) {
      this._collapsed = new Set(sections.map((_, i) => i));
    }
    // Always ensure the section containing the active article is expanded
    if (activeSlug) {
      sections.forEach((s, i) => {
        if ((s.articles ?? []).some(a => a.slug === activeSlug)) {
          this._collapsed.delete(i);
        }
      });
    }

    const totalArticles = sections.reduce((n, s) => n + (s.articles?.length ?? 0), 0);

    const env = location.hostname.startsWith('qa.') ? 'qa'
              : location.hostname.startsWith('dev.') ? 'dev'
              : location.hostname === 'localhost' ? 'local'
              : 'prod';

    const folderIcon = `<svg class="sg-side-nav__folder-icon" width="13" height="13"
        viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 5a1.5 1.5 0 011.5-1.5h3.086a1 1 0 01.707.293L8.5 5H12.5A1.5 1.5 0 0114 6.5v5A1.5 1.5 0 0112.5 13h-9A1.5 1.5 0 012 11.5V5z"
            fill="currentColor"/>
    </svg>`;

    const docIcon = `<svg class="sg-side-nav__doc-icon" width="12" height="12"
        viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
    </svg>`;

    const chevronSvg = `<svg width="7" height="7" viewBox="0 0 7 7" fill="none" aria-hidden="true">
      <path d="M1.5 2L3.5 4L5.5 2" stroke="currentColor" stroke-width="1.3"
            stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

    const tree = sections.map((section, i) => {
      const collapsed = this._collapsed.has(i);
      const articles  = section.articles ?? [];

      const docs = articles.map(article => {
        const isActive = article.slug === activeSlug;
        const cls = `sg-side-nav__doc${isActive ? ' sg-side-nav__doc--active' : ''}`;

        if (article.href) {
          return `<a class="${cls}" href="${article.href}"
                     data-slug="${article.slug ?? ''}">
                   ${docIcon}
                   <span class="sg-side-nav__doc-label">${article.title}</span>
                 </a>`;
        }
        return `<button class="${cls}"
                         data-slug="${article.slug ?? ''}"
                         data-object-id="${article.content_object_id ?? ''}"
                         data-render="${article.render ?? 'markdown'}"
                         data-title="${article.title}"
                         data-section="${section.title}"
                         data-vault-id="${article.vault_id ?? ''}"
                         data-read-key="${article.read_key ?? ''}">
                  ${docIcon}
                  <span class="sg-side-nav__doc-label">${article.title}</span>
                </button>`;
      }).join('');

      return `
        <div class="sg-side-nav__section" data-section-index="${i}">
          <div class="sg-side-nav__folder" data-index="${i}">
            <span class="sg-side-nav__chev${collapsed ? '' : ' sg-side-nav__chev--open'}">
              ${chevronSvg}
            </span>
            ${folderIcon}
            <span class="sg-side-nav__folder-label">${section.title}</span>
          </div>
          ${collapsed ? '' : `
            <div class="sg-side-nav__children">${docs}</div>
          `}
        </div>`;
    }).join('');

    const footer = version ? `
      <div class="sg-side-nav__footer">
        <span class="sg-side-nav__version">${version} · ${env}</span>
      </div>` : '';

    this.innerHTML = `
      <div class="sg-side-nav__header">
        ${treeLabel.toUpperCase()} TREE
        <span class="sg-side-nav__count">${totalArticles}</span>
      </div>
      ${tree || '<p class="sg-side-nav__empty">No articles yet.</p>'}
      ${footer}`;

    // Folder expand/collapse
    this.querySelectorAll('.sg-side-nav__folder').forEach(folder => {
      folder.addEventListener('click', () => {
        const idx = parseInt(folder.dataset.index, 10);
        if (this._collapsed.has(idx)) this._collapsed.delete(idx);
        else this._collapsed.add(idx);
        this._render(sections);
      });
    });

    // Article clicks (buttons only — <a> tags navigate normally)
    this.querySelectorAll('.sg-side-nav__doc[data-object-id]').forEach(btn => {
      btn.addEventListener('click', () => {
        this.querySelectorAll('.sg-side-nav__doc')
            .forEach(b => b.classList.remove('sg-side-nav__doc--active'));
        btn.classList.add('sg-side-nav__doc--active');
        this.setAttribute('active-slug', btn.dataset.slug);
        this.dispatchEvent(new CustomEvent('nav:select', {
          bubbles: true,
          detail: {
            title:             btn.dataset.title,
            slug:              btn.dataset.slug,
            content_object_id: btn.dataset.objectId,
            render:            btn.dataset.render,
            sectionTitle:      btn.dataset.section ?? '',
            vault_id:          btn.dataset.vaultId  || null,
            read_key:          btn.dataset.readKey  || null,
          },
        }));
      });
    });

    // First-load behaviour
    if (this.hasAttribute('auto-select') && !this._dataLoaded) {
      this._dataLoaded = true;

      this.dispatchEvent(new CustomEvent('nav:loaded', {
        bubbles: true,
        detail: { sections, totalArticles },
      }));

      // Only auto-select when a specific slug was requested
      if (activeSlug) {
        const target = this.querySelector(
          `.sg-side-nav__doc[data-slug="${CSS.escape(activeSlug)}"]`
        );
        if (target) {
          this.querySelectorAll('.sg-side-nav__doc')
              .forEach(b => b.classList.remove('sg-side-nav__doc--active'));
          target.classList.add('sg-side-nav__doc--active');
          this.dispatchEvent(new CustomEvent('nav:select', {
            bubbles: true,
            detail: {
              title:             target.dataset.title,
              slug:              target.dataset.slug,
              content_object_id: target.dataset.objectId,
              render:            target.dataset.render,
              sectionTitle:      target.dataset.section ?? '',
              vault_id:          target.dataset.vaultId || null,
              read_key:          target.dataset.readKey || null,
            },
          }));
        }
      }
    }
  }
}

customElements.define('sg-side-nav', SgSideNav);
