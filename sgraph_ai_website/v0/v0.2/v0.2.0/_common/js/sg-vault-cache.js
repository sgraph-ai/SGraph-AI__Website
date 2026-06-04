/**
 * sg-vault-cache v1.0.0
 *
 * Transparent fetch-layer cache for sgraph.ai vault objects.
 * Load as a plain (non-module) <script> BEFORE any ES-module scripts so
 * the fetch patch is installed before any vault-client imports run.
 *
 * What it does:
 *   1. IDB persistent cache — obj-cas-imm-* blobs are content-addressed and
 *      truly immutable (hash in name → content never changes). Stored in
 *      IndexedDB and served on subsequent page loads without a network round-trip.
 *   2. In-flight deduplication — if the same URL is already being fetched,
 *      concurrent callers wait for the first response rather than issuing
 *      duplicate network requests. Eliminates the parallel sub-nav / side-nav
 *      duplicate fetch pattern entirely.
 *   3. Timeout / break-out — in-flight entries time out after 30 s; all
 *      waiting callers are rejected (they will surface their own errors).
 *
 * Synthetic responses carry extra headers so the debug panel can identify them:
 *   x-sg-cache: idb-hit | inflight | network
 *   x-sg-cache-ms: N   (read time for idb-hit; wait time for inflight)
 *
 * Also dispatches window CustomEvents for observability:
 *   sg:vault-fetch   detail: { type, url, ms?, bytes?, status?, waitMs? }
 *
 * Exposes window.sgVaultCache with:
 *   .inFlightCount  — number of pending network requests
 *   .clearIdb()     — clear the entire IDB store (returns Promise)
 *   .idbStats()     — returns Promise<{ count, bytes }>
 */
(function () {
  'use strict';

  var DB_NAME     = 'sg-vault-cache/v1';
  var STORE       = 'objects';
  var DB_VERSION  = 1;
  var TIMEOUT_MS  = 30000;

  // ── IndexedDB ─────────────────────────────────────────────────────────────

  var _db     = null;
  var _dbReady = new Promise(function (resolve) {
    if (!window.indexedDB) { resolve(null); return; }
    var req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function (e) {
      var db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
    req.onerror   = function ()  { resolve(null); };
  });

  function idbGet(key) {
    if (!_db) return Promise.resolve(null);
    return new Promise(function (resolve) {
      var tx  = _db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).get(key);
      req.onsuccess = function () { resolve(req.result != null ? req.result : null); };
      req.onerror   = function () { resolve(null); };
    });
  }

  function idbSet(key, buf) {
    if (!_db) return;
    try {
      var tx = _db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(buf, key);
    } catch (_) {}
  }

  // ── URL helpers ───────────────────────────────────────────────────────────

  function isVaultUrl(url) {
    return url.indexOf('send.sgraph.ai') !== -1;
  }

  // The vault read API serves path segments with literal slashes; %2F-encoded
  // slashes bypass the server's fast path. Browsers send literal slashes, but
  // encodeURIComponent(path) in the vault client (and our own callers) emits
  // %2F. Decode them back to '/' so every vault request hits the optimised path.
  function unescapeSlashes(url) { return url.replace(/%2[Ff]/g, '/'); }

  // obj-cas-imm-* are content-addressed immutable — safe to persist forever.
  // ref / commit / tree objects change with vault publishes — only deduped in-flight.
  function isImmutable(url) {
    var d = decodeURIComponent(url);
    return d.indexOf('/obj-cas-imm') !== -1 ||
           (d.indexOf('/bare/') !== -1 && d.indexOf('/data/') !== -1);
  }

  function idbKey(url) {
    try { return new URL(url).pathname; } catch (_) { return url; }
  }

  // ── In-flight registry ────────────────────────────────────────────────────

  var _inFlight = new Map();  // url → { promise, resolve, reject, timer }

  // ── Event emitter ─────────────────────────────────────────────────────────

  function emit(type, url, extra) {
    try {
      var detail = Object.assign({ type: type, url: url }, extra);
      window.dispatchEvent(new CustomEvent('sg:vault-fetch', { detail: detail }));
    } catch (_) {}
  }

  // ── Synthetic Response builder ────────────────────────────────────────────

  function syntheticResp(buf, extraHeaders, status, statusText, origHeaders) {
    var h = {};
    if (origHeaders) {
      ['content-type', 'content-length', 'etag', 'cache-control'].forEach(function (k) {
        var v = origHeaders.get(k);
        if (v) h[k] = v;
      });
    }
    Object.assign(h, extraHeaders);
    return new Response(buf, {
      status:     status     != null ? status     : 200,
      statusText: statusText != null ? statusText : 'OK',
      headers:    h,
    });
  }

  // ── Fetch patch ───────────────────────────────────────────────────────────

  var _origFetch = window.fetch.bind(window);

  window.fetch = function sgVaultCacheFetch(input, init) {
    var url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
    if (!isVaultUrl(url)) return _origFetch(input, init);

    // Rewrite %2F → '/' so the request reaches the server's optimised path.
    // Done before key/immutability checks so the IDB key is consistent too.
    var normUrl = unescapeSlashes(url);
    if (normUrl !== url) {
      input = typeof input === 'string' ? normUrl : new Request(normUrl, input);
      url   = normUrl;
    }

    var t0  = performance.now();
    var key = idbKey(url);
    var imm = isImmutable(url);

    // 1 ── IDB hit (immutable blobs only) ──────────────────────────────────
    if (imm) {
      return _dbReady.then(function () {
        return idbGet(key);
      }).then(function (cached) {
        if (cached) {
          var ms = Math.round(performance.now() - t0);
          emit('idb-hit', url, { ms: ms, bytes: cached.byteLength });
          return syntheticResp(cached.slice(0), { 'x-sg-cache': 'idb-hit', 'x-sg-cache-ms': String(ms) });
        }
        return _networkOrInflight(url, key, imm, input, init, t0);
      });
    }

    // 2/3 ── In-flight dedup or network ────────────────────────────────────
    return _networkOrInflight(url, key, imm, input, init, t0);
  };

  function _networkOrInflight(url, key, imm, input, init, t0) {
    // Join existing in-flight request for this URL
    if (_inFlight.has(url)) {
      var waitT0 = performance.now();
      return _inFlight.get(url).promise.then(function (buf) {
        var ms = Math.round(performance.now() - waitT0);
        emit('inflight-hit', url, { waitMs: ms });
        return syntheticResp(buf.slice(0), { 'x-sg-cache': 'inflight', 'x-sg-wait-ms': String(ms) });
      }, function () {
        // The originating request failed; make our own attempt (no infinite loop —
        // by this point _inFlight.delete(url) has been called by the failed request).
        return _doFetch(url, key, imm, input, init, t0);
      });
    }
    return _doFetch(url, key, imm, input, init, t0);
  }

  function _doFetch(url, key, imm, input, init, t0) {
    var entry = { promise: null, resolve: null, reject: null, timer: null };
    entry.promise = new Promise(function (res, rej) {
      entry.resolve = res;
      entry.reject  = rej;
    });
    entry.timer = setTimeout(function () {
      _inFlight.delete(url);
      entry.reject(new Error('sg-vault-cache: timeout after ' + TIMEOUT_MS + 'ms'));
    }, TIMEOUT_MS);
    _inFlight.set(url, entry);

    return _origFetch(input, init).then(function (resp) {
      return resp.arrayBuffer().then(function (buf) {
        clearTimeout(entry.timer);
        entry.resolve(buf);
        _inFlight.delete(url);

        if (imm && resp.ok) {
          // fire-and-forget IDB write
          _dbReady.then(function () { idbSet(key, buf.slice(0)); });
        }

        var ms = Math.round(performance.now() - t0);
        emit('network', url, { ms: ms, bytes: buf.byteLength, status: resp.status });
        return syntheticResp(buf.slice(0), { 'x-sg-cache': 'network' }, resp.status, resp.statusText, resp.headers);
      });
    }, function (err) {
      clearTimeout(entry.timer);
      entry.reject(err);
      _inFlight.delete(url);
      emit('network-error', url, { error: err.message });
      throw err;
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.sgVaultCache = {
    get inFlightCount() { return _inFlight.size; },

    clearIdb: function () {
      return _dbReady.then(function () {
        if (!_db) return;
        var tx = _db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
      });
    },

    idbStats: function () {
      return _dbReady.then(function () {
        if (!_db) return { count: 0, bytes: 0 };
        return new Promise(function (resolve) {
          var count = 0, bytes = 0;
          var tx     = _db.transaction(STORE, 'readonly');
          var cursor = tx.objectStore(STORE).openCursor();
          cursor.onsuccess = function (e) {
            var c = e.target.result;
            if (!c) { resolve({ count: count, bytes: bytes }); return; }
            count++;
            if (c.value && c.value.byteLength) bytes += c.value.byteLength;
            c.continue();
          };
          cursor.onerror = function () { resolve({ count: count, bytes: bytes }); };
        });
      });
    },
  };

})();
