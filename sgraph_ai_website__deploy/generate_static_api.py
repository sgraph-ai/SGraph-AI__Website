#!/usr/bin/env python3
"""Generate static API JSON endpoints for deployment.

Writes JSON files into {source_dir}/api/ which are included in the
normal S3 sync. The api/ directory is gitignored — files are generated
fresh on each deploy.

Endpoints produced:
  api/deployment.json  — version, env, branch, commit SHA, deploy timestamp
  api/pages.json       — inventory of every HTML page in the site
"""

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path


DEPLOY_URLS = {
    "prod": "https://sgraph.ai",
    "main": "https://main.sgraph.ai",
    "dev" : "https://dev.sgraph.ai",
    "qa"  : "https://qa.sgraph.ai",
}


EXCLUDED_DIRS = {"_common", "cloudfront"}


def scan_pages(source_dir: Path) -> list:
    pages = []
    for html_file in sorted(source_dir.rglob("*.html")):
        rel = html_file.relative_to(source_dir)
        if rel.parts[0] in EXCLUDED_DIRS:
            continue
        parts = rel.parts
        if parts[-1] == "index.html":
            segments = parts[:-1]
            url_path = ("/" + "/".join(segments) + "/") if segments else "/"
        else:
            url_path = "/" + str(rel)
        pages.append({"path": url_path, "file": str(rel)})
    return pages


def generate_deployment_json(args, api_dir: Path) -> None:
    deploy_url = args.deploy_url or DEPLOY_URLS.get(args.deploy_env, f"https://{args.deploy_env}.sgraph.ai")
    data = {
        "site"        : args.site,
        "version"     : args.version,
        "env"         : args.deploy_env,
        "branch"      : args.branch,
        "commit_sha"  : args.commit_sha,
        "commit_short": args.commit_sha[:7] if args.commit_sha and args.commit_sha != "unknown" else "unknown",
        "deployed_at" : datetime.now(timezone.utc).isoformat(),
        "deploy_url"  : deploy_url,
        "s3_path"     : f"websites/{args.site}/{args.deploy_env}/latest/",
        "api_base"    : f"{deploy_url}/api/",
    }
    out = api_dir / "deployment.json"
    out.write_text(json.dumps(data, indent=2))
    print(f"  Written: {out}")


def generate_pages_json(args, source_dir: Path, api_dir: Path) -> None:
    pages = scan_pages(source_dir)
    data = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "env"         : args.deploy_env,
        "version"     : args.version,
        "page_count"  : len(pages),
        "pages"       : pages,
    }
    out = api_dir / "pages.json"
    out.write_text(json.dumps(data, indent=2))
    print(f"  Written: {out} ({len(pages)} pages)")


def main():
    parser = argparse.ArgumentParser(description="Generate static API JSON endpoints.")
    parser.add_argument("--source-dir", required=True,   help="WEBSITE_DIR (site root to scan and write api/ into)")
    parser.add_argument("--deploy-env", required=True,   help="Target environment (qa, dev, main, prod)")
    parser.add_argument("--version",    required=True,   help="Deployed version string (e.g. v0.2.7)")
    parser.add_argument("--commit-sha", default=os.environ.get("GITHUB_SHA", "unknown"))
    parser.add_argument("--branch",     default=os.environ.get("GITHUB_REF_NAME", "unknown"))
    parser.add_argument("--site",       default="sgraph-ai")
    parser.add_argument("--deploy-url", default="",      help="Override the deploy URL (default: derived from env)")
    args = parser.parse_args()

    source_dir = Path(args.source_dir).resolve()
    if not source_dir.is_dir():
        print(f"ERROR: source-dir does not exist: {source_dir}")
        raise SystemExit(1)

    api_dir = source_dir / "api"
    api_dir.mkdir(exist_ok=True)

    print(f"\n--- Generating static API ---")
    print(f"  Source  : {source_dir}")
    print(f"  Env     : {args.deploy_env}")
    print(f"  Version : {args.version}")
    print(f"  Branch  : {args.branch}")
    print(f"  Commit  : {args.commit_sha[:7] if args.commit_sha and args.commit_sha != 'unknown' else 'unknown'}")
    print(f"  Output  : {api_dir}/")

    generate_deployment_json(args, api_dir)
    generate_pages_json(args, source_dir, api_dir)

    print(f"\n  Static API ready — {len(list(api_dir.iterdir()))} endpoint(s) in {api_dir}/")


if __name__ == "__main__":
    main()
