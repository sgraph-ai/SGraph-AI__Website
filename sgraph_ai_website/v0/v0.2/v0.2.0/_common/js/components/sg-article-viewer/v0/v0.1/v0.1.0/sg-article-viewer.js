/**
 * sg-article-viewer v0.1.5
 *
 * Full content pipeline: vault fetch → frontmatter parse → viewer render.
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
      const renderHint = this.getAttribute('render') ?? 'markdown';
      const viewer = meta.viewer ?? (renderHint === 'json' ? 'json' : 'article');

      if (viewer === 'article') {
        await this._renderArticle(meta, body, vaultId, readKey);
      } else if (viewer === 'json') {
        this._renderJson(text);
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

    const metaHtml  = renderMetaStrip(meta);
    const bodyHtml  = marked.parse(applyTokens(body));

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

  _renderJson(text) {
    let data;
    try { data = JSON.parse(text); }
    catch {
      this.innerHTML = `<div class="article-viewer"><div class="article-body"><pre class="article-json-raw">${escHtml(text)}</pre></div></div>`;
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

    this.innerHTML = `
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
    const statusIcon = s => ({ done: '✅', 'in-progress': '🔄', next: '🔄', queued: '⏳', pending: '⏳' }[s?.toLowerCase()] ?? '·');
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
      { key: 'queued',      label: 'Queued',      icon: '⏳' },
      { key: 'next',        label: 'Up Next',     icon: '🔜' },
      { key: 'in-progress', label: 'In Progress', icon: '🔄' },
      { key: 'done',        label: 'Done',         icon: '✅' },
    ];

    // Collect all tasks across workstreams, tagged with workstream metadata
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
      if (!tasks.length && col.key === 'next') return ''; // hide if empty
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
          <div class="kanban-col__cards">${cards || '<div class="kanban-col__empty">—</div>'}</div>
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
    const statusIcon = s => ({ open: '🔴', 'in-progress': '🟡', closed: '🟢', blocked: '⛔' }[s?.toLowerCase()] ?? '·');

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
        <span class="issues-summary__sep">·</span>
        <span class="issues-summary__stat issues-summary__stat--muted">${closed} closed</span>
      </div>
      <div class="issues-list">${rows || '<p>No issues.</p>'}</div>`;
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

// Token replacement — pre-processing pass on raw markdown body.
// Supported tokens (must be on a single line):
//   {{screenshot: id | title | description | dimensions}}
function applyTokens(body) {
  return body.replace(
    /\{\{screenshot:\s*([^|\n}]+?)(?:\s*\|\s*([^|\n}]*?))?(?:\s*\|\s*([^|\n}]*?))?(?:\s*\|\s*([^|\n}]*?))?\s*\}\}/g,
    (_, id, title, desc, dims) => {
      id    = (id    ?? '').trim();
      title = (title ?? '').trim();
      desc  = (desc  ?? '').trim();
      dims  = (dims  ?? '').trim();
      const dimsLabel = dims ? dims.replace(/x/i, '×') : '';
      const badge = dimsLabel ? `[ SCREENSHOT NEEDED ]  ~ ${dimsLabel}` : '[ SCREENSHOT NEEDED ]';
      return `<div class="screenshot-placeholder" data-screenshot-id="${escHtml(id)}">` +
             `<div class="screenshot-placeholder__header">` +
             `<span class="screenshot-placeholder__icon">📷</span>` +
             `<span class="screenshot-placeholder__title">${escHtml(title)}</span>` +
             `</div>` +
             (desc ? `<div class="screenshot-placeholder__desc">${escHtml(desc)}</div>` : '') +
             `<div class="screenshot-placeholder__badge">${escHtml(badge)}</div>` +
             `</div>`;
    }
  );
}

customElements.define('sg-article-viewer', SgArticleViewer);
