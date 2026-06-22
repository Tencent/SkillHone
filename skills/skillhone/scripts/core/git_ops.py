"""Git operations via gitpython (no subprocess for git).

All git interactions in skillhone go through this module. Advantages over
raw subprocess:
  - Proper Python exceptions on failure (not rc != 0 parsing)
  - No shell escaping / quoting issues
  - Structured access to repo state (HEAD sha, branches, remotes)
"""
from __future__ import annotations

import os
import shutil
import tempfile
from pathlib import Path
from typing import Optional

import git

WORK_DIR = Path("/tmp/skillhone")


def clone(url: str, dest: Optional[Path] = None, *,
          depth: int = 0, branch: str = "main",
          token: str = "") -> Path:
    """Clone a repo. Injects token into URL if provided.

    Args:
        url: Repo URL (http(s)://...)
        dest: Target dir. If None, creates a temp dir.
        depth: Shallow clone depth (0 = full clone).
        branch: Branch to checkout after clone.
        token: If set, injected as oauth2:<token>@ into the URL.

    Returns:
        Path to the cloned repo.
    """
    clone_url = _inject_token(url, token)
    if dest is None:
        WORK_DIR.mkdir(parents=True, exist_ok=True)
        dest = Path(tempfile.mkdtemp(prefix="clone_", dir=str(WORK_DIR)))
    else:
        dest = Path(dest)
        dest.mkdir(parents=True, exist_ok=True)

    kwargs: dict = {"url": clone_url, "to_path": str(dest)}
    if depth > 0:
        kwargs["depth"] = depth
    if branch:
        kwargs["branch"] = branch

    try:
        git.Repo.clone_from(**kwargs)
    except git.GitCommandError as e:
        # Try without branch spec (some repos only have 'main')
        if "Remote branch" in str(e) or "not found" in str(e):
            kwargs.pop("branch", None)
            git.Repo.clone_from(**kwargs)
        else:
            raise
    return dest


def init_and_push(local_dir: Path, remote_url: str, *,
                  token: str = "",
                  commit_msg: str = "initial",
                  branch: str = "main") -> None:
    """Init a repo, add all files, commit, push to remote.

    Used by `new.py` to push a freshly scaffolded skill repo.
    """
    repo = git.Repo.init(str(local_dir), initial_branch=branch)
    repo.git.add(A=True)
    repo.index.commit(commit_msg)

    push_url = _inject_token(remote_url, token)
    if "origin" not in [r.name for r in repo.remotes]:
        repo.create_remote("origin", push_url)
    else:
        repo.remotes.origin.set_url(push_url)

    repo.remotes.origin.push(refspec=f"{branch}:{branch}", set_upstream=True)


def add_commit_push(local_dir: Path, *,
                    commit_msg: str,
                    branch: str = "main",
                    token: str = "",
                    remote_url: str = "") -> None:
    """Stage all, commit, push (for existing repos).

    Used by `seed.py` after modifying skill files.
    """
    repo = git.Repo(str(local_dir))
    repo.git.add(A=True)
    if repo.is_dirty(untracked_files=True):
        repo.index.commit(commit_msg)
    else:
        return  # nothing to commit

    if remote_url and token:
        push_url = _inject_token(remote_url, token)
        repo.remotes.origin.set_url(push_url)

    repo.remotes.origin.push(refspec=f"{branch}:{branch}")


def checkout(repo_path: Path, ref: str) -> None:
    """Checkout a specific ref (sha / branch / tag)."""
    repo = git.Repo(str(repo_path))
    repo.git.checkout(ref)


def head_sha(repo_path: Path) -> str:
    """Return the HEAD sha of a repo."""
    repo = git.Repo(str(repo_path))
    return repo.head.commit.hexsha


def _inject_token(url: str, token: str) -> str:
    """Inject oauth2 token into URL if provided and not already present."""
    if not token:
        return url
    if "@" in url.split("://", 1)[-1]:
        return url  # already has credentials
    scheme, rest = url.split("://", 1)
    return f"{scheme}://oauth2:{token}@{rest}"
