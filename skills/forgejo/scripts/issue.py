#!/usr/bin/env python3
"""Forgejo issue management.

Usage:
    python3 scripts/issue.py list [--state open|closed|all]
    python3 scripts/issue.py create --title "Bug" --body "Details"
    python3 scripts/issue.py view <number>
    python3 scripts/issue.py close <number>
    python3 scripts/issue.py comment <number> --body "text"
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _common import get_client


def main() -> int:
    p = argparse.ArgumentParser(description="Forgejo issues")
    p.add_argument("action", choices=["list", "create", "view", "close", "comment"])
    p.add_argument("number", nargs="?", default=None)
    p.add_argument("--title", default="")
    p.add_argument("--body", default="")
    p.add_argument("--state", default="open", choices=["open", "closed", "all"])
    p.add_argument("--labels", default="")
    p.add_argument("--assignees", default="")
    p.add_argument("--role", default="")
    p.add_argument("--repo", default="")
    args = p.parse_args()

    client = get_client(role=args.role, repo=args.repo)

    if args.action == "list":
        issues = client.issue_list(state=args.state, labels=args.labels)
        issues = [i for i in issues if not i.get("pull_request")]
        if not issues:
            print("No issues found.")
            return 0
        for i in issues:
            labels = ", ".join(l.get("name", "") for l in i.get("labels", []))
            line = f"#{i['number']}\t{i['state']}\t{i['title']}"
            if labels:
                line += f"\t[{labels}]"
            print(line)
        return 0

    elif args.action == "create":
        if not args.title:
            print("ERROR: --title required", file=sys.stderr)
            return 1
        issue = client.issue_create(title=args.title, body=args.body,
                                     assignees=args.assignees.split(",") if args.assignees else None)
        print(f"Created #{issue['number']}: {issue['title']}")
        return 0

    elif args.action == "view":
        if not args.number:
            print("ERROR: number required", file=sys.stderr)
            return 1
        issue = client.issue_view(int(args.number))
        print(f"#{issue['number']} [{issue['state']}] {issue['title']}")
        if issue.get("body"):
            print(f"\n{issue['body'][:500]}")
        return 0

    elif args.action == "close":
        if not args.number:
            print("ERROR: number required", file=sys.stderr)
            return 1
        client.issue_close(int(args.number))
        print(f"Closed #{args.number}")
        return 0

    elif args.action == "comment":
        if not args.number or not args.body:
            print("ERROR: number and --body required", file=sys.stderr)
            return 1
        client.issue_comment(int(args.number), args.body)
        print(f"Commented on #{args.number}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
