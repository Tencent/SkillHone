"""Orchestrator-only eval harness (task-agnostic).

Usage:
    python -m evaluation.eval_harness \\
        --skill-dir <path> --eval-repo <forgejo-url> \\
        --split probe|pr_val|es_val \\
        [--eval-sha SHA] [--output score.json] [--redact-traces]

This module is the ONLY way to touch the eval repo. The eval repo:
  - is private (Forgejo visibility=private)
  - contains probe/pr_val/es_val.jsonl + evaluator/eval.py
  - is NEVER referenced from anywhere in the skill repo or the agent workspace
  - is checked out with a Forgejo token that the agent never sees

The split-agent-visibility rule:
  - probe:  redacted traces can be shown to agent
  - pr_val: aggregate-only score can be shown to agent
  - es_val: orchestrator only — not even aggregate goes back to agent

This module is imported only by sdlc_loop.py (orchestrator) and by the CI
harbor shell script. It is not imported by any code that ends up in the
agent's workspace.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Optional

# Resolve paths
try:
    from core.paths import get_cache_dir as _get_cache_dir
    from core.git_ops import clone as _git_clone, checkout as _git_checkout, head_sha as _git_head_sha
except ImportError:
    # Fallback for standalone usage
    import git as _git_mod

    def _get_cache_dir() -> Path:
        d = Path.home() / ".skillhone" / "cache"
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _git_clone(url, dest=None, **kw):
        from core.git_ops import clone
        return clone(url, dest, **kw)

    def _git_checkout(repo_path, ref):
        _git_mod.Repo(str(repo_path)).git.checkout(ref)

    def _git_head_sha(repo_path):
        return _git_mod.Repo(str(repo_path)).head.commit.hexsha


def clone_eval_repo(repo_url: str, sha: str = "main",
                    cache_dir: Path | None = None) -> Path:
    """Clone or reuse an eval repo. Requires FORGEJO_TOKEN env var in URL or env.

    The cache dir defaults to ~/.skillhone/cache (0700) so the agent workspace
    cannot read the cloned eval data even if it tries.
    """
    if cache_dir is None:
        cache_dir = _get_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    try:
        cache_dir.chmod(0o700)
    except OSError:
        pass
    name = repo_url.rstrip("/").split("/")[-1].replace(".git", "")
    target = cache_dir / f"{name}@{sha[:10]}"

    token = os.environ.get("FORGEJO_TOKEN", "")

    if target.exists():
        try:
            got = _git_head_sha(target)
            if got == sha or sha == "main":
                return target
        except Exception:
            pass
        shutil.rmtree(target)

    _git_clone(repo_url, dest=target, token=token)
    if sha and sha != "main":
        _git_checkout(target, sha)
    try:
        target.chmod(0o700)
    except OSError:
        pass
    return target


def run_eval(skill_dir: Path, eval_dir: Path, split: str,
             iteration: int = 0, n_probe: int = 10,
             redact_traces: bool = False,
             output: Optional[Path] = None,
             trace_dir: Optional[str] = None) -> dict:
    """Invoke the evaluation engine directly (no subprocess). Returns the score dict."""
    import asyncio
    import tempfile

    from evaluation.template import run_eval as _run_eval

    if output is None:
        output = Path(tempfile.NamedTemporaryFile(
            delete=False, suffix=".json", prefix=f"eval_{split}_").name)

    rc = asyncio.run(_run_eval(
        skill_dir=str(skill_dir),
        dataset_dir=str(eval_dir),
        split=split,
        output=str(output),
        iteration=iteration,
        n_probe=n_probe,
        redact_traces=redact_traces,
        trace_dir=trace_dir,
    ))

    if not output.exists():
        raise RuntimeError(f"eval failed (rc={rc}): output file not produced")
    return json.loads(output.read_text())


def redact_for_agent(score: dict, split: str) -> dict:
    """Apply per-split visibility redaction before showing to the agent.

      probe  → aggregate + per-item redacted traces (no gold/query)
      pr_val → aggregate ONLY (no traces at all)
      es_val → NOTHING returned to agent (raise)

    sdlc_loop.py's agent prompt uses this as the filter.
    """
    keep = {k: score[k] for k in
            ("split", "n_items", "n_passed", "n_total", "score", "pass_rate",
             "avg_duration_s", "model") if k in score}
    if split == "probe":
        traces = score.get("traces", [])
        redacted_traces = []
        for t in traces:
            err = t.get("error", "")
            # Classify failure type
            if t.get("passed"):
                category = "pass"
            elif "hard timeout" in err or "agent_timeout" in err:
                category = "timeout"
            elif "agent_process_error" in err:
                category = "agent_process_error"
            elif "no_answer_produced" in err or (not t.get("predicted") and not err):
                category = "no_answer"
            elif not t.get("predicted"):
                category = "no_answer"
            else:
                category = "wrong_answer"

            # Only include actionable failures in traces shown to improver.
            # agent_process_error (max_turns exhausted) is NOT actionable —
            # it reflects task difficulty beyond model capability, not a skill defect.
            if category == "agent_process_error":
                continue

            redacted_traces.append({
                "uid": t.get("uid", ""),
                "query_preview": (t.get("query") or "")[:120] + "…",
                "predicted_preview": (t.get("predicted") or "")[:80],
                "passed": t.get("passed", False),
                "failure_category": category,
                "error": err,
            })
        keep["traces"] = redacted_traces
        # Add summary of failure categories
        from collections import Counter
        cats = Counter(t["failure_category"] for t in redacted_traces)
        keep["failure_summary"] = dict(cats)
    elif split == "pr_val":
        pass  # aggregate only
    elif split == "es_val":
        raise PermissionError(
            "es_val results are orchestrator-only; refusing to redact for agent")
    else:
        raise ValueError(split)
    return keep


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skill-dir", required=True)
    ap.add_argument("--eval-repo", required=True,
                    help="Forgejo URL of the private eval repo "
                         "(e.g. http://forgejo/skillhone/<name>-eval)")
    ap.add_argument("--eval-sha", default="main")
    ap.add_argument("--split", required=True,
                    choices=("probe", "pr_val", "es_val"))
    ap.add_argument("--iteration", type=int, default=0)
    ap.add_argument("--n-probe", type=int, default=10)
    ap.add_argument("--output", required=True)
    ap.add_argument("--redact-traces", action="store_true",
                    help="Ask eval.py to redact traces (probe only).")
    ap.add_argument("--for-agent", action="store_true",
                    help="Apply per-split agent-visibility filter to output.")
    args = ap.parse_args()

    eval_dir = clone_eval_repo(args.eval_repo, args.eval_sha)
    score = run_eval(
        skill_dir=Path(args.skill_dir).resolve(),
        eval_dir=eval_dir,
        split=args.split,
        iteration=args.iteration,
        n_probe=args.n_probe,
        redact_traces=args.redact_traces,
    )
    if args.for_agent:
        score = redact_for_agent(score, args.split)
    Path(args.output).write_text(
        json.dumps(score, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"{args.split}: score={score.get('score', 0):.4f} "
          f"({score.get('n_passed', 0)}/{score.get('n_total', 0)})",
          file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
