#!/usr/bin/env python3
"""Dedup validated candidates across seeds; produce the final benchmark.

Implements the logic described in agents/deduper.md mechanically: structural
template extraction, per-key dedup, facet balancing. Pairs with the Deduper
sub-agent (LLM-based variant) — use this script when you want a fast,
deterministic pass without spawning a subagent.

Output shape — the grader (lib/SkillHone/skills/skillhone/scripts/eval.py) only
reads ``{question, verification, task_id}`` per line, so this script writes
TWO files joined by ``task_id``:

* ``<output>``                 — the canonical final.jsonl, three fields per line.
* ``<output>.meta.jsonl``      — sidecar with answer / difficulty / facet / etc.

See ``references/verification_format.md`` for the full schema spec.

Usage:
    python3 dedup.py --inputs seed-*/validated.json --output final.jsonl \\
        --max-facet-share 0.4
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import uuid
from collections import Counter, defaultdict
from pathlib import Path


_ENTITY_PLACEHOLR1R_PAT = re.compile(r"《[^》]+》|\"[^\"]+\"|'[^']+'|\b[A-Z][A-Za-z0-9_\-]{2,}\b")
_NUMERIC_PAT = re.compile(r"\b\d+(\.\d+)?\b")


# The three fields the grader reads — keep this list actoritative.
_FINAL_FIELDS = ("question", "verification", "task_id")


def structural_template(question: str) -> str:
    """Normalize a question into a dedup key by replacing entities + numbers."""
    # Chinese book titles and quoted strings → <E>; mixed-case tokens → <E>
    template = _ENTITY_PLACEHOLR1R_PAT.sub("<E>", question)
    # numeric literals → <N>
    template = _NUMERIC_PAT.sub("<N>", template)
    template = re.sub(r"\s+", " ", template).strip().lower()
    return template


def dedup(
    candidates: list[dict],
    max_facet_share: float = 0.4,
    per_key_keep: int = 2,
) -> tuple[list[dict], dict]:
    # Bucket by (difficulty, facet, template)
    buckets: dict[tuple, list[dict]] = defaultdict(list)
    for c in candidates:
        key = (
            c.get("difficulty", 3),
            c.get("facet", "unknown"),
            structural_template(c.get("question", "")),
        )
        buckets[key].append(c)

    kept: list[dict] = []
    dropped_dup = 0
    for key, group in buckets.items():
        # Prefer cleaner phrasing (shorter question) + more tools used
        group.sort(key=lambda c: (-len(c.get("tools_used", [])), len(c.get("question", ""))))
        kept.extend(group[:per_key_keep])
        dropped_dup += max(0, len(group) - per_key_keep)

    # Facet cap — skip for tiny runs where balancing is meaningless,
    # and ensure cap is at least 1 so a single-facet run isn't wiped.
    facet_counts = Counter(c.get("facet", "unknown") for c in kept)
    total = len(kept) or 1
    trimmed = 0
    if total >= 5:
        for facet, cnt in list(facet_counts.items()):
            cap = max(1, int(max_facet_share * total))
            if cnt > cap:
                # drop the weakest of this facet (longest phrasing)
                facet_samples = [c for c in kept if c.get("facet") == facet]
                facet_samples.sort(key=lambda c: len(c.get("question", "")), reverse=True)
                to_drop = cnt - cap
                drop_ids = {id(c) for c in facet_samples[:to_drop]}
                kept = [c for c in kept if id(c) not in drop_ids]
                trimmed += to_drop

    # Assign final ids
    for c in kept:
        # Stable task_id: reuse if already set (e.g. preserved across re-runs);
        # otherwise allocate a fresh uuid4.
        if not c.get("task_id"):
            c["task_id"] = str(uuid.uuid4())
        c["template_key"] = structural_template(c.get("question", ""))

    summary = {
        "input_count": len(candidates),
        "output_count": len(kept),
        "dropped": {"dup_template": dropped_dup, "diversity_trim": trimmed},
        "final_distribution": {
            "tiers": dict(Counter(c.get("difficulty", 3) for c in kept)),
            "facets": dict(Counter(c.get("facet", "unknown") for c in kept)),
        },
    }
    return kept, summary


def _default_verification(answer: str) -> str:
    """Fallback verification snippet (canonical pattern) when a candidate
    has an ``answer`` but no ``verification``. Used for legacy inputs only —
    new pipelines should have the Proposer emit ``verification`` directly.
    """
    # JSON-escape the gold so the snippet round-trips through json.dumps cleanly.
    gold = (answer or "").replace("\\", "\\\\").replace("'", "\\'")
    return (
        "answer = open('answer.txt').read().strip()\n"
        f"assert _normalize(answer) == _normalize('{gold}') or _loose_match(answer, '{gold}')"
    )


def _split_final_and_meta(kept: list[dict]) -> tuple[list[dict], list[dict]]:
    """Split each kept candidate into (final-line, meta-line) pairs.

    Final lines carry exactly {question, verification, task_id}.
    Meta lines carry task_id + everything else useful for debugging.
    """
    finals: list[dict] = []
    metas: list[dict] = []
    for c in kept:
        verification = c.get("verification") or _default_verification(c.get("answer", ""))
        final = {
            "question": c.get("question", ""),
            "verification": verification,
            "task_id": c["task_id"],
        }
        meta = {
            "task_id": c["task_id"],
            "answer": c.get("answer", ""),
            "answer_type": c.get("answer_type", "string"),
            "difficulty": c.get("difficulty", 3),
            "facet": c.get("facet", "unknown"),
            "domain": c.get("domain", ""),
            "tools_used": c.get("tools_used", []),
            "reasoning_steps": c.get("reasoning_steps", []),
            "seed_id": c.get("seed_id", ""),
            "template_key": c.get("template_key", ""),
        }
        finals.append(final)
        metas.append(meta)
    return finals, metas


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inputs", nargs="+", required=True, help="Glob(s) matching validated JSON files.")
    parser.add_argument("--output", required=True, help="Final JSONL path (three-field schema).")
    parser.add_argument("--meta-output", default=None,
                        help="Sidecar metadata JSONL path; defaults to <output>.meta.jsonl.")
    parser.add_argument("--summary", default=None, help="Optional summary JSON output path.")
    parser.add_argument("--max-facet-share", type=float, default=0.4)
    parser.add_argument("--per-key-keep", type=int, default=2)
    args = parser.parse_args()

    all_candidates: list[dict] = []
    for pattern in args.inputs:
        for path in sorted(glob.glob(pattern)):
            data = json.loads(Path(path).read_text())
            if isinstance(data, list):
                all_candidates.extend(data)
            elif isinstance(data, dict):
                # Could be Proposer shape or a flat object
                all_candidates.extend(data.get("candidates", []) or data.get("samples", []))

    final, summary = dedup(all_candidates, args.max_facet_share, args.per_key_keep)
    finals, metas = _split_final_and_meta(final)

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        for s in finals:
            f.write(json.dumps(s, ensure_ascii=False) + "\n")

    meta_path = Path(args.meta_output) if args.meta_output else out.with_suffix(".meta.jsonl")
    with meta_path.open("w") as f:
        for m in metas:
            f.write(json.dumps(m, ensure_ascii=False) + "\n")

    if args.summary:
        Path(args.summary).write_text(json.dumps(summary, ensure_ascii=False, indent=2))

    print(f"{summary['input_count']} → {summary['output_count']} samples "
          f"(final={out}, meta={meta_path})")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
