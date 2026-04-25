#!/bin/bash
# ---------------------------------------------------------------------------
# Local dev server for the main website (dev.sgraph.ai)
#
# IFD overlay model: every v0/v0.X/v0.X.Y/ tree is a snapshot of the site at
# that version. The live site is the union of all of them, replayed in semver
# order — earlier versions are the base, later versions overlay on top.
#
# Example (with both v0.1.0 and v0.2.0 present):
#   sgraph_ai_website/v0/v0.1/v0.1.0/en-gb/   →  latest/en-gb/   (base)
#   sgraph_ai_website/v0/v0.2/v0.2.0/en-gb/   →  latest/en-gb/   (overlay)
#
# This script replicates that locally by copying every version's content into
# a temporary directory that mirrors the production URL structure.
#
# No Web Crypto / secure-context requirement — 127.0.0.1 or localhost both work.
# ---------------------------------------------------------------------------
PORT=10060
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
WEBSITE_DIR="$REPO_ROOT/sgraph_ai_website"
SERVE_DIR="$REPO_ROOT/.local-server-website"

# ─── Discover every v0/v0.X/v0.X.Y version, sorted in semver order ──────────
# Matches the IFD layout: $WEBSITE_DIR/v0/v0.<minor>/v0.<minor>.<patch>/
# `sort -V` handles v0.1.0 < v0.2.0 < v0.10.0 correctly.
VERSION_DIRS=$(find "$WEBSITE_DIR/v0" -mindepth 3 -maxdepth 3 -type d -name 'v0.*.*' 2>/dev/null | sort -V)
LATEST_VERSION_DIR=$(echo "$VERSION_DIRS" | tail -1)

if [ -z "$LATEST_VERSION_DIR" ]; then
    echo "ERROR: No v0/v0.X/v0.X.Y versions found under $WEBSITE_DIR/v0/"
    exit 1
fi

VERSION_LABELS=$(echo "$VERSION_DIRS" | xargs -n1 basename | tr '\n' ' ')
LATEST_VERSION=$(basename "$LATEST_VERSION_DIR")

# Clean up on exit
cleanup() {
    echo ""
    echo "Stopping server..."
    rm -rf "$SERVE_DIR"
}
trap cleanup EXIT

# ─── Build the local serve directory ────────────────────────────────────────
# Replay each version in semver order; later versions overlay earlier ones.

echo "Building local server directory (IFD overlay: $VERSION_LABELS)..."
rm -rf "$SERVE_DIR"
mkdir -p "$SERVE_DIR"

while IFS= read -r VERSION_DIR; do
    [ -z "$VERSION_DIR" ] && continue
    VERSION=$(basename "$VERSION_DIR")
    echo "  Applying $VERSION ..."

    # _common/ (fonts, CSS, JS) — later versions overlay earlier ones
    if [ -d "$VERSION_DIR/_common" ]; then
        mkdir -p "$SERVE_DIR/_common"
        cp -r "$VERSION_DIR/_common"/. "$SERVE_DIR/_common/"
    fi

    # en-gb/ pages — later versions overlay earlier ones
    if [ -d "$VERSION_DIR/en-gb" ]; then
        mkdir -p "$SERVE_DIR/en-gb"
        cp -r "$VERSION_DIR/en-gb"/. "$SERVE_DIR/en-gb/"
    fi

    # Root index.html (redirect / locale autodetect)
    [ -f "$VERSION_DIR/index.html" ] && cp "$VERSION_DIR/index.html" "$SERVE_DIR/index.html"

    # Root 404.html
    [ -f "$VERSION_DIR/404.html" ] && cp "$VERSION_DIR/404.html" "$SERVE_DIR/404.html"
done <<< "$VERSION_DIRS"

# ─── Start server ───────────────────────────────────────────────────────────
echo ""
echo "Starting sgraph.ai local server ($LATEST_VERSION — IFD overlay: $VERSION_LABELS)..."
echo "  Root:     $SERVE_DIR"
echo "  Versions: $VERSION_LABELS"
echo ""
echo "  URLs:"
echo "    Home:         http://localhost:$PORT/"
echo "    EN-GB:        http://localhost:$PORT/en-gb/"
echo "    How it Works: http://localhost:$PORT/en-gb/how-it-works/"
echo "    Vaults:       http://localhost:$PORT/en-gb/vaults/"
echo "    Security:     http://localhost:$PORT/en-gb/security/"
echo "    Pricing:      http://localhost:$PORT/en-gb/pricing/"
echo ""
python3 -m http.server $PORT --directory "$SERVE_DIR" --bind localhost
