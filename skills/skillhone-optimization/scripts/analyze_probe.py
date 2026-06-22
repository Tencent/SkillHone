#!/usr/bin/env python3
"""Analyze probe evaluation results and identify failure patterns.

Usage:
    python3 scripts/analyze_probe.py _data/probe_result.json

Outputs a structured analysis of:
- Overall score and pass/fail counts
- Failure categories (timeout, wrong answer, no answer, format error)
- Top error patterns with examples
- Suggested improvement priorities
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from collections import Counter
from pathlib import Path

# Logging setup
_log = logging.getLogger("analyze_probe")
_log.setLevel(logging.DEBUG)
_fmt = logging.Formatter("%(asctime)s [%(levelname)-5s] %(message)s", datefmt="%H:%M:%S")
_sh = logging.StreamHandler(sys.stderr)
_sh.setLevel(logging.WARNING)
_sh.setFormatter(_fmt)
_log.addHandler(_sh)
_log_dir = Path("_data")
if _log_dir.exists():
    _fh = logging.FileHandler(_log_dir / "analyze_probe.log")
    _fh.setLevel(logging.DEBUG)
    _fh.setFormatter(_fmt)
    _log.addHandler(_fh)


def classify_failure(trace: dict) -> str:
    """Classify a failed trace into a failure category."""
    error = trace.get("error", "")
    predicted = trace.get("predicted_preview", "")

    if "Recursion limit" in error or "recursion_limit" in error:
        return "timeout"
    if "hard timeout" in error:
        return "hard_timeout"
    if "LLM fallback guess" in error:
        return "llm_fallback"
    if not predicted or predicted.strip() == "":
        return "no_answer"
    if "answer scraped" in error:
        return "scraped"
    return "wrong_answer"


def analyze(result: dict) -> dict:
    """Analyze probe result and return structured findings."""
    score = result.get("score", 0)
    n_passed = result.get("n_passed", 0)
    n_total = result.get("n_total", 0)
    traces = result.get("traces", [])

    # Separate passed and failed
    passed = [t for t in traces if t.get("passed")]
    failed = [t for t in traces if not t.get("passed")]

    # Classify failures
    failure_cats = Counter()
    failure_examples: dict[str, list] = {}
    for t in failed:
        cat = classify_failure(t)
        failure_cats[cat] += 1
        if cat not in failure_examples:
            failure_examples[cat] = []
        if len(failure_examples[cat]) < 3:
            failure_examples[cat].append({
                "uid": t.get("uid", "?"),
                "query_preview": t.get("query_preview", "")[:80],
                "predicted_preview": t.get("predicted_preview", "")[:60],
                "error": t.get("error", "")[:100],
            })

    # Priority ranking (most impactful to fix first)
    priorities = []
    for cat, count in failure_cats.most_common():
        impact = count / max(n_total, 1)
        suggestion = _suggest_fix(cat)
        priorities.append({
            "category": cat,
            "count": count,
            "impact_pct": round(impact * 100, 1),
            "suggestion": suggestion,
        })

    compiler_diagnosis = _load_compiler_diagnosis()

    return {
        "summary": {
            "score": score,
            "passed": n_passed,
            "failed": len(failed),
            "total": n_total,
        },
        "failure_breakdown": dict(failure_cats),
        "priorities": priorities,
        "examples": failure_examples,
        "compiler_diagnosis": compiler_diagnosis,
    }


def _suggest_fix(category: str) -> str:
    """Return a neutral description of the failure category."""
    descriptions = {
        "timeout": "Agent ran out of turns before completing the task",
        "hard_timeout": "Agent hit the wall-clock time limit",
        "llm_fallback": "Agent could not find answer via available tools",
        "no_answer": "Agent completed but did not write answer.txt",
        "scraped": "Agent wrote answer to wrong location",
        "wrong_answer": "Agent produced an incorrect answer",
    }
    return descriptions.get(category, "Unknown failure mode")


def format_report(analysis: dict) -> str:
    """Format analysis as human-readable report."""
    lines = []
    s = analysis["summary"]
    lines.append(f"=== Probe Analysis ===")
    lines.append(f"Score: {s['score']:.2%} ({s['passed']}/{s['total']} passed, {s['failed']} failed)")
    lines.append("")

    lines.append("--- Failure Breakdown ---")
    for cat, count in sorted(analysis["failure_breakdown"].items(),
                              key=lambda x: -x[1]):
        pct = count / max(s["total"], 1) * 100
        lines.append(f"  {cat}: {count} ({pct:.0f}%)")
    lines.append("")

    lines.append("--- Improvement Priorities ---")
    for i, p in enumerate(analysis["priorities"][:3], 1):
        lines.append(f"  {i}. [{p['category']}] {p['count']} failures ({p['impact_pct']}%)")
        lines.append(f"     Fix: {p['suggestion']}")
    lines.append("")

    compiler = analysis.get("compiler_diagnosis") or {}
    if compiler:
        lines.append("--- Compiler / Validator Diagnostics ---")
        summary = compiler.get("summary")
        if summary:
            lines.append(str(summary))
        patterns = compiler.get("patterns") or compiler.get("diagnostics") or []
        if isinstance(patterns, dict):
            patterns = [{"pattern": k, "count": v} for k, v in patterns.items()]
        for item in patterns[:5] if isinstance(patterns, list) else []:
            if isinstance(item, dict):
                label = item.get("pattern") or item.get("message") or item.get("error") or str(item)
                count = item.get("count")
                suffix = f" ({count})" if count is not None else ""
                lines.append(f"  - {label}{suffix}")
            else:
                lines.append(f"  - {item}")
        lines.append("")

    lines.append("--- Example Failures ---")
    for cat, examples in analysis["examples"].items():
        lines.append(f"  [{cat}]:")
        for ex in examples[:2]:
            lines.append(f"    - {ex['uid']}: {ex['query_preview']}")
            if ex["predicted_preview"]:
                lines.append(f"      pred: {ex['predicted_preview']}")
            if ex["error"]:
                lines.append(f"      err: {ex['error']}")
    lines.append("")

    # Skill structure feedback if available
    skill_fb = None
    # Note: skill_structure_feedback is injected by orchestrator
    lines.append("--- Top Failure Mode ---")
    if analysis["priorities"]:
        top = analysis["priorities"][0]
        lines.append(f"Most common: {top['category']} ({top['count']} failures)")
        lines.append(f"Description: {top['suggestion']}")

    return "\n".join(lines)


def _load_compiler_diagnosis() -> dict:
    """Load optional compiler diagnostics generated by the orchestrator."""
    path = Path("_data/compiler_diagnosis.json")
    if not path.exists():
        return {}
    try:
        with path.open() as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"diagnostics": data}
    except Exception as exc:
        return {"summary": f"Could not read compiler_diagnosis.json: {exc}"}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze a probe_result.json and print a structured failure report.",
    )
    parser.add_argument("probe_result",
                        help="Path to probe_result.json (typically _data/probe_result.json)")
    parser.add_argument("--json", action="store_true",
                        help="Also emit the structured analysis as JSON")
    args = parser.parse_args()

    path = Path(args.probe_result)
    if not path.exists():
        print(f"ERROR: {path} not found", file=sys.stderr)
        _log.error(f"Probe result file not found: {path}")
        return 1

    with path.open() as f:
        result = json.load(f)

    _log.info(f"Analyzing probe results from {path} "
              f"(score={result.get('score', 0):.4f}, "
              f"n={result.get('n_total', 0)})")

    analysis = analyze(result)
    report = format_report(analysis)
    print(report)

    _log.info(f"Analysis complete: {analysis['summary']['passed']}/{analysis['summary']['total']} passed, "
              f"top failure: {analysis['priorities'][0]['category'] if analysis['priorities'] else 'none'}")

    if args.json:
        print("\n--- JSON ---")
        print(json.dumps(analysis, indent=2, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    sys.exit(main())
