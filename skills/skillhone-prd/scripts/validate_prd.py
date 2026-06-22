#!/usr/bin/env python3
"""Check that a PRD covers its required dimensions with no placeholders.

Two modes:

  * ``--mode full`` (default) — for ``PRD.md``. All four sections must
    be present in order: ``## 1. Environment``, ``## 2. Goal``,
    ``## 3. Output format``, ``## 4. Evaluation``.
  * ``--mode improver`` — for ``PRD.improver_only.md``. Only the first
    three sections are required, and section 4 (Evaluation) MUST be
    absent. Any auto-validation rule field in section 3 is also a
    failure.

Common rules in both modes:
  * Each present required section must have non-whitespace content.
  * No placeholder markers left behind:
      - ``<...>``  (angle-bracket placeholders from the template)
      - ``TODO``
      - ``_(no content`` (marker emitted by write_prd.py for empty
        sections)

Exit 0 if clean, 1 if any rule fails. Prints one line per failure.
Zero external dependencies.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


_FULL_REQUIRED_HEADINGS = [
    "## 1. Environment",
    "## 2. Goal",
    "## 3. Output format",
    "## 4. Evaluation",
]

_IMPROVER_REQUIRED_HEADINGS = [
    "## 1. Environment",
    "## 2. Goal",
    "## 3. Output format",
]

_IMPROVER_FORBIDDEN_HEADING = "## 4. Evaluation"

# Field-bullet patterns that, if present in an improver-only PRD,
# leak the validation/grading shape to the improver agent. Match the
# bold-key style emitted by ``write_prd.py``.
_IMPROVER_LEAK_PATTERNS = [
    (re.compile(r"-\s+\*\*automatic\s+validation\s+rule\*\*", re.IGNORECASE),
     "leaks automatic_validation_rule"),
    (re.compile(r"-\s+\*\*validation\s+rule\*\*", re.IGNORECASE),
     "leaks validation_rule"),
    (re.compile(r"-\s+\*\*validator(\s+command)?\*\*", re.IGNORECASE),
     "leaks validator field"),
]

_PLACEHOLDER_PATTERNS = [
    (re.compile(r"<[^>]{1,80}>"), "angle-bracket placeholder like <...>"),
    (re.compile(r"\bTODO\b"), "literal TODO"),
    (re.compile(r"_\(no content"), "empty-section marker from write_prd.py"),
]


def _find_sections(text: str) -> dict[str, str]:
    """Return heading → body text (excluding the heading itself)."""
    sections: dict[str, str] = {}
    lines = text.splitlines()
    current: str | None = None
    buf: list[str] = []
    for line in lines:
        if line.startswith("## "):
            if current is not None:
                sections[current] = "\n".join(buf).strip()
            current = line.strip()
            buf = []
        elif current is not None:
            buf.append(line)
    if current is not None:
        sections[current] = "\n".join(buf).strip()
    return sections


def validate(text: str, mode: str) -> list[str]:
    errors: list[str] = []
    required = (
        _IMPROVER_REQUIRED_HEADINGS if mode == "improver"
        else _FULL_REQUIRED_HEADINGS
    )

    # Rule 1: required headings present and in order.
    last_idx = -1
    for heading in required:
        idx = text.find(heading)
        if idx < 0:
            errors.append(f"missing heading: {heading!r}")
        elif idx <= last_idx:
            errors.append(f"heading out of order: {heading!r}")
        else:
            last_idx = idx

    # Rule 1b (improver only): forbid the Evaluation heading entirely.
    if mode == "improver" and _IMPROVER_FORBIDDEN_HEADING in text:
        errors.append(
            f"forbidden heading present in improver PRD: "
            f"{_IMPROVER_FORBIDDEN_HEADING!r} "
            f"— evaluation criteria must not leak to the improver"
        )

    # Rule 2: each section has content.
    sections = _find_sections(text)
    for heading in required:
        body = sections.get(heading)
        if body is None:
            continue  # already reported in rule 1
        if not body:
            errors.append(f"section is empty: {heading!r}")

    # Rule 3: no placeholder markers anywhere.
    for pattern, label in _PLACEHOLDER_PATTERNS:
        for m in pattern.finditer(text):
            snippet = m.group(0)
            line_no = text.count("\n", 0, m.start()) + 1
            errors.append(
                f"placeholder found ({label}) at line {line_no}: "
                f"{snippet[:60]!r}"
            )

    # Rule 4 (improver only): no validation-rule leak in section 3.
    if mode == "improver":
        for pattern, label in _IMPROVER_LEAK_PATTERNS:
            for m in pattern.finditer(text):
                line_no = text.count("\n", 0, m.start()) + 1
                errors.append(
                    f"improver leak ({label}) at line {line_no}"
                )

    return errors


def _infer_mode(path: Path) -> str:
    return "improver" if path.name.endswith(".improver_only.md") else "full"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", help="path to PRD markdown file")
    ap.add_argument(
        "--mode", choices=("auto", "full", "improver"), default="auto",
        help=("validation mode. 'auto' picks 'improver' if the filename "
              "ends with '.improver_only.md', else 'full'."),
    )
    args = ap.parse_args(argv)

    p = Path(args.path)
    if not p.is_file():
        print(f"error: not a file: {p}", file=sys.stderr)
        return 2

    mode = args.mode if args.mode != "auto" else _infer_mode(p)

    text = p.read_text(encoding="utf-8")
    errors = validate(text, mode)
    if errors:
        print(
            f"PRD validation FAILED ({len(errors)} issue(s), mode={mode}):",
            file=sys.stderr,
        )
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1

    print(f"PRD validation PASSED (mode={mode}): {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
