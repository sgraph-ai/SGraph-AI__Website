/**
 * sg-article-viewer v0.2.0
 *
 * Full content pipeline: vault fetch → frontmatter parse → viewer render.
 * Includes three-layer interactive loading UX:
 *   Layer 1 — deterministic progress bar, visible during load only
 *   Layer 2 — load summary panel, opened via reopener button after load
 *   Layer 3 — full request trace modal with timeline, opened from Layer 2
 *
 * Attributes:
 *   vault-id   — content vault id
 *   read-key   — base64url AES-256-GCM read key
 *   object-id  — vault object id of the content file
 *   render     — hint for content type: 'markdown' (default) | 'json'
 *                Overridden by frontmatter 'viewer' key if present.
 *
 * Frontmatter keys:
 *   viewer: article (default) | <future types>
 *   title, author, date, status, tags
 *
 * vault: image URIs:  ![alt](vault:obj-cas-imm-...)  resolved async after render.
 *
 * Token replacement (Option 2 — pre-processing pass before marked):
 *   {{screenshot: id | title | description | dimensions}}
 *   e.g. {{screenshot: settings-code-exec | Claude Settings | Toggle ON | 800x500}}
 *
 * Fires viewer:rendered on document with detail: { meta }
 */
class SgArticleViewer extends HTMLElement {
  static get observedAttributes() {
    return ['vault-id', 'read-key', 'object-id', 'render'];
  }

  // ── Styles injection ────────────────────────────────────────────────────────

  static _stylesInjected = false;

  static _injectStyles() {
    if (SgArticleViewer._stylesInjected) return;
    SgArticleViewer._stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
/* ── sg-article-viewer loading UX (v0.2.0) ───────────────────────── */

/* Layer 1 — progress bar */
.sg-av-l1 {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 4rem 2rem;
  min-height: 200px;
  transition: opacity 0.2s ease;
}
.sg-av-l1__bar-track {
  width: 240px;
  height: 3px;
  background: rgba(0,0,0,0.08);
  border-radius: 2px;
  overflow: hidden;
}
.sg-av-l1__bar {
  height: 100%;
  background: #3b82f6;
  border-radius: 2px;
  transition: width 0.45s cubic-bezier(0.4,0,0.2,1);
}
.sg-av-l1__label {
  font-size: 0.8125rem;
  color: #9ca3af;
  letter-spacing: 0.01em;
}

/* Reopener */
.sg-av__reopener {
  position: fixed;
  bottom: 14px;
  right: calc(14px + 26px + 8px);
  font-size: 0.75rem;
  color: #6b7280;
  background: rgba(255,255,255,0.9);
  border: 1px solid #e5e7eb;
  backdrop-filter: blur(4px);
  cursor: pointer;
  padding: 0.375rem 0.625rem;
  border-radius: 0.5rem;
  opacity: 0;
  transition: opacity 0.4s ease, background 0.15s ease, box-shadow 0.15s ease;
  z-index: 50;
  font-family: inherit;
  letter-spacing: 0.01em;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
}
.sg-av__reopener.sg-av__reopener--visible { opacity: 0.55; }
.sg-av__reopener:hover { opacity: 1 !important; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }

/* Layer 2 — summary panel */
.sg-av__layer2 {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 340px;
  background: #fff;
  border-left: 1px solid #e5e7eb;
  box-shadow: -4px 0 32px rgba(0,0,0,0.08);
  z-index: 100;
  display: flex;
  flex-direction: column;
  font-size: 0.8125rem;
  animation: sg-av-slide-in 0.2s ease;
  overflow: hidden;
}
@keyframes sg-av-slide-in {
  from { transform: translateX(100%); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}
.sg-av-l2__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}
.sg-av-l2__title {
  font-weight: 600;
  font-size: 0.875rem;
  color: #111827;
}
.sg-av-l2__close {
  background: none;
  border: none;
  cursor: pointer;
  color: #9ca3af;
  font-size: 1rem;
  padding: 0.25rem 0.5rem;
  border-radius: 0.25rem;
  transition: color 0.15s, background 0.15s;
  line-height: 1;
}
.sg-av-l2__close:hover { color: #374151; background: #f3f4f6; }
.sg-av-l2__meta {
  padding: 0.875rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}
.sg-av-l2__meta > div { display: flex; gap: 0.5rem; align-items: baseline; }
.sg-av-l2__key { color: #9ca3af; min-width: 76px; flex-shrink: 0; }
.sg-av-l2__val { color: #374151; word-break: break-all; }
.sg-av-l2__val--mono { font-family: ui-monospace, monospace; font-size: 0.725rem; }
.sg-av-l2__steps {
  width: 100%;
  border-collapse: collapse;
  flex-shrink: 0;
}
.sg-av-l2__steps th {
  text-align: left;
  padding: 0.5rem 1.25rem;
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #9ca3af;
  border-bottom: 1px solid #f3f4f6;
  font-weight: 600;
}
.sg-av-l2__steps td {
  padding: 0.4375rem 1.25rem;
  border-bottom: 1px solid #f9fafb;
  color: #374151;
}
.sg-av-l2__step-name { font-family: ui-monospace, monospace; font-size: 0.725rem; }
.sg-av-l2__step-time { color: #6b7280; white-space: nowrap; }
.sg-av-l2__step-size { color: #9ca3af; white-space: nowrap; }
.sg-av-l2__badges {
  padding: 0.75rem 1.25rem;
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  flex-shrink: 0;
}
.sg-av-l2__badge {
  font-size: 0.75rem;
  padding: 0.25rem 0.625rem;
  border-radius: 0.375rem;
}
.sg-av-l2__badge--ok  { background: #f0fdf4; color: #16a34a; }
.sg-av-l2__badge--err { background: #fef2f2; color: #dc2626; }
.sg-av-l2__footer {
  padding: 0.875rem 1.25rem;
  border-top: 1px solid #f3f4f6;
  display: flex;
  justify-content: flex-end;
  margin-top: auto;
  flex-shrink: 0;
}
.sg-av-l2__trace-btn {
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  padding: 0.375rem 0.75rem;
  font-size: 0.8125rem;
  cursor: pointer;
  color: #374151;
  transition: background 0.15s, border-color 0.15s;
  font-family: inherit;
}
.sg-av-l2__trace-btn:hover { background: #f9fafb; border-color: #d1d5db; }

/* Layer 2 mobile: bottom sheet */
@media (max-width: 640px) {
  .sg-av__layer2 {
    top: auto; right: 0; left: 0; bottom: 0;
    width: 100%; max-height: 80vh;
    border-left: none; border-top: 1px solid #e5e7eb;
    border-radius: 1rem 1rem 0 0;
    box-shadow: 0 -4px 32px rgba(0,0,0,0.1);
    animation: sg-av-slide-up 0.2s ease;
    overflow-y: auto;
  }
  @keyframes sg-av-slide-up {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
}

/* Layer 3 — full trace modal */
.sg-av__layer3 {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.45);
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
  animation: sg-av-fade-in 0.15s ease;
}
@keyframes sg-av-fade-in {
  from { opacity: 0; }
  to   { opacity: 1; }
}
.sg-av-l3__dialog {
  background: #fff;
  border-radius: 0.75rem;
  box-shadow: 0 24px 64px rgba(0,0,0,0.18);
  width: 100%;
  max-width: 820px;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.sg-av-l3__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.5rem;
  border-bottom: 1px solid #f3f4f6;
  flex-shrink: 0;
}
.sg-av-l3__title { font-weight: 600; font-size: 0.9375rem; color: #111827; }
.sg-av-l3__toolbar-actions { display: flex; gap: 0.5rem; align-items: center; }
.sg-av-l3__newtab {
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 0.375rem;
  padding: 0.25rem 0.625rem;
  font-size: 0.75rem;
  cursor: pointer;
  color: #6b7280;
  transition: all 0.15s;
  font-family: inherit;
}
.sg-av-l3__newtab:hover { background: #f9fafb; color: #374151; }
.sg-av-l3__close {
  background: none; border: none; cursor: pointer;
  color: #9ca3af; font-size: 1rem;
  padding: 0.25rem 0.5rem; border-radius: 0.25rem;
  transition: color 0.15s, background 0.15s; line-height: 1;
}
.sg-av-l3__close:hover { color: #374151; background: #f3f4f6; }
.sg-av-l3__body {
  overflow-y: auto;
  padding: 1.5rem;
  display: flex;
  flex-direction: column;
  gap: 1.75rem;
}
.sg-av-l3__section { display: flex; flex-direction: column; gap: 0.75rem; }
.sg-av-l3__section-title {
  font-size: 0.6875rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #9ca3af;
  font-weight: 600;
}
.sg-av-l3__tl-scale {
  display: flex;
  justify-content: space-between;
  font-size: 0.6875rem;
  color: #d1d5db;
  padding-left: 116px;
  font-family: ui-monospace, monospace;
  margin-bottom: 0.125rem;
}
.sg-av-l3__tl-row {
  display: grid;
  grid-template-columns: 110px 1fr 56px;
  align-items: center;
  gap: 0.5rem;
}
.sg-av-l3__tl-label {
  font-size: 0.6875rem;
  font-family: ui-monospace, monospace;
  color: #6b7280;
  text-align: right;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sg-av-l3__tl-track {
  position: relative;
  height: 18px;
  background: #f3f4f6;
  border-radius: 3px;
  overflow: hidden;
}
.sg-av-l3__tl-bar {
  position: absolute;
  top: 0;
  height: 100%;
  background: #3b82f6;
  border-radius: 3px;
  min-width: 3px;
}
.sg-av-l3__tl-dur {
  font-size: 0.6875rem;
  font-family: ui-monospace, monospace;
  color: #9ca3af;
  white-space: nowrap;
  text-align: right;
}
.sg-av-l3__obj {
  border: 1px solid #f3f4f6;
  border-radius: 0.5rem;
  overflow: hidden;
}
.sg-av-l3__obj-header {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.5625rem 0.875rem;
  background: #f9fafb;
  flex-wrap: wrap;
}
.sg-av-l3__obj-role {
  font-size: 0.6875rem;
  font-family: ui-monospace, monospace;
  background: #e5e7eb;
  color: #374151;
  padding: 0.125rem 0.375rem;
  border-radius: 0.25rem;
  flex-shrink: 0;
}
.sg-av-l3__obj-id {
  font-size: 0.725rem;
  font-family: ui-monospace, monospace;
  color: #374151;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
.sg-av-l3__obj-size { font-size: 0.6875rem; color: #9ca3af; flex-shrink: 0; }
.sg-av-l3__obj-expand {
  background: none;
  border: 1px solid #e5e7eb;
  border-radius: 0.25rem;
  padding: 0.125rem 0.375rem;
  font-size: 0.6875rem;
  cursor: pointer;
  color: #6b7280;
  white-space: nowrap;
  font-family: inherit;
  transition: all 0.15s;
  flex-shrink: 0;
}
.sg-av-l3__obj-expand:hover { background: #fff; color: #374151; border-color: #d1d5db; }
.sg-av-l3__obj-preview {
  margin: 0;
  padding: 0.75rem 0.875rem;
  font-size: 0.725rem;
  font-family: ui-monospace, monospace;
  white-space: pre-wrap;
  word-break: break-all;
  color: #374151;
  background: #fff;
  border-top: 1px solid #f3f4f6;
  max-height: 280px;
  overflow-y: auto;
  line-height: 1.5;
}
.sg-av-l3__error {
  background: #fef2f2;
  color: #dc2626;
  padding: 0.625rem 0.875rem;
  border-radius: 0.5rem;
  font-size: 0.8125rem;
  font-family: ui-monospace, monospace;
}
`;
    document.head.appendChild(style);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  connectedCallback()        { SgArticleViewer._injectStyles(); this._load(); }
  attributeChangedCallback() { this._load(); }
  disconnectedCallback()     { this._revokeBlobUrls(); }

  // ── State ───────────────────────────────────────────────────────────────────

  _loadSeq = 0;
  _trace = null;
  _contentEl = null;
  _reopenerEl = null;
  _layer1El = null;
  _layer2El = null;
  _reopenerFadeTimer = null;
  _blobUrls = [];

  // ── Structure ───────────────────────────────────────────────────────────────

  _ensureStructure() {
    if (!this._contentEl) {
      this._contentEl = document.createElement('div');
      this._contentEl.className = 'sg-av__content';
      this.appendChild(this._contentEl);
    }
  }

  // ── Load pipeline ───────────────────────────────────────────────────────────

  async _load() {
    const vaultId  = this.getAttribute('vault-id');
    const readKey  = this.getAttribute('read-key');
    const objectId = this.getAttribute('object-id');
    if (!vaultId || !readKey || !objectId) return;

    const seq = ++this._loadSeq;
    this._ensureStructure();

    // Close any open Layer 2
    if (this._layer2El) { this._layer2El.remove(); this._layer2El = null; }

    // Show Layer 1 progress bar
    this._showLayer1();

    // Build trace object
    const t0 = performance.now();
    const trace = {
      vault_id:    vaultId,
      object_id:   objectId,
      resolved_at: null,
      total_ms:    null,
      steps:       [],
      objects:     [],
      errors:      [],
      status:      'loading',
    };

    const stepStart = name => {
      const start_ms = Math.round(performance.now() - t0);
      return (opts = {}) => {
        trace.steps.push({ name, start_ms, end_ms: Math.round(performance.now() - t0), ...opts });
        this._updateLayer1Progress(name);
      };
    };

    try {
      let endStep;

      endStep = stepStart('module-import');
      const { importReadKey, readObject } =
        await import('/core/vault-client/v1/v1.2/v1.2.2/sg-vault-client.js');
      endStep();

      endStep = stepStart('key-import');
      const cryptoKey = await importReadKey(readKey);
      endStep();

      endStep = stepStart('blob-fetch-decrypt');
      const buf = await readObject('https://send.sgraph.ai', vaultId, objectId, cryptoKey);
      const size_bytes = buf.byteLength;
      endStep({ size_bytes });

      if (seq !== this._loadSeq) return;

      const text = new TextDecoder().decode(buf);

      // Capture decrypted content for Layer 3
      trace.objects.push({
        role:       'blob',
        id:         objectId,
        size_bytes,
        preview:    text.slice(0, 1000),
        full_size:  size_bytes,
      });

      endStep = stepStart('parse');
      const { meta, body } = parseFrontmatter(text);
      endStep();

      endStep = stepStart('render');
      const renderHint = this.getAttribute('render') ?? 'markdown';
      const viewer = meta.viewer ?? (renderHint === 'json' ? 'json' : 'article');

      if (viewer === 'article') {
        await this._renderArticle(meta, body, vaultId, readKey);
      } else if (viewer === 'json') {
        this._renderJson(text);
      } else {
        this._contentEl.innerHTML = `<p class="article-error">Unknown viewer: "${viewer}"</p>`;
      }
      endStep();

      trace.status      = 'ok';
      trace.resolved_at = new Date().toISOString();
      trace.total_ms    = Math.round(performance.now() - t0);
      this._trace       = trace;
      this._hideLayer1AndShowReopener();

    } catch (err) {
      if (seq !== this._loadSeq) return;
      const msg = err?.message ?? String(err);
      trace.status   = 'error';
      trace.total_ms = Math.round(performance.now() - t0);
      trace.errors.push(msg);
      this._trace = trace;

      this._contentEl.innerHTML = `<p class="article-error">Failed to load content.</p>`;
      console.error('sg-article-viewer load failed', { objectId, vaultId, err });
      document.dispatchEvent(new CustomEvent('debug:log', {
        detail: { type: 'error', src: 'article-viewer', msg: `${objectId}: ${msg}` },
      }));
      this._hideLayer1AndShowReopener();
    }
  }

  // ── Layer 1 — progress bar ──────────────────────────────────────────────────

  _showLayer1() {
    this._layer1El = document.createElement('div');
    this._layer1El.className = 'sg-av-l1';
    this._layer1El.setAttribute('aria-live', 'polite');
    this._layer1El.innerHTML = `
      <div class="sg-av-l1__bar-track">
        <div class="sg-av-l1__bar" style="width:5%"></div>
      </div>
      <div class="sg-av-l1__label">Connecting…</div>`;
    this._contentEl.innerHTML = '';
    this._contentEl.appendChild(this._layer1El);

    if (this._reopenerEl) {
      this._reopenerEl.textContent = '⬡ loading…';
      clearTimeout(this._reopenerFadeTimer);
    }
  }

  _updateLayer1Progress(completedStep) {
    if (!this._layer1El) return;
    const PHASES = {
      'module-import':      { pct: 20, label: 'Loading vault client…' },
      'key-import':         { pct: 30, label: 'Preparing decryption key…' },
      'blob-fetch-decrypt': { pct: 72, label: 'Fetching and decrypting content…' },
      'parse':              { pct: 83, label: 'Parsing content…' },
      'render':             { pct: 97, label: 'Rendering…' },
    };
    const phase = PHASES[completedStep];
    if (!phase) return;
    const bar   = this._layer1El.querySelector('.sg-av-l1__bar');
    const label = this._layer1El.querySelector('.sg-av-l1__label');
    if (bar)   bar.style.width = phase.pct + '%';
    if (label) label.textContent = phase.label;
  }

  _hideLayer1AndShowReopener() {
    if (this._layer1El) {
      this._layer1El.style.opacity = '0';
      const el = this._layer1El;
      setTimeout(() => { if (el.parentNode) el.remove(); }, 220);
      this._layer1El = null;
    }

    if (!this._reopenerEl) {
      this._reopenerEl = document.createElement('button');
      this._reopenerEl.className = 'sg-av__reopener';
      this._reopenerEl.setAttribute('aria-label', 'Show content load details');
      this.appendChild(this._reopenerEl);
      this._reopenerEl.addEventListener('click', () => this._openLayer2());
    }

    const { total_ms, status } = this._trace ?? {};
    this._reopenerEl.textContent = status === 'ok'
      ? `⬡ loaded in ${(total_ms / 1000).toFixed(1)}s ↗`
      : `⬡ load failed ↗`;

    clearTimeout(this._reopenerFadeTimer);
    this._reopenerEl.classList.add('sg-av__reopener--visible');
    this._reopenerFadeTimer = setTimeout(() => {
      if (this._reopenerEl) this._reopenerEl.classList.remove('sg-av__reopener--visible');
    }, 5000);
  }

  // ── Layer 2 — summary panel ─────────────────────────────────────────────────

  _openLayer2() {
    if (this._layer2El) {
      this._layer2El.remove();
      this._layer2El = null;
      return;
    }

    const trace = this._trace;
    if (!trace) return;

    const stepsHtml = trace.steps.map(s => {
      const dur     = s.end_ms - s.start_ms;
      const sizeStr = s.size_bytes != null ? formatBytes(s.size_bytes) : '';
      return `<tr>
        <td class="sg-av-l2__step-name">${escHtml(s.name)}</td>
        <td class="sg-av-l2__step-time">${dur} ms</td>
        <td class="sg-av-l2__step-size">${escHtml(sizeStr)}</td>
      </tr>`;
    }).join('');

    const okBadge  = `<div class="sg-av-l2__badge sg-av-l2__badge--ok">&#10003; No errors</div>`;
    const errBadge = `<div class="sg-av-l2__badge sg-av-l2__badge--err">&#10007; ${trace.errors.length} error(s)</div>`;
    const badges   = trace.errors.length === 0 ? okBadge : errBadge;

    const panel = document.createElement('div');
    panel.className = 'sg-av__layer2';
    panel.innerHTML = `
      <div class="sg-av-l2__header">
        <span class="sg-av-l2__title">Content load summary</span>
        <button class="sg-av-l2__close" aria-label="Close panel">&#10005;</button>
      </div>
      <div class="sg-av-l2__meta">
        <div>
          <span class="sg-av-l2__key">vault</span>
          <span class="sg-av-l2__val sg-av-l2__val--mono">${escHtml(trace.vault_id)}</span>
        </div>
        <div>
          <span class="sg-av-l2__key">object</span>
          <span class="sg-av-l2__val sg-av-l2__val--mono">${escHtml(trace.object_id)}</span>
        </div>
        <div>
          <span class="sg-av-l2__key">loaded</span>
          <span class="sg-av-l2__val">${trace.resolved_at ? new Date(trace.resolved_at).toUTCString() : '—'}</span>
        </div>
        <div>
          <span class="sg-av-l2__key">total time</span>
          <span class="sg-av-l2__val">${trace.total_ms != null ? trace.total_ms + ' ms' : '—'}</span>
        </div>
      </div>
      <table class="sg-av-l2__steps">
        <thead><tr><th>Step</th><th>Time</th><th>Size</th></tr></thead>
        <tbody>${stepsHtml}</tbody>
      </table>
      <div class="sg-av-l2__badges">${badges}</div>
      <div class="sg-av-l2__footer">
        <button class="sg-av-l2__trace-btn">Full trace &#8599;</button>
      </div>`;

    this._layer2El = panel;
    document.body.appendChild(panel);

    panel.querySelector('.sg-av-l2__close').addEventListener('click', () => {
      panel.remove();
      this._layer2El = null;
    });
    panel.querySelector('.sg-av-l2__trace-btn').addEventListener('click', () => {
      this._openLayer3();
    });
  }

  // ── Layer 3 — full trace modal ──────────────────────────────────────────────

  _openLayer3() {
    const existing = document.getElementById('sg-av-l3-modal');
    if (existing) { existing.remove(); return; }

    const trace   = this._trace;
    if (!trace) return;
    const totalMs = trace.total_ms || 1;

    // Timeline
    const timelineBars = trace.steps.map(s => {
      const left  = Math.round((s.start_ms / totalMs) * 100);
      const width = Math.max(1, Math.round(((s.end_ms - s.start_ms) / totalMs) * 100));
      const dur   = s.end_ms - s.start_ms;
      return `<div class="sg-av-l3__tl-row">
        <span class="sg-av-l3__tl-label">${escHtml(s.name)}</span>
        <div class="sg-av-l3__tl-track">
          <div class="sg-av-l3__tl-bar" style="left:${left}%;width:${width}%"></div>
        </div>
        <span class="sg-av-l3__tl-dur">${dur}ms</span>
      </div>`;
    }).join('');

    const scaleHtml = `<div class="sg-av-l3__tl-scale">
      <span>0ms</span>
      <span>${Math.round(totalMs / 2)}ms</span>
      <span>${totalMs}ms</span>
    </div>`;

    // Objects
    const objectsHtml = trace.objects.map((obj, i) => {
      const previewId = `sg-av-obj-${i}`;
      const hasPreview = !!obj.preview;
      return `<div class="sg-av-l3__obj">
        <div class="sg-av-l3__obj-header">
          <span class="sg-av-l3__obj-role">${escHtml(obj.role)}</span>
          <span class="sg-av-l3__obj-id">${escHtml(obj.id)}</span>
          ${obj.size_bytes != null ? `<span class="sg-av-l3__obj-size">${escHtml(formatBytes(obj.size_bytes))}</span>` : ''}
          ${hasPreview ? `<button class="sg-av-l3__obj-expand" data-target="${previewId}">view &#8599;</button>` : ''}
        </div>
        ${hasPreview ? `<pre class="sg-av-l3__obj-preview" id="${previewId}" hidden>${escHtml(obj.preview)}${obj.full_size > 1000 ? '\n… (' + formatBytes(obj.full_size) + ' total)' : ''}</pre>` : ''}
      </div>`;
    }).join('');

    // Errors
    const errorsSection = trace.errors.length
      ? `<div class="sg-av-l3__section">
           <div class="sg-av-l3__section-title">Errors</div>
           ${trace.errors.map(e => `<div class="sg-av-l3__error">${escHtml(e)}</div>`).join('')}
         </div>`
      : '';

    const modal = document.createElement('div');
    modal.id = 'sg-av-l3-modal';
    modal.className = 'sg-av__layer3';
    modal.innerHTML = `
      <div class="sg-av-l3__dialog">
        <div class="sg-av-l3__toolbar">
          <span class="sg-av-l3__title">Full request trace</span>
          <div class="sg-av-l3__toolbar-actions">
            <button class="sg-av-l3__newtab">open in new tab &#8599;</button>
            <button class="sg-av-l3__close" aria-label="Close">&#10005;</button>
          </div>
        </div>
        <div class="sg-av-l3__body">
          <div class="sg-av-l3__section">
            <div class="sg-av-l3__section-title">Timeline &mdash; ${totalMs}ms total</div>
            ${scaleHtml}
            ${timelineBars}
          </div>
          ${objectsHtml ? `<div class="sg-av-l3__section">
            <div class="sg-av-l3__section-title">Objects</div>
            ${objectsHtml}
          </div>` : ''}
          ${errorsSection}
        </div>
      </div>`;

    document.body.appendChild(modal);

    modal.querySelector('.sg-av-l3__close').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    modal.querySelectorAll('.sg-av-l3__obj-expand').forEach(btn => {
      btn.addEventListener('click', () => {
        const pre = document.getElementById(btn.dataset.target);
        if (!pre) return;
        pre.hidden = !pre.hidden;
        btn.textContent = pre.hidden ? 'view ↗' : 'close ✕';
      });
    });

    modal.querySelector('.sg-av-l3__newtab').addEventListener('click', () => {
      const html = this._buildTracePageHtml(trace);
      const blob = new Blob([html], { type: 'text/html' });
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    });
  }

  _buildTracePageHtml(trace) {
    const stepsRows = trace.steps.map(s => `
      <tr>
        <td>${escHtml(s.name)}</td>
        <td>${s.start_ms}ms</td>
        <td>${s.end_ms}ms</td>
        <td>${s.end_ms - s.start_ms}ms</td>
        <td>${s.size_bytes != null ? formatBytes(s.size_bytes) : ''}</td>
        <td>${s.error ? escHtml(s.error) : ''}</td>
      </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>sg-article-viewer trace &mdash; ${escHtml(trace.object_id)}</title>
  <style>
    body{font-family:system-ui,sans-serif;max-width:960px;margin:2rem auto;padding:0 1.25rem;color:#111;line-height:1.5}
    h1{font-size:1rem;color:#374151;margin:0 0 1.5rem}
    h2{font-size:0.6875rem;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;font-weight:600;margin:2rem 0 .5rem}
    .meta{display:grid;grid-template-columns:110px 1fr;gap:.25rem .5rem;font-size:.875rem;margin-bottom:.5rem}
    .key{color:#9ca3af}
    .mono{font-family:ui-monospace,monospace;font-size:.8125rem}
    table{width:100%;border-collapse:collapse;font-size:.8125rem}
    th{text-align:left;padding:.375rem .5rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb}
    td{padding:.375rem .5rem;border-bottom:1px solid #f3f4f6;font-family:ui-monospace,monospace}
    pre{background:#f9fafb;padding:1rem;border-radius:.5rem;overflow-x:auto;font-size:.8rem;line-height:1.5;white-space:pre-wrap;word-break:break-all}
    .badge-ok{display:inline-block;background:#f0fdf4;color:#16a34a;padding:.125rem .5rem;border-radius:.25rem;font-size:.8rem}
    .badge-err{display:inline-block;background:#fef2f2;color:#dc2626;padding:.125rem .5rem;border-radius:.25rem;font-size:.8rem}
  </style>
</head>
<body>
  <h1>Request trace &mdash; ${escHtml(trace.object_id)}</h1>
  <div class="meta">
    <span class="key">vault</span>    <span class="mono">${escHtml(trace.vault_id)}</span>
    <span class="key">object</span>   <span class="mono">${escHtml(trace.object_id)}</span>
    <span class="key">status</span>   <span>${escHtml(trace.status)}</span>
    <span class="key">total</span>    <span>${trace.total_ms ?? '—'}ms</span>
    <span class="key">resolved</span> <span>${trace.resolved_at ?? '—'}</span>
  </div>
  <span class="${trace.errors.length === 0 ? 'badge-ok' : 'badge-err'}">
    ${trace.errors.length === 0 ? '&#10003; No errors' : `&#10007; ${trace.errors.length} error(s)`}
  </span>
  <h2>Steps</h2>
  <table>
    <thead><tr><th>Name</th><th>Start</th><th>End</th><th>Duration</th><th>Size</th><th>Error</th></tr></thead>
    <tbody>${stepsRows}</tbody>
  </table>
  ${trace.objects.length ? `
  <h2>Objects</h2>
  ${trace.objects.map(o => `
    <h3 style="font-size:.8125rem;font-weight:600;color:#374151;margin:1rem 0 .25rem">
      ${escHtml(o.role)} &mdash; ${escHtml(o.id)}
      ${o.size_bytes != null ? `<span style="color:#9ca3af;font-weight:400"> (${escHtml(formatBytes(o.size_bytes))})</span>` : ''}
    </h3>
    <pre>${escHtml(o.preview ?? '')}${o.full_size > 1000 ? '\n…' : ''}</pre>`).join('')}` : ''}
  ${trace.errors.length ? `
  <h2>Errors</h2>
  <pre style="background:#fef2f2;color:#dc2626">${trace.errors.map(e => escHtml(e)).join('\n')}</pre>` : ''}
</body>
</html>`;
  }

  // ── Renderers ───────────────────────────────────────────────────────────────

  async _renderArticle(meta, body, vaultId, readKey) {
    const [{ marked }, yamlLoad] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/marked@9/+esm'),
      _loadYaml(),
    ]);

    const renderer = new marked.Renderer();

    renderer.link = function (href, title, text) {
      if (typeof href === 'object' && href !== null) {
        title = href.title;
        text  = href.text;
        href  = href.href;
      }
      const isExternal = href && /^https?:\/\//i.test(href);
      const titleAttr  = title ? ` title="${escHtml(title)}"` : '';
      const target     = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
      return `<a href="${escHtml(href)}"${titleAttr}${target}>${text}</a>`;
    };

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

    const metaHtml = renderMetaStrip(meta);
    const bodyHtml = marked.parse(applyFencedBlocks(applyTokens(body), yamlLoad));

    this._contentEl.innerHTML = `
      <div class="article-viewer">
        ${metaHtml}
        <div class="article-body">${bodyHtml}</div>
      </div>`;

    document.dispatchEvent(new CustomEvent('viewer:rendered', {
      detail: { meta },
    }));

    this._resolveVaultImages(vaultId, readKey);
  }

  _renderJson(text) {
    let data;
    try { data = JSON.parse(text); }
    catch {
      this._contentEl.innerHTML = `<div class="article-viewer"><div class="article-body"><pre class="article-json-raw">${escHtml(text)}</pre></div></div>`;
      return;
    }

    const schema = data.schema ?? '';
    let renderedHtml;

    if (schema === 'project-decisions-v1') {
      renderedHtml = this._decisionsHtml(data);
    } else if (schema === 'project-agents-v1' || schema === 'project-agents-v2') {
      renderedHtml = this._agentsHtml(data);
    } else if (schema === 'project-workstreams-v1') {
      renderedHtml = this._workstreamsHtml(data);
    } else if (schema === 'project-workstreams-v2') {
      renderedHtml = this._kanbanHtml(data);
    } else if (schema === 'project-issues-v1') {
      renderedHtml = this._issuesHtml(data);
    } else {
      renderedHtml = `<pre class="article-json-raw">${escHtml(JSON.stringify(data, null, 2))}</pre>`;
    }

    const rawHtml = escHtml(JSON.stringify(data, null, 2));

    this._contentEl.innerHTML = `
      <div class="article-viewer">
        <div class="article-body">
          <div class="json-view-toggle">
            <button class="json-view-btn json-view-btn--active" data-view="rendered">Formatted</button>
            <button class="json-view-btn" data-view="raw">{ } Raw</button>
          </div>
          <div class="json-rendered-view">${renderedHtml}</div>
          <div class="json-raw-view" hidden><pre class="article-json-raw">${rawHtml}</pre></div>
        </div>
      </div>`;

    this.querySelectorAll('.json-view-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        this.querySelectorAll('.json-view-btn').forEach(b =>
          b.classList.toggle('json-view-btn--active', b === btn)
        );
        this.querySelector('.json-rendered-view').hidden = view === 'raw';
        this.querySelector('.json-raw-view').hidden      = view === 'rendered';
      });
    });

    document.dispatchEvent(new CustomEvent('viewer:rendered', { detail: { meta: {} } }));
  }

  _decisionsHtml(data) {
    const decisions = data.decisions ?? [];
    return `
      <h1>Decision Log</h1>
      <div class="decisions-log">
        ${decisions.map(d => `
          <div class="decision-entry">
            <div class="decision-entry__header">
              <span class="decision-entry__id">${escHtml(d.id ?? '')}</span>
              <span class="decision-entry__date">${escHtml(d.date ?? '')}</span>
              <span class="decision-entry__status decision-entry__status--${escHtml((d.status ?? '').toLowerCase())}">${escHtml(d.status ?? '')}</span>
              <span class="decision-entry__by">${escHtml(d.decided_by ?? '')}</span>
            </div>
            <div class="decision-entry__topic">${escHtml(d.topic ?? '')}</div>
            <div class="decision-entry__text">${escHtml(d.decision ?? '')}</div>
            ${d.detail ? `<div class="decision-entry__detail">${escHtml(d.detail)}</div>` : ''}
          </div>`).join('')}
      </div>`;
  }

  _agentsHtml(data) {
    const agents = data.agents ?? [];
    return `
      <h1>Agents</h1>
      <div class="agents-list">
        ${agents.map(a => {
          const owns  = Array.isArray(a.owns)  ? a.owns  : (a.owns  ? [a.owns]  : []);
          const tools = Array.isArray(a.tools) ? a.tools : (a.tools ? [a.tools] : []);
          const statusClass = (a.session_status ?? '').toLowerCase().replace(/\s+/g, '-');
          return `
          <div class="agent-entry">
            <div class="agent-entry__header">
              <span class="agent-entry__alias">${escHtml(a.alias ?? '')}</span>
              ${a.session_status ? `<span class="agent-entry__status agent-entry__status--${escHtml(statusClass)}">${escHtml(a.session_status)}</span>` : ''}
              <span class="agent-entry__role">${escHtml(a.role ?? '')}</span>
              <span class="agent-entry__model">${escHtml(a.model ?? '')}</span>
            </div>
            <div class="agent-entry__name">${escHtml(a.full_name ?? '')}</div>
            ${a.location ? `<div class="agent-entry__location">${escHtml(a.location)}</div>` : ''}
            ${owns.length ? `
              <div class="agent-entry__section-label">Owns</div>
              <ul class="agent-entry__list">
                ${owns.map(o => `<li>${escHtml(o)}</li>`).join('')}
              </ul>` : ''}
            ${tools.length ? `
              <div class="agent-entry__section-label">Tools</div>
              <ul class="agent-entry__list">
                ${tools.map(t => `<li>${escHtml(t)}</li>`).join('')}
              </ul>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  }

  _workstreamsHtml(data) {
    const workstreams = data.workstreams ?? [];
    const statusIcon = s => ({ done: '&#10003;', 'in-progress': '&#8635;', next: '&#8635;', queued: '&#8987;', pending: '&#8987;' }[s?.toLowerCase()] ?? '&middot;');
    return `
      <h1>Workstreams</h1>
      <div class="workstreams-list">
        ${workstreams.map(ws => {
          const tasks = ws.tasks ?? [];
          return `
          <div class="workstream-entry">
            <div class="workstream-entry__header">
              <span class="workstream-entry__id">${escHtml(ws.id ?? '')}</span>
              <span class="workstream-entry__title">${escHtml(ws.title ?? '')}</span>
              ${ws.status ? `<span class="workstream-entry__status workstream-entry__status--${escHtml((ws.status ?? '').toLowerCase())}">${escHtml(ws.status)}</span>` : ''}
            </div>
            ${ws.goal  ? `<div class="workstream-entry__goal">${escHtml(ws.goal)}</div>` : ''}
            ${ws.owner ? `<div class="workstream-entry__owner">Owner: ${escHtml(ws.owner)}</div>` : ''}
            ${tasks.length ? `
              <table class="workstream-tasks">
                <thead><tr><th>Task</th><th>Owner</th><th>Status</th><th>Notes</th></tr></thead>
                <tbody>
                  ${tasks.map(t => `
                    <tr class="workstream-task workstream-task--${escHtml((t.status ?? '').toLowerCase())}">
                      <td>${escHtml(t.task ?? t.title ?? '')}</td>
                      <td>${escHtml(t.owner ?? '')}</td>
                      <td><span class="task-status">${statusIcon(t.status)} ${escHtml(t.status ?? '')}</span></td>
                      <td class="task-notes">${escHtml(t.notes ?? '')}</td>
                    </tr>`).join('')}
                </tbody>
              </table>` : ''}
          </div>`;
        }).join('')}
      </div>`;
  }

  _kanbanHtml(data) {
    const workstreams = data.workstreams ?? [];
    const columns = [
      { key: 'queued',      label: 'Queued',      icon: '&#8987;' },
      { key: 'next',        label: 'Up Next',     icon: '&#8594;' },
      { key: 'in-progress', label: 'In Progress', icon: '&#8635;' },
      { key: 'done',        label: 'Done',         icon: '&#10003;' },
    ];

    const allTasks = workstreams.flatMap(ws =>
      (ws.tasks ?? []).map(t => ({
        ...t,
        _wsTitle: ws.title,
        _wsColor: ws.color ?? '#6366f1',
        _wsId:    ws.id ?? '',
      }))
    );

    const colHtml = columns.map(col => {
      const tasks = allTasks.filter(t =>
        (t.status ?? '').toLowerCase().replace(/\s+/g, '-') === col.key
      );
      if (!tasks.length && col.key === 'next') return '';
      const cards = tasks.map(t => `
        <div class="kanban-card" style="--ws-color:${escHtml(t._wsColor)}">
          <div class="kanban-card__ws">${escHtml(t._wsTitle)}</div>
          <div class="kanban-card__title">${escHtml(t.task ?? t.title ?? '')}</div>
          ${t.owner ? `<div class="kanban-card__owner">${escHtml(t.owner)}</div>` : ''}
          ${t.notes ? `<div class="kanban-card__notes">${escHtml(t.notes)}</div>` : ''}
        </div>`).join('');
      return `
        <div class="kanban-col">
          <div class="kanban-col__header">
            <span class="kanban-col__icon">${col.icon}</span>
            <span class="kanban-col__label">${col.label}</span>
            <span class="kanban-col__count">${tasks.length}</span>
          </div>
          <div class="kanban-col__cards">${cards || '<div class="kanban-col__empty">&mdash;</div>'}</div>
        </div>`;
    }).filter(Boolean).join('');

    const wsLegend = workstreams.map(ws => `
      <span class="kanban-legend__item">
        <span class="kanban-legend__dot" style="background:${escHtml(ws.color ?? '#6366f1')}"></span>
        ${escHtml(ws.title)}
      </span>`).join('');

    return `
      <h1>Workstreams</h1>
      ${wsLegend ? `<div class="kanban-legend">${wsLegend}</div>` : ''}
      <div class="kanban-board">${colHtml}</div>`;
  }

  _issuesHtml(data) {
    const issues = data.issues ?? [];
    const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    const sorted = [...issues].sort((a, b) =>
      (priorityOrder[a.priority?.toLowerCase()] ?? 9) -
      (priorityOrder[b.priority?.toLowerCase()] ?? 9)
    );

    const priorityBadge = p => {
      const cls = (p ?? '').toLowerCase();
      return `<span class="issue-priority issue-priority--${escHtml(cls)}">${escHtml(p ?? '')}</span>`;
    };
    const statusIcon = s => ({ open: '&#128308;', 'in-progress': '&#128993;', closed: '&#128994;', blocked: '&#9940;' }[s?.toLowerCase()] ?? '&middot;');

    const rows = sorted.map(issue => `
      <div class="issue-row issue-row--${escHtml((issue.status ?? '').toLowerCase())}">
        <div class="issue-row__header">
          <span class="issue-row__id">${escHtml(issue.id ?? '')}</span>
          ${priorityBadge(issue.priority)}
          <span class="issue-row__status">${statusIcon(issue.status)} ${escHtml(issue.status ?? '')}</span>
          ${issue.owner ? `<span class="issue-row__owner">${escHtml(issue.owner)}</span>` : ''}
        </div>
        <div class="issue-row__title">${escHtml(issue.title ?? '')}</div>
        ${issue.description ? `<div class="issue-row__desc">${escHtml(issue.description)}</div>` : ''}
      </div>`).join('');

    const open   = issues.filter(i => (i.status ?? '').toLowerCase() !== 'closed').length;
    const closed = issues.length - open;

    return `
      <h1>Issues</h1>
      <div class="issues-summary">
        <span class="issues-summary__stat">${open} open</span>
        <span class="issues-summary__sep">&middot;</span>
        <span class="issues-summary__stat issues-summary__stat--muted">${closed} closed</span>
      </div>
      <div class="issues-list">${rows || '<p>No issues.</p>'}</div>`;
  }

  // ── Image resolution ────────────────────────────────────────────────────────

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
  return `<div class="article-meta">${parts.join('<span class="article-meta__sep">&middot;</span>')}</div>`;
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

function formatBytes(bytes) {
  if (bytes < 1024)       return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── YAML loader (cached) ──────────────────────────────────────────────────────
let _yamlCache = null;
async function _loadYaml() {
  if (!_yamlCache) {
    const mod = await import('https://esm.sh/js-yaml@4');
    _yamlCache = mod.load ?? mod.default?.load;
  }
  return _yamlCache;
}

// ── Fenced-block pre-processor ────────────────────────────────────────────────
const FENCED_TYPES = new Set([
  'comparison', 'feature-cards', 'code-comparison', 'timeline',
  'checklist', 'skill-cards', 'component-gallery', 'component-table', 'proposal-card',
]);

function applyFencedBlocks(body, yamlLoad) {
  return body.replace(
    /^```([\w-]+)\n([\s\S]*?)^```/gm,
    (match, type, content) => {
      if (!FENCED_TYPES.has(type)) return match;
      let data;
      try { data = yamlLoad(content); } catch { return match; }
      try {
        if (type === 'comparison')         return renderComparison(data);
        if (type === 'feature-cards')      return renderFeatureCards(data);
        if (type === 'code-comparison')    return renderCodeComparison(data);
        if (type === 'timeline')           return renderTimeline(data);
        if (type === 'checklist')          return renderChecklist(data);
        if (type === 'skill-cards')        return renderSkillCards(data);
        if (type === 'component-gallery')  return renderComponentGallery(data);
        if (type === 'component-table')    return renderComponentTable(data);
        if (type === 'proposal-card')      return renderProposalCard(data);
      } catch { return match; }
      return match;
    }
  );
}

// ── Token replacement ─────────────────────────────────────────────────────────
function applyTokens(body) {
  return body.replace(
    /\{\{screenshot:\s*([^|\n}]+?)(?:\s*\|\s*([^|\n}]*?))?(?:\s*\|\s*([^|\n}]*?))?(?:\s*\|\s*([^|\n}]*?))?\s*\}\}/g,
    (_, id, title, desc, dims) => {
      id    = (id    ?? '').trim();
      title = (title ?? '').trim();
      desc  = (desc  ?? '').trim();
      dims  = (dims  ?? '').trim();
      const dimsLabel = dims ? dims.replace(/x/i, '\xd7') : '';
      const badge = dimsLabel ? `[ SCREENSHOT NEEDED ]  ~ ${dimsLabel}` : '[ SCREENSHOT NEEDED ]';
      return `<div class="screenshot-placeholder" data-screenshot-id="${escHtml(id)}">` +
             `<div class="screenshot-placeholder__header">` +
             `<span class="screenshot-placeholder__icon">&#128247;</span>` +
             `<span class="screenshot-placeholder__title">${escHtml(title)}</span>` +
             `</div>` +
             (desc ? `<div class="screenshot-placeholder__desc">${escHtml(desc)}</div>` : '') +
             `<div class="screenshot-placeholder__badge">${escHtml(badge)}</div>` +
             `</div>`;
    }
  );
}

// ── Fenced-block renderers ────────────────────────────────────────────────────

function renderComparison(data) {
  const col = side => {
    if (!side) return '';
    const colorCls = `cmp-col--${escHtml(side.color ?? 'neutral')}`;
    const items = (side.items ?? []).map(item => `
      <div class="cmp-item">
        <dt class="cmp-item__label">${escHtml(item.label ?? '')}</dt>
        <dd class="cmp-item__value">${escHtml(item.value ?? '')}</dd>
      </div>`).join('');
    return `<div class="cmp-col ${colorCls}">
      <div class="cmp-col__header">
        <div class="cmp-col__title">${escHtml(side.title ?? '')}</div>
        <div class="cmp-col__subtitle">${escHtml(side.subtitle ?? '')}</div>
      </div>
      <dl class="cmp-col__items">${items}</dl>
    </div>`;
  };
  return `<div class="cmp-card">${col(data.left)}<div class="cmp-sep"></div>${col(data.right)}</div>`;
}

function renderFeatureCards(data) {
  const cards = (data.cards ?? []).map(c => `
    <div class="feat-card">
      <div class="feat-card__icon">${escHtml(c.icon ?? '')}</div>
      <div class="feat-card__title">${escHtml(c.title ?? '')}</div>
      <div class="feat-card__body">${escHtml(c.body ?? '')}</div>
    </div>`).join('');
  return `<div class="feat-cards">${cards}</div>`;
}

function renderCodeComparison(data) {
  const panel = side => {
    if (!side) return '';
    return `<div class="code-cmp__panel">
      <div class="code-cmp__title">${escHtml(side.title ?? '')}</div>
      <pre class="code-cmp__pre"><code>${escHtml(side.code ?? '')}</code></pre>
    </div>`;
  };
  return `<div class="code-cmp">${panel(data.left)}${panel(data.right)}</div>`;
}

function renderTimeline(data) {
  const nodes = (data.events ?? []).map(ev => {
    const cls = `tl-node--${escHtml((ev.result ?? 'partial').toLowerCase())}`;
    return `<div class="tl-node ${cls}">
      <div class="tl-node__label">${escHtml(ev.label ?? '')}</div>
      <div class="tl-node__dot"></div>
      <div class="tl-node__meta">
        <span class="tl-node__dur">${escHtml(ev.duration ?? '')}</span>
        <span class="tl-node__badge">${escHtml(ev.result ?? '')}</span>
      </div>
      ${ev.detail ? `<div class="tl-node__detail">${escHtml(ev.detail)}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="tl-track">${nodes}</div>`;
}

function renderChecklist(data) {
  const items = (data.items ?? []).map(item => {
    const done = item.done === true;
    return `<li class="check-item ${done ? 'check-item--done' : 'check-item--todo'}">
      <span class="check-item__icon">${done ? '&#10003;' : '&#9633;'}</span>
      <div class="check-item__body">
        <div class="check-item__label">${escHtml(item.label ?? '')}</div>
        ${item.detail ? `<div class="check-item__detail">${escHtml(item.detail)}</div>` : ''}
      </div>
    </li>`;
  }).join('');
  return `<ul class="check-list">${items}</ul>`;
}

function renderSkillCards(data) {
  const keyColor = { human: 'blue', browser: 'teal', api: 'purple' };
  const cards = (data.skills ?? []).map(skill => {
    const color = keyColor[skill.key ?? ''] ?? 'neutral';
    const contains = (skill.contains ?? []).map(c => `<li>${escHtml(c)}</li>`).join('');
    return `<div class="skill-card skill-card--${escHtml(color)}">
      <div class="skill-card__header">
        <span class="skill-card__icon">${escHtml(skill.icon ?? '')}</span>
        <span class="skill-card__title">${escHtml(skill.title ?? '')}</span>
      </div>
      <div class="skill-card__audience">${escHtml(skill.audience ?? '')}</div>
      <ul class="skill-card__contains">${contains}</ul>
      <div class="skill-card__format"><code>${escHtml(skill.format ?? '')}</code></div>
    </div>`;
  }).join('');
  return `<div class="skill-cards">${cards}</div>`;
}

function renderComponentGallery(data) {
  const cards = (data.components ?? []).map(c => {
    const apiCls = `comp-card__api--${escHtml((c.current_api ?? 'none').toLowerCase())}`;
    return `<div class="comp-card">
      <div class="comp-card__header">
        <span class="comp-card__name">${escHtml(c.name ?? '')}</span>
        <span class="comp-card__api ${apiCls}">${escHtml(c.current_api ?? 'none')}</span>
      </div>
      <code class="comp-card__tag">${escHtml(c.tag ?? '')}</code>
      <div class="comp-card__role">${escHtml(c.role ?? '')}</div>
      <em class="comp-card__use">${escHtml(c.agent_use_case ?? '')}</em>
    </div>`;
  }).join('');
  return `<div class="comp-gallery">${cards}</div>`;
}

function renderComponentTable(data) {
  const cols = data.columns ?? [];
  const rows = data.rows ?? [];
  const thead = `<tr>${cols.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr>`;
  const tbody = rows.map((row, ri) => {
    const cells = (Array.isArray(row) ? row : []).map((cell, ci) =>
      `<td${ci === 2 ? ' class="comp-table__mono"' : ''}>${escHtml(cell ?? '')}</td>`
    ).join('');
    return `<tr${ri % 2 ? ' class="comp-table__odd"' : ''}>${cells}</tr>`;
  }).join('');
  return `<table class="comp-table"><thead>${thead}</thead><tbody>${tbody}</tbody></table>`;
}

function renderProposalCard(data) {
  const statusCls = `proposal-card__status--${escHtml((data.status ?? 'proposed').toLowerCase().replace(/\s+/g, '-'))}`;
  const methods = (data.methods ?? []).map(m => `
    <div class="proposal-method">
      <code class="proposal-method__name">${escHtml(m.name ?? '')}</code>
      <code class="proposal-method__returns">${escHtml(m.returns ?? '')}</code>
      <span class="proposal-method__use">${escHtml(m.use ?? '')}</span>
    </div>`).join('');
  return `<div class="proposal-card">
    <div class="proposal-card__header">
      <span class="proposal-card__title">${escHtml(data.title ?? '')}</span>
      <span class="proposal-card__status ${statusCls}">${escHtml(data.status ?? '')}</span>
    </div>
    <div class="proposal-card__methods">${methods}</div>
  </div>`;
}

customElements.define('sg-article-viewer', SgArticleViewer);
