/**
 * sg-debug-panel v0.1.8
 *
 * Floating debug overlay for sgraph.ai sub-sites. Three tabs:
 *   Log     — intercepted fetch calls (vault / GitHub API) + custom nav:* events
 *   Fetches — every vault request as a sequenced list OR a Jaeger/X-Ray-style
 *             waterfall trace: bars positioned by start offset, sized by duration,
 *             colour-coded by source component (detected via call stack).
 *             If sg-vault-cache is present, cache hits (IDB ✓) and in-flight
 *             dedup waits (→ inflight) are shown as distinct bar styles with
 *             their own colour coding. An IDB stats bar shows live cache size.
 *             Duplicate network blob fetches are flagged ("dup ×N").
 *   Sources — raw nav JSON tree + last decrypted vault content
 *
 * Only active on qa / dev / localhost — no-op on prod.
 *
 * Usage:  <sg-debug-panel></sg-debug-panel>  (anywhere in <body>)
 * Trigger: ◉ button injected into sg-sub-nav controls, or keyboard Shift+D
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

    this._log           = [];
    this._sources       = [];   // { kind, label, content }
    this._vaultContent  = new Map();   // objectId → decrypted text
    this._vaultFetches  = [];   // ordered vault fetch entries
    this._objFetchCount = new Map();   // objectId → number of times fetched
    this._vaultFetchSeq = 0;
    this._traceT0       = null; // performance.now() of first vault fetch (trace origin)
    this._open          = localStorage.getItem('sg-debug-open') === 'true';
    this._activeTab     = localStorage.getItem('sg-debug-tab') ?? 'log';
    this._fetchView     = localStorage.getItem('sg-debug-fetchview') ?? 'trace';

    this._buildUI();
    this._patchFetch();
    this._listenEvents();
    this._listenKeyboard();
    this._pushLog({ kind: 'system', msg: `sg-debug-panel v0.1.8 · ${env} · ${location.pathname}` });
  }

  disconnectedCallback() {
    if (this._origFetch) window.fetch = this._origFetch;
    this._evtAbort?.abort();
    this._kbAbort?.abort();
    this._btnObserver?.disconnect();
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  _buildUI() {
    const style = document.createElement('style');
    style.textContent = `
      /* Button inside sg-sub-nav controls */
      .sgdbg-btn {
        width: 26px; height: 26px; border-radius: 50%; flex-shrink: 0;
        background: #334155; color: #94a3b8;
        border: 1px solid #475569; cursor: pointer;
        font-size: 12px; display: inline-flex; align-items: center; justify-content: center;
        transition: color .15s, background .15s; user-select: none;
        margin-left: 6px; align-self: center;
      }
      .sgdbg-btn:hover { background: #1e293b; color: #e2e8f0; }
      .sgdbg-btn.active { color: #38bdf8; border-color: #38bdf8; background: #1e293b; }
      /* Fallback: fixed positioning when no sg-sub-nav found */
      .sgdbg-btn.sgdbg-btn--fixed {
        position: fixed; bottom: 14px; right: 14px; z-index: 9000;
        box-shadow: 0 2px 8px rgba(0,0,0,.4);
      }

      /* Container is always pointer-events:none — only the drawer itself is interactive */
      .sgdbg-panel {
        position: fixed; inset: 0; z-index: 8999;
        pointer-events: none;
      }

      .sgdbg-drawer {
        position: absolute; top: 0; right: 0; bottom: 0;
        width: var(--sgdbg-w, min(720px, 96vw));
        min-width: 320px; max-width: 96vw;
        background: #0f172a; color: #e2e8f0;
        display: flex; flex-direction: column;
        transform: translateX(100%); transition: transform .22s ease;
        box-shadow: -4px 0 24px rgba(0,0,0,.5);
        font-family: 'DM Mono', 'Menlo', 'Consolas', monospace;
        font-size: 12px;
        pointer-events: all;   /* drawer is interactive even when overlay is not */
        overscroll-behavior: contain;
      }
      .sgdbg-drawer.resizing { transition: none; user-select: none; }
      .sgdbg-panel.open .sgdbg-drawer { transform: translateX(0); }

      /* Resize handle — draggable left edge */
      .sgdbg-resize {
        position: absolute; top: 0; left: 0; bottom: 0; width: 6px;
        cursor: col-resize; z-index: 1;
        background: transparent;
        transition: background .15s;
      }
      .sgdbg-resize:hover, .sgdbg-resize.dragging { background: #38bdf844; }

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
      .sgdbg-log { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; overscroll-behavior: contain; }
      .sgdbg-entry {
        display: grid; grid-template-columns: 32px 56px 60px 1fr;
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
      .sgdbg-idx  { color: #334155; font-size: 9px; padding-top: 2px; white-space: nowrap; text-align: right; }
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
      .sgdbg-sources { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0; overscroll-behavior: contain; }
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
        font-size: 10.5px; color: #94a3b8; max-height: 60vh; overflow-y: auto;
        background: #0a1122; overscroll-behavior: contain;
      }
      /* JSON syntax highlighting */
      .sgdbg-jk { color: #7dd3fc; }
      .sgdbg-jv { color: #86efac; }
      .sgdbg-jn { color: #fda4af; }
      .sgdbg-jb { color: #fbbf24; }
      .sgdbg-source-item.open .sgdbg-source-body { display: block; }
      .sgdbg-src-empty { padding: 2rem; text-align: center; color: #334155; font-size: 11px; }

      /* Fetches tab */
      .sgdbg-fetches-log { flex: 1; min-height: 0; overflow-y: auto; padding: 4px 0; overscroll-behavior: contain; }
      .sgdbg-frow {
        display: grid;
        grid-template-columns: 28px 64px 44px 1fr auto;
        gap: 0 6px; padding: 3px 14px;
        border-bottom: 1px solid #1e293b0a;
        border-left: 2px solid #334155;
        align-items: baseline;
      }
      .sgdbg-frow.blob   { border-left-color: #7c3aed88; }
      .sgdbg-frow.ref    { border-left-color: #0369a1; }
      .sgdbg-frow.tree   { border-left-color: #16a34a; }
      .sgdbg-frow.commit { border-left-color: #475569; }
      .sgdbg-frow.other  { border-left-color: #334155; }
      .sgdbg-frow.dup-blob { border-left-color: #f59e0b; background: #f59e0b07; }
      .sgdbg-frow.fetch-err { border-left-color: #dc2626; }
      .sgdbg-f-seq  { color: #334155; font-size: 9px; text-align: right; white-space: nowrap; }
      .sgdbg-f-ts   { color: #475569; font-size: 10px; white-space: nowrap; }
      .sgdbg-f-type {
        font-size: 9px; font-weight: 700; text-transform: uppercase;
        letter-spacing: .05em; white-space: nowrap;
      }
      .sgdbg-frow.blob   .sgdbg-f-type { color: #a78bfa; }
      .sgdbg-frow.ref    .sgdbg-f-type { color: #38bdf8; }
      .sgdbg-frow.tree   .sgdbg-f-type { color: #4ade80; }
      .sgdbg-frow.commit .sgdbg-f-type { color: #94a3b8; }
      .sgdbg-frow.other  .sgdbg-f-type { color: #475569; }
      .sgdbg-frow.dup-blob .sgdbg-f-type { color: #fbbf24; }
      .sgdbg-f-id  { color: #cbd5e1; font-size: 11px; word-break: break-all; min-width: 0; }
      .sgdbg-f-id .sgdbg-f-vid { color: #334155; font-size: 9px; }
      .sgdbg-f-right { display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
      .sgdbg-f-dur  { color: #475569; font-size: 10px; white-space: nowrap; }
      .sgdbg-f-dur.slow  { color: #fbbf24; }
      .sgdbg-f-dur.vslow { color: #f87171; }
      .sgdbg-f-dup {
        font-size: 9px; font-weight: 700; color: #f59e0b;
        background: #f59e0b11; border: 1px solid #f59e0b44;
        border-radius: 3px; padding: 0 4px; white-space: nowrap;
      }
      .sgdbg-fetches-empty { padding: 2rem; text-align: center; color: #334155; font-size: 11px; }
      .sgdbg-f-src { font-weight: 700; font-size: 9px; text-transform: lowercase; margin-right: 4px; }

      /* IDB stats bar */
      .sgdbg-idb-bar {
        display: flex; align-items: center; gap: 8px;
        padding: 5px 14px; border-bottom: 1px solid #1e293b;
        background: #16a34a0d; flex-shrink: 0;
      }
      .sgdbg-idb-label { font-size: 9px; font-weight: 700; text-transform: uppercase; color: #4ade80; letter-spacing: .06em; }
      .sgdbg-idb-stats { font-size: 10px; color: #94a3b8; }
      .sgdbg-idb-inflight { font-size: 10px; color: #fbbf24; margin-left: auto; }

      /* Cache-type row variants */
      .sgdbg-frow.idb-hit  { border-left-color: #16a34a; background: #16a34a07; }
      .sgdbg-frow.inflight { border-left-color: #a78bfa; background: #7c3aed07; }
      .sgdbg-frow.idb-hit  .sgdbg-f-type { color: #4ade80; }
      .sgdbg-frow.inflight .sgdbg-f-type { color: #c4b5fd; }

      /* Fetches — trace / waterfall (Jaeger / X-Ray style) */
      .sgdbg-trace-legend {
        display: flex; flex-wrap: wrap; gap: 4px 12px;
        padding: 6px 14px; border-bottom: 1px solid #1e293b;
        font-size: 10px; color: #94a3b8; flex-shrink: 0;
      }
      .sgdbg-trace-legend-item { display: inline-flex; align-items: center; gap: 4px; }
      .sgdbg-trace-swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
      .sgdbg-trace-axis {
        position: relative; height: 16px; margin-left: 132px;
        border-bottom: 1px solid #1e293b; flex-shrink: 0;
      }
      .sgdbg-trace-tick {
        position: absolute; top: 2px; transform: translateX(-50%);
        font-size: 9px; color: #475569; white-space: nowrap;
      }
      .sgdbg-trace-tick:first-child { transform: none; }
      .sgdbg-trace-tick:last-child  { transform: translateX(-100%); }
      .sgdbg-trace-rows { padding: 2px 0; }
      .sgdbg-trace-row {
        display: grid; grid-template-columns: 132px 1fr;
        align-items: center; gap: 0; min-height: 18px;
        border-bottom: 1px solid #1e293b0a;
      }
      .sgdbg-trace-row:hover { background: #1e293b66; }
      .sgdbg-trace-row.dup { background: #f59e0b08; }
      .sgdbg-trace-gutter {
        display: flex; align-items: center; gap: 5px;
        padding: 0 6px 0 14px; overflow: hidden; white-space: nowrap;
      }
      .sgdbg-trace-seq  { color: #334155; font-size: 9px; }
      .sgdbg-trace-src  { font-size: 9px; font-weight: 700; text-overflow: ellipsis; overflow: hidden; }
      .sgdbg-trace-type { font-size: 8px; font-weight: 700; text-transform: uppercase; opacity: .8; }
      .sgdbg-trace-track {
        position: relative; height: 14px; margin-right: 8px;
      }
      .sgdbg-trace-bar {
        position: absolute; top: 2px; height: 10px; border-radius: 2px;
        min-width: 2px; opacity: .85;
      }
      .sgdbg-trace-bar.inflight  { opacity: .5; background-image: repeating-linear-gradient(45deg, #ffffff22 0 4px, transparent 4px 8px); }
      .sgdbg-trace-bar.idb-cached { opacity: 1; height: 8px; top: 3px; min-width: 4px; border-radius: 1px; }
      .sgdbg-trace-row.err .sgdbg-trace-bar { background: #dc2626 !important; }
      .sgdbg-trace-bar-label {
        position: absolute; top: 0; font-size: 9px; color: #94a3b8;
        white-space: nowrap; padding: 0 5px; line-height: 14px; pointer-events: none;
      }

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

    // Toggle button — will be mounted into sg-sub-nav controls
    const btn = document.createElement('button');
    btn.className = 'sgdbg-btn' + (this._open ? ' active' : '');
    btn.title = 'Debug panel (Shift+D)';
    btn.textContent = '◉';
    btn.addEventListener('click', () => this.toggle());
    this._btn = btn;
    this._mountBtn();

    // Panel
    const panel = document.createElement('div');
    panel.className = 'sgdbg-panel' + (this._open ? ' open' : '');
    panel.innerHTML = `
      <div class="sgdbg-drawer">
        <div class="sgdbg-resize" id="sgdbg-resize"></div>
        <div class="sgdbg-head">
          <span class="sgdbg-title">◉ Debug</span>
          <div class="sgdbg-tabs">
            <button class="sgdbg-tab${this._activeTab==='log'?' active':''}" data-tab="log">Log</button>
            <button class="sgdbg-tab${this._activeTab==='fetches'?' active':''}" data-tab="fetches">Fetches</button>
            <button class="sgdbg-tab${this._activeTab==='sources'?' active':''}" data-tab="sources">Sources</button>
          </div>
          <div class="sgdbg-counts">
            <span class="sgdbg-count vault" id="sgdbg-c-vault">vault 0</span>
            <span class="sgdbg-count nav"   id="sgdbg-c-nav">nav 0</span>
            <span class="sgdbg-count err"   id="sgdbg-c-err">err 0</span>
          </div>
        </div>

        <!-- LOG tab -->
        <div id="sgdbg-tab-log" style="${this._activeTab==='log'?'display:flex;flex-direction:column;flex:1;min-height:0':'display:none'}">
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

        <!-- FETCHES tab -->
        <div id="sgdbg-tab-fetches" style="${this._activeTab==='fetches'?'display:flex;flex-direction:column;flex:1;min-height:0':'display:none'}">
          <div class="sgdbg-toolbar">
            <span id="sgdbg-fetches-summary" style="font-size:10px;color:#475569;flex:1">0 requests</span>
            <button class="sgdbg-tbtn${this._fetchView!=='list'?' on':''}" id="sgdbg-fetches-trace">Trace</button>
            <button class="sgdbg-tbtn${this._fetchView==='list'?' on':''}" id="sgdbg-fetches-list">List</button>
            <button class="sgdbg-tbtn" id="sgdbg-fetches-clear">Clear</button>
            <button class="sgdbg-tbtn" id="sgdbg-idb-clear" title="Clear IndexedDB cache">IDB ✕</button>
          </div>
          <div class="sgdbg-idb-bar" id="sgdbg-idb-bar" hidden>
            <span class="sgdbg-idb-label">IDB cache</span>
            <span id="sgdbg-idb-stats" class="sgdbg-idb-stats">—</span>
            <span id="sgdbg-idb-inflight" class="sgdbg-idb-inflight"></span>
          </div>
          <div class="sgdbg-fetches-log" id="sgdbg-fetches-log">
            <div class="sgdbg-fetches-empty">No vault requests captured yet.<br>Load a page or article to populate.</div>
          </div>
        </div>

        <!-- SOURCES tab -->
        <div id="sgdbg-tab-sources" style="${this._activeTab==='sources'?'display:flex;flex-direction:column;flex:1;min-height:0':'display:none'}">
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

    panel.querySelector('#sgdbg-close').addEventListener('click', () => this.close());

    // Resize handle
    this._initResize(panel.querySelector('#sgdbg-resize'), panel.querySelector('.sgdbg-drawer'));

    // Tab switching
    panel.querySelectorAll('.sgdbg-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        this._activeTab = tab.dataset.tab;
        localStorage.setItem('sg-debug-tab', this._activeTab);
        panel.querySelectorAll('.sgdbg-tab').forEach(t => t.classList.toggle('active', t === tab));
        panel.querySelector('#sgdbg-tab-log').style.display     = this._activeTab==='log'     ? 'flex' : 'none';
        panel.querySelector('#sgdbg-tab-fetches').style.display = this._activeTab==='fetches' ? 'flex' : 'none';
        panel.querySelector('#sgdbg-tab-sources').style.display = this._activeTab==='sources' ? 'flex' : 'none';
        if (this._activeTab === 'log')     { const el = panel.querySelector('#sgdbg-tab-log');     el.style.flexDirection='column'; el.style.flex='1'; el.style.minHeight='0'; }
        if (this._activeTab === 'fetches') { const el = panel.querySelector('#sgdbg-tab-fetches'); el.style.flexDirection='column'; el.style.flex='1'; el.style.minHeight='0'; }
        if (this._activeTab === 'sources') { const el = panel.querySelector('#sgdbg-tab-sources'); el.style.flexDirection='column'; el.style.flex='1'; el.style.minHeight='0'; }
        if (this._activeTab === 'fetches') this._renderFetches();
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
    panel.querySelector('#sgdbg-fetches-clear')?.addEventListener('click', () => {
      this._vaultFetches = []; this._objFetchCount = new Map();
      this._vaultFetchSeq = 0; this._traceT0 = null;
      this._renderFetches(); this._updateFetchSummary();
    });
    const setFetchView = (view) => {
      this._fetchView = view;
      localStorage.setItem('sg-debug-fetchview', view);
      panel.querySelector('#sgdbg-fetches-trace').classList.toggle('on', view !== 'list');
      panel.querySelector('#sgdbg-fetches-list').classList.toggle('on', view === 'list');
      this._renderFetches();
    };
    panel.querySelector('#sgdbg-fetches-trace')?.addEventListener('click', () => setFetchView('trace'));
    panel.querySelector('#sgdbg-fetches-list')?.addEventListener('click',  () => setFetchView('list'));

    panel.querySelector('#sgdbg-idb-clear')?.addEventListener('click', () => {
      window.sgVaultCache?.clearIdb().then(() => this._refreshIdbStats());
    });

    // Show IDB stats bar only if vault cache is present; refresh periodically
    if (window.sgVaultCache) {
      panel.querySelector('#sgdbg-idb-bar').hidden = false;
      this._refreshIdbStats();
    }

    this._logEl   = panel.querySelector('#sgdbg-log');
    this._srcEl   = panel.querySelector('#sgdbg-sources');
    this._fetchEl = panel.querySelector('#sgdbg-fetches-log');
    this._logFilter = '';

    // Auto-scroll: pinned to bottom by default; un-pins when user scrolls up
    this._fetchScrollPinned = true;
    this._fetchEl.addEventListener('scroll', () => {
      const el = this._fetchEl;
      this._fetchScrollPinned = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    });
  }

  // ── Button placement ──────────────────────────────────────────────────────

  _mountBtn() {
    const attach = () => {
      const controls = document.querySelector('sg-sub-nav .sg-sub-nav__controls');
      if (controls) {
        if (!controls.contains(this._btn)) controls.appendChild(this._btn);
      } else if (!document.body.contains(this._btn)) {
        this._btn.classList.add('sgdbg-btn--fixed');
        document.body.appendChild(this._btn);
      }
    };
    // Try immediately, then watch for sg-sub-nav to render
    attach();
    const subNav = document.querySelector('sg-sub-nav');
    if (subNav) {
      const mo = new MutationObserver(attach);
      mo.observe(subNav, { childList: true, subtree: false });
      this._btnObserver = mo;
    }
  }

  // ── Resize handle ─────────────────────────────────────────────────────────

  _initResize(handle, drawer) {
    if (!handle || !drawer) return;
    const STORE_KEY = 'sg-debug-width';
    // Restore saved width
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) document.documentElement.style.setProperty('--sgdbg-w', `${saved}px`);

    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      drawer.classList.add('resizing');
      handle.classList.add('dragging');
      const startX = e.clientX;
      const startW = drawer.getBoundingClientRect().width;
      const onMove = mv => {
        const newW = Math.max(320, Math.min(window.innerWidth * 0.96, startW + (startX - mv.clientX)));
        document.documentElement.style.setProperty('--sgdbg-w', `${newW}px`);
      };
      const onUp = () => {
        drawer.classList.remove('resizing');
        handle.classList.remove('dragging');
        const finalW = drawer.getBoundingClientRect().width;
        localStorage.setItem(STORE_KEY, Math.round(finalW));
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  toggle() { this._open ? this.close() : this.open(); }
  open()   { this._open = true;  localStorage.setItem('sg-debug-open','true');  this._applyOpen(); }
  close()  { this._open = false; localStorage.setItem('sg-debug-open','false'); this._applyOpen(); }
  _applyOpen() {
    this._panel.classList.toggle('open', this._open);
    this._btn.classList.toggle('active', this._open);
    if (this._open) {
      this._renderLog();
      if (this._activeTab === 'fetches') this._renderFetches();
      if (this._activeTab === 'sources') this._renderSources();
    }
  }

  // ── Log ───────────────────────────────────────────────────────────────────

  _pushLog(entry) {
    entry.ts = new Date().toLocaleTimeString('en-GB', { hour12:false, second:'2-digit', fractionalSecondDigits:2 });
    entry.id = ++SgDebugPanel._seq;
    this._log.unshift(entry);
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
      const cls   = e.kind?.replace(/-ok|-err/,'') ?? 'system';
      const badge = e.kind==='vault-ok'  ? '✓ vault'
                  : e.kind==='vault-err' ? '✗ vault'
                  : e.kind==='vault'     ? '… vault'
                  : e.kind ?? 'info';
      const hasContent = e.objectId && this._vaultContent.has(e.objectId);
      const contentHl  = hasContent
        ? hlJson(this._vaultContent.get(e.objectId).slice(0, 40000))
        : '';
      return `<div class="sgdbg-entry ${cls}" data-id="${e.id}">
        <span class="sgdbg-idx">#${e.id}</span>
        <span class="sgdbg-ts">${e.ts}</span>
        <span class="sgdbg-kind">${badge}</span>
        <div>
          <div class="sgdbg-msg">${esc(e.msg??'')}</div>
          ${e.sub ? `<div class="sgdbg-sub">${esc(e.sub)}</div>` : ''}
          ${e.detail ? `<div class="sgdbg-detail">${esc(typeof e.detail==='string'?e.detail:JSON.stringify(e.detail,null,2))}</div>` : ''}
          ${hasContent ? `<div class="sgdbg-detail">${contentHl}</div>` : ''}
        </div>
      </div>`;
    }).join('');
    this._logEl.querySelectorAll('.sgdbg-entry').forEach(row =>
      row.addEventListener('click', () => row.classList.toggle('expanded'))
    );
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
    this._srcEl.innerHTML = '';
    if (!this._sources.length) {
      const empty = document.createElement('div');
      empty.className = 'sgdbg-src-empty';
      empty.innerHTML = 'No sources captured yet.<br>Load an article or nav to populate.';
      this._srcEl.appendChild(empty);
      return;
    }
    this._sources.forEach((s, i) => {
      const item = document.createElement('div');
      item.className = 'sgdbg-source-item' + (s.open ? ' open' : '');

      const hd = document.createElement('div');
      hd.className = 'sgdbg-source-hd';

      const lbl = document.createElement('span');
      lbl.className = 'sgdbg-source-hd-label';
      lbl.textContent = `${s.kind} · ${s.label}`;

      const meta = document.createElement('span');
      meta.className = 'sgdbg-source-hd-meta';
      meta.textContent = s.size ?? '';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'sgdbg-source-hd-copy';
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', e => {
        e.stopPropagation();
        navigator.clipboard?.writeText(s.content ?? '').then(() => {
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
        });
      });

      hd.appendChild(lbl);
      hd.appendChild(meta);
      hd.appendChild(copyBtn);
      hd.addEventListener('click', e => {
        if (e.target === copyBtn) return;
        this._sources[i].open = !this._sources[i].open;
        item.classList.toggle('open', this._sources[i].open);
      });

      const body = document.createElement('div');
      body.className = 'sgdbg-source-body';
      const isJson = s.kind?.toLowerCase().includes('json');
      if (isJson) {
        body.innerHTML = hlJson(s.content ?? '');
      } else {
        body.textContent = s.content ?? '';
      }

      item.appendChild(hd);
      item.appendChild(body);
      this._srcEl.appendChild(item);
    });
  }

  // ── Fetches ───────────────────────────────────────────────────────────────

  // Identify the component that initiated a fetch, by inspecting the call stack.
  // The patched fetch wrapper and the vault-client library frames are skipped so
  // the first *application* frame (a custom element module or page script) wins.
  _detectSource() {
    const stack = (new Error()).stack || '';
    const lines = stack.split('\n');
    for (const line of lines) {
      if (line.includes('sg-debug-panel')) continue;   // the patch itself
      if (line.includes('sg-vault-client')) continue;  // the crypto/IO library
      const m = line.match(/([\w.\-]+)\.(?:js|mjs|html)(?::\d+:\d+)?/);
      if (!m) continue;
      const file = m[1];
      if (file.includes('sg-side-nav'))       return 'side-nav';
      if (file.includes('sg-sub-nav'))        return 'sub-nav';
      if (file.includes('sg-search'))         return 'search';
      if (file.includes('sg-article-viewer')) return 'article-viewer';
      if (file.includes('sg-debug-panel'))    continue;
      if (file === 'index' || file.endsWith('index')) return 'page';
      // Any other named module/page becomes its short name
      return file.split('/').pop();
    }
    return 'page';
  }

  _sourceColor(source) {
    const PALETTE = {
      'side-nav':       '#38bdf8',
      'sub-nav':        '#a78bfa',
      'search':         '#4ade80',
      'article-viewer': '#fbbf24',
      'page':           '#f472b6',
    };
    if (PALETTE[source]) return PALETTE[source];
    // Stable hash → hue for any other source
    let h = 0;
    for (let i = 0; i < (source ?? '').length; i++) h = (h * 31 + source.charCodeAt(i)) % 360;
    return `hsl(${h}, 65%, 62%)`;
  }

  _renderFetches() {
    const el = this._fetchEl;
    if (!el) return;
    if (!this._vaultFetches.length) {
      el.innerHTML = '<div class="sgdbg-fetches-empty">No vault requests captured yet.<br>Load a page or article to populate.</div>';
      return;
    }
    if (this._fetchView === 'list') this._renderFetchesList(el);
    else                            this._renderFetchesTrace(el);
    if (this._fetchScrollPinned) requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
  }

  _renderFetchesList(el) {
    el.innerHTML = this._vaultFetches.map(f => {
      const ct        = f.cacheType ?? 'network';
      const isDupBlob = f.objType === 'blob' && f.dupNum > 0 && ct === 'network';
      const rowCls    = ['sgdbg-frow',
        ct === 'idb-hit'  ? 'idb-hit'  :
        ct === 'inflight' ? 'inflight'  :
        f.objType ?? 'other',
        isDupBlob ? 'dup-blob' : '',
        f.ok === false ? 'fetch-err' : ''].filter(Boolean).join(' ');
      const durCls    = f.durationMs == null ? '' : f.durationMs > 500 ? ' vslow' : f.durationMs > 200 ? ' slow' : '';
      const displayId = f.objId.startsWith('obj-') ? f.objId
                      : f.objId.length > 16 ? f.objId.slice(0, 16) + '…'
                      : f.objId;
      const durText   = f.durationMs != null ? `${f.durationMs}ms` : '…';
      const sizeText  = f.sizekb ? ` · ${f.sizekb}KB` : '';
      const srcColor  = this._sourceColor(f.source);
      const typeLabel = ct === 'idb-hit' ? 'IDB ✓'
                      : ct === 'inflight' ? '→ dedup'
                      : (f.objType ?? '?');
      return `<div class="${rowCls}">
        <span class="sgdbg-f-seq">#${f.seq}</span>
        <span class="sgdbg-f-ts">${f.ts}</span>
        <span class="sgdbg-f-type">${typeLabel}</span>
        <span class="sgdbg-f-id">
          <span class="sgdbg-f-src" style="color:${srcColor}">${esc(f.source ?? '?')}</span>
          ${esc(displayId)} <span class="sgdbg-f-vid">[${esc(f.vaultId)}]</span>
        </span>
        <span class="sgdbg-f-right">
          <span class="sgdbg-f-dur${durCls}">${durText}${sizeText}</span>
          ${isDupBlob ? `<span class="sgdbg-f-dup">dup ×${f.dupNum + 1}</span>` : ''}
        </span>
      </div>`;
    }).join('');
  }

  // Jaeger / X-Ray style waterfall: each request is a span positioned by its
  // start offset and sized by duration. Bars are colour-coded by source
  // component so parallel duplicate dependency chains are visually obvious.
  _renderFetchesTrace(el) {
    const fetches = this._vaultFetches;
    const base = this._traceT0 ?? fetches[0].startPerf;
    // Total span = from first start to the latest end (use elapsed-so-far for in-flight)
    const now  = performance.now();
    let maxEnd = 0;
    for (const f of fetches) {
      const end = f.startPerf + (f.durationMs != null ? f.durationMs : (now - f.startPerf));
      if (end - base > maxEnd) maxEnd = end - base;
    }
    const total = Math.max(maxEnd, 1);

    // Time axis ticks (~5 divisions)
    const tickCount = 5;
    const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
      const ms = Math.round((total / tickCount) * i);
      const pct = (i / tickCount) * 100;
      return `<span class="sgdbg-trace-tick" style="left:${pct}%">${ms}ms</span>`;
    }).join('');

    // Source legend (distinct sources in first-seen order)
    const seenSrc = [];
    for (const f of fetches) if (!seenSrc.includes(f.source)) seenSrc.push(f.source);
    const legend = [
      ...seenSrc.map(s =>
        `<span class="sgdbg-trace-legend-item">
           <span class="sgdbg-trace-swatch" style="background:${this._sourceColor(s)}"></span>${esc(s ?? '?')}
         </span>`),
      ...(fetches.some(f => f.cacheType === 'idb-hit')
        ? [`<span class="sgdbg-trace-legend-item"><span class="sgdbg-trace-swatch" style="background:#16a34a"></span>IDB ✓</span>`] : []),
      ...(fetches.some(f => f.cacheType === 'inflight')
        ? [`<span class="sgdbg-trace-legend-item"><span class="sgdbg-trace-swatch" style="background:#7c3aed"></span>→ dedup</span>`] : []),
    ].join('');

    const rows = fetches.map(f => {
      const ct          = f.cacheType ?? 'network';
      const startOffset = f.startPerf - base;
      const dur         = f.durationMs != null ? f.durationMs : (now - f.startPerf);
      const leftPct     = (startOffset / total) * 100;
      // IDB hits and inflight waits show as a narrow marker at their start position
      const widthPct    = ct === 'idb-hit' ? Math.max((dur / total) * 100, 0.3)
                        : Math.max((dur / total) * 100, 0.6);
      const labelLeft   = leftPct < 55;
      const srcColor    = this._sourceColor(f.source);
      const barColor    = ct === 'idb-hit'  ? '#16a34a'
                        : ct === 'inflight' ? '#7c3aed'
                        : srcColor;
      const isDupBlob   = f.objType === 'blob' && f.dupNum > 0 && ct === 'network';
      const displayId   = f.objId.length > 22 ? f.objId.slice(0, 22) + '…' : f.objId;
      const pending     = f.durationMs == null;
      const durText     = pending ? '…' : `${f.durationMs}ms`;
      const typeLabel   = ct === 'idb-hit' ? 'IDB' : ct === 'inflight' ? 'dedup' : (f.objType ?? '?');
      const barExtra    = isDupBlob ? ';outline:1px solid #f59e0b' : '';
      const barCls      = ct === 'inflight' ? ' inflight'
                        : ct === 'idb-hit'  ? ' idb-cached'
                        : pending            ? ' inflight'
                        : '';
      const labelText   = ct === 'idb-hit' ? `IDB ✓ ${displayId}` : ct === 'inflight' ? `→ dedup ${durText}` : `${displayId} · ${durText}`;
      const rowCls      = `sgdbg-trace-row${isDupBlob ? ' dup' : ''}${f.ok === false ? ' err' : ''}`;
      return `<div class="${rowCls}">
        <div class="sgdbg-trace-gutter">
          <span class="sgdbg-trace-seq">#${f.seq}</span>
          <span class="sgdbg-trace-src" style="color:${srcColor}">${esc(f.source ?? '?')}</span>
          <span class="sgdbg-trace-type">${typeLabel}</span>
        </div>
        <div class="sgdbg-trace-track">
          <div class="sgdbg-trace-bar${barCls}"
               style="left:${leftPct}%;width:${widthPct}%;background:${barColor}${barExtra}"
               title="${esc(`${typeLabel} ${displayId} · ${durText}`)}"></div>
          <span class="sgdbg-trace-bar-label" style="${labelLeft ? `left:calc(${leftPct}% + ${widthPct}% + 3px)` : `right:calc(${100 - leftPct}% + 3px)`}">${esc(labelText)}${isDupBlob ? ` <span class="sgdbg-f-dup">dup ×${f.dupNum + 1}</span>` : ''}</span>
        </div>
      </div>`;
    }).join('');

    el.innerHTML = `
      <div class="sgdbg-trace-legend">${legend}</div>
      <div class="sgdbg-trace-axis">${ticks}</div>
      <div class="sgdbg-trace-rows">${rows}</div>`;
  }

  _updateFetchSummary() {
    const sumEl = this._panel?.querySelector('#sgdbg-fetches-summary');
    if (!sumEl) return;
    const total     = this._vaultFetches.length;
    const networks  = this._vaultFetches.filter(f => f.cacheType === 'network' || f.cacheType == null);
    const idbHits   = this._vaultFetches.filter(f => f.cacheType === 'idb-hit').length;
    const inflights = this._vaultFetches.filter(f => f.cacheType === 'inflight').length;
    const blobs     = networks.filter(f => f.objType === 'blob');
    const uniq      = new Set(blobs.map(f => f.objId)).size;
    const dups      = blobs.filter(f => f.dupNum > 0).length;
    const byType    = {};
    for (const f of networks) byType[f.objType] = (byType[f.objType] ?? 0) + 1;
    const parts = [`${total} req`];
    if (networks.length < total) parts.push(`${networks.length} net`);
    if (idbHits)    parts.push(`${idbHits} IDB✓`);
    if (inflights)  parts.push(`${inflights} dedup`);
    if (byType.blob)   parts.push(`${byType.blob} blob${byType.blob > 1 ? 's' : ''} (${uniq} uniq)`);
    if (byType.ref)    parts.push(`${byType.ref} ref`);
    if (byType.commit) parts.push(`${byType.commit} commit`);
    if (byType.tree)   parts.push(`${byType.tree} tree`);
    if (dups > 0)      parts.push(`⚠ ${dups} dup${dups > 1 ? 's' : ''}`);
    sumEl.textContent = parts.join(' · ');
    const tabBtn = this._panel?.querySelector('.sgdbg-tab[data-tab="fetches"]');
    if (tabBtn) tabBtn.textContent = dups > 0 ? `Fetches ⚠${dups}` : `Fetches${total ? ` ${total}` : ''}`;
  }

  _refreshIdbStats() {
    const bar  = this._panel?.querySelector('#sgdbg-idb-bar');
    const stat = this._panel?.querySelector('#sgdbg-idb-stats');
    const inf  = this._panel?.querySelector('#sgdbg-idb-inflight');
    if (!bar || !stat) return;
    if (!window.sgVaultCache) { bar.hidden = true; return; }
    bar.hidden = false;
    window.sgVaultCache.idbStats().then(s => {
      if (stat) stat.textContent = `${s.count} objects · ${(s.bytes / 1024).toFixed(0)} KB`;
    }).catch(() => {});
    if (inf) {
      const n = window.sgVaultCache.inFlightCount;
      inf.textContent = n > 0 ? `${n} in-flight` : '';
    }
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
        const decoded = decodeURIComponent(url);
        const short   = decoded.replace(/^https?:\/\/[^/]+/, '').slice(0, 100);
        const kind    = isVault ? 'vault' : isGH ? 'gh' : 'nav';
        const t0      = performance.now();

        // Pre-request: classify vault path and record in fetches log
        let vfe = null;  // vault fetch entry
        if (isVault) {
          const parts   = decoded.split('/');
          // URL shape: https://send.sgraph.ai/api/vault/read/{vaultId}/{pathSegments...}
          // parts[6] = vaultId, parts[7+] = path type
          const vaultId = parts[6] ?? '?';
          const subPath = parts.slice(7).join('/');
          const objType = subPath.startsWith('ref/')    ? 'ref'
                        : subPath.startsWith('tree/')   ? 'tree'
                        : subPath.startsWith('commit/') ? 'commit'
                        : subPath.includes('obj-cas-imm') || subPath.startsWith('bare/') ? 'blob'
                        : 'other';
          const objId   = parts.pop() ?? '';
          const prevCnt = self._objFetchCount.get(objId) ?? 0;
          self._objFetchCount.set(objId, prevCnt + 1);
          vfe = {
            seq:       ++self._vaultFetchSeq,
            ts:        new Date().toLocaleTimeString('en-GB', { hour12:false, second:'2-digit', fractionalSecondDigits:2 }),
            objType, objId, vaultId,
            source:    self._detectSource(),   // calling component (from stack)
            dupNum:    prevCnt,                 // >0 means this is a duplicate
            startPerf: t0,                      // performance.now() at request start
            cacheType: null,                    // filled in post-response: 'idb-hit'|'inflight'|'network'
            ok:        null, durationMs: null, sizekb: null,
          };
          if (self._traceT0 == null) self._traceT0 = t0;
          self._vaultFetches.push(vfe);
          self._updateFetchSummary();
          if (self._open && self._activeTab === 'fetches') self._renderFetches();
        }

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
            // Extract last path segment as objectId for vault entries
            const objectId = isVault ? (decoded.split('/').pop() ?? '') : undefined;
            self._pushLog({
              kind:     res.ok ? `${kind}-ok` : `${kind}-err`,
              msg:      `${res.ok ? '✓' : `✗ ${res.status}`} ${short}`,
              sub:      `${ms}ms`,
              objectId: res.ok ? objectId : undefined,
              detail:   res.ok ? null : `HTTP ${res.status} ${res.statusText}`,
            });
          }

          // Post-request: fill in duration + size + cache type for vault fetch entry
          if (vfe) {
            vfe.ok = res.ok;
            vfe.durationMs = ms;
            const sgCache = res.headers.get('x-sg-cache');
            vfe.cacheType = sgCache ?? 'network';  // 'idb-hit' | 'inflight' | 'network'
            if (sgCache === 'inflight') {
              const wms = parseInt(res.headers.get('x-sg-wait-ms') ?? '0', 10);
              vfe.durationMs = wms;  // show actual wait time, not full network time
            }
            const cl = res.headers.get('content-length');
            if (cl) vfe.sizekb = (parseInt(cl, 10) / 1024).toFixed(1);
            self._updateFetchSummary();
            if (self._open && self._activeTab === 'fetches') self._renderFetches();
            if (sgCache && sgCache !== 'network') self._refreshIdbStats();
          }

          return res;
        } catch (err) {
          const ms = Math.round(performance.now() - t0);
          self._pushLog({ kind: `${kind}-err`, msg: `✗ ${short}`, sub: `${ms}ms · ${err.message}`, detail: err.stack });
          if (vfe) { vfe.ok = false; vfe.durationMs = ms; self._updateFetchSummary(); if (self._open && self._activeTab === 'fetches') self._renderFetches(); }
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
        // Store for on-demand display in log entries
        if (objectId) self._vaultContent.set(objectId, text);
        self._pushSource({ kind: kind ?? 'vault content', label: objectId ?? 'unknown',
                           content: text, size: `${(text.length/1024).toFixed(1)} KB`, open: true });
        self._pushLog({ kind:'vault-ok', msg:`content captured · ${objectId}`,
                        sub: `${(text.length/1024).toFixed(1)} KB · click to expand`,
                        objectId });
        // Re-render so any earlier fetch log entry for this objectId shows the content
        if (self._open && self._activeTab === 'log') self._renderLog();
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

function hlJson(raw) {
  // Escape HTML, then apply single-pass token regex for syntax highlighting
  const h = raw.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return h.replace(
    /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?)|(true|false|null)/g,
    (m, str, colon, num, kw) => {
      if (str && colon) return `<span class="sgdbg-jk">${str}</span>${colon}`;
      if (str)          return `<span class="sgdbg-jv">${str}</span>`;
      if (num !== undefined && num !== '') return `<span class="sgdbg-jn">${num}</span>`;
      if (kw)           return `<span class="sgdbg-jb">${kw}</span>`;
      return m;
    }
  );
}

customElements.define('sg-debug-panel', SgDebugPanel);
