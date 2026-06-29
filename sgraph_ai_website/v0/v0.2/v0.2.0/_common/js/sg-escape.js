/**
 * sg-escape — shared HTML-escaping helpers
 *
 * Single source of truth for escaping untrusted (vault-derived) strings before
 * they are interpolated into innerHTML. Replaces the per-component ad-hoc copies
 * that variously forgot to escape quotes (security review: CR-01).
 *
 * escHtml() escapes all five characters that matter in both element and
 * (double- or single-quoted) attribute contexts: & < > " '
 *
 * For URLs that come from vault content, use safeUrl() to neutralise
 * javascript:/data: and other script-bearing schemes before using the value in
 * an href/src.
 */

const _HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, ch => _HTML_ESCAPES[ch]);
}

// Allow only http(s), mailto, tel, and relative/anchor URLs. Anything else
// (javascript:, data:, vbscript:, …) collapses to '#'. Call escHtml() on the
// result before placing it in an attribute.
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(u)) return u;        // explicit safe schemes
  if (/^(\/|\.|#|\?)/.test(u)) return u;                   // relative / anchor / query
  if (/^[a-z0-9._-]+(\/|$)/i.test(u)) return u;            // bare relative path segment
  return '#';                                              // reject everything else
}
