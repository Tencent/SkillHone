"""Forgejo REST API client.

Thin wrapper around Forgejo REST API v1. Used by the per-resource scripts
(issue.py, pr.py, wiki.py, repo.py, summary.py) via _common.get_client().
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

try:
    import requests
except ImportError:
    raise ImportError("'requests' package not found. Install: pip install requests")


class ForgejoClient:
    """Thin wrapper around Forgejo REST API v1."""

    def __init__(self, url: str, token: str, owner: str, repo: str):
        self.base = url.rstrip("/")
        self.owner = owner
        self.repo = repo
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"token {token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        })
        self.session.timeout = 30

    @property
    def repo_api(self) -> str:
        return f"{self.base}/api/v1/repos/{self.owner}/{self.repo}"

    def _get(self, path: str, **params) -> Any:
        r = self.session.get(f"{self.base}/api/v1{path}", params=params)
        r.raise_for_status()
        return r.json()

    def _post(self, path: str, data: dict) -> Any:
        r = self.session.post(f"{self.base}/api/v1{path}", json=data)
        r.raise_for_status()
        return r.json()

    def _patch(self, path: str, data: dict) -> Any:
        r = self.session.patch(f"{self.base}/api/v1{path}", json=data)
        r.raise_for_status()
        return r.json()

    def _delete(self, path: str) -> bool:
        r = self.session.delete(f"{self.base}/api/v1{path}")
        r.raise_for_status()
        return True

    def _put(self, path: str, data: dict) -> Any:
        r = self.session.put(f"{self.base}/api/v1{path}", json=data)
        r.raise_for_status()
        return r.json()

    # ── Auth ──

    def auth_status(self) -> dict:
        """Check authentication status."""
        return self._get("/user")

    # ── Issues ──

    def issue_list(self, state: str = "open", labels: str = "",
                   limit: int = 30) -> list[dict]:
        params: dict[str, Any] = {"state": state, "limit": limit}
        if labels:
            params["labels"] = labels
        path = f"/repos/{self.owner}/{self.repo}/issues"
        return self._get(path, **params)

    def issue_create(self, title: str, body: str = "",
                     labels: list[int] | None = None,
                     assignees: list[str] | None = None) -> dict:
        data: dict[str, Any] = {"title": title, "body": body}
        if labels:
            data["labels"] = labels
        if assignees:
            data["assignees"] = assignees
        path = f"/repos/{self.owner}/{self.repo}/issues"
        return self._post(path, data)

    def issue_view(self, number: int) -> dict:
        path = f"/repos/{self.owner}/{self.repo}/issues/{number}"
        return self._get(path)

    def issue_close(self, number: int) -> dict:
        path = f"/repos/{self.owner}/{self.repo}/issues/{number}"
        return self._patch(path, {"state": "closed"})

    def issue_comment(self, number: int, body: str) -> dict:
        path = f"/repos/{self.owner}/{self.repo}/issues/{number}/comments"
        return self._post(path, {"body": body})

    def issue_labels(self) -> list[dict]:
        """List available labels for the repo."""
        path = f"/repos/{self.owner}/{self.repo}/labels"
        return self._get(path)

    # ── Pull Requests ──

    def pr_list(self, state: str = "open", limit: int = 30) -> list[dict]:
        path = f"/repos/{self.owner}/{self.repo}/pulls"
        return self._get(path, state=state, limit=limit)

    def pr_create(self, title: str, head: str, base: str = "main",
                  body: str = "") -> dict:
        data = {"title": title, "head": head, "base": base, "body": body}
        path = f"/repos/{self.owner}/{self.repo}/pulls"
        return self._post(path, data)

    def pr_view(self, number: int) -> dict:
        path = f"/repos/{self.owner}/{self.repo}/pulls/{number}"
        return self._get(path)

    def pr_merge(self, number: int, method: str = "merge",
                 title: str = "", message: str = "") -> dict:
        data: dict[str, Any] = {"Do": method}
        if title:
            data["merge_message_field"] = title
        if message:
            data["merge_commit_message_field"] = message
        path = f"/repos/{self.owner}/{self.repo}/pulls/{number}/merge"
        return self._post(path, data)

    def pr_review(self, number: int, event: str = "APPROVED",
                  body: str = "") -> dict:
        """Submit a review. event: APPROVED, REQUEST_CHANGES, COMMENT."""
        data = {"event": event, "body": body}
        path = f"/repos/{self.owner}/{self.repo}/pulls/{number}/reviews"
        return self._post(path, data)

    def pr_comment(self, number: int, body: str) -> dict:
        """Add a comment to a PR (uses issues API since PRs are issues)."""
        return self.issue_comment(number, body)

    # ── Repo ──

    def repo_view(self) -> dict:
        path = f"/repos/{self.owner}/{self.repo}"
        return self._get(path)

    def repo_branches(self) -> list[dict]:
        path = f"/repos/{self.owner}/{self.repo}/branches"
        return self._get(path)

    # ─── Wiki ─────────────────────────────────────────────────────────────────

    def wiki_list(self) -> list[dict]:
        """List wiki pages."""
        return self._get(f"/repos/{self.owner}/{self.repo}/wiki/pages") or []

    def wiki_create(self, title: str, content: str) -> dict:
        """Create a new wiki page."""
        import base64 as _b64
        encoded = _b64.b64encode(content.encode()).decode()
        return self._post(f"/repos/{self.owner}/{self.repo}/wiki/new", {
            "title": title,
            "content_base64": encoded,
        })

    def wiki_get(self, title: str) -> dict:
        """Get a wiki page by title.

        Forgejo sometimes mangles the canonical sub_url (e.g. adds a trailing
        ``.-`` for titles containing hyphens). Try the literal title first,
        then fall back to the ``sub_url`` returned from ``wiki_list``.
        """
        import urllib.parse
        try:
            slug = urllib.parse.quote(title, safe="")
            return self._get(f"/repos/{self.owner}/{self.repo}/wiki/page/{slug}") or {}
        except Exception:
            # Fall back: look up the canonical sub_url via wiki_list.
            for p in self.wiki_list():
                if p.get("title") == title:
                    sub = p.get("sub_url") or title
                    slug = urllib.parse.quote(sub, safe="")
                    return self._get(f"/repos/{self.owner}/{self.repo}/wiki/page/{slug}") or {}
            raise

    def wiki_edit(self, title: str, content: str) -> dict:
        """Edit an existing wiki page."""
        import base64 as _b64
        import urllib.parse
        encoded = _b64.b64encode(content.encode()).decode()
        # Try literal title first, then fall back to sub_url on 404.
        try:
            slug = urllib.parse.quote(title, safe="")
            return self._patch(f"/repos/{self.owner}/{self.repo}/wiki/page/{slug}", {
                "title": title,
                "content_base64": encoded,
            })
        except Exception:
            for p in self.wiki_list():
                if p.get("title") == title:
                    sub = p.get("sub_url") or title
                    slug = urllib.parse.quote(sub, safe="")
                    return self._patch(f"/repos/{self.owner}/{self.repo}/wiki/page/{slug}", {
                        "title": title,
                        "content_base64": encoded,
                    })
            raise
