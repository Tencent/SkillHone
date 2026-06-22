#!/usr/bin/env python3
"""Forgejo pull request management.

Usage:
    python3 scripts/pr.py list [--state open|closed|all]
    python3 scripts/pr.py create --title "Fix" --head fix/branch --base main --body "..."
    python3 scripts/pr.py view <number>
    python3 scripts/pr.py merge <number> [--method merge|rebase|squash]
    python3 scripts/pr.py review <number> [--approve | --request-changes]
    python3 scripts/pr.py comment <number> --body "text"
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _common import get_client


def main() -> int:
    p = argparse.ArgumentParser(description="Forgejo PRs")
    p.add_argument("action", choices=["list", "create", "view", "merge", "review", "comment"])
    p.add_argument("number", nargs="?", default=None)
    p.add_argument("--title", default="")
    p.add_argument("--body", default="")
    p.add_argument("--head", default="")
    p.add_argument("--base", default="main")
    p.add_argument("--state", default="open", choices=["open", "closed", "all"])
    p.add_argument("--method", default="merge", choices=["merge", "rebase", "squash"])
    p.add_argument("--approve", action="store_true")
    p.add_argument("--request-changes", action="store_true")
    p.add_argument("--role", default="")
    p.add_argument("--repo", default="")
    args = p.parse_args()

    client = get_client(role=args.role, repo=args.repo)

    if args.action == "list":
        prs = client.pr_list(state=args.state)
        if not prs:
            print("No PRs found.")
            return 0
        for pr in prs:
            head = pr.get("head", {}).get("ref", "?")
            base = pr.get("base", {}).get("ref", "?")
            print(f"#{pr['number']}\t{pr['state']}\t{pr['title']}\t{head}→{base}")
        return 0

    elif args.action == "create":
        if not args.title or not args.head:
            print("ERROR: --title and --head required", file=sys.stderr)
            return 1
        pr = client.pr_create(title=args.title, head=args.head,
                              base=args.base, body=args.body)
        print(f"Created PR #{pr['number']}: {pr['title']}")
        return 0

    elif args.action == "view":
        if not args.number:
            print("ERROR: number required", file=sys.stderr)
            return 1
        pr = client.pr_view(int(args.number))
        print(f"#{pr['number']} [{pr['state']}] {pr['title']}")
        print(f"  {pr.get('head',{}).get('ref','?')} → {pr.get('base',{}).get('ref','?')}")
        if pr.get("body"):
            print(f"\n{pr['body'][:500]}")
        return 0

    elif args.action == "merge":
        if not args.number:
            print("ERROR: number required", file=sys.stderr)
            return 1
        client.pr_merge(int(args.number), method=args.method)
        print(f"Merged PR #{args.number} ({args.method})")
        return 0

    elif args.action == "review":
        if not args.number:
            print("ERROR: number required", file=sys.stderr)
            return 1
        if args.approve:
            client.pr_review(int(args.number), event="APPROVED")
            print(f"Approved PR #{args.number}")
        elif args.request_changes:
            client.pr_review(int(args.number), event="REQUEST_CHANGES",
                            body=args.body or "Changes requested")
            print(f"Requested changes on PR #{args.number}")
        return 0

    elif args.action == "comment":
        if not args.number or not args.body:
            print("ERROR: number and --body required", file=sys.stderr)
            return 1
        client.pr_comment(int(args.number), args.body)
        print(f"Commented on PR #{args.number}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
