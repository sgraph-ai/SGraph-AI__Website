/**
 * sg-sub-nav — sub-site top navigation bar
 *
 * Attributes:
 *   site-title   — display name shown on the left (e.g. "Library")
 *   links        — JSON string: [{ "title": "...", "href": "..." }] (highest priority)
 *   src          — URL of a nav JSON file (reads cross_links from it)
 *   active-href  — href of the currently active cross-link (for highlighting)
 *
 * Nav JSON shape (subset used):
 *   { "cross_links": [...] }   OR   { "library": { "cross_links": [...] } }
 *   OR   { "dev": { "cross_links": [...] } }
 *
 * Fires no custom events — purely presentational.
 */
class SgSubNav extends HTMLElement {
  static get observedAttributes() {
    return ['site-title', 'links', 'src', 'active-href'];
  }

  connectedCallback() { this._render(); }
  attributeChangedCallback() { this._render(); }

  async _render() {
    const title      = this.getAttribute('site-title') ?? '';
    const linksAttr  = this.getAttribute('links');
    const src        = this.getAttribute('src');
    const activeHref = this.getAttribute('active-href') ?? location.pathname;

    let crossLinks = [];

    if (linksAttr) {
      try { crossLinks = JSON.parse(linksAttr); } catch (_) {}
    } else if (src) {
      try {
        const res  = await fetch(src);
        const data = await res.json();
        crossLinks = data.cross_links
          ?? data.library?.cross_links
          ?? data.dev?.cross_links
          ?? [];
      } catch (_) {}
    }

    this.innerHTML = `
      <nav class="sg-sub-nav__bar" aria-label="${title} navigation">
        <span class="sg-sub-nav__title">${title}</span>
        <ul class="sg-sub-nav__links">
          ${crossLinks.map(l => `
            <li>
              <a href="${l.href}"
                 class="sg-sub-nav__link${l.href === activeHref ? ' sg-sub-nav__link--active' : ''}">
                ${l.title}
              </a>
            </li>`).join('')}
        </ul>
      </nav>`;
  }
}

customElements.define('sg-sub-nav', SgSubNav);
