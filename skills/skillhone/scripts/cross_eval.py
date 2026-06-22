#!/usr/bin/env python3
"""Run cross-domain evaluation: any skill × any test split.

Usage:
    # Run SkillHone on SealQA only
    python3 cross_eval.py --skill /tmp/skillhone_run --split test.seal_0

    # Run multiple skills × multiple splits
    python3 cross_eval.py \\
        --skill /tmp/skillhone/seed_for_baseline:seed \\
        --skill /tmp/skillhone_run:skillhone \\
        --split test.gaia --split test.seal_0

Logs results to ~/.skillhone/runs/cross_eval/results.jsonl
"""
from __future__ import annotations

import argparse
import asyncio
import datetime
import json
import os
import sys
from pathlib import Path

EVAL_DIR_DEFAULT = "/tmp/skillhone_eval"
LOG_DIR = Path.home() / ".skillhone" / "runs" / "cross_eval"


def parse_skill_arg(s: str) -> tuple[str, str]:
    """Parse 'path[:label]' → (path, label)."""
    if ":" in s and not s.startswith("/"):
        path, label = s.rsplit(":", 1)
    elif s.count(":") == 1 and not s[0] == "/":
        path, label = s.split(":", 1)
    else:
        # Try splitting at last colon if path doesn't have one in it
        parts = s.rsplit(":", 1)
        if len(parts) == 2 and Path(parts[0]).exists():
            path, label = parts
        else:
            path = s
            label = Path(s).name
    return path, label


def main() -> int:
    parser = argparse.ArgumentParser(description="Cross-domain eval runner")
    parser.add_argument("--skill", action="append", required=True,
                        help="skill dir, optionally :label (can repeat)")
    parser.add_argument("--split", action="append", required=True,
                        help="test split name, e.g. test.gaia or test.seal_0 (can repeat)")
    parser.add_argument("--eval-dir", default=EVAL_DIR_DEFAULT,
                        help="dir containing <split>.jsonl files")
    parser.add_argument("--log-dir", default=str(LOG_DIR),
                        help="dir for output JSONs and history.jsonl")
    args = parser.parse_args()

    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)
    history_path = log_dir / "results.jsonl"

    eval_dir = Path(args.eval_dir).resolve()

    # Add eval template to path
    eval_scripts = Path(os.environ.get("SKILLHONE_HOME", Path.home() / ".skillhone")) / "skills" / "skillhone" / "scripts"
    sys.path.insert(0, str(eval_scripts))
    from evaluation.template import run_eval

    skills = [parse_skill_arg(s) for s in args.skill]

    print(f"=== Cross-domain Eval ===")
    print(f"  Skills: {[label for _, label in skills]}")
    print(f"  Splits: {args.split}")
    print(f"  Eval dir: {eval_dir}")
    print(f"  Log dir: {log_dir}")
    print()

    results = []
    for skill_path, skill_label in skills:
        skill_dir = Path(skill_path).resolve()
        if not (skill_dir / "SKILL.md").exists():
            print(f"  SKIP: {skill_label} ({skill_dir}) missing SKILL.md", file=sys.stderr)
            continue

        for split in args.split:
            split_file = eval_dir / f"{split}.jsonl"
            if not split_file.exists():
                print(f"  SKIP: {split} ({split_file}) not found", file=sys.stderr)
                continue

            ts = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
            output = log_dir / f"{skill_label}_{split}_{ts}.json"
            print(f"\n>>> Running: skill={skill_label}, split={split}")
            print(f"    skill_dir: {skill_dir}")
            print(f"    output: {output}")

            t0 = datetime.datetime.now()
            try:
                asyncio.run(run_eval(
                    skill_dir=str(skill_dir),
                    dataset_dir=str(eval_dir),
                    split=split,
                    output=str(output),
                    iteration=0,
                    n_probe=0,
                ))
                result = json.loads(output.read_text())
            except Exception as e:
                print(f"    ERROR: {e}", file=sys.stderr)
                continue
            elapsed = (datetime.datetime.now() - t0).total_seconds()

            score = result.get("score", 0.0)
            n_passed = result.get("n_passed", 0)
            n_total = result.get("n_total", 0)
            n_errors = result.get("n_errors", 0)

            print(f"    Score: {n_passed}/{n_total} = {score:.1%} (errors={n_errors}, time={elapsed:.0f}s)")

            record = {
                "ts": datetime.datetime.now().isoformat(),
                "skill_label": skill_label,
                "skill_dir": str(skill_dir),
                "split": split,
                "score": score,
                "n_passed": n_passed,
                "n_total": n_total,
                "n_errors": n_errors,
                "elapsed_s": round(elapsed, 1),
                "output_file": str(output),
            }
            with open(history_path, "a") as f:
                f.write(json.dumps(record, ensure_ascii=False) + "\n")
            results.append(record)

    # Summary
    print(f"\n=== Summary ===")
    print(f"{'skill':<25} {'split':<20} {'score':<8} {'pass/total':<12}")
    for r in results:
        print(f"{r['skill_label']:<25} {r['split']:<20} {r['score']:.1%}    {r['n_passed']}/{r['n_total']}")
    print(f"\nHistory: {history_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
