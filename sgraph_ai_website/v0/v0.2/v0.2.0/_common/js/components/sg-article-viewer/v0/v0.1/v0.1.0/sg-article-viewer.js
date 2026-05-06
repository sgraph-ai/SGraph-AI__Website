/**
 * sg-article-viewer v0.1.0
 *
 * Full content pipeline: vault fetch → frontmatter parse → viewer render.
 *
 * Attributes:
 *   vault-id   — content vault id
 *   read-key   — base64url AES-256-GCM read key
 *   object-id  — vault object id of the markdown file
 *
 * Frontmatter keys:
 *   viewer: article (default) | <future types>
 *   title, author, date, status, tags
 *
 * vault: image URIs:  ![alt](vault:obj-cas-imm-...)  resolved async after render.
 *
 * Fires viewer:rendered on document with detail: { meta }
 */
class SgArticleViewer extends HTMLElement {
  static get observedAttributes() {
    return ['vault-id', 'read-key', 'object-id'];
  }

  connectedCallback()          { this._load(); }
  attributeChangedCallback()   { this._load(); }
  disconnectedCallback()       { this._revokeBlobUrls(); }

  async _load() {
    const vaultId  = this.getAttribute('vault-id');
    const readKey  = this.getAttribute('read-key');
    const objectId = this.getAttribute('object-id');
    if (!vaultId || !readKey || !objectId) return;

    this.innerHTML = '<div class="article-loading" aria-live="polite">Loading…</div>';

    try {
      const { importReadKey, readObject } =
        await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
      const cryptoKey = await importReadKey(readKey);
      const buf = await readObject('https://send.sgraph.ai', vaultId, objectId, cryptoKey);
      const text = new TextDecoder().decode(buf);

      const { meta, body } = parseFrontmatter(text);
      const viewer = meta.viewer ?? 'article';

      if (viewer === 'article') {
        await this._renderArticle(meta, body, vaultId, readKey);
      } else {
        this.innerHTML = `<p class="article-error">Unknown viewer: "${viewer}"</p>`;
      }
    } catch (err) {
      this.innerHTML = `<p class="article-error">Failed to load content.</p>`;
      console.error('sg-article-viewer:', err);
    }
  }

  async _renderArticle(meta, body, vaultId, readKey) {
    const { marked } = await import('https://cdn.jsdelivr.net/npm/marked@9/+esm');

    const renderer = new marked.Renderer();
    const origImage = renderer.image.bind(renderer);
    renderer.image = function (href, title, text) {
      if (typeof href === 'object' && href !== null) {
        title = href.title;
        text  = href.text;
        href  = href.href;
      }
      if (href && href.startsWith('vault:')) {
        const objId = href.slice(6).trim();
        const titleAttr = title ? ` title="${escHtml(title)}"` : '';
        return `<figure class="article-figure">` +
               `<img class="article-img article-img--loading"` +
               ` data-vault-obj="${escHtml(objId)}"` +
               ` alt="${escHtml(text)}"${titleAttr}>` +
               (title ? `<figcaption class="article-figcaption">${escHtml(title)}</figcaption>` : '') +
               `</figure>`;
      }
      return origImage(href, title, text);
    };

    marked.use({ renderer });

    const metaHtml  = renderMetaStrip(meta);
    const bodyHtml  = marked.parse(body);

    this.innerHTML = `
      <div class="article-viewer">
        ${metaHtml}
        <div class="article-body">${bodyHtml}</div>
      </div>`;

    document.dispatchEvent(new CustomEvent('viewer:rendered', {
      detail: { meta },
    }));

    this._resolveVaultImages(vaultId, readKey);
  }

  _blobUrls = [];

  async _resolveVaultImages(vaultId, readKey) {
    const imgs = Array.from(this.querySelectorAll('img[data-vault-obj]'));
    if (!imgs.length) return;

    const { importReadKey, readObject } =
      await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
    const cryptoKey = await importReadKey(readKey);

    await Promise.allSettled(imgs.map(async img => {
      const objId = img.dataset.vaultObj;
      try {
        const buf  = await readObject('https://send.sgraph.ai', vaultId, objId, cryptoKey);
        const mime = sniffMime(new Uint8Array(buf));
        const blob = new Blob([buf], { type: mime });
        const url  = URL.createObjectURL(blob);
        this._blobUrls.push(url);
        img.src = url;
        img.classList.remove('article-img--loading');
        img.classList.add('article-img--loaded');
      } catch (_) {
        img.classList.remove('article-img--loading');
        img.classList.add('article-img--error');
        img.alt = `[Image unavailable: ${objId}]`;
      }
    }));
  }

  _revokeBlobUrls() {
    this._blobUrls.forEach(u => URL.revokeObjectURL(u));
    this._blobUrls = [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseFrontmatter(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const m  = text.match(fm);
  if (!m) return { meta: {}, body: text };

  const meta = {};
  for (const line of m[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 1) continue;
    const key = line.slice(0, colon).trim();
    let   val = line.slice(colon + 1).trim();
    if (val.startsWith('[') && val.endsWith(']')) {
      meta[key] = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean);
    } else {
      meta[key] = val;
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

function renderMetaStrip(meta) {
  const parts = [];

  if (meta.author) {
    parts.push(`<span class="article-meta__author">${escHtml(meta.author)}</span>`);
  }
  if (meta.date) {
    const d = new Date(meta.date);
    const fmt = isNaN(d.getTime())
      ? escHtml(meta.date)
      : d.toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    parts.push(`<span class="article-meta__date">${fmt}</span>`);
  }
  if (meta.status) {
    const s = escHtml(meta.status.toLowerCase());
    parts.push(`<span class="article-meta__status article-meta__status--${s}">${escHtml(meta.status)}</span>`);
  }
  if (Array.isArray(meta.tags) && meta.tags.length) {
    const pills = meta.tags.map(t =>
      `<span class="article-meta__tag">${escHtml(t)}</span>`
    ).join('');
    parts.push(`<span class="article-meta__tags">${pills}</span>`);
  } else if (typeof meta.tags === 'string' && meta.tags) {
    parts.push(`<span class="article-meta__tags"><span class="article-meta__tag">${escHtml(meta.tags)}</span></span>`);
  }

  if (!parts.length) return '';
  return `<div class="article-meta">${parts.join('<span class="article-meta__sep">·</span>')}</div>`;
}

function sniffMime(bytes) {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'image/gif';
  if (bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  return 'application/octet-stream';
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

customElements.define('sg-article-viewer', SgArticleViewer);
