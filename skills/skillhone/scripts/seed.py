#!/usr/bin/env python3
"""Seed a skill repo with SkillHone's original scaffold.

Usage:
    python3 scripts/seed.py --repo http://forgejo/skillhone/my-skill.git
    python3 scripts/seed.py /path/to/local/skill
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

SKILLHONE_HOME = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
HISTORY_FILE = SKILLHONE_HOME / "history.jsonl"
LOCAL_SCRIPTS_DIR = Path(__file__).resolve().parent
INSTALLED_SCRIPTS_DIR = SKILLHONE_HOME / "skills" / "skillhone" / "scripts"
for scripts_dir in (LOCAL_SCRIPTS_DIR, INSTALLED_SCRIPTS_DIR):
    if (scripts_dir / "core").is_dir():
        sys.path.insert(0, str(scripts_dir))


def _log_event(action: str, data: dict) -> None:
    """Append one JSON line to ~/.skillhone/history.jsonl."""
    import datetime
    record = {"ts": datetime.datetime.now().isoformat(), "action": action, **data}
    SKILLHONE_HOME.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed a skill using SkillHone's original scaffold")
    parser.add_argument("repo_path", nargs="?", default=None,
                        help="local path (must contain README.md)")
    parser.add_argument("--repo", default=None,
                        help="Forgejo git URL (clone, seed, push)")
    parser.add_argument("--model", default=None,
                        help="accepted for CLI compatibility; seed is deterministic")
    parser.add_argument("--force", action="store_true",
                        help="overwrite SKILL.md and generated seed helper files")
    args = parser.parse_args()

    if not args.repo and not args.repo_path:
        print("ERROR: provide --repo <url> or a local path", file=sys.stderr)
        return 2

    if args.repo:
        cfg = _load_settings(required=True)
        return _seed_remote(args.repo, cfg, args.model, force=args.force)
    return _seed_local(Path(args.repo_path).resolve(), {}, args.model, force=args.force)


def _load_settings(*, required: bool) -> dict:
    settings_path = SKILLHONE_HOME / "settings.json"
    if not settings_path.exists():
        if required:
            raise FileNotFoundError(f"{settings_path} not found")
        return {}
    return json.loads(settings_path.read_text())


def _seed_remote(repo_url: str, cfg: dict, model_override: str | None, *, force: bool) -> int:
    from core.git_ops import clone as git_clone, add_commit_push

    forgejo = cfg.get("forgejo", {})
    token = forgejo.get("token", "")

    tmp_parent = Path("/tmp/skillhone")
    tmp_parent.mkdir(parents=True, exist_ok=True)
    tmp = Path(tempfile.mkdtemp(prefix="seed_", dir=str(tmp_parent)))
    local_dir = tmp / "repo"
    try:
        print(f"Cloning {repo_url} ...")
        git_clone(repo_url, dest=local_dir, token=token)

        if not (local_dir / "README.md").exists():
            print("ERROR: cloned repo has no README.md", file=sys.stderr)
            return 2

        rc = _run_seed(local_dir, cfg, model_override, force=force)
        if rc != 0:
            return rc

        print("Pushing seed result...")
        add_commit_push(local_dir,
                        commit_msg="seed: initialize SkillHone skill",
                        token=token, remote_url=repo_url)
        _log_event("seed", {
            "repo": repo_url,
            "local_dir": str(local_dir),
            "model": "deterministic",
        })
        print("Done")
        return 0
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def _seed_local(repo_path: Path, cfg: dict, model_override: str | None, *, force: bool) -> int:
    if not repo_path.exists():
        print(f"ERROR: {repo_path} not found", file=sys.stderr)
        return 2
    if not (repo_path / "README.md").exists():
        print(f"ERROR: {repo_path}/README.md not found", file=sys.stderr)
        return 2
    return _run_seed(repo_path, cfg, model_override, force=force)


def _run_seed(repo_path: Path, cfg: dict, model_override: str | None, *, force: bool) -> int:
    print(f"Seeding skill at {repo_path} with SkillHone scaffold")

    from core.seed import run_skillhone_seed
    try:
        run_skillhone_seed(repo_path, cfg, model_override=model_override, force=force)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    print("Seed complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
