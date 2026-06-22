#!/usr/bin/env python3
"""Forgejo wiki management.

Usage:
    python3 scripts/wiki.py list
    python3 scripts/wiki.py get --title "Page-Title"
    python3 scripts/wiki.py create --title "New Page" --body "content"
    python3 scripts/wiki.py edit --title "Page" --body "new content"
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _common import get_client


def main() -> int:
    p = argparse.ArgumentParser(description="Forgejo wiki")
    p.add_argument("action", choices=["list", "get", "create", "edit"])
    p.add_argument("--title", default="")
    p.add_argument("--body", default="")
    p.add_argument("--role", default="")
    p.add_argument("--repo", default="")
    args = p.parse_args()

    client = get_client(role=args.role, repo=args.repo)

    if args.action == "list":
        pages = client.wiki_list()
        if not pages:
            print("No wiki pages.")
            return 0
        for page in pages:
            print(f"  {page.get('title', '?')}")
        return 0

    elif args.action == "get":
        if not args.title:
            print("ERROR: --title required", file=sys.stderr)
            return 1
        page = client.wiki_get(args.title)
        import base64
        content = base64.b64decode(page.get("content_base64", "")).decode()
        print(content)
        return 0

    elif args.action == "create":
        if not args.title or not args.body:
            print("ERROR: --title and --body required", file=sys.stderr)
            return 1
        client.wiki_create(args.title, args.body)
        print(f"Created wiki: {args.title}")
        return 0

    elif args.action == "edit":
        if not args.title or not args.body:
            print("ERROR: --title and --body required", file=sys.stderr)
            return 1
        client.wiki_edit(args.title, args.body)
        print(f"Updated wiki: {args.title}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
