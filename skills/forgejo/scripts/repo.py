#!/usr/bin/env python3
"""Forgejo repo info.

Usage:
    python3 scripts/repo.py info
    python3 scripts/repo.py branches
"""
import argparse, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from _common import get_client


def main() -> int:
    p = argparse.ArgumentParser(description="Forgejo repo")
    p.add_argument("action", choices=["info", "branches"])
    p.add_argument("--role", default="")
    p.add_argument("--repo", default="")
    args = p.parse_args()

    client = get_client(role=args.role, repo=args.repo)

    if args.action == "info":
        info = client.repo_view()
        print(f"Repo: {info.get('full_name')}")
        print(f"  Default branch: {info.get('default_branch')}")
        print(f"  Stars: {info.get('stars_count', 0)}")
        print(f"  Open issues: {info.get('open_issues_count', 0)}")
        return 0

    elif args.action == "branches":
        branches = client.repo_branches()
        for b in branches:
            print(f"  {b.get('name')}")
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
