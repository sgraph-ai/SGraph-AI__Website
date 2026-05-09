/**
 * sg-side-nav v4 — file-tree sidebar navigation
 *
 * Attributes:
 *   src              — URL of a nav JSON file
 *   vault-id         — content vault id
 *   read-key         — base64url AES-256-GCM read key
 *   nav-object-id    — vault object-id of the nav JSON
 *   active-slug      — slug of the currently active article
 *   auto-select      — boolean; fires nav:select for active-slug on first load
 *   tree-label       — sidebar header label (default: "Contents")
 *   version          — version string shown in footer
 *
 * Nav JSON shapes:
 *   { "library": { "sections": [...] } }
 *   { "dev":     { "sections": [...] } }
 *   { "sections": [...] }
 *
 * Section fields:
 *   articles[]        — inline articles (current behaviour)
 *   nav_object_id     — vault object-id of a child nav JSON (lazy-loaded on expand)
 *   vault_id          — override vault for nav_object_id fetch
 *   read_key          — override read key for nav_object_id fetch
 *
 * Article fields:
 *   href              — renders as <a> (link-out)
 *   content_object_id — renders as <button> (fires nav:select)
 *   children[]        — renders article as a collapsible folder
 *
 * Fires:
 *   nav:loaded  — detail: { sections, totalArticles }
 *   nav:select  — detail: { title, slug, content_object_id, render, schema,
 *                           sectionTitle, parentTitle, vault_id, read_key }
 */
class SgSideNav extends HTMLElement {
  static get observedAttributes() {
    return ['src', 'vault-id', 'read-key', 'nav-object-id',
            'active-slug', 'auto-select', 'tree-label', 'version', 'extra-links', 'home-href'];
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

  // Fetch a section's articles from vault when nav_object_id is declared
  async _loadSection(section, sections) {
    section._loading = true;
    try {
      const { importReadKey, readObject } =
        await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
      const vaultId  = section.vault_id  ?? this.getAttribute('vault-id');
      const readKey  = section.read_key  ?? this.getAttribute('read-key');
      const cryptoKey = await importReadKey(readKey);
      const buf = await readObject('https://send.sgraph.ai', vaultId, section.nav_object_id, cryptoKey);
      const data = JSON.parse(new TextDecoder().decode(buf));
      section._loadedArticles = (data.library ?? data.dev ?? data).articles ?? data.articles ?? [];
      section._loading = false;
      this._render(sections);
    } catch (err) {
      console.error('sg-side-nav: section load error', section.title, err);
      section._loading = false;
      section._loadError = true;
      this._render(sections);
    }
  }

  _injectExtraLinks(sections) {
    const raw = this.getAttribute('extra-links');
    if (!raw) return;
    let extras;
    try { extras = JSON.parse(raw); } catch { return; }
    for (const item of extras) {
      const section = sections.find(s => s.title === item.section);
      const entry = item.object_id
        ? { title:             item.title,
            slug:              item.slug ?? '',
            content_object_id: item.object_id,
            vault_id:          item.vault_id  ?? undefined,
            read_key:          item.read_key  ?? undefined,
            render:            item.render    ?? 'markdown',
            schema:            item.schema    ?? undefined }
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
    const activeSlug = this.getAttribute('active-slug') ?? '';
    const version    = this.getAttribute('version') ?? '';
    const treeLabel  = this.getAttribute('tree-label') ?? 'Contents';

    // ── Collapse state: sections ──────────────────────────────────────────
    if (!this._collapsed) {
      this._collapsed = new Set(sections.map((_, i) => i));
    }

    // ── Collapse state: article folders (articles with children[]) ────────
    if (!this._collapsedFolders) {
      this._collapsedFolders = new Set();
      // Default all article-folders to collapsed
      sections.forEach(s => {
        (s._loadedArticles ?? s.articles ?? []).forEach(a => {
          if ((a.children ?? []).length) this._collapsedFolders.add(a.slug ?? a.title);
        });
      });
    }

    // Expand section + article-folder that contains the active slug
    if (activeSlug) {
      sections.forEach((s, i) => {
        const arts = s._loadedArticles ?? s.articles ?? [];
        arts.forEach(a => {
          const isParent = a.slug === activeSlug;
          const hasActiveChild = (a.children ?? []).some(c => {
            const cs = _compoundSlug(a.slug, c.slug);
            return cs === activeSlug;
          });
          if (isParent || hasActiveChild) {
            this._collapsed.delete(i);
            if ((a.children ?? []).length) this._collapsedFolders.delete(a.slug ?? a.title);
          }
        });
      });
    }

    const totalArticles = sections.reduce((n, s) => {
      const arts = s._loadedArticles ?? s.articles ?? [];
      return n + arts.reduce((m, a) => m + 1 + (a.children?.length ?? 0), 0);
    }, 0);

    const env = location.hostname.startsWith('qa.') ? 'qa'
              : location.hostname.startsWith('dev.') ? 'dev'
              : location.hostname === 'localhost' ? 'local'
              : 'prod';

    // ── SVG icons ─────────────────────────────────────────────────────────
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

    // ── Render helpers ────────────────────────────────────────────────────

    // Plain doc item (leaf article or child)
    const renderDoc = (article, sectionTitle, extraCls = '', parentTitle = '') => {
      const isActive = article.slug === activeSlug;
      const cls = `sg-side-nav__doc${isActive ? ' sg-side-nav__doc--active' : ''}${extraCls}`;
      if (article.href) {
        return `<a class="${cls}" href="${article.href}" data-slug="${article.slug ?? ''}">
                   ${docIcon}<span class="sg-side-nav__doc-label">${article.title}</span>
                 </a>`;
      }
      return `<button class="${cls}"
                       data-slug="${article.slug ?? ''}"
                       data-object-id="${article.content_object_id ?? ''}"
                       data-render="${article.render ?? 'markdown'}"
                       data-schema="${article.schema ?? ''}"
                       data-title="${article.title}"
                       data-section="${sectionTitle}"
                       data-parent-title="${parentTitle}"
                       data-vault-id="${article.vault_id ?? ''}"
                       data-read-key="${article.read_key ?? ''}">
                ${docIcon}<span class="sg-side-nav__doc-label">${article.title}</span>
              </button>`;
    };

    // Article folder (parent article with children[])
    const renderArticleFolder = (article, sectionTitle) => {
      const folderKey   = article.slug ?? article.title;
      const isCollapsed = this._collapsedFolders.has(folderKey);
      const isActive    = article.slug === activeSlug;
      const children    = article.children ?? [];

      const childDocs = children.map(c => {
        const childSlug = _compoundSlug(article.slug, c.slug);
        return renderDoc({ ...c, slug: childSlug }, sectionTitle, ' sg-side-nav__doc--child', article.title);
      }).join('');

      // Title row: button if article has its own content, else plain label
      const titleEl = article.content_object_id
        ? `<button class="sg-side-nav__doc sg-side-nav__doc--folder-title${isActive ? ' sg-side-nav__doc--active' : ''}"
                           data-slug="${article.slug ?? ''}"
                           data-object-id="${article.content_object_id}"
                           data-render="${article.render ?? 'markdown'}"
                           data-schema="${article.schema ?? ''}"
                           data-title="${article.title}"
                           data-section="${sectionTitle}"
                           data-parent-title=""
                           data-vault-id="${article.vault_id ?? ''}"
                           data-read-key="${article.read_key ?? ''}">
                    <span class="sg-side-nav__doc-label">${article.title}</span>
                  </button>`
        : `<span class="sg-side-nav__article-folder-label"
                  data-article-folder-key="${folderKey}">${article.title}</span>`;

      return `
        <div class="sg-side-nav__article-folder">
          <div class="sg-side-nav__article-folder-hd">
            <span class="sg-side-nav__chev${isCollapsed ? '' : ' sg-side-nav__chev--open'}"
                  data-article-chev="${folderKey}">
              ${chevronSvg}
            </span>
            ${folderIcon}
            ${titleEl}
          </div>
          ${isCollapsed ? '' : `<div class="sg-side-nav__grandchildren">${childDocs}</div>`}
        </div>`;
    };

    // ── Build section tree ────────────────────────────────────────────────
    const tree = sections.map((section, i) => {
      const collapsed   = this._collapsed.has(i);
      const articles    = section._loadedArticles ?? section.articles ?? [];
      const sectionSlug = section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');

      // Trigger lazy load for vault-backed sections
      if (!collapsed && section.nav_object_id && !section._loadedArticles && !section._loading && !section._loadError) {
        this._loadSection(section, sections);
      }

      let docsHtml;
      if (!collapsed && section.nav_object_id && section._loading) {
        docsHtml = `<span class="sg-side-nav__loading">Loading…</span>`;
      } else if (!collapsed && section.nav_object_id && section._loadError) {
        docsHtml = `<span class="sg-side-nav__load-error">Failed to load</span>`;
      } else {
        docsHtml = articles.map(article => {
          const children = article.children ?? [];
          return children.length
            ? renderArticleFolder(article, section.title)
            : renderDoc(article, section.title);
        }).join('');
      }

      return `
        <div class="sg-side-nav__section" data-section-index="${i}">
          <div class="sg-side-nav__folder" data-index="${i}">
            <span class="sg-side-nav__chev${collapsed ? '' : ' sg-side-nav__chev--open'}" data-chev="${i}">
              ${chevronSvg}
            </span>
            ${folderIcon}
            <span class="sg-side-nav__folder-label"
                  data-section-title="${section.title}"
                  data-section-slug="${sectionSlug}">${section.title}</span>
          </div>
          ${collapsed ? '' : `<div class="sg-side-nav__children">${docsHtml}</div>`}
        </div>`;
    }).join('');

    const footer = version ? `
      <div class="sg-side-nav__footer">
        <span class="sg-side-nav__version">${version} · ${env}</span>
      </div>` : '';

    const homeHref  = this.getAttribute('home-href') ?? '';
    const homeLabel = treeLabel || 'Home';
    const homeLink  = homeHref
      ? `<a class="sg-side-nav__home" href="${homeHref}">← ${homeLabel}</a>`
      : '';

    this.innerHTML = `
      <button class="sg-side-nav__toggle" title="Toggle sidebar" aria-label="Toggle sidebar"></button>
      ${homeLink}
      <div class="sg-side-nav__header">
        ${treeLabel.toUpperCase()} TREE
        <span class="sg-side-nav__count">${totalArticles}</span>
      </div>
      ${tree || '<p class="sg-side-nav__empty">No articles yet.</p>'}
      ${footer}`;

    // ── Event handlers ────────────────────────────────────────────────────

    // Sidebar panel toggle
    this.querySelector('.sg-side-nav__toggle')?.addEventListener('click', () => {
      const shell = this.closest('.sub-site');
      if (!shell) return;
      const collapsed = shell.classList.toggle('nav-collapsed');
      localStorage.setItem('sg-nav-collapsed', collapsed);
    });

    // Section chevron: toggle section expand/collapse
    this.querySelectorAll('[data-chev]').forEach(chev => {
      chev.addEventListener('click', e => {
        e.stopPropagation();
        const idx = parseInt(chev.dataset.chev, 10);
        if (this._collapsed.has(idx)) this._collapsed.delete(idx);
        else this._collapsed.add(idx);
        this._render(sections);
      });
    });

    // Section folder label: expand section + fire nav:section
    this.querySelectorAll('.sg-side-nav__folder-label').forEach(label => {
      label.addEventListener('click', () => {
        const idx = sections.findIndex(s => s.title === label.dataset.sectionTitle);
        if (idx >= 0) this._collapsed.delete(idx);
        this._render(sections);
        this.dispatchEvent(new CustomEvent('nav:section', {
          bubbles: true,
          detail: { title: label.dataset.sectionTitle, sectionSlug: label.dataset.sectionSlug },
        }));
      });
    });

    // Article folder chevron: toggle article-folder expand/collapse
    this.querySelectorAll('[data-article-chev]').forEach(chev => {
      chev.addEventListener('click', e => {
        e.stopPropagation();
        const key = chev.dataset.articleChev;
        if (this._collapsedFolders.has(key)) this._collapsedFolders.delete(key);
        else this._collapsedFolders.add(key);
        this._render(sections);
      });
    });

    // Article folder label (no content — label-only parent): toggle on click
    this.querySelectorAll('[data-article-folder-key]').forEach(label => {
      label.addEventListener('click', () => {
        const key = label.dataset.articleFolderKey;
        if (this._collapsedFolders.has(key)) this._collapsedFolders.delete(key);
        else this._collapsedFolders.add(key);
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
            schema:            btn.dataset.schema   || null,
            sectionTitle:      btn.dataset.section ?? '',
            parentTitle:       btn.dataset.parentTitle || null,
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
              schema:            target.dataset.schema   || null,
              sectionTitle:      target.dataset.section ?? '',
              parentTitle:       target.dataset.parentTitle || null,
              vault_id:          target.dataset.vaultId || null,
              read_key:          target.dataset.readKey || null,
            },
          }));
        }
      }
    }
  }
}

// Build compound slug: prefix child slug with parent slug if not already prefixed
function _compoundSlug(parentSlug, childSlug) {
  if (!childSlug || !parentSlug) return childSlug;
  return childSlug.startsWith(parentSlug + '/') ? childSlug : `${parentSlug}/${childSlug}`;
}

customElements.define('sg-side-nav', SgSideNav);
