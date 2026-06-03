// CloudFront Function: URL Rewrite for S3 Static Site
//
// Purpose: Rewrite directory-style URIs to serve index.html; SPA sub-site routing.
// Association: Viewer Request event on CloudFront distribution E2YZA5CZTJE62H
//
// What it does:
//   /                              → /index.html
//   /en-gb/library/SLUG/           → /en-gb/library/index.html   (SPA rewrite)
//   /en-gb/invest/SLUG/            → /en-gb/invest/index.html    (SPA rewrite)
//   /en-gb/dev/SLUG/               → /en-gb/dev/index.html       (SPA rewrite, except real sub-pages)
//   /en-gb/dev/vault-peek/         → /en-gb/dev/vault-peek/index.html  (real sub-page, not rewritten)
//   /en-gb/library/                → /en-gb/library/index.html
//   /product                       → 302 → /product/             (add trailing slash)
//   /favicon.ico                   → /favicon.ico                (no change)
//
// SPA routing note:
//   Library and Dev sub-sites use history.pushState with path-based article slugs.
//   Any slug path under the sub-site root is served as the sub-site shell (index.html).
//   The browser JS then reads location.pathname to determine which article to load.
//   Add entries to DEV_REAL_PAGES when new real sub-pages are added under /en-gb/dev/.
//
// Deploy via AWS Console or CLI:
//   aws cloudfront create-function \
//     --name url-rewrite-for__sgraph-ai \
//     --function-config '{"Comment":"Append index.html to directory URIs","Runtime":"cloudfront-js-2.0"}' \
//     --function-code fileb://url-rewrite.js
//
//   aws cloudfront publish-function \
//     --name url-rewrite-for__sgraph-ai \
//     --if-match <ETag>
//
//   Then associate with distribution as Viewer Request.

var CF_VERSION = 'v0.1.3';

function handler(event) {
    var request = event.request;
    var uri = request.uri;

    // Stamp the real public hostname before CloudFront rewrites Host to the S3 origin.
    // Lambda@Edge at origin-request reads this to derive the orchestrator URL.
    request.headers['x-sg-site-host'] = { value: event.request.headers.host.value };
    request.headers['x-sg-cf-version'] = { value: CF_VERSION };

    // SPA sub-site rewrites — must run before the generic index.html append.
    // Only apply to trailing-slash URIs (bare paths are handled below with a redirect).
    //
    // IMPORTANT: do NOT rewrite *.md / *.llm.json / llms.txt here. Those are served
    // as pure text by the sg-edge-render Lambda@Edge at origin-request (which runs
    // AFTER this viewer-request function). They have a dot and no trailing slash, so
    // they fall through to the bottom unchanged and reach the origin-request Lambda.

    // Library: all sub-paths are SPA slug routes → serve library index
    if (uri.endsWith('/') && uri.startsWith('/en-gb/library/') && uri !== '/en-gb/library/') {
        request.uri = '/en-gb/library/index.html';
        return request;
    }

    // Invest: all sub-paths are SPA slug routes → serve invest index
    if (uri.endsWith('/') && uri.startsWith('/en-gb/invest/') && uri !== '/en-gb/invest/') {
        request.uri = '/en-gb/invest/index.html';
        return request;
    }

    // Dev: sub-paths are SPA slug routes, except known real sub-pages
    var DEV_REAL_PAGES = ['/en-gb/dev/vault-peek/'];
    if (uri.endsWith('/') && uri.startsWith('/en-gb/dev/') && uri !== '/en-gb/dev/' &&
        !DEV_REAL_PAGES.some(function(p) { return uri === p; })) {
        request.uri = '/en-gb/dev/index.html';
        return request;
    }

    // Generic: append index.html to any bare directory URI
    if (uri.endsWith('/')) {
        request.uri += 'index.html';
    }
    // Redirect bare paths (no extension) to add trailing slash.
    // Required so the browser base URL is correct for relative asset resolution.
    else if (!uri.includes('.')) {
        return {
            statusCode: 302,
            statusDescription: 'Found',
            headers: { location: { value: uri + '/' } }
        };
    }

    return request;
}
