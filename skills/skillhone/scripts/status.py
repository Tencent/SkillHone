#!/usr/bin/env python3
"""Show the current Forgejo repo's issue and PR status.

Usage:
    python3 scripts/status.py
    python3 scripts/status.py --repo my-skill
    python3 scripts/status.py --repo skillhone/my-skill
    python3 scripts/status.py --repo-url http://localhost:3000/skillhone/my-skill.git
"""
from __future__ import annotations

import argparse
import configparser
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import requests
except ImportError:
    raise ImportError("'requests' package not found. Install: pip install requests")

try:
    import json5
except ImportError:
    json5 = None


PAGE_SIZE = 50
DEFAULT_MAX_ITEMS = 200
DEFAULT_DISPLAY_LIMIT = 12


@dataclass
class RepoConfig:
    url: str
    token: str
    owner: str
    repo: str
    sources: dict[str, str]


class ForgejoReadClient:
    """Read-only Forgejo REST API client."""

    def __init__(self, cfg: RepoConfig):
        self.base = cfg.url.rstrip("/")
        self.owner = cfg.owner
        self.repo = cfg.repo
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"token {cfg.token}",
            "Accept": "application/json",
        })

    def get(self, path: str, **params: Any) -> Any:
        response = self.session.get(
            f"{self.base}/api/v1{path}",
            params=params,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def repo_view(self) -> dict[str, Any]:
        return self.get(f"/repos/{self.owner}/{self.repo}")

    def issue_page(self, state: str, page: int) -> list[dict[str, Any]]:
        return self.get(
            f"/repos/{self.owner}/{self.repo}/issues",
            state=state,
            limit=PAGE_SIZE,
            page=page,
        )

    def pr_page(self, state: str, page: int) -> list[dict[str, Any]]:
        return self.get(
            f"/repos/{self.owner}/{self.repo}/pulls",
            state=state,
            limit=PAGE_SIZE,
            page=page,
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Print a read-only dashboard of the current Forgejo repo's issues and PRs.",
    )
    parser.add_argument(
        "--repo",
        default="",
        help="Repo name or owner/repo. Overrides config/env repo.",
    )
    parser.add_argument(
        "--repo-url",
        default="",
        help="Forgejo clone/web URL. Used to infer owner and repo.",
    )
    parser.add_argument("--owner", default="", help="Forgejo owner/org override.")
    parser.add_argument("--url", default="", help="Forgejo base URL override.")
    parser.add_argument("--token", default="", help="Forgejo token override.")
    parser.add_argument(
        "--state",
        choices=["open", "closed", "all"],
        default="all",
        help="Which remote records to fetch for counts and listings.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_DISPLAY_LIMIT,
        help=f"Rows to display per section (default: {DEFAULT_DISPLAY_LIMIT}).",
    )
    parser.add_argument(
        "--max-items",
        type=int,
        default=DEFAULT_MAX_ITEMS,
        help=f"Maximum records to fetch per resource (default: {DEFAULT_MAX_ITEMS}).",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Emit machine-readable JSON instead of the text dashboard.",
    )
    parser.add_argument(
        "--show-sources",
        action="store_true",
        help="Show where url/token/owner/repo were resolved from. Token value is never printed.",
    )
    args = parser.parse_args()

    cfg = resolve_config(args)
    client = ForgejoReadClient(cfg)

    repo_info = client.repo_view()
    issues_raw = collect_pages(client.issue_page, args.state, args.max_items)
    prs_raw = collect_pages(client.pr_page, args.state, args.max_items)

    issues = [item for item in issues_raw if not item.get("pull_request")]
    prs = sort_recent(prs_raw)
    issues = sort_recent(issues)

    payload = build_payload(
        cfg=cfg,
        repo_info=repo_info,
        issues=issues,
        prs=prs,
        max_items=args.max_items,
        state=args.state,
    )

    if args.json:
        if not args.show_sources:
            payload.pop("config_sources", None)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    else:
        print_dashboard(payload, display_limit=args.limit, show_sources=args.show_sources)
    return 0


def resolve_config(args: argparse.Namespace) -> RepoConfig:
    values: dict[str, str] = {"url": "", "token": "", "owner": "", "repo": ""}
    sources: dict[str, str] = {}

    apply_source(values, sources, read_settings(), "~/.skillhone/settings.json")
    apply_source(values, sources, read_nearest_config_json(Path.cwd()), "_data/config.json")
    apply_source(values, sources, read_nearest_forgejo_config(Path.cwd()), "_data/forgejo_config.txt")
    apply_source(values, sources, read_git_remote(Path.cwd()), "git remote origin")
    apply_source(values, sources, read_env(), "environment")

    cli_values: dict[str, str] = {}
    if args.repo_url:
        cli_values.update(parse_repo_url(args.repo_url))
    if args.repo:
        cli_values.update(parse_repo_arg(args.repo))
    if args.owner:
        cli_values["owner"] = args.owner
    if args.url:
        cli_values["url"] = args.url
    if args.token:
        cli_values["token"] = args.token
    apply_source(values, sources, cli_values, "cli")

    missing = [key for key in ("url", "token", "owner", "repo") if not values[key]]
    if missing:
        joined = ", ".join(missing)
        raise SystemExit(
            f"ERROR: missing Forgejo config field(s): {joined}. "
            "Set CLI flags, FORGEJO_* env vars, _data/forgejo_config.txt, "
            "or ~/.skillhone/settings.json."
        )

    return RepoConfig(
        url=values["url"],
        token=values["token"],
        owner=values["owner"],
        repo=values["repo"],
        sources=sources,
    )


def apply_source(
    values: dict[str, str],
    sources: dict[str, str],
    incoming: dict[str, str],
    source_name: str,
) -> None:
    for key, value in incoming.items():
        if key not in values or not value:
            continue
        values[key] = value
        sources[key] = source_name


def read_env() -> dict[str, str]:
    return {
        "url": os.environ.get("FORGEJO_URL", ""),
        "token": os.environ.get("FORGEJO_TOKEN", ""),
        "owner": os.environ.get("FORGEJO_OWNER", ""),
        "repo": os.environ.get("FORGEJO_REPO", ""),
    }


def read_settings() -> dict[str, str]:
    settings_path = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone")) / "settings.json"
    if not settings_path.exists():
        return {}
    settings_text = settings_path.read_text(encoding="utf-8")
    settings = json5.loads(settings_text) if json5 else json.loads(settings_text)
    forgejo = settings.get("forgejo", {})
    return {
        "url": forgejo.get("url", ""),
        "token": forgejo.get("token", ""),
        "owner": forgejo.get("owner", ""),
        "repo": forgejo.get("repo", ""),
    }


def read_nearest_config_json(cwd: Path) -> dict[str, str]:
    config_path = nearest_file(cwd, "_data/config.json")
    if config_path is None:
        return {}
    config = json.loads(config_path.read_text(encoding="utf-8"))
    values = {
        "url": config.get("forgejo_url", ""),
        "owner": config.get("forgejo_owner", ""),
    }
    repo_url = config.get("skill_repo_url", "")
    if repo_url:
        values.update(parse_repo_url(repo_url))
    return values


def read_nearest_forgejo_config(cwd: Path) -> dict[str, str]:
    config_path = nearest_file(cwd, "_data/forgejo_config.txt")
    if config_path is None:
        return {}

    values: dict[str, str] = {}
    for raw_line in config_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ValueError(f"Invalid config line in {config_path}: {raw_line!r}")
        key, value = line.split("=", 1)
        normalized = key.strip().lower()
        mapped = {
            "forgejo_url": "url",
            "forgejo_token": "token",
            "forgejo_owner": "owner",
            "forgejo_repo": "repo",
        }.get(normalized)
        if mapped:
            values[mapped] = value.strip()
    return values


def read_git_remote(cwd: Path) -> dict[str, str]:
    git_config = nearest_file(cwd, ".git/config")
    if git_config is None:
        return {}
    parser = configparser.ConfigParser()
    parser.read(git_config)
    section = 'remote "origin"'
    if section not in parser or "url" not in parser[section]:
        return {}
    return parse_repo_url(parser[section]["url"])


def nearest_file(cwd: Path, relative_path: str) -> Path | None:
    for root in [cwd, *cwd.parents]:
        candidate = root / relative_path
        if candidate.exists():
            return candidate
    return None


def parse_repo_arg(repo: str) -> dict[str, str]:
    stripped = repo.strip().removesuffix(".git").strip("/")
    if not stripped:
        return {}
    parts = stripped.split("/")
    if len(parts) == 1:
        return {"repo": parts[0]}
    if len(parts) == 2:
        return {"owner": parts[0], "repo": parts[1]}
    raise ValueError(f"--repo must be '<repo>' or '<owner>/<repo>', got: {repo}")


def parse_repo_url(repo_url: str) -> dict[str, str]:
    stripped = repo_url.strip()
    if not stripped:
        return {}

    if "://" in stripped:
        parsed = urlparse(stripped)
        parts = [part for part in parsed.path.strip("/").split("/") if part]
        if len(parts) < 2:
            raise ValueError(f"Cannot infer owner/repo from URL: {repo_url}")
        hostname = parsed.hostname or parsed.netloc
        netloc = f"{hostname}:{parsed.port}" if parsed.port else hostname
        return {
            "url": f"{parsed.scheme}://{netloc}",
            "owner": parts[-2],
            "repo": parts[-1].removesuffix(".git"),
        }

    if "@" in stripped and ":" in stripped:
        _, path = stripped.split(":", 1)
        parts = [part for part in path.strip("/").split("/") if part]
        if len(parts) < 2:
            raise ValueError(f"Cannot infer owner/repo from SSH URL: {repo_url}")
        return {"owner": parts[-2], "repo": parts[-1].removesuffix(".git")}

    return parse_repo_arg(stripped)


def collect_pages(fetch_page, state: str, max_items: int) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    page = 1
    while len(records) < max_items:
        batch = fetch_page(state, page)
        if not batch:
            break
        records.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        page += 1
    return records[:max_items]


def build_payload(
    cfg: RepoConfig,
    repo_info: dict[str, Any],
    issues: list[dict[str, Any]],
    prs: list[dict[str, Any]],
    max_items: int,
    state: str,
) -> dict[str, Any]:
    open_issues = [issue for issue in issues if issue.get("state") == "open"]
    closed_issues = [issue for issue in issues if issue.get("state") == "closed"]
    open_prs = [pr for pr in prs if pr.get("state") == "open"]
    merged_prs = [pr for pr in prs if pr.get("merged")]
    closed_unmerged_prs = [
        pr for pr in prs
        if pr.get("state") == "closed" and not pr.get("merged")
    ]
    closed_prs = sort_recent(merged_prs + closed_unmerged_prs)

    return {
        "repo": {
            "full_name": repo_info.get("full_name") or f"{cfg.owner}/{cfg.repo}",
            "html_url": repo_info.get("html_url", ""),
            "default_branch": repo_info.get("default_branch", ""),
            "open_issues_count": repo_info.get("open_issues_count"),
        },
        "fetch": {
            "state": state,
            "max_items": max_items,
            "issue_records": len(issues),
            "pr_records": len(prs),
        },
        "issues": {
            "open": len(open_issues),
            "closed": len(closed_issues),
            "open_items": [summarize_issue(issue) for issue in open_issues],
            "recent_closed_items": [summarize_issue(issue) for issue in closed_issues],
        },
        "pull_requests": {
            "open": len(open_prs),
            "merged": len(merged_prs),
            "closed_unmerged": len(closed_unmerged_prs),
            "open_items": [summarize_pr(pr) for pr in open_prs],
            "recent_closed_items": [summarize_pr(pr) for pr in closed_prs],
        },
        "config_sources": {
            key: (f"{value} (value hidden)" if key == "token" else value)
            for key, value in cfg.sources.items()
        },
    }


def summarize_issue(issue: dict[str, Any]) -> dict[str, Any]:
    return {
        "number": issue.get("number"),
        "state": issue.get("state", ""),
        "title": issue.get("title", ""),
        "labels": [label.get("name", "") for label in issue.get("labels", [])],
        "assignees": [user.get("login", "") for user in issue.get("assignees", [])],
        "updated_at": issue.get("updated_at", ""),
        "html_url": issue.get("html_url", ""),
    }


def summarize_pr(pr: dict[str, Any]) -> dict[str, Any]:
    head = pr.get("head") or {}
    base = pr.get("base") or {}
    return {
        "number": pr.get("number"),
        "state": "merged" if pr.get("merged") else pr.get("state", ""),
        "title": pr.get("title", ""),
        "head": head.get("ref", ""),
        "base": base.get("ref", ""),
        "draft": bool(pr.get("draft", False)),
        "mergeable": pr.get("mergeable"),
        "updated_at": pr.get("updated_at", ""),
        "html_url": pr.get("html_url", ""),
    }


def sort_recent(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(items, key=lambda item: item.get("updated_at") or "", reverse=True)


def print_dashboard(payload: dict[str, Any], display_limit: int, show_sources: bool) -> None:
    repo = payload["repo"]
    fetch = payload["fetch"]
    issues = payload["issues"]
    prs = payload["pull_requests"]

    print("=== SkillHone Repo Status ===")
    print(f"Repo: {repo['full_name']}")
    if repo["html_url"]:
        print(f"URL:  {repo['html_url']}")
    if repo["default_branch"]:
        print(f"Default branch: {repo['default_branch']}")
    print(
        f"Fetched: issues={fetch['issue_records']}, PRs={fetch['pr_records']} "
        f"(state={fetch['state']}, cap={fetch['max_items']})"
    )
    print()

    print(f"Issues: open={issues['open']}, closed={issues['closed']}")
    print_records(
        title="Open issues",
        records=issues["open_items"],
        limit=display_limit,
        formatter=format_issue,
    )
    print_records(
        title="Recent closed issues",
        records=issues["recent_closed_items"],
        limit=max(0, min(5, display_limit)),
        formatter=format_issue,
    )
    print()

    print(
        "Pull requests: "
        f"open={prs['open']}, merged={prs['merged']}, closed_unmerged={prs['closed_unmerged']}"
    )
    print_records(
        title="Open PRs",
        records=prs["open_items"],
        limit=display_limit,
        formatter=format_pr,
    )
    print_records(
        title="Recent closed PRs",
        records=prs["recent_closed_items"],
        limit=max(0, min(5, display_limit)),
        formatter=format_pr,
    )

    if show_sources:
        print()
        print("Config sources:")
        for key in ("url", "token", "owner", "repo"):
            print(f"  {key}: {payload['config_sources'].get(key, 'missing')}")


def print_records(title: str, records: list[dict[str, Any]], limit: int, formatter) -> None:
    if limit == 0:
        return
    print(f"{title}:")
    if not records:
        print("  none")
        return
    for record in records[:limit]:
        print(formatter(record))
    remaining = len(records) - limit
    if remaining > 0:
        print(f"  ... {remaining} more")


def format_issue(issue: dict[str, Any]) -> str:
    labels = ", ".join(label for label in issue["labels"] if label)
    assignees = ", ".join(user for user in issue["assignees"] if user)
    suffix_parts = []
    if labels:
        suffix_parts.append(f"labels: {labels}")
    if assignees:
        suffix_parts.append(f"assignees: {assignees}")
    suffix_parts.append(f"updated: {relative_time(issue['updated_at'])}")
    suffix = " | ".join(suffix_parts)
    return f"  #{issue['number']} [{issue['state']}] {issue['title']} ({suffix})"


def format_pr(pr: dict[str, Any]) -> str:
    mergeable = pr["mergeable"]
    if mergeable is True:
        mergeable_text = "mergeable=yes"
    elif mergeable is False:
        mergeable_text = "mergeable=no"
    else:
        mergeable_text = "mergeable=unknown"
    draft = "draft=yes" if pr["draft"] else "draft=no"
    branch = f"{pr['head']} -> {pr['base']}" if pr["head"] or pr["base"] else "branch=?"
    return (
        f"  #{pr['number']} [{pr['state']}] {pr['title']} "
        f"({branch} | {draft} | {mergeable_text} | updated: {relative_time(pr['updated_at'])})"
    )


def relative_time(value: str) -> str:
    if not value:
        return "unknown"
    normalized = value.replace("Z", "+00:00")
    then = datetime.fromisoformat(normalized)
    now = datetime.now(timezone.utc)
    if then.tzinfo is None:
        then = then.replace(tzinfo=timezone.utc)
    delta = now - then
    seconds = max(0, int(delta.total_seconds()))
    if seconds < 60:
        return f"{seconds}s ago"
    minutes = seconds // 60
    if minutes < 60:
        return f"{minutes}m ago"
    hours = minutes // 60
    if hours < 48:
        return f"{hours}h ago"
    days = hours // 24
    return f"{days}d ago"


if __name__ == "__main__":
    sys.exit(main())
