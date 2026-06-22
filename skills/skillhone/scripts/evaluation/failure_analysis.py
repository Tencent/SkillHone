"""Generate failure analysis report from probe results.

Called by orchestrator after probe eval. Has access to full traces
(including gold answers and full questions). Produces a redacted
analysis report that describes error PATTERNS without leaking
specific questions or answers.

The report is written to workspace/_data/failure_analysis.txt
for the improver to read.
"""
from __future__ import annotations

import json
from pathlib import Path


def generate_failure_analysis(probe_raw: dict) -> str:
    """Analyze probe failures and produce a pattern-level report.

    Input: full probe result (with query, expected, predicted).
    Output: redacted analysis (no specific questions/answers leaked).
    """
    traces = probe_raw.get("traces", [])
    if not traces:
        return "No traces available for analysis."

    passed = [t for t in traces if t.get("passed")]
    failed = [t for t in traces if not t.get("passed")]

    # Separate actionable failures from model-limit failures
    actionable = []
    model_limit = []
    for t in failed:
        err = t.get("error", "")
        if "agent_process_error" in err:
            model_limit.append(t)
        else:
            actionable.append(t)

    lines = []
    lines.append(f"## Failure Analysis (probe eval)")
    lines.append(f"")
    lines.append(f"Total: {len(traces)} items, {len(passed)} passed, {len(failed)} failed")
    lines.append(f"- Actionable failures (wrong/no answer): {len(actionable)}")
    lines.append(f"- Model-limit failures (max_turns exhausted): {len(model_limit)}")
    lines.append(f"")

    if not actionable and not model_limit:
        lines.append("All items passed. No failures to analyze.")
        return "\n".join(lines)

    # Analyze actionable failures (wrong_answer, no_answer)
    if actionable:
        lines.append(f"### Actionable failures ({len(actionable)} items)")
        lines.append(f"")

        wrong_answer = [t for t in actionable if t.get("predicted")]
        no_answer = [t for t in actionable if not t.get("predicted")]

        if wrong_answer:
            lines.append(f"**Wrong answers ({len(wrong_answer)}):**")
            patterns = _analyze_wrong_answers(wrong_answer)
            for p in patterns:
                lines.append(f"- {p}")
            lines.append("")

        if no_answer:
            lines.append(f"**No answer produced ({len(no_answer)}):**")
            patterns = _analyze_no_answers(no_answer)
            for p in patterns:
                lines.append(f"- {p}")
            lines.append("")

    # Analyze what passed items have in common (so improver knows what works)
    if passed:
        lines.append(f"### What's working ({len(passed)} items passed)")
        lines.append(f"")
        patterns = _analyze_passes(passed)
        for p in patterns:
            lines.append(f"- {p}")
        lines.append("")

    # Analyze model-limit failures at high level (no specifics)
    if model_limit:
        lines.append(f"### Model-limit failures ({len(model_limit)} items)")
        lines.append(f"These items exhausted the agent's turn budget (max_turns).")
        avg_dur = sum(t.get("duration_s", 0) for t in model_limit) / len(model_limit)
        lines.append(f"Average duration: {avg_dur:.0f}s")
        lines.append("")

    return "\n".join(lines)


def _analyze_wrong_answers(traces: list[dict]) -> list[str]:
    """Find patterns in wrong answers without leaking specifics."""
    patterns = []

    # Check if answers are too vague/placeholder
    vague = [t for t in traces if t.get("predicted", "").lower() in
             ("provisional", "tbd", "unknown", "n/a", "no answer yet")]
    if vague:
        patterns.append(f"{len(vague)} items have placeholder answers "
                       f"('provisional', 'TBD' etc.) — agent gave up without real answer")

    # Check answer length mismatch
    too_long = [t for t in traces if len(t.get("predicted", "")) > 100]
    if too_long:
        patterns.append(f"{len(too_long)} answers are too verbose "
                       f"(>100 chars) — should be short factual answers")

    # Check if predicted is close but wrong format
    format_issues = []
    for t in traces:
        pred = t.get("predicted", "")
        exp = t.get("expected", "")
        if pred and exp:
            # Check number format issues
            if any(c.isdigit() for c in pred) and any(c.isdigit() for c in exp):
                pred_nums = "".join(c for c in pred if c.isdigit())
                exp_nums = "".join(c for c in exp if c.isdigit())
                if pred_nums and exp_nums and pred_nums != exp_nums:
                    format_issues.append("number_mismatch")
                elif pred_nums == exp_nums and pred != exp:
                    format_issues.append("format_only")
    if format_issues:
        fmt_only = format_issues.count("format_only")
        if fmt_only:
            patterns.append(f"{fmt_only} answers have correct info but wrong format")

    # Check if answers are partially correct
    partial = []
    for t in traces:
        pred = (t.get("predicted", "") or "").lower()
        exp = (t.get("expected", "") or "").lower()
        if pred and exp and (pred in exp or exp in pred):
            partial.append(t)
    if partial:
        patterns.append(f"{len(partial)} answers are partially correct "
                       f"(substring match) — close but not exact")

    if not patterns:
        patterns.append("Wrong answers don't share an obvious pattern — "
                       "likely individual search failures")

    return patterns


def _analyze_no_answers(traces: list[dict]) -> list[str]:
    """Find patterns in no-answer cases."""
    patterns = []

    # Check durations
    durations = [t.get("duration_s", 0) for t in traces]
    avg_dur = sum(durations) / len(durations) if durations else 0

    short = [d for d in durations if d < 60]
    if short:
        patterns.append(f"{len(short)} items finished very quickly (<60s) "
                       f"without writing answer — agent may have crashed early")

    long_ = [d for d in durations if d > 500]
    if long_:
        patterns.append(f"{len(long_)} items ran for >500s without producing answer — "
                       f"agent searched extensively but never committed an answer")

    if not patterns:
        patterns.append(f"Average duration {avg_dur:.0f}s — agent ran but "
                       f"didn't write answer.txt")

    return patterns


def _analyze_passes(traces: list[dict]) -> list[str]:
    """Identify what makes passed items succeed."""
    patterns = []

    durations = [t.get("duration_s", 0) for t in traces]
    avg_dur = sum(durations) / len(durations) if durations else 0

    fast = [t for t in traces if t.get("duration_s", 0) < 120]
    slow = [t for t in traces if t.get("duration_s", 0) > 600]

    if fast:
        patterns.append(f"{len(fast)}/{len(traces)} passed items completed "
                       f"quickly (<2min) — simple single-hop lookups work well")
    if slow:
        patterns.append(f"{len(slow)}/{len(traces)} passed items took >10min — "
                       f"some complex queries do succeed with enough turns")

    # Check answer types
    answers = [t.get("predicted", "") for t in traces]
    numeric = [a for a in answers if a and a.replace(",", "").replace(".", "").isdigit()]
    if numeric:
        patterns.append(f"{len(numeric)}/{len(traces)} correct answers are numeric — "
                       f"number lookups are a strength")

    short_answers = [a for a in answers if a and len(a) < 20]
    if len(short_answers) == len(answers):
        patterns.append("All correct answers are short (<20 chars) — "
                       "agent correctly produces concise answers")

    return patterns
