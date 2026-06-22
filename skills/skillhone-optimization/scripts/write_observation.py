#!/usr/bin/env python3
"""Render SkillHone observation data as Forgejo wiki markdown.

The script intentionally stays compiler-agnostic. It formats redacted probe,
trajectory, and compiler diagnostics so the improvement loop has a durable,
browsable observation page instead of local-only JSON.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from analyze_probe import analyze  # noqa: E402


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        with path.open() as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"items": data}
    except Exception as exc:
        return {"error": f"Could not read {path}: {exc}"}


def _fmt_patterns(data: object, limit: int = 8) -> list[str]:
    if not data:
        return []
    if isinstance(data, dict):
        items = [{"pattern": key, "count": value} for key, value in data.items()]
    elif isinstance(data, list):
        items = data
    else:
        return [f"- {data}"]

    lines: list[str] = []
    for item in items[:limit]:
        if isinstance(item, dict):
            label = (
                item.get("pattern")
                or item.get("message")
                or item.get("error")
                or item.get("category")
                or str(item)
            )
            count = item.get("count")
            suffix = f" ({count})" if count is not None else ""
            lines.append(f"- {label}{suffix}")
        else:
            lines.append(f"- {item}")
    return lines


def render_observation(probe: dict, trajectory: dict, title: str, action: str) -> str:
    analysis = analyze(probe)
    summary = analysis["summary"]
    compiler = analysis.get("compiler_diagnosis") or {}

    lines = [
        f"# {title}",
        "",
        "## Probe Summary",
        "",
        f"- Score: {summary['score']:.2%}",
        f"- Passed: {summary['passed']}/{summary['total']}",
        f"- Failed: {summary['failed']}",
        "",
        "## Failure Breakdown",
        "",
    ]

    breakdown = analysis.get("failure_breakdown") or {}
    if breakdown:
        for category, count in sorted(breakdown.items(), key=lambda item: -item[1]):
            lines.append(f"- {category}: {count}")
    else:
        lines.append("- No failures")

    lines.extend(["", "## Compiler / Validator Observation", ""])
    if compiler:
        summary_text = compiler.get("summary")
        if summary_text:
            lines.append(str(summary_text))
            lines.append("")
        patterns = compiler.get("patterns") or compiler.get("diagnostics") or []
        pattern_lines = _fmt_patterns(patterns)
        lines.extend(pattern_lines or ["- Compiler diagnosis present but no patterns were summarized"])
    else:
        lines.append("- No compiler diagnosis captured for this iteration")

    lines.extend(["", "## Trajectory Observation", ""])
    if trajectory:
        traj_summary = trajectory.get("summary")
        if traj_summary:
            lines.append(str(traj_summary))
            lines.append("")
        traj_patterns = (
            trajectory.get("patterns")
            or trajectory.get("categories")
            or trajectory.get("failure_breakdown")
            or trajectory.get("diagnostics")
            or []
        )
        lines.extend(_fmt_patterns(traj_patterns) or ["- Trajectory diagnosis present but no patterns were summarized"])
    else:
        lines.append("- No trajectory diagnosis captured for this iteration")

    lines.extend(["", "## Improvement Priorities", ""])
    priorities = analysis.get("priorities") or []
    if priorities:
        for item in priorities[:5]:
            lines.append(
                f"- {item['category']}: {item['count']} failures, "
                f"{item['impact_pct']}% impact. {item['suggestion']}"
            )
    else:
        lines.append("- No priority because no probe failures were found")

    lines.extend(["", "## Action Taken", ""])
    lines.append(action or "- Issue reporter should fill in the issue/PR action taken")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create redacted SkillHone observation wiki markdown.")
    parser.add_argument("--probe", default="_data/probe_result.json")
    parser.add_argument("--trajectory", default="_data/trajectory_diagnosis.json")
    parser.add_argument("--title", default="Iteration Observation")
    parser.add_argument("--action", default="")
    args = parser.parse_args()

    probe_path = Path(args.probe)
    if not probe_path.exists():
        print(f"ERROR: {probe_path} not found", file=sys.stderr)
        return 1

    with probe_path.open() as f:
        probe = json.load(f)
    trajectory = _load_json(Path(args.trajectory))

    print(render_observation(probe, trajectory, args.title, args.action))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
