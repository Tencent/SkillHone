#!/usr/bin/env python3
"""Run skill evaluation.

Usage:
    python3 scripts/eval.py --skill-dir ./my-skill --eval-dir ./my-skill-eval --split probe
    python3 scripts/eval.py --skill-dir ./my-skill --eval-dir ./my-skill-eval --split test --mode direct
    python3 scripts/eval.py --skill-dir ./my-skill --eval-dir ./my-skill-eval --split test --mode seed
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Run skill evaluation")
    parser.add_argument("--skill-dir", required=True,
                        help="path to skill directory (with SKILL.md)")
    parser.add_argument("--eval-dir", required=True,
                        help="path to eval repo (with probe.jsonl + evaluator/)")
    parser.add_argument("--split", required=True,
                        help="split name (e.g. probe, train, test, test.gaia, test.seal_0); "
                             "loads <split>.jsonl from eval-dir")
    parser.add_argument("--n-probe", type=int, default=0,
                        help="number of items (0=all)")
    parser.add_argument("--output", default=None)
    parser.add_argument("--trace-dir", default=None,
                        help="save per-item solver trajectories")
    parser.add_argument("--iteration", type=int, default=0)
    parser.add_argument("--mode", choices=("skill", "seed", "direct"), default="skill",
                        help="skill=use optimized skill (default), "
                             "seed=use seed version (git first commit), "
                             "direct=no skill at all (bare agent)")
    parser.add_argument("--workers", type=int, default=None,
                        help="override executor.workers from settings.json")
    parser.add_argument("--timeout", type=int, default=None,
                        help="override executor.timeout (seconds) from settings.json")
    args = parser.parse_args()

    # Per-run overrides via env (consumed by template.py's _get_workers/_get_timeout)
    if args.workers is not None:
        import os as _os
        _os.environ["EXECUTOR_WORKERS"] = str(args.workers)
    if args.timeout is not None:
        import os as _os
        _os.environ["EXECUTOR_TIMEOUT"] = str(args.timeout)

    skill_dir = Path(args.skill_dir).resolve()
    eval_dir = Path(args.eval_dir).resolve()

    if not eval_dir.exists():
        print(f"ERROR: eval-dir not found: {eval_dir}", file=sys.stderr)
        return 2

    # Handle mode: direct means no skill, seed means checkout first commit
    actual_skill_dir = skill_dir
    tmp_seed_dir = None

    if args.mode == "direct":
        # Create an empty dir (no SKILL.md = no skill loaded)
        import tempfile
        actual_skill_dir = Path(tempfile.mkdtemp(prefix="noskill_", dir="/tmp/skillhone"))
        print(f"[eval] mode=direct (no skill)")
    elif args.mode == "seed":
        # Checkout the seed commit (first non-initial commit)
        import tempfile, shutil
        tmp_seed_dir = Path(tempfile.mkdtemp(prefix="seed_eval_", dir="/tmp/skillhone"))
        try:
            import git
            repo = git.Repo(str(skill_dir))
            # Find seed commit (second commit, after 'initial')
            commits = list(repo.iter_commits("main", max_count=100))
            seed_commit = None
            for c in reversed(commits):
                if "seed" in c.message.lower():
                    seed_commit = c
                    break
            if not seed_commit:
                # fallback: second commit from the bottom
                seed_commit = commits[-2] if len(commits) >= 2 else commits[-1]
            # Checkout seed into tmp dir
            repo.git.worktree("add", str(tmp_seed_dir), seed_commit.hexsha)
            actual_skill_dir = tmp_seed_dir
            print(f"[eval] mode=seed (commit {seed_commit.hexsha[:8]}: {seed_commit.message.strip()[:50]})")
        except Exception as e:
            # Fallback: just copy current dir
            print(f"[eval] WARNING: could not checkout seed: {e}", file=sys.stderr)
            shutil.copytree(str(skill_dir), str(tmp_seed_dir), dirs_exist_ok=True)
            actual_skill_dir = tmp_seed_dir
    else:
        if not skill_dir.exists():
            print(f"ERROR: skill-dir not found: {skill_dir}", file=sys.stderr)
            return 2
        print(f"[eval] mode=skill (optimized)")

    output = args.output or f"/tmp/skillhone_eval_{args.split}_{args.mode}.json"

    from evaluation.template import run_eval

    print(f"[eval] split={args.split} skill={actual_skill_dir.name} "
          f"n={args.n_probe or 'all'} mode={args.mode}")

    rc = asyncio.run(run_eval(
        skill_dir=str(actual_skill_dir),
        dataset_dir=str(eval_dir),
        split=args.split,
        output=output,
        iteration=args.iteration,
        n_probe=args.n_probe,
        trace_dir=args.trace_dir,
    ))

    # Cleanup worktree
    if tmp_seed_dir and tmp_seed_dir.exists():
        try:
            import git
            repo = git.Repo(str(skill_dir))
            repo.git.worktree("remove", str(tmp_seed_dir), force=True)
        except Exception:
            pass

    if rc != 0:
        print(f"[eval] FAILED (rc={rc})", file=sys.stderr)
        return 1

    try:
        score = json.loads(Path(output).read_text())
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1

    print(f"\n  Score: {score.get('score', 0):.2%} "
          f"({score.get('n_passed', 0)}/{score.get('n_total', 0)})")
    print(f"  Mode: {args.mode}")
    print(f"  Saved: {output}")
    return 0


if __name__ == "__main__":
    import os
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    sys.exit(main())
