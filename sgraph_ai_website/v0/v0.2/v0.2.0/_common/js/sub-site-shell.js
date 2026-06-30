/**
 * sub-site-shell — shared SPA shell logic for vault-backed sub-sites
 *
 * Extracted from the three near-identical inline scripts in the library / dev /
 * invest shells (code review CR-05). One module, parameterised per site, so a
 * feature or fix lands everywhere at once and the shells stop drifting.
 *
 * Usage (in a shell's inline <script type="module">):
 *
 *   import { mountSubSite } from '/_common/js/sub-site-shell.js';
 *   const api = mountSubSite({
 *     base:      '/en-gb/library/',
 *     siteLabel: 'Library',
 *     vaultId:   '<vault-id>',
 *     readKey:   '<public-read-key>',
 *   });
 *
 * Standard DOM the shell is expected to provide (all optional except the shell
 * container + article-render; missing ones are simply skipped):
 *   #sub-site-shell  sg-side-nav  #landing  #article-content  #article-toc
 *   #article-render  #article-crumbs  #next-prev  #toc-list  #toc-toggle
 *   #loading-state  #loading-sub  #landing-sections  #landing-stats
 *
 * Options (all default to the library shell's behaviour):
 *   hasToc        true  — right-hand "On this page" TOC
 *   hasSearch     true  — show the "Search" action on the 404 page
 *   showStats     true  — populate #landing-stats from nav timing
 *   emitDebug     true  — emit debug:nav-json / debug:vault-content events
 *   linkSection   true  — breadcrumb section segment is a link (invest: false)
 *   onSelect(detail, api) -> truthy to take over a nav:select (dev: ci/json views)
 *   onNavLoaded(sections, detail, api) -> extra hook after nav loads (dev footer)
 *
 * Returns an `api` of the internal renderers so plugins can reuse them:
 *   { showArticle, showSectionIndex, showGroupIndex, showLanding, showHome,
 *     showNotFound, setBreadcrumbs, buildNextPrev, buildToc, els, getState }
 */
import { escHtml, safeUrl } from './sg-escape.js';

export function mountSubSite(config) {
  const {
    base,
    siteLabel,
    vaultId,
    readKey,
    hasToc = true,
    hasSearch = true,
    showStats = true,
    emitDebug = true,
    linkSection = true,
    onSelect = null,
    onNavLoaded = null,
  } = config;

  const VAULT_ID = vaultId;
  const READ_KEY = readKey;

  // ── DOM ───────────────────────────────────────────────────────────────────
  const shell      = document.getElementById('sub-site-shell');
  const sideNav    = document.querySelector('sg-side-nav');
  const landing    = document.getElementById('landing');
  const articleEl  = document.getElementById('article-content');
  const articleToc = document.getElementById('article-toc');
  const renderEl   = document.getElementById('article-render');
  const crumbsEl   = document.getElementById('article-crumbs');
  const nextPrevEl = document.getElementById('next-prev');
  const tocListEl  = document.getElementById('toc-list');
  const loadingEl  = document.getElementById('loading-state');
  const loadingSub = document.getElementById('loading-sub');

  // ── path / slug helpers ─────────────────────────────────────────────────────
  function slugFromPath() {
    const segments = location.pathname.split('/').filter(Boolean);
    return segments.length > 2 ? segments.slice(2).join('/') : '';
  }
  function toSlug(title) {
    return String(title).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/, '');
  }
  function compoundSlug(parentSlug, childSlug) {
    if (!childSlug || !parentSlug) return childSlug;
    return childSlug.startsWith(parentSlug + '/') ? childSlug : `${parentSlug}/${childSlug}`;
  }
  // Recursively find an article by slug at arbitrary depth.
  function findArticleBySlug(sections, slug) {
    function walk(nodes, sectionTitle, parentSlug, parentTitle) {
      for (const a of (nodes ?? [])) {
        const aSlug = compoundSlug(parentSlug, a.slug);
        if (aSlug === slug) return { ...a, slug: aSlug, sectionTitle, parentTitle };
        const found = walk(a.children ?? [], sectionTitle, aSlug, a.title);
        if (found) return found;
      }
      return null;
    }
    for (const s of sections) {
      const found = walk(s.children ?? s.articles ?? [], s.title, '', null);
      if (found) return found;
    }
    return null;
  }
  // Flatten nav tree to linear reading order (arbitrary depth) — drives prev/next.
  function flattenNavTree(nodes, sectionTitle, parentSlug, parentTitle) {
    const result = [];
    for (const a of (nodes ?? [])) {
      const aSlug = compoundSlug(parentSlug, a.slug);
      result.push({ ...a, slug: aSlug, sectionTitle, parentTitle: parentTitle ?? null });
      result.push(...flattenNavTree(a.children ?? [], sectionTitle, aSlug, a.title));
    }
    return result;
  }

  // ── state ───────────────────────────────────────────────────────────────────
  let allArticles = [];
  let allSections = [];
  let navHome = null;
  let headingObserver = null;

  // ── panel collapse restore (mobile defaults to collapsed) ──────────────────
  if (shell) {
    const savedNav = localStorage.getItem('sg-nav-collapsed');
    if (savedNav === 'true' || (savedNav === null && window.innerWidth <= 900)) {
      shell.classList.add('nav-collapsed');
    }
    if (localStorage.getItem('sg-toc-collapsed') === 'true') shell.classList.add('toc-collapsed');
  }
  document.getElementById('toc-toggle')?.addEventListener('click', () => {
    const collapsed = shell.classList.toggle('toc-collapsed');
    localStorage.setItem('sg-toc-collapsed', collapsed);
  });

  // ── cold-start loading UX (no-ops when there is no #loading-state) ─────────
  const navStartMs = performance.now();
  let loadMsgTimer = null, loadTimeoutTimer = null;
  if (loadingEl) {
    const msgs = ['Connecting to vault', 'Fetching nav tree', 'Decrypting content', 'Almost there…'];
    let idx = 0;
    loadMsgTimer = setInterval(() => {
      idx = Math.min(idx + 1, msgs.length - 1);
      if (loadingSub) loadingSub.textContent = msgs[idx];
    }, 3000);
    loadTimeoutTimer = setTimeout(() => {
      clearInterval(loadMsgTimer);
      if (!loadingEl.hidden) {
        if (loadingSub) loadingSub.textContent = '';
        const title = loadingEl.querySelector('.sg-loading__title');
        if (title) title.textContent = `Could not load ${siteLabel.toLowerCase()}`;
        loadingEl.innerHTML += `
          <p class="sg-loading__error">The vault is taking too long to respond.
            This can happen after a period of inactivity.</p>
          <button class="sg-loading__retry" onclick="location.reload()">Try again</button>`;
      }
    }, 20000);
  }
  function hideLoading() {
    if (loadMsgTimer) clearInterval(loadMsgTimer);
    if (loadTimeoutTimer) clearTimeout(loadTimeoutTimer);
    if (loadingEl) loadingEl.hidden = true;
  }

  // ── renderers ───────────────────────────────────────────────────────────────
  function showLanding() {
    if (articleEl) articleEl.hidden = true;
    if (articleToc) articleToc.hidden = true;
    shell?.classList.remove('with-toc');
    if (landing) landing.hidden = false;
  }

  function showHome() {
    if (navHome && (navHome.content_object_id || navHome.content_path)) {
      if (landing) landing.hidden = true;
      if (articleToc) articleToc.hidden = true;
      shell?.classList.remove('with-toc');
      if (articleEl) articleEl.hidden = false;
      window.scrollTo({ top: 0, behavior: 'auto' });
      setBreadcrumbs(siteLabel, null, null);
      if (nextPrevEl) nextPrevEl.innerHTML = '';
      showArticle(navHome.content_object_id, navHome.render ?? 'markdown',
                  navHome.vault_id ?? null, navHome.read_key ?? null, { suppressToc: true });
      return;
    }
    showLanding();
  }

  function showSectionIndex(section) {
    // If the section declares an index article, load it as the landing page.
    if (section.index) {
      const indexArticle = (section.children ?? section.articles ?? []).find(a => a.slug === section.index);
      if (indexArticle?.content_object_id) {
        setBreadcrumbs(siteLabel, section.title, null);
        showArticle(indexArticle.content_object_id, indexArticle.render ?? 'markdown',
                    indexArticle.vault_id, indexArticle.read_key);
        buildNextPrev(indexArticle.slug);
        return;
      }
    }

    if (landing) landing.hidden = true;
    if (articleToc) articleToc.hidden = true;
    shell?.classList.remove('with-toc');
    if (articleEl) articleEl.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });

    setBreadcrumbs(siteLabel, section.title, null);

    const articles = section.children ?? section.articles ?? [];
    renderEl.innerHTML = `
      <div class="article-viewer">
        <div class="article-body">
          <h1>${escHtml(section.title)}</h1>
          ${section.description ? `<p class="section-index-desc">${escHtml(section.description)}</p>` : ''}
          <ul class="section-index-list">
            ${articles.map(a => {
              const kids = (a.children ?? []);
              const childList = kids.length ? `
                <ul class="section-index-list section-index-list--nested">
                  ${kids.map(c => `
                    <li class="section-index-list__item">
                      <button class="section-index-list__link" data-slug="${escHtml(compoundSlug(a.slug, c.slug))}">
                        <span class="section-index-list__title">${escHtml(c.title)}</span>
                        ${c.description ? `<span class="section-index-list__desc">${escHtml(c.description)}</span>` : ''}
                      </button>
                    </li>`).join('')}
                </ul>` : '';
              return `
              <li class="section-index-list__item">
                <button class="section-index-list__link" data-slug="${escHtml(a.slug ?? '')}">
                  <span class="section-index-list__title">${escHtml(a.title)}</span>
                  ${a.description ? `<span class="section-index-list__desc">${escHtml(a.description)}</span>` : ''}
                </button>
                ${childList}
              </li>`;
            }).join('')}
          </ul>
        </div>
      </div>`;

    if (nextPrevEl) nextPrevEl.innerHTML = '';
    wireIndexLinks();
  }

  // Index page for a nav group node (children but no own content).
  function showGroupIndex(groupNode) {
    if (landing) landing.hidden = true;
    if (articleToc) articleToc.hidden = true;
    shell?.classList.remove('with-toc');
    if (articleEl) articleEl.hidden = false;
    window.scrollTo({ top: 0, behavior: 'auto' });

    setBreadcrumbs(siteLabel, groupNode.sectionTitle, groupNode.parentTitle || null, groupNode.title);

    const children = (groupNode.children ?? []).map(c => ({
      ...c, slug: compoundSlug(groupNode.slug, c.slug),
    }));

    renderEl.innerHTML = `
      <div class="article-viewer">
        <div class="article-body">
          <h1>${escHtml(groupNode.title)}</h1>
          ${groupNode.description ? `<p class="section-index-desc">${escHtml(groupNode.description)}</p>` : ''}
          <ul class="section-index-list">
            ${children.map(c => `
              <li class="section-index-list__item">
                <button class="section-index-list__link" data-slug="${escHtml(c.slug ?? '')}">
                  <span class="section-index-list__title">${escHtml(c.title)}</span>
                  ${c.description ? `<span class="section-index-list__desc">${escHtml(c.description)}</span>` : ''}
                </button>
              </li>`).join('')}
          </ul>
        </div>
      </div>`;

    if (nextPrevEl) nextPrevEl.innerHTML = '';
    wireIndexLinks();
  }

  function wireIndexLinks() {
    renderEl.querySelectorAll('.section-index-list__link').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.slug;
        if (!slug) return;
        sideNav?.querySelector(`.sg-side-nav__doc[data-slug="${CSS.escape(slug)}"]`)?.click();
      });
    });
  }

  function showNotFound(slug) {
    if (landing) landing.hidden = true;
    if (articleToc) articleToc.hidden = true;
    shell?.classList.remove('with-toc');
    if (articleEl) articleEl.hidden = false;

    setBreadcrumbs(siteLabel, 'Not found', null, slug);
    const searchBtn = hasSearch
      ? `<button class="sg-not-found__btn sg-not-found__btn--secondary" id="not-found-search-btn">Search ${escHtml(siteLabel.toLowerCase())}</button>`
      : '';
    renderEl.innerHTML = `
      <div class="article-viewer">
        <div class="article-body sg-not-found">
          <p class="sg-not-found__code">404</p>
          <h1 class="sg-not-found__title">Page not found</h1>
          <p class="sg-not-found__desc">
            <code class="sg-not-found__slug">${escHtml(slug)}</code> doesn't exist here yet.
            It may be coming soon, or the link may be outdated.
          </p>
          <div class="sg-not-found__actions">
            <a class="sg-not-found__btn sg-not-found__btn--primary" href="${escHtml(safeUrl(base))}">← ${escHtml(siteLabel)} home</a>
            ${searchBtn}
          </div>
        </div>
      </div>`;
    if (nextPrevEl) nextPrevEl.innerHTML = '';
    document.getElementById('not-found-search-btn')?.addEventListener('click', () => {
      document.querySelector('sg-search')?.dispatchEvent(new CustomEvent('sg-search:open', { bubbles: true }));
    });
  }

  function showArticle(objectId, render, vId, rKey, opts = {}) {
    if (landing) landing.hidden = true;
    if (articleEl) articleEl.hidden = false;

    renderEl.innerHTML = '';
    const el = document.createElement('sg-article-viewer');
    el.setAttribute('vault-id',  vId  || VAULT_ID);
    el.setAttribute('read-key',  rKey || READ_KEY);
    el.setAttribute('object-id', objectId);
    el.setAttribute('render',    render || 'markdown');
    renderEl.appendChild(el);

    if (headingObserver) headingObserver.disconnect();
    if (articleToc) articleToc.hidden = true;
    shell?.classList.remove('with-toc');
    if (tocListEl) tocListEl.innerHTML = '';

    if (hasToc && !opts.suppressToc) {
      headingObserver = new MutationObserver(() => {
        clearTimeout(headingObserver._t);
        headingObserver._t = setTimeout(() => buildToc(renderEl), 150);
      });
      headingObserver.observe(renderEl, { childList: true, subtree: true });
    }
  }

  function setBreadcrumbs(site, section, parent, article) {
    if (!crumbsEl) return;
    const siteHref    = base;
    const sectionHref = section ? `${base}${toSlug(section)}/` : null;
    const parts = [site, section, parent, article].filter(Boolean);
    crumbsEl.innerHTML = parts.map((p, i) => {
      if (i === 0) return `<a class="sub-site__crumbs-link" href="${escHtml(safeUrl(siteHref))}">${escHtml(p)}</a><span class="sub-site__crumbs-sep">/</span>`;
      if (i === 1 && parts.length > 2 && linkSection) return `<a class="sub-site__crumbs-link" href="${escHtml(safeUrl(sectionHref))}">${escHtml(p)}</a><span class="sub-site__crumbs-sep">/</span>`;
      if (i < parts.length - 1) return `<span>${escHtml(p)}</span><span class="sub-site__crumbs-sep">/</span>`;
      return `<span class="sub-site__crumbs-here">${escHtml(p)}</span>`;
    }).join('');
  }

  function buildToc(container) {
    if (!hasToc || !articleToc || !tocListEl) return;
    const headings = Array.from(container.querySelectorAll('h2, h3'));
    if (headings.length < 2) return;
    headings.forEach((h, i) => { if (!h.id) h.id = `h-${i}`; });
    tocListEl.innerHTML = headings.map(h => `
      <li class="${h.tagName === 'H3' ? 'h3' : ''}">
        <a class="sub-site__toc-link" href="#${escHtml(h.id)}">${escHtml(h.textContent)}</a>
      </li>`).join('');
    shell?.classList.add('with-toc');
    articleToc.hidden = false;
    const links = Array.from(tocListEl.querySelectorAll('.sub-site__toc-link'));
    const io = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          links.forEach(l => l.classList.remove('active'));
          tocListEl.querySelector(`a[href="#${entry.target.id}"]`)?.classList.add('active');
        }
      });
    }, { rootMargin: '-15% 0px -70% 0px' });
    headings.forEach(h => io.observe(h));
  }

  function buildLandingCards(sections, navElapsedMs) {
    if (showStats) {
      const statsEl = document.getElementById('landing-stats');
      if (statsEl && navElapsedMs != null) {
        const total = sections.reduce((n, s) => n + (s.children ?? s.articles ?? []).length, 0);
        statsEl.textContent = `${total} articles · ${sections.length} sections · nav loaded in ${(navElapsedMs / 1000).toFixed(2)} s`;
        statsEl.hidden = false;
      }
    }
    const container = document.getElementById('landing-sections');
    if (!container) return;
    container.innerHTML = sections.map(section => {
      const articles = section.children ?? section.articles ?? [];
      const shown    = articles.slice(0, 4);
      const overflow = articles.length - shown.length;
      return `
        <div class="section-card">
          <div class="section-card__header">
            <button class="section-card__title" data-section="${escHtml(section.title)}">${escHtml(section.title)}</button>
            <span class="section-card__count">${escHtml(articles.length)}</span>
          </div>
          ${section.description ? `<p class="section-card__desc">${escHtml(section.description)}</p>` : ''}
          <ul class="section-card__articles">
            ${shown.map(a => a.href
              ? `<li><a class="section-card__article" href="${escHtml(safeUrl(a.href))}">${escHtml(a.title)}</a></li>`
              : `<li><button class="section-card__article" data-slug="${escHtml(a.slug ?? '')}">${escHtml(a.title)}</button></li>`
            ).join('')}
            ${overflow > 0 ? `<li><span class="section-card__more">+${overflow} more</span></li>` : ''}
          </ul>
        </div>`;
    }).join('');

    container.querySelectorAll('.section-card__title[data-section]').forEach(btn => {
      btn.addEventListener('click', () => {
        const sectionTitle = btn.dataset.section;
        const sectionSlug  = toSlug(sectionTitle);
        history.pushState({ sectionSlug }, '', `${base}${sectionSlug}/`);
        const section = allSections.find(s => s.title === sectionTitle);
        if (section) showSectionIndex(section);
      });
    });
    container.querySelectorAll('.section-card__article[data-slug]').forEach(btn => {
      btn.addEventListener('click', () => {
        const slug = btn.dataset.slug;
        if (!slug) return;
        sideNav?.querySelector(`.sg-side-nav__doc[data-slug="${CSS.escape(slug)}"]`)?.click();
      });
    });
  }

  function buildNextPrev(currentSlug) {
    if (!nextPrevEl) return;
    const idx  = allArticles.findIndex(a => a.slug === currentSlug);
    const prev = idx > 0 ? allArticles[idx - 1] : null;
    const next = idx >= 0 && idx < allArticles.length - 1 ? allArticles[idx + 1] : null;
    if (!prev && !next) { nextPrevEl.innerHTML = ''; return; }
    nextPrevEl.innerHTML = `
      <div class="sub-site__nav-card sub-site__nav-card--prev${prev ? '' : ' sub-site__nav-card--empty'}"
           ${prev ? '' : 'aria-hidden="true"'}>
        ${prev ? `<div class="sub-site__nav-label">← Previous</div>
                  <div class="sub-site__nav-title">${escHtml(prev.title)}</div>` : ''}
      </div>
      <div class="sub-site__nav-card sub-site__nav-card--next${next ? '' : ' sub-site__nav-card--empty'}"
           ${next ? '' : 'aria-hidden="true"'}>
        ${next ? `<div class="sub-site__nav-label">Next →</div>
                  <div class="sub-site__nav-title">${escHtml(next.title)}</div>` : ''}
      </div>`;
    if (prev) nextPrevEl.querySelector('.sub-site__nav-card--prev')
      .addEventListener('click', () => sideNav?.querySelector(`.sg-side-nav__doc[data-slug="${CSS.escape(prev.slug)}"]`)?.click());
    if (next) nextPrevEl.querySelector('.sub-site__nav-card--next')
      .addEventListener('click', () => sideNav?.querySelector(`.sg-side-nav__doc[data-slug="${CSS.escape(next.slug)}"]`)?.click());
  }

  // ── api (exposed for plugins / onSelect) ────────────────────────────────────
  const api = {
    showArticle, showSectionIndex, showGroupIndex, showLanding, showHome,
    showNotFound, setBreadcrumbs, buildNextPrev, buildToc, toSlug, compoundSlug,
    els: { shell, sideNav, landing, articleEl, articleToc, renderEl, nextPrevEl },
    getState: () => ({ allArticles, allSections, navHome }),
    VAULT_ID, READ_KEY,
  };

  // ── events ──────────────────────────────────────────────────────────────────
  const initialSlug = slugFromPath();
  if (initialSlug) sideNav?.setAttribute('active-slug', initialSlug);

  document.addEventListener('nav:loaded', e => {
    const navElapsedMs = performance.now() - navStartMs;
    const sections = e.detail?.sections;
    if (!Array.isArray(sections) || sections.length === 0) return; // ignore partial/empty
    hideLoading();
    allSections = sections;
    navHome = e.detail?.home ?? null;
    allArticles = sections.flatMap(s => flattenNavTree(s.children ?? s.articles ?? [], s.title, '', null));

    if (emitDebug) {
      const navElapsedSec = (navElapsedMs / 1000).toFixed(2);
      document.dispatchEvent(new CustomEvent('debug:nav-json',
        { detail: { json: { sections }, src: `${siteLabel.toLowerCase()} nav · ${allArticles.length} articles · loaded in ${navElapsedSec}s` } }));
      document.dispatchEvent(new CustomEvent('debug:vault-content', {
        detail: { objectId: 'nav-timing', kind: 'nav timing',
          text: `nav:loaded in ${navElapsedSec}s\n${allArticles.length} articles across ${allSections.length} sections` }
      }));
    }

    buildLandingCards(sections, navElapsedMs);
    if (onNavLoaded) try { onNavLoaded(sections, e.detail, api); } catch (err) { console.error('onNavLoaded:', err); }

    const slug = slugFromPath();
    if (!slug) { showHome(); return; }
    const matchedSection = sections.find(s => toSlug(s.title) === slug);
    if (matchedSection) { showSectionIndex(matchedSection); return; }

    const found = findArticleBySlug(sections, slug);
    if (found) {
      setBreadcrumbs(siteLabel, found.sectionTitle, found.parentTitle || null, found.title);
      if (found.content_object_id) {
        showArticle(found.content_object_id, found.render ?? 'markdown', found.vault_id ?? null, found.read_key ?? null);
        buildNextPrev(slug);
      } else if ((found.children ?? []).length) {
        showGroupIndex(found);
      } else {
        showNotFound(slug);
      }
    } else {
      showNotFound(slug);
    }
  });

  document.addEventListener('nav:select', e => {
    const d = e.detail;
    const targetPath = `${base}${d.slug}/`;
    if (location.pathname !== targetPath) history.pushState({ slug: d.slug }, '', targetPath);

    // Let a site take over special renders (dev: ci / json boards).
    if (onSelect && onSelect(d, api)) {
      // handled by the site; still update document.title + mobile collapse below
    } else {
      setBreadcrumbs(siteLabel, d.sectionTitle, d.parentTitle || null, d.title);
      showArticle(d.content_object_id, d.render ?? 'markdown', d.vault_id, d.read_key);
      buildNextPrev(d.slug);
    }
    // CR-10: keep the tab title in sync with the open article.
    if (d.title) document.title = `${d.title} — ${siteLabel} — sgraph.ai`;
    if (window.innerWidth <= 900) {
      shell?.classList.add('nav-collapsed');
      localStorage.setItem('sg-nav-collapsed', 'true');
    }
  });

  document.addEventListener('nav:section', e => {
    const { title, sectionSlug } = e.detail;
    const targetPath = `${base}${sectionSlug}/`;
    if (location.pathname !== targetPath) history.pushState({ sectionSlug }, '', targetPath);
    const section = allSections.find(s => s.title === title);
    if (section) showSectionIndex(section);
  });

  window.addEventListener('popstate', () => {
    const slug = slugFromPath();
    if (!slug) { showHome(); return; }
    const matchedSection = allSections.find(s => toSlug(s.title) === slug);
    if (matchedSection) { showSectionIndex(matchedSection); return; }
    const btn = sideNav?.querySelector(`.sg-side-nav__doc[data-slug="${CSS.escape(slug)}"]`);
    if (btn) btn.click();
    else sideNav?.setAttribute('active-slug', slug);
  });

  return api;
}
