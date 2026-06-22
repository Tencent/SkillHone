"""Seed-repo helpers (task-agnostic).

A SkillHone skill repo is JUST a skill: README.md + SKILL.md + scripts/ +
references/. Nothing else. No training data, no eval, no pointer to
auxiliary repos, no git submodules (submodules leak the related-repo URLs).

Related repos (train data, eval, etc.) are linked by a NAMING CONVENTION only:

    skillhone/<name>          — the skill repo (agent-visible)
    skillhone/<name>-train    — optional training data, if the task uses any
    skillhone/<name>-eval     — private eval repo (orchestrator/CI only)

The orchestrator / CI resolves `<name>-eval` by string-suffixing the skill
name; nothing in the skill repo mentions it.
"""
from __future__ import annotations

import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from . import paths
from .git_ops import clone


@dataclass
class SeedRepo:
    clone_path: Path
    readme: str                   # task brief → injected into Master prompt
    skill_md_path: Path
    skill_name: str               # last URL segment; used to derive <name>-eval


def clone_seed_repo(repo_url: str, workdir: Optional[Path] = None) -> SeedRepo:
    if workdir is None:
        # Orchestrator-side skill clone goes under ~/.skillhone/cache (0700)
        private = paths.get_cache_dir()
        workdir = Path(tempfile.mkdtemp(prefix="seed_", dir=str(private)))
    workdir = Path(workdir)

    clone(repo_url, dest=workdir, depth=1)

    readme_path = workdir / "README.md"
    skill_md = workdir / "SKILL.md"
    if not readme_path.exists():
        raise RuntimeError(f"seed repo missing README.md: {repo_url}")
    if not skill_md.exists():
        raise RuntimeError(f"seed repo missing SKILL.md: {repo_url}")

    skill_name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")

    # Sanity: skill repo must not leak auxiliary repo locations.
    gitmodules = workdir / ".gitmodules"
    if gitmodules.exists():
        raise RuntimeError(
            f"seed repo {repo_url} contains .gitmodules — submodules leak "
            "the related-repo URL. Remove and rebuild.")

    return SeedRepo(
        clone_path=workdir,
        readme=readme_path.read_text(encoding="utf-8"),
        skill_md_path=skill_md,
        skill_name=skill_name,
    )


def derive_eval_repo_url(skill_repo_url: str) -> str:
    """Derive the companion eval repo URL by string-suffixing with '-eval'.

    This is THE ONLY link between a skill and its eval. There is no file on
    disk that records it; the orchestrator derives it on the fly and the
    agent never learns of it.
    """
    base = skill_repo_url.rstrip("/").replace(".git", "")
    return f"{base}-eval"
