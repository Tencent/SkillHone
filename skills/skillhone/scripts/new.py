#!/usr/bin/env python3
"""Create a new skill + eval repo pair on Forgejo.

Usage:
    python3 scripts/new.py deep-research --instruction README.md --data-dir ./data
    python3 scripts/new.py my-skill --instruction "Answer questions about X" --no-run
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import tempfile
from pathlib import Path

SKILLHONE_HOME = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone"))
HISTORY_FILE = SKILLHONE_HOME / "history.jsonl"
sys.path.insert(0, str(SKILLHONE_HOME / "skills" / "skillhone" / "scripts"))
TEMPLATE_PY = SKILLHONE_HOME / "skills" / "skillhone" / "scripts" / "evaluation" / "template.py"


def _log_event(action: str, data: dict) -> None:
    """Append one JSON line to ~/.skillhone/history.jsonl."""
    import datetime
    record = {"ts": datetime.datetime.now().isoformat(), "action": action, **data}
    SKILLHONE_HOME.mkdir(parents=True, exist_ok=True)
    with open(HISTORY_FILE, "a") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9\-]*[a-z0-9]$")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create new skill + eval repos")
    parser.add_argument("name", help="skill name (lowercase, dashes OK)")
    parser.add_argument("--instruction", default=None,
                        help="README.md file or inline text")
    parser.add_argument("--data-dir", default=None,
                        help="directory with probe.jsonl/train.jsonl/test.jsonl")
    parser.add_argument("--no-run", action="store_true",
                        help="create repos but don't start optimization")
    args = parser.parse_args()

    if not _NAME_RE.fullmatch(args.name):
        print(f"ERROR: invalid name '{args.name}' (use lowercase + dashes)", file=sys.stderr)
        return 2

    # Load settings
    settings_path = Path.home() / ".skillhone" / "settings.json"
    if not settings_path.exists():
        print("ERROR: ~/.skillhone/settings.json not found", file=sys.stderr)
        return 1
    settings = json.loads(settings_path.read_text())
    forgejo_cfg = settings.get("forgejo", {})
    token = forgejo_cfg.get("token", "")
    forgejo_url = forgejo_cfg.get("url", "http://localhost:3000")
    owner = forgejo_cfg.get("owner", "skillhone")

    # Stage repos
    Path("/tmp/skillhone").mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix=f"new_{args.name}_", dir="/tmp/skillhone"))
    skill_dir = stage / args.name
    eval_dir = stage / f"{args.name}-eval"

    # Scaffold skill repo
    skill_dir.mkdir(parents=True)
    title = " ".join(w.capitalize() for w in args.name.split("-"))
    (skill_dir / "SKILL.md").write_text(
        f"---\nname: {args.name}\ndescription: >-\n  TODO\n---\n\n# {title}\n\nTODO\n")
    (skill_dir / "scripts").mkdir()
    (skill_dir / "scripts" / ".gitkeep").write_text("")
    (skill_dir / "references").mkdir()
    (skill_dir / "references" / ".gitkeep").write_text("")

    # Set README from --instruction.
    #
    # PRD eval/improver visibility split — three modes, in priority order:
    #
    #   (1) Explicit override. If --instruction points to a file AND a sibling
    #       `*.improver_only.md` (or `PRD.improver_only.md`) exists next to it,
    #       treat the sibling as the improver-visible PRD verbatim.
    #
    #   (2) Auto-redaction (default). If --instruction is a single Markdown
    #       file, scan it for a top-level `## ` (or `# `) section whose
    #       heading contains "Evaluation", "Verifier", "Scoring", or "Rubric"
    #       (case-insensitive). Strip that section (and any of its
    #       sub-sections) from the improver-visible copy, replacing it with a
    #       short redaction note. The full file always goes to the eval repo.
    #
    #   (3) Inline string. If --instruction is plain text (not a file), no
    #       split is possible; the string goes to skill_dir/README.md as-is.
    #
    # In modes (1) and (2):
    #     skill_dir/README.md  ← improver-visible (no rubric)   (improver/solver)
    #     eval_dir/PRD.md      ← full PRD (rubric intact)       (eval-agent)
    import re as _re

    def _auto_redact_evaluation(text: str) -> tuple[str, bool]:
        """Strip the first `## ...Evaluation/Verifier/Scoring/Rubric...` section
        (and any subsections under it) from a markdown PRD. Returns
        (redacted_text, did_redact). Idempotent if no such section exists.
        """
        lines = text.splitlines(keepends=False)
        eval_re = _re.compile(
            r"^(#{1,3})\s+.*\b(Evaluation|Verifier|Verification|Scoring|Rubric)\b.*$",
            _re.IGNORECASE,
        )
        # Find the first matching heading
        start_idx = None
        start_level = None
        for i, line in enumerate(lines):
            m = eval_re.match(line.rstrip())
            if m:
                start_idx = i
                start_level = len(m.group(1))
                break
        if start_idx is None:
            return text, False
        # Find the end: next heading of same-or-shallower level, or EOF
        heading_re = _re.compile(r"^(#{1,6})\s+")
        end_idx = len(lines)
        for j in range(start_idx + 1, len(lines)):
            mh = heading_re.match(lines[j])
            if mh and len(mh.group(1)) <= start_level:
                end_idx = j
                break
        redaction_note = [
            lines[start_idx],
            "",
            "> _Redacted in this improver-only view of the PRD. The full",
            "> evaluation rubric — verifier contract, scoring rules,",
            "> acceptance gates — is visible to the eval-agent only and lives",
            "> in the paired `<skill>-eval` repo's `PRD.md`. The improver must",
            "> not see its own grading rubric, or Goodhart's Law takes over._",
            "",
        ]
        new_lines = lines[:start_idx] + redaction_note + lines[end_idx:]
        return "\n".join(new_lines) + ("\n" if text.endswith("\n") else ""), True

    full_prd_text = None
    improver_text = None
    if args.instruction:
        p = Path(args.instruction)
        if p.exists():
            full_prd_text = p.read_text(encoding="utf-8")
            # Mode 1: explicit override via sibling file.
            stem = p.stem
            candidates = [
                p.parent / f"{stem}.improver_only{p.suffix}",
                p.parent / f"{stem.lower()}.improver_only.md",
                p.parent / "PRD.improver_only.md",
                p.parent / "prd.improver_only.md",
            ]
            seen = set()
            for cand in candidates:
                rp = cand.resolve()
                if rp in seen or rp == p.resolve():
                    continue
                seen.add(rp)
                if cand.exists():
                    improver_text = cand.read_text(encoding="utf-8")
                    print(f"  Using improver-only PRD override: {cand.name}")
                    break
            # Mode 2: auto-redact if no override.
            if improver_text is None and p.suffix.lower() in (".md", ".markdown"):
                candidate, did_redact = _auto_redact_evaluation(full_prd_text)
                if did_redact:
                    improver_text = candidate
                    print(f"  Auto-redacted Evaluation section from PRD for improver-visible copy")
        else:
            # If the value looks like a file path but does not resolve, fail
            # loudly — silently treating it as inline text writes a useless
            # one-line README and silently corrupts the rest of the pipeline.
            looks_like_path = (
                "/" in args.instruction
                or args.instruction.lower().endswith((".md", ".markdown", ".txt"))
            )
            if looks_like_path:
                raise SystemExit(
                    f"--instruction looks like a file path but does not exist: "
                    f"{args.instruction!r} (resolved from cwd={Path.cwd()}). "
                    f"Pass an absolute path or run from a directory where the "
                    f"relative path resolves."
                )
            # Mode 3: inline instruction string.
            full_prd_text = args.instruction

        if improver_text is not None:
            (skill_dir / "README.md").write_text(improver_text, encoding="utf-8")
        else:
            (skill_dir / "README.md").write_text(full_prd_text, encoding="utf-8")
    else:
        (skill_dir / "README.md").write_text(f"# {title}\n\nTODO\n")

    # Scaffold eval repo — seed both probe and test splits empty so that
    # `skillhone synth --splits probe,test` can fill them without surprise.
    eval_dir.mkdir(parents=True)
    (eval_dir / "probe.jsonl").write_text("")
    (eval_dir / "test.jsonl").write_text("")
    evaluator = eval_dir / "evaluator"
    evaluator.mkdir()
    # Copy template.py as eval.py
    if TEMPLATE_PY.exists():
        shutil.copy2(TEMPLATE_PY, evaluator / "eval.py")

    # When the PRD split was detected above, the full PRD (with the
    # evaluation rubric) belongs in the private eval repo only — never in
    # the public skill repo. Drop it at the eval-repo root as PRD.md so
    # the eval-agent can read it directly.
    if improver_text is not None and full_prd_text is not None:
        (eval_dir / "PRD.md").write_text(full_prd_text, encoding="utf-8")

    # Copy data files if --data-dir
    if args.data_dir:
        data_path = Path(args.data_dir)
        # Copy all .jsonl files (probe/train/test*/pr_val/etc.)
        for src in sorted(data_path.glob("*.jsonl")):
            shutil.copy2(src, eval_dir / src.name)
            print(f"  Copied: {src.name}")

    # Create Forgejo repos + push
    def _create_repo(name, private=False):
        import urllib.request
        data = json.dumps({"name": name, "private": private, "auto_init": True}).encode()
        # Try org endpoint first, fall back to user endpoint
        for endpoint in [f"{forgejo_url}/api/v1/orgs/{owner}/repos",
                         f"{forgejo_url}/api/v1/user/repos"]:
            req = urllib.request.Request(
                endpoint, data=data,
                headers={"Authorization": f"token {token}",
                         "Content-Type": "application/json"})
            try:
                urllib.request.urlopen(req, timeout=10)
                return  # success
            except urllib.error.HTTPError as e:
                if e.code == 409:  # already exists
                    return
                continue
            except Exception:
                continue
        print(f"  WARNING: could not create repo {name}", file=sys.stderr)

    def _push(local_dir, repo_name):
        import git as _git
        url = f"http://{forgejo_url.split('://', 1)[1]}/{owner}/{repo_name}.git"
        push_url = f"http://oauth2:{token}@{forgejo_url.split('://', 1)[1]}/{owner}/{repo_name}.git"
        # Init, add, commit, force-push (repo was auto_init'd)
        repo = _git.Repo.init(str(local_dir), initial_branch="main")
        repo.config_writer().set_value("user", "name", "skillhone").release()
        repo.config_writer().set_value("user", "email", "skillhone@localhost").release()
        repo.git.add(A=True)
        repo.index.commit("initial")
        if "origin" not in [r.name for r in repo.remotes]:
            repo.create_remote("origin", push_url)
        else:
            repo.remotes.origin.set_url(push_url)
        repo.remotes.origin.push(refspec="main:main", force=True)

    print(f"Creating repos: {owner}/{args.name} + {owner}/{args.name}-eval")
    _create_repo(f"{args.name}-eval", private=True)
    _create_repo(args.name, private=False)
    _push(eval_dir, f"{args.name}-eval")
    _push(skill_dir, args.name)
    shutil.rmtree(stage, ignore_errors=True)

    skill_url = f"{forgejo_url}/{owner}/{args.name}.git"
    print(f"\n  Skill: {skill_url}")
    print(f"  Eval:  {forgejo_url}/{owner}/{args.name}-eval.git (private)")

    _log_event("new", {
        "name": args.name,
        "skill_url": skill_url,
        "eval_url": f"{forgejo_url}/{owner}/{args.name}-eval.git",
        "data_dir": args.data_dir,
    })

    if args.no_run:
        print(f"\nTo seed:  python3 scripts/seed.py --repo {skill_url}")
        print(f"To optim: python3 scripts/optim.py --repo {skill_url}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
