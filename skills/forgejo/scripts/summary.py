#!/usr/bin/env python3
"""Forgejo summary — shows issues + PRs + latest wiki failure analysis.

Usage:
    python3 scripts/summary.py
"""
import argparse
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _common import get_client
import base64


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print a Forgejo dashboard for the current repo: open issues + open PRs + latest failure-analysis wiki page.",
    )
    parser.parse_args()

    client = get_client()

    print(f"=== {client.owner}/{client.repo} ===\n")

    # Open issues
    issues = client.issue_list(state="open")
    issues = [i for i in issues if not i.get("pull_request")]
    print(f"Open issues ({len(issues)}):")
    for i in issues[:5]:
        print(f"  #{i['number']} {i['title']}")
    if len(issues) > 5:
        print(f"  ... and {len(issues)-5} more")
    print()

    # Open PRs
    prs = client.pr_list(state="open")
    print(f"Open PRs ({len(prs)}):")
    for pr in prs[:5]:
        head = pr.get("head", {}).get("ref", "?")
        print(f"  #{pr['number']} {pr['title']} ({head})")
    print()

    # Latest wiki failure analysis
    try:
        pages = client.wiki_list()
        analysis_pages = [p for p in pages if "Failure-Analysis" in p.get("title", "")]
        if analysis_pages:
            latest = sorted(analysis_pages, key=lambda p: p.get("title", ""))[-1]
            page = client.wiki_get(latest["title"])
            content = base64.b64decode(page.get("content_base64", "")).decode()
            print(f"Latest failure analysis: {latest['title']}")
            print(content[:1000])
        else:
            print("No failure analysis in wiki yet.")
    except Exception as e:
        print(f"Wiki: {e}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
