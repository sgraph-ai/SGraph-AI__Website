/**
 * sg-search  — fractal graph search engine
 *
 * Each search node is a JSON file with the same shape:
 *   { v, id, label, keys[], children[{ keys[], label, ref }], articles[{ slug, title, keys[], snippet }] }
 *
 * The client loads only the nodes whose keys match the query (lazy, parallel).
 * Fuse.js is lazy-loaded from vendor/fuse.js on first keypress.
 *
 * Attributes:
 *   root-url   — URL (absolute path) to the root node JSON, e.g. /en-gb/library/search/root.json
 *   vault-id   — vault ID used when ref looks like "obj-cas-imm-*"
 *   read-key   — base64url read key used for vault node decryption
 *   placeholder — input placeholder text (default "Search…")
 *
 * Events dispatched on document:
 *   nav:select  — { slug, title, ... } when user picks a result
 */

const FUSE_URL = new URL(
  '../../../../../vendor/fuse.js',
  import.meta.url
).href;

const IV_LEN = 12;

let _fuseClass = null;
async function loadFuse() {
  if (_fuseClass) return _fuseClass;
  const { default: Fuse } = await import(FUSE_URL);
  _fuseClass = Fuse;
  return Fuse;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlight(text, query) {
  if (!query || !text) return escHtml(text);
  const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').split(/\s+/).filter(Boolean).join('|')})`, 'gi');
  return escHtml(text).replace(re, '<mark>$1</mark>');
}

class SgSearch extends HTMLElement {
  static get observedAttributes() {
    return ['root-url', 'vault-id', 'read-key', 'placeholder'];
  }

  _nodeCache  = new Map();  // url/id → node object
  _cryptoKey  = null;       // CryptoKey for vault node decryption
  _rootNode   = null;
  _overlay    = null;
  _input      = null;
  _resultsList = null;
  _debounce   = null;
  _currentQuery = '';
  _keyHandler = null;

  connectedCallback() {
    this._injectStyles();
    this._buildTrigger();
    this._keyHandler = e => {
      // '/' outside inputs opens overlay
      if (e.key === '/' && !['INPUT','TEXTAREA'].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        this._open();
      }
    };
    document.addEventListener('keydown', this._keyHandler);

    // Bridge: sg-sub-nav dispatches sub-nav:search when the header search bar is used
    this._subNavSearchHandler = e => {
      const query = e.detail?.query ?? '';
      if (!this._overlay) this._open();
      if (this._input) {
        this._input.value = query;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._runSearch(query.trim()), 180);
      }
    };
    document.addEventListener('sub-nav:search', this._subNavSearchHandler);

    this._openHandler = () => this._open();
    this.addEventListener('sg-search:open', this._openHandler);

    // Eagerly warm the root node (it's tiny)
    this._loadRootNode();
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this._keyHandler);
    document.removeEventListener('sub-nav:search', this._subNavSearchHandler);
    this.removeEventListener('sg-search:open', this._openHandler);
    this._overlay?.remove();
  }

  attributeChangedCallback() {
    this._cryptoKey = null; // invalidate key cache on attr change
  }

  // ── Public ─────────────────────────────────────────────────

  open()  { this._open(); }
  close() { this._close(); }

  // ── UI ─────────────────────────────────────────────────────

  _buildTrigger() {
    this.innerHTML = `<button class="sg-search__trigger" aria-label="Open search">
      <svg class="sg-search__icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="8.5" cy="8.5" r="5.5"/>
        <line x1="13" y1="13" x2="18" y2="18"/>
      </svg>
      <span class="sg-search__trigger-text">Search</span>
      <kbd class="sg-search__kbd">/</kbd>
    </button>`;
    this.querySelector('.sg-search__trigger').addEventListener('click', () => this._open());
  }

  _open() {
    if (this._overlay) return;

    const overlay = document.createElement('div');
    overlay.className = 'sg-search__overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Search library');
    overlay.innerHTML = `
      <div class="sg-search__backdrop"></div>
      <div class="sg-search__modal">
        <div class="sg-search__input-row">
          <svg class="sg-search__modal-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="8.5" cy="8.5" r="5.5"/>
            <line x1="13" y1="13" x2="18" y2="18"/>
          </svg>
          <input class="sg-search__input"
            type="search"
            autocomplete="off"
            spellcheck="false"
            placeholder="${escHtml(this.getAttribute('placeholder') || 'Search…')}"
          />
          <button class="sg-search__close-btn" aria-label="Close search">
            <kbd>ESC</kbd>
          </button>
        </div>
        <div class="sg-search__results-wrap">
          <ul class="sg-search__results" role="listbox" aria-label="Search results"></ul>
          <div class="sg-search__hint">Start typing to search across all library articles</div>
        </div>
      </div>`;

    document.body.appendChild(overlay);
    this._overlay     = overlay;
    this._input       = overlay.querySelector('.sg-search__input');
    this._resultsList = overlay.querySelector('.sg-search__results');

    overlay.querySelector('.sg-search__backdrop').addEventListener('click', () => this._close());
    overlay.querySelector('.sg-search__close-btn').addEventListener('click', () => this._close());

    overlay.addEventListener('keydown', e => {
      if (e.key === 'Escape') { this._close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); this._moveFocus(1); return; }
      if (e.key === 'ArrowUp')   { e.preventDefault(); this._moveFocus(-1); return; }
      if (e.key === 'Enter') {
        const focused = overlay.querySelector('[data-slug]:focus');
        if (focused) this._pick(focused.dataset);
      }
    });

    this._input.addEventListener('input', () => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => this._runSearch(this._input.value.trim()), 180);
    });

    requestAnimationFrame(() => this._input.focus());
  }

  _close() {
    this._overlay?.remove();
    this._overlay = null;
    this._input = null;
    this._resultsList = null;
    this._currentQuery = '';
  }

  _moveFocus(dir) {
    const items = [...(this._resultsList?.querySelectorAll('[data-slug]') ?? [])];
    if (!items.length) return;
    const idx = items.indexOf(document.activeElement);
    const next = items[Math.max(0, Math.min(items.length - 1, idx + dir))];
    next?.focus();
  }

  _pick(dataset) {
    const { slug, title, sectionTitle } = dataset;
    this._close();
    document.dispatchEvent(new CustomEvent('nav:select', {
      bubbles: true,
      detail: { slug, title, sectionTitle: sectionTitle || '', parentTitle: null,
                content_object_id: dataset.objectId || null,
                render: dataset.render || 'markdown',
                vault_id: dataset.vaultId || null,
                read_key: dataset.readKey || null }
    }));
  }

  // ── Search ─────────────────────────────────────────────────

  async _runSearch(query) {
    if (!this._resultsList) return;
    if (!query) {
      this._resultsList.innerHTML = '';
      this._overlay.querySelector('.sg-search__hint').hidden = false;
      return;
    }
    this._overlay.querySelector('.sg-search__hint').hidden = true;
    this._currentQuery = query;

    this._resultsList.innerHTML = '<li class="sg-search__loading">Searching…</li>';

    let root, results;
    try {
      root = await this._loadRootNode();
      if (!root) throw new Error('search index unavailable');
      results = await this._searchNode(query, root, 0, new Set());
    } catch (err) {
      console.error('[sg-search]', err);
      if (this._resultsList) {
        this._resultsList.innerHTML = `<li class="sg-search__empty">Search unavailable — ${escHtml(err.message)}</li>`;
      }
      return;
    }

    if (this._currentQuery !== query) return; // stale (new query arrived while searching)

    // Deduplicate by slug, preserve best (lowest) score
    const seen = new Map();
    for (const r of results) {
      const prev = seen.get(r.slug);
      if (!prev || r._score < prev._score) seen.set(r.slug, r);
    }
    const deduped = [...seen.values()].sort((a, b) => (a._score ?? 1) - (b._score ?? 1));

    if (!deduped.length) {
      this._resultsList.innerHTML = `<li class="sg-search__empty">No results for <strong>${escHtml(query)}</strong></li>`;
      return;
    }

    this._resultsList.innerHTML = deduped.slice(0, 12).map(r => `
      <li class="sg-search__result">
        <button class="sg-search__result-btn"
          role="option"
          data-slug="${escHtml(r.slug)}"
          data-title="${escHtml(r.title)}"
          data-section-title="${escHtml(r.sectionTitle ?? r._nodeLabel ?? '')}"
          ${r.object_id  ? `data-object-id="${escHtml(r.object_id)}"` : ''}
          ${r.vault_id   ? `data-vault-id="${escHtml(r.vault_id)}"` : ''}
          ${r.read_key   ? `data-read-key="${escHtml(r.read_key)}"` : ''}
          ${r.render     ? `data-render="${escHtml(r.render)}"` : ''}
        >
          <span class="sg-search__result-title">${highlight(r.title, query)}</span>
          ${r._nodeLabel ? `<span class="sg-search__result-section">${escHtml(r._nodeLabel)}</span>` : ''}
          ${r.snippet    ? `<span class="sg-search__result-snippet">${highlight(r.snippet, query)}</span>` : ''}
        </button>
      </li>`).join('');

    this._resultsList.querySelectorAll('[data-slug]').forEach(btn => {
      btn.addEventListener('click', () => this._pick(btn.dataset));
      btn.addEventListener('keydown', e => {
        if (e.key === 'Enter') this._pick(btn.dataset);
      });
    });
  }

  async _searchNode(query, node, depth, visited) {
    if (!node || visited.has(node.id)) return [];
    visited.add(node.id);

    const Fuse = await loadFuse();
    const results = [];

    // Search articles at this node
    if (node.articles?.length) {
      const fuse = new Fuse(node.articles, {
        keys: [
          { name: 'title',   weight: 3 },
          { name: 'keys',    weight: 2 },
          { name: 'snippet', weight: 1 },
        ],
        threshold: 0.45,
        includeScore: true,
        useExtendedSearch: false,
      });
      for (const { item, score } of fuse.search(query)) {
        results.push({ ...item, _score: score ?? 0, _nodeLabel: node.label });
      }
    }

    // Recurse into matching children (max depth 4, max 3 branches per level)
    if (depth < 4 && node.children?.length) {
      const childFuse = new Fuse(node.children, {
        keys: [
          { name: 'keys',  weight: 2 },
          { name: 'label', weight: 1 },
        ],
        threshold: 0.5,
        includeScore: true,
      });
      const matching = childFuse.search(query).slice(0, 3);

      const childResults = await Promise.all(
        matching.map(({ item }) =>
          this._loadNode(item.ref)
            .then(child => child ? this._searchNode(query, child, depth + 1, visited) : [])
            .catch(() => [])
        )
      );
      for (const cr of childResults) results.push(...cr);
    }

    return results;
  }

  // ── Node loading ───────────────────────────────────────────

  async _loadRootNode() {
    if (this._rootNode) return this._rootNode;
    const url = this.getAttribute('root-url');
    if (!url) return null;
    const node = await this._loadNode(url);
    this._rootNode = node;
    return node;
  }

  async _loadNode(ref) {
    if (!ref) return null;
    if (this._nodeCache.has(ref)) return this._nodeCache.get(ref);

    let node;
    if (ref.startsWith('/') || ref.startsWith('http')) {
      // Plain JSON fetch (stub / dev mode)
      const res = await fetch(ref);
      if (!res.ok) throw new Error(`search node fetch failed: ${res.status} ${ref}`);
      node = await res.json();
    } else {
      // Vault object
      node = await this._loadVaultNode(ref);
    }

    this._nodeCache.set(ref, node);
    return node;
  }

  async _loadVaultNode(objectId) {
    const vaultId = this.getAttribute('vault-id');
    const readKey = this.getAttribute('read-key');
    if (!vaultId || !readKey) throw new Error('sg-search: vault-id and read-key required for vault nodes');

    const { fileIdToPath } = await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
    const url = `https://send.sgraph.ai/api/vault/read/${vaultId}/${encodeURIComponent(fileIdToPath(objectId))}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`vault node ${objectId}: ${resp.status}`);
    const encrypted = await resp.arrayBuffer();

    if (!this._cryptoKey) {
      const raw = Uint8Array.from(atob(readKey.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0));
      this._cryptoKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    }

    const data = new Uint8Array(encrypted);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, IV_LEN) },
      this._cryptoKey,
      data.slice(IV_LEN)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  }

  // ── Styles ─────────────────────────────────────────────────

  _injectStyles() {
    if (document.getElementById('sg-search-styles')) return;
    const s = document.createElement('style');
    s.id = 'sg-search-styles';
    s.textContent = `
/* ── trigger ─────────────────────────────────────── */
sg-search { display: block; }
.sg-search__trigger {
  display: flex; align-items: center; gap: 0.375rem;
  width: 100%; padding: 0.45rem 0.625rem;
  background: rgba(255,255,255,0.55);
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 0.375rem;
  font-size: 0.8rem; color: #6b7280;
  cursor: pointer; font-family: inherit;
  transition: background 0.15s, border-color 0.15s;
}
.sg-search__trigger:hover {
  background: rgba(255,255,255,0.85);
  border-color: rgba(0,0,0,0.2);
  color: #374151;
}
.sg-search__icon { width: 14px; height: 14px; flex-shrink: 0; }
.sg-search__trigger-text { flex: 1; text-align: left; }
.sg-search__kbd {
  font-family: ui-monospace, monospace; font-size: 0.65rem;
  border: 1px solid rgba(0,0,0,0.15); border-radius: 0.2rem;
  padding: 0.05rem 0.3rem; color: #9ca3af; background: rgba(0,0,0,0.04);
}

/* ── overlay ─────────────────────────────────────── */
.sg-search__overlay {
  position: fixed; inset: 0; z-index: 9000;
  display: flex; align-items: flex-start; justify-content: center;
  padding-top: 10vh;
}
.sg-search__backdrop {
  position: absolute; inset: 0;
  background: rgba(0,0,0,0.45); backdrop-filter: blur(2px);
}
.sg-search__modal {
  position: relative; z-index: 1;
  width: min(680px, calc(100vw - 2rem));
  background: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 25px 60px rgba(0,0,0,0.25);
  overflow: hidden;
  animation: sg-search-in 0.15s ease;
}
@keyframes sg-search-in {
  from { opacity: 0; transform: translateY(-12px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}

/* ── input row ───────────────────────────────────── */
.sg-search__input-row {
  display: flex; align-items: center; gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-bottom: 1px solid #f3f4f6;
}
.sg-search__modal-icon { width: 18px; height: 18px; color: #9ca3af; flex-shrink: 0; }
.sg-search__input {
  flex: 1; border: none; outline: none;
  font-size: 1rem; font-family: inherit; color: #111827;
  background: transparent;
}
.sg-search__input::placeholder { color: #d1d5db; }
.sg-search__input::-webkit-search-cancel-button { display: none; }
.sg-search__close-btn {
  background: none; border: 1px solid #e5e7eb; border-radius: 0.25rem;
  padding: 0.1rem 0.35rem; cursor: pointer; color: #9ca3af;
  font-size: 0.7rem; font-family: ui-monospace, monospace;
  transition: border-color 0.15s; flex-shrink: 0;
}
.sg-search__close-btn:hover { border-color: #9ca3af; color: #6b7280; }

/* ── results ─────────────────────────────────────── */
.sg-search__results-wrap { max-height: min(480px, 60vh); overflow-y: auto; }
.sg-search__results { list-style: none; margin: 0; padding: 0.375rem 0; }
.sg-search__hint {
  padding: 1.25rem 1rem;
  font-size: 0.8rem; color: #9ca3af; text-align: center;
}
.sg-search__loading {
  padding: 1rem 1rem; font-size: 0.8rem; color: #9ca3af;
  list-style: none; text-align: center;
}
.sg-search__empty {
  padding: 1.25rem 1rem; font-size: 0.875rem; color: #6b7280;
  list-style: none; text-align: center;
}
.sg-search__result { list-style: none; }
.sg-search__result-btn {
  display: flex; flex-direction: column; gap: 0.15rem;
  width: 100%; padding: 0.6rem 1rem;
  background: none; border: none; cursor: pointer;
  text-align: left; font-family: inherit;
  transition: background 0.1s;
}
.sg-search__result-btn:hover,
.sg-search__result-btn:focus {
  background: #f9fafb; outline: none;
}
.sg-search__result-btn:focus { background: #eff6ff; }
.sg-search__result-title {
  font-size: 0.9rem; font-weight: 500; color: #111827; line-height: 1.3;
}
.sg-search__result-title mark {
  background: #fef08a; color: inherit; border-radius: 0.1rem; padding: 0 0.1rem;
}
.sg-search__result-section {
  font-size: 0.7rem; color: #9ca3af; font-weight: 400;
}
.sg-search__result-snippet {
  font-size: 0.78rem; color: #6b7280; line-height: 1.4;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}
.sg-search__result-snippet mark {
  background: #fef9c3; color: inherit; border-radius: 0.1rem; padding: 0 0.1rem;
}
`;
    document.head.appendChild(s);
  }
}

customElements.define('sg-search', SgSearch);
