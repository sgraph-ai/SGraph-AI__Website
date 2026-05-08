/**
 * sg-debug-panel v0.1.1
 *
 * Floating debug overlay for sgraph.ai sub-sites. Two tabs:
 *   Log     — intercepted fetch calls (vault / GitHub API) + custom nav:* events
 *   Sources — raw nav JSON tree + last decrypted vault content
 *
 * Only active on qa / dev / localhost — no-op on prod.
 *
 * Usage:  <sg-debug-panel></sg-debug-panel>  (anywhere in <body>)
 * Trigger: ◉ fixed button (bottom-left) or keyboard Shift+D
 *
 * Pages emit raw content by dispatching:
 *   document.dispatchEvent(new CustomEvent('debug:nav-json',     { detail: { json, src } }))
 *   document.dispatchEvent(new CustomEvent('debug:vault-content',{ detail: { objectId, text, kind } }))
 */
class SgDebugPanel extends HTMLElement {
  connectedCallback() {
    const env = location.hostname.startsWith('qa.') ? 'qa'
              : location.hostname.startsWith('dev.') ? 'dev'
              : location.hostname === 'localhost' || location.hostname === '127.0.0.1' ? 'local'
              : 'prod';
    if (env === 'prod') return;

    this._log       = [];
    this._sources   = [];   // { kind, label, content }
    this._open      = localStorage.getItem('sg-debug-open') === 'true';
    this._activeTab = localStorage.getItem('sg-debug-tab') ?? 'log';

    this._buildUI();
    this._patchFetch();
    this._listenEvents();
    this._listenKeyboard();
    this._pushLog({ kind: 'system', msg: `sg-debug-panel v0.1.1 · ${env} · ${location.pathname}` });
  }

  disconnectedCallback() {
    if (this._origFetch) window.fetch = this._origFetch;
    this._evtAbort?.abort();
    this._kbAbort?.abort();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      .sgdbg-btn {
        position: fixed; bottom: 12px; left: 12px; z-index: 9000;
        width: 28px; height: 28px; border-radius: 50%;
        background: #1e293b; color: #94a3b8;
        border: 1px solid #334155; cursor: pointer;
        font-size: 13px; display: flex; align-items: center; justify-content: center;
        box-shadow: 0 2px 8px rgba(0,0,0,.35);
        transition: color .15s, background .15s; user-select: none;
      }
      .sgdbg-btn:hover { background: #0f172a; color: #e2e8f0; }
      .sgdbg-btn.active { background: #0f172a; color: #38bdf8; border-color: #38bdf8; }

      .sgdbg-panel {
        position: fixed; inset: 0; z-index: 8999;
        pointer-events: none;
      }
      .sgdbg-panel.open { pointer-events: all; }

      .sgdbg-overlay {
        position: absolute; inset: 0;
        background: rgba(0,0,0,.25);
        opacity: 0; transition: opacity .2s;
      }
      .sgdbg-panel.open .sgdbg-overlay { opacity: 1; }

      .sgdbg-drawer {
        position: absolute; top: 0; right: 0; bottom: 0;
        width: min(720px, 96vw);
        background: #0f172a; color: #e2e8f0;
        display: flex; flex-direction: column;
        transform: translateX(100%); transition: transform .22s ease;
        box-shadow: -4px 0 24px rgba(0,0,0,.5);
        font-family: 'DM Mono', 'Menlo', 'Consolas', monospace;
        font-size: 12px;
      }
      .sgdbg-panel.open .sgdbg-drawer { transform: translateX(0); }

      /* Head */
      .sgdbg-head {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 10px 14px; border-bottom: 1px solid #1e293b; flex-shrink: 0;
      }
      .sgdbg-title { font-weight: 700; color: #38bdf8; letter-spacing: .04em; }
      .sgdbg-tabs { display: flex; gap: 4px; }
      .sgdbg-tab {
        padding: 3px 10px; border: 1px solid #334155; border-radius: 4px;
        background: transparent; color: #64748b; cursor: pointer; font-size: 11px;
        font-family: inherit; transition: color .12s, border-color .12s;
      }
      .sgdbg-tab.active { color: #38bdf8; border-color: #38bdf8; background: #38bdf811; }
      .sgdbg-counts { margin-left: auto; display: flex; gap: 5px; flex-wrap: wrap; }
      .sgdbg-count {
        padding: 1px 7px; border-radius: 9999px; font-size: 10px; font-weight: 700;
      }
      .sgdbg-count.vault  { background: #7c3aed22; color: #a78bfa; border: 1px solid #7c3aed44; }
      .sgdbg-count.nav    { background: #0369a122; color: #38bdf8;  border: 1px solid #0369a144; }
      .sgdbg-count.err    { background: #dc262622; color: #f87171;  border: 1px solid #dc262644; }

      /* Toolbar */
      .sgdbg-toolbar {
        display: flex; align-items: center; gap: 6px; padding: 6px 14px;
        border-bottom: 1px solid #1e293b; flex-shrink: 0;
      }
      .sgdbg-filter {
        flex: 1; background: #1e293b; border: 1px solid #334155;
        color: #e2e8f0; padding: 4px 8px; border-radius: 4px; font-size: 11px;
        font-family: inherit;
      }
      .sgdbg-filter::placeholder { color: #475569; }
      .sgdbg-filter:focus { outline: none; border-color: #38bdf8; }
      .sgdbg-tbtn {
        padding: 3px 8px; border: 1px solid #334155; border-radius: 4px;
        background: transparent; color: #94a3b8; cursor: pointer; font-size: 10px;
        font-family: inherit; transition: color .12s, border-color .12s; white-space: nowrap;
      }
      .sgdbg-tbtn:hover { color: #e2e8f0; border-color: #64748b; }
      .sgdbg-tbtn.on { color: #38bdf8; border-color: #38bdf8; }

      /* Log entries */
      .sgdbg-log { flex: 1; overflow-y: auto; padding: 4px 0; scroll-behavior: smooth; }
      .sgdbg-entry {
        display: grid; grid-template-columns: 56px 60px 1fr;
        gap: 0 8px; padding: 4px 14px;
        border-bottom: 1px solid #1e293b0a;
        align-items: start; cursor: pointer;
        transition: background .1s;
        border-left: 2px solid transparent;
      }
      .sgdbg-entry:hover { background: #1e293b; }
      .sgdbg-entry.vault-ok  { border-left-color: #7c3aed; }
      .sgdbg-entry.vault-err { border-left-color: #dc2626; }
      .sgdbg-entry.vault     { border-left-color: #7c3aed88; }
      .sgdbg-entry.nav       { border-left-color: #0369a1; }
      .sgdbg-entry.error     { border-left-color: #dc2626; }
      .sgdbg-entry.warn      { border-left-color: #f59e0b; }
      .sgdbg-entry.gh        { border-left-color: #f59e0b; }
      .sgdbg-entry.system    { border-left-color: #16a34a; }
      .sgdbg-ts   { color: #475569; font-size: 10px; padding-top: 1px; white-space: nowrap; }
      .sgdbg-kind { font-size: 10px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: .04em; padding-top: 1px; white-space: nowrap; }
      .sgdbg-entry.vault-ok  .sgdbg-kind,
      .sgdbg-entry.vault     .sgdbg-kind { color: #a78bfa; }
      .sgdbg-entry.vault-err .sgdbg-kind { color: #f87171; }
      .sgdbg-entry.nav    .sgdbg-kind { color: #38bdf8; }
      .sgdbg-entry.error  .sgdbg-kind { color: #f87171; }
      .sgdbg-entry.system .sgdbg-kind { color: #4ade80; }
      .sgdbg-entry.gh     .sgdbg-kind,
      .sgdbg-entry.warn   .sgdbg-kind { color: #fbbf24; }
      .sgdbg-msg  { color: #cbd5e1; word-break: break-all; }
      .sgdbg-sub  { color: #475569; font-size: 10px; margin-top: 2px; }
      .sgdbg-detail {
        display: none; grid-column: 1 / -1;
        background: #1e293b; border-radius: 4px; margin: 4px 0;
        padding: 8px 10px; color: #94a3b8; font-size: 10px;
        white-space: pre-wrap; word-break: break-all;
        max-height: 220px; overflow-y: auto;
      }
      .sgdbg-entry.expanded .sgdbg-detail { display: block; }

      /* Sources tab */
      .sgdbg-sources { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 0; }
      .sgdbg-source-item { border-bottom: 1px solid #1e293b; }
      .sgdbg-source-hd {
        display: flex; align-items: center; gap: 8px; padding: 8px 14px;
        cursor: pointer; user-select: none;
        background: #1e293b44;
      }
      .sgdbg-source-hd:hover { background: #1e293b; }
      .sgdbg-source-hd-label { font-size: 11px; font-weight: 700; color: #38bdf8; flex: 1; }
      .sgdbg-source-hd-meta  { font-size: 10px; color: #475569; }
      .sgdbg-source-hd-copy  {
        font-size: 10px; color: #64748b; padding: 2px 6px;
        border: 1px solid #334155; border-radius: 3px; cursor: pointer;
        background: transparent;
      }
      .sgdbg-source-hd-copy:hover { color: #e2e8f0; }
      .sgdbg-source-body {
        display: none; padding: 10px 14px;
        white-space: pre-wrap; word-break: break-all;
        font-size: 10.5px; color: #94a3b8; max-height: 400px; overflow-y: auto;
        background: #0a1122;
      }
      .sgdbg-source-item.open .sgdbg-source-body { display: block; }
      .sgdbg-src-empty { padding: 2rem; text-align: center; color: #334155; font-size: 11px; }

      /* Footer */
      .sgdbg-foot {
        padding: 8px 14px; border-top: 1px solid #1e293b;
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .sgdbg-path { color: #475569; font-size: 10px; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
      .sgdbg-close {
        background: transparent; border: 1px solid #334155; color: #94a3b8;
        padding: 3px 10px; border-radius: 4px; cursor: pointer; font-size: 11px;
        font-family: inherit;
      }
      .sgdbg-close:hover { color: #e2e8f0; }
    `;
    document.head.appendChild(style);

    // Toggle button
    const btn = document.createElement('button');
    btn.className = 'sgdbg-btn' + (this._open ? ' active' : '');
    btn.title = 'Debug panel (Shift+D)';
    btn.textContent = '◉';
    btn.addEventListener('click', () => this.toggle());
    document.body.appendChild(btn);
    this._btn = btn;

    // Panel
    const panel = document.createElement('div');
    panel.className = 'sgdbg-panel' + (this._open ? ' open' : '');
    panel.innerHTML = `
      <div class="sgdbg-overlay"></div>
      <div class="sgdbg-drawer">
        <div class="sgdbg-head">
          <span class="sgdbg-title">◉ Debug</span>
          <div class="sgdbg-tabs">
            <button class="sgdbg-tab${this._activeTab==='log'?' active':''}" data-tab="log">Log</button>
            <button class="sgdbg-tab${this._activeTab==='sources'?' active':''}" data-tab="sources">Sources</button>
          </div>
          <div class="sgdbg-counts">
            <span class="sgdbg-count vault" id="sgdbg-c-vault">vault 0</span>
            <span class="sgdbg-count nav"   id="sgdbg-c-nav">nav 0</span>
            <span class="sgdbg-count err"   id="sgdbg-c-err">err 0</span>
          </div>
        </div>

        <!-- LOG tab -->
        <div id="sgdbg-tab-log" style="${this._activeTab==='log'?'display:flex;flex-direction:column;flex:1':'display:none'}">
          <div class="sgdbg-toolbar">
            <input class="sgdbg-filter" id="sgdbg-filter" placeholder="Filter…" type="search">
            <button class="sgdbg-tbtn on"  id="sgdbg-f-all">All</button>
            <button class="sgdbg-tbtn" id="sgdbg-f-vault">Vault</button>
            <button class="sgdbg-tbtn" id="sgdbg-f-nav">Nav</button>
            <button class="sgdbg-tbtn" id="sgdbg-f-error">Errors</button>
            <button class="sgdbg-tbtn" id="sgdbg-clear">Clear</button>
          </div>
          <div class="sgdbg-log" id="sgdbg-log"></div>
        </div>

        <!-- SOURCES tab -->
        <div id="sgdbg-tab-sources" style="${this._activeTab==='sources'?'display:flex;flex-direction:column;flex:1':'display:none'}">
          <div class="sgdbg-toolbar">
            <span style="font-size:10px;color:#475569;flex:1">Raw nav JSON · decrypted vault content</span>
            <button class="sgdbg-tbtn" id="sgdbg-src-clear">Clear</button>
          </div>
          <div class="sgdbg-sources" id="sgdbg-sources">
            <div class="sgdbg-src-empty">No sources captured yet.<br>Load an article or nav to populate.</div>
          </div>
        </div>

        <div class="sgdbg-foot">
          <span class="sgdbg-path">${esc(location.pathname)}</span>
          <button class="sgdbg-close" id="sgdbg-close">Close ✕</button>
        </div>
      </div>`;
    document.body.appendChild(panel);
    this._panel = panel;

    // Overlay + close
    panel.querySelector('.sgdbg-overlay').addEventListener('click', () => this.close());
    panel.querySelector('#sgdbg-close').addEventListener('click', () => this.close());

    // Tab switching
    panel.querySelectorAll('.sgdbg-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        localStorage.setItem('sg-debug-tab', this._activeTab);
        panel.querySelectorAll('.sgdbg-tab').forEach(t => t.classList.toggle('active', t === tab));
        panel.querySelector('#sgdbg-tab-log').style.display     = this._activeTab==='log'     ? 'flex' : 'none';
        panel.querySelector('#sgdbg-tab-sources').style.display = this._activeTab==='sources' ? 'flex' : 'none';
        if (this._activeTab === 'log')     { panel.querySelector('#sgdbg-tab-log').style.flexDirection = 'column'; panel.querySelector('#sgdbg-tab-log').style.flex = '1'; }
        if (this._activeTab === 'sources') { panel.querySelector('#sgdbg-tab-sources').style.flexDirection = 'column'; panel.querySelector('#sgdbg-tab-sources').style.flex = '1'; }
        if (this._activeTab === 'sources') this._renderSources();
      });
    });

    // Log filters
    const filterEl = panel.querySelector('#sgdbg-filter');
    filterEl.addEventListener('input', () => { this._logFilter = filterEl.value; this._renderLog(); });
    let _logKind = null;
    ['all','vault','nav','error'].forEach(k => {
      panel.querySelector(`#sgdbg-f-${k}`)?.addEventListener('click', e => {
        _logKind = k === 'all' ? null : k;
        this._logFilter = _logKind ?? '';
        filterEl.value = this._logFilter;
        panel.querySelectorAll('.sgdbg-tbtn').forEach(b => b.classList.remove('on'));
        e.currentTarget.classList.add('on');
        this._renderLog();
      });
    });
    panel.querySelector('#sgdbg-clear')?.addEventListener('click', () => {
      this._log = []; this._renderLog(); this._updateCounts();
    });
    panel.querySelector('#sgdbg-src-clear')?.addEventListener('click', () => {
      this._sources = []; this._renderSources();
    });

    this._logEl  = panel.querySelector('#sgdbg-log');
    this._srcEl  = panel.querySelector('#sgdbg-sources');
    this._logFilter = '';
  }

  toggle() { this._open ? this.close() : this.open(); }
  open()   { this._open = true;  localStorage.setItem('sg-debug-open','true');  this._applyOpen(); }
  close()  { this._open = false; localStorage.setItem('sg-debug-open','false'); this._applyOpen(); }
  _applyOpen() {
    this._panel.classList.toggle('open', this._open);
    this._btn.classList.toggle('active', this._open);
    if (this._open) { this._renderLog(); if (this._activeTab==='sources') this._renderSources(); }
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  _pushLog(entry) {
    entry.ts = new Date().toLocaleTimeString('en-GB', { hour12:false, second:'2-digit', fractionalSecondDigits:2 });
    entry.id = ++SgDebugPanel._seq;
    this._log.push(entry);
    this._updateCounts();
    if (this._open && this._activeTab==='log') this._renderLog();
  }

  _updateCounts() {
    let vault=0, nav=0, err=0;
    this._log.forEach(e => {
      if (e.kind?.startsWith('vault') || e.kind==='gh') vault++;
      else if (e.kind==='nav') nav++;
      if (e.kind==='error' || e.kind==='vault-err') err++;
    });
    this._panel?.querySelector('#sgdbg-c-vault') && (
      this._panel.querySelector('#sgdbg-c-vault').textContent = `vault ${vault}`,
      this._panel.querySelector('#sgdbg-c-nav').textContent   = `nav ${nav}`,
      this._panel.querySelector('#sgdbg-c-err').textContent   = `err ${err}`
    );
  }

  _renderLog() {
    const f = (this._logFilter ?? '').toLowerCase();
    const entries = this._log.filter(e =>
      !f || (e.kind??'').includes(f) || (e.msg??'').toLowerCase().includes(f) || (e.sub??'').toLowerCase().includes(f)
    );
    if (!entries.length) {
      this._logEl.innerHTML = '<div style="padding:2rem;text-align:center;color:#334155;font-size:11px">No entries</div>';
      return;
    }
    this._logEl.innerHTML = entries.map(e => {
      const cls  = e.kind?.replace(/-ok|-err/,'') ?? 'system';
      const badge = e.kind==='vault-ok'  ? '✓ vault'
                  : e.kind==='vault-err' ? '✗ vault'
                  : e.kind==='vault'     ? '… vault'
                  : e.kind ?? 'info';
      return `<div class="sgdbg-entry ${cls}" data-id="${e.id}">
        <span class="sgdbg-ts">${e.ts}</span>
        <span class="sgdbg-kind">${badge}</span>
        <div>
          <div class="sgdbg-msg">${esc(e.msg??'')}</div>
          ${e.sub ? `<div class="sgdbg-sub">${esc(e.sub)}</div>` : ''}
          ${e.detail ? `<div class="sgdbg-detail">${esc(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail,null,2))}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    this._logEl.querySelectorAll('.sgdbg-entry').forEach(row =>
      row.addEventListener('click', () => row.classList.toggle('expanded'))
    );
    this._logEl.scrollTop = this._logEl.scrollHeight;
  }

  // ── Sources ───────────────────────────────────────────────────────────────

  _pushSource(source) {
    // Replace existing source with same label
    const idx = this._sources.findIndex(s => s.label === source.label);
    if (idx >= 0) this._sources[idx] = source;
    else this._sources.unshift(source);
    if (this._open && this._activeTab==='sources') this._renderSources();
  }

  _renderSources() {
    if (!this._sources.length) {
      this._srcEl.innerHTML = '<div class="sgdbg-src-empty">No sources captured yet.<br>Load an article or nav to populate.</div>';
      return;
    }
    this._srcEl.innerHTML = this._sources.map((s, i) => `
      <div class="sgdbg-source-item${s.open?' open':''}" data-si="${i}">
        <div class="sgdbg-source-hd">
          <span class="sgdbg-source-hd-label">${esc(s.kind)} · ${esc(s.label)}</span>
          <span class="sgdbg-source-hd-meta">${s.size ?? ''}</span>
          <button class="sgdbg-source-hd-copy" data-si="${i}">Copy</button>
        </div>
        <div class="sgdbg-source-body">${esc(s.content)}</div>
      </div>`).join('');

    this._srcEl.querySelectorAll('.sgdbg-source-hd').forEach((hd, i) => {
      hd.addEventListener('click', e => {
        if (e.target.classList.contains('sgdbg-source-hd-copy')) return;
        this._sources[i].open = !this._sources[i].open;
        this._renderSources();
      });
    });
    this._srcEl.querySelectorAll('.sgdbg-source-hd-copy').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const si = parseInt(btn.dataset.si, 10);
        navigator.clipboard?.writeText(this._sources[si]?.content ?? '').then(() => {
          btn.textContent = 'Copied!';
          setTimeout(() => btn.textContent = 'Copy', 1500);
        });
      });
    });
  }

  // ── fetch patch ───────────────────────────────────────────────────────────

  _patchFetch() {
    const self = this;
    this._origFetch = window.fetch;
    window.fetch = async function(input, init) {
      const url    = typeof input === 'string' ? input : (input?.url ?? '');
      const isVault = url.includes('send.sgraph.ai') || (url.includes('vault') && !url.includes('github'));
      const isGH    = url.includes('api.github.com');
      const isNav   = !isVault && !isGH && (url.endsWith('.json') || url.includes('nav'));

      if (isVault || isGH || isNav) {
        const short = url.replace(/^https?:\/\/[^/]+/, '').slice(0, 80);
        const kind  = isVault ? 'vault' : isGH ? 'gh' : 'nav';
        const t0    = performance.now();
        if (isVault || isGH) self._pushLog({ kind, msg: `${kind.toUpperCase()} → ${short}`, sub: 'fetching…' });

        try {
          const res  = await self._origFetch.call(this, input, init);
          const ms   = Math.round(performance.now() - t0);
          const res2 = res.clone();   // clone before body is consumed

          if (isNav && res.ok) {
            res2.text().then(text => {
              try {
                const parsed = JSON.parse(text);
                self._pushSource({ kind: 'nav JSON', label: short, content: JSON.stringify(parsed, null, 2),
                                   size: `${(text.length/1024).toFixed(1)} KB`, open: true });
              } catch { /* not JSON */ }
            }).catch(()=>{});
          }

          if (isVault || isGH) {
            self._pushLog({
              kind:   res.ok ? `${kind}-ok` : `${kind}-err`,
              msg:    `${res.ok ? '✓' : `✗ ${res.status}`} ${short}`,
              sub:    `${ms}ms`,
              detail: res.ok ? null : `HTTP ${res.status} ${res.statusText}`,
            });
          }
          return res;
        } catch (err) {
          const ms = Math.round(performance.now() - t0);
          self._pushLog({ kind: `${kind}-err`, msg: `✗ ${short}`, sub: `${ms}ms · ${err.message}`, detail: err.stack });
          throw err;
        }
      }
      return self._origFetch.call(this, input, init);
    };
  }

  // ── custom events ─────────────────────────────────────────────────────────

  _listenEvents() {
    this._evtAbort = new AbortController();
    const sig  = this._evtAbort.signal;
    const self = this;

    // Nav events
    ['nav:select','nav:loaded','nav:section'].forEach(type => {
      document.addEventListener(type, e => {
        const d   = e.detail ?? {};
        const msg = type==='nav:select'  ? `${d.slug??'?'} — ${d.title??'?'}`
                  : type==='nav:loaded'  ? `${d.totalArticles??0} articles, ${(d.sections??[]).length} sections`
                  : `${d.sectionSlug??'?'} — ${d.title??'?'}`;
        self._pushLog({ kind:'nav', msg:`${type} · ${msg}`, detail: JSON.stringify(d,null,2) });
      }, { signal: sig });
    });

    // Vault content emitted by page scripts
    document.addEventListener('debug:vault-content', e => {
      const { objectId, text, kind } = e.detail ?? {};
      if (text) {
        self._pushSource({ kind: kind ?? 'vault content', label: objectId ?? 'unknown',
                           content: text, size: `${(text.length/1024).toFixed(1)} KB`, open: true });
        self._pushLog({ kind:'vault-ok', msg:`content captured · ${objectId}`, sub:`${(text.length/1024).toFixed(1)} KB` });
      }
    }, { signal: sig });

    // Nav JSON emitted by page scripts
    document.addEventListener('debug:nav-json', e => {
      const { json, src } = e.detail ?? {};
      if (json) {
        self._pushSource({ kind:'nav JSON', label: src ?? 'nav', content: JSON.stringify(json,null,2),
                           size: `${(JSON.stringify(json).length/1024).toFixed(1)} KB`, open: true });
      }
    }, { signal: sig });

    // Console errors
    const origErr  = console.error.bind(console);
    const origWarn = console.warn.bind(console);
    console.error = (...a) => { self._pushLog({ kind:'error', msg: a.map(String).join(' ').slice(0,300) }); origErr(...a); };
    console.warn  = (...a) => { self._pushLog({ kind:'warn',  msg: a.map(String).join(' ').slice(0,300) }); origWarn(...a); };

    window.addEventListener('unhandledrejection', e => {
      self._pushLog({ kind:'error', msg:`Unhandled rejection: ${e.reason?.message??e.reason}`, detail: e.reason?.stack });
    }, { signal: sig });
  }

  // ── keyboard ──────────────────────────────────────────────────────────────

  _listenKeyboard() {
    this._kbAbort = new AbortController();
    document.addEventListener('keydown', e => {
      if (e.key==='D' && e.shiftKey && !e.ctrlKey && !e.metaKey &&
          !['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)) this.toggle();
    }, { signal: this._kbAbort.signal });
  }
}

SgDebugPanel._seq = 0;

function esc(s) {
  return String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

customElements.define('sg-debug-panel', SgDebugPanel);
