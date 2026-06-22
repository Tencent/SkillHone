#!/usr/bin/env python3
"""Offline static checker for a skill directory.

Validates the skill against the Agent Skills spec (agentskills.io) plus a few
additional best-practice heuristics. Designed to run fully offline — no API
calls, no network. Pair with an LLM-based rubric for subjective scoring.

Usage:
    python3 scripts/static_check.py <skill-dir>          # human report
    python3 scripts/static_check.py <skill-dir> --json   # JSON report
    python3 scripts/static_check.py <skill-dir> --strict # warnings fail too

Exit codes:
    0 — all checks pass
    1 — hard errors (spec violation)
    2 — warnings only (e.g. body too long)
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    print("ERROR: PyYAML not installed. Install with: pip install pyyaml",
          file=sys.stderr)
    sys.exit(1)


# ── Spec constants (from agentskills.io) ────────────────────────────────────
MAX_NAME_LEN = 64
MAX_DESC_LEN = 1024
MAX_COMPAT_LEN = 500
RECOMMENDED_BODY_LINES = 500
NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")
ALLOWED_FRONTMATTER = {
    "name", "description", "license",
    "allowed-tools", "metadata", "compatibility",
}


# ── Result accumulator ──────────────────────────────────────────────────────
class Report:
    def __init__(self, skill: str):
        self.skill = skill
        self.errors: list[dict[str, str]] = []
        self.warnings: list[dict[str, str]] = []
        self.metrics: dict[str, Any] = {}

    def err(self, kind: str, detail: str) -> None:
        self.errors.append({"kind": kind, "detail": detail})

    def warn(self, kind: str, detail: str) -> None:
        self.warnings.append({"kind": kind, "detail": detail})

    def metric(self, key: str, value: Any) -> None:
        self.metrics[key] = value

    @property
    def passed(self) -> bool:
        return not self.errors

    def as_dict(self) -> dict[str, Any]:
        return {
            "skill": self.skill,
            "pass": self.passed,
            "errors": self.errors,
            "warnings": self.warnings,
            "metrics": self.metrics,
        }


# ── Individual checks ───────────────────────────────────────────────────────

def _read_skill_md(skill_dir: Path, rep: Report) -> tuple[dict, str] | None:
    """Return (frontmatter_dict, body_text) or None on hard error."""
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        rep.err("missing_skill_md", f"{skill_md} not found")
        return None

    raw = skill_md.read_text(encoding="utf-8")
    if not raw.startswith("---"):
        rep.err("no_frontmatter", "SKILL.md must start with `---` frontmatter")
        return None

    parts = raw.split("---", 2)
    if len(parts) < 3:
        rep.err("malformed_frontmatter", "closing `---` not found")
        return None

    try:
        fm = yaml.safe_load(parts[1]) or {}
    except yaml.YAMLError as e:
        rep.err("invalid_yaml", f"frontmatter YAML parse failed: {e}")
        return None

    if not isinstance(fm, dict):
        rep.err("frontmatter_not_dict", "frontmatter must be a YAML mapping")
        return None

    return fm, parts[2]


def _check_frontmatter(fm: dict, skill_dir: Path, rep: Report) -> None:
    # Unknown fields — warning, not error (spec says "should not")
    for k in fm:
        if k not in ALLOWED_FRONTMATTER:
            rep.warn("unknown_frontmatter_field",
                     f"`{k}` is not a spec-defined field")

    # name
    name = fm.get("name", "")
    rep.metric("name", name)
    if not name or not isinstance(name, str):
        rep.err("missing_name", "`name` field is required and must be a string")
    else:
        if len(name) > MAX_NAME_LEN:
            rep.err("name_too_long",
                    f"name is {len(name)} chars, max {MAX_NAME_LEN}")
        if not NAME_RE.match(name):
            rep.err("invalid_name",
                    f"name `{name}` must be lowercase alphanumeric with "
                    "hyphens, no leading/trailing/double hyphens")
        if name != skill_dir.name:
            rep.err("name_dir_mismatch",
                    f"name `{name}` does not match directory "
                    f"`{skill_dir.name}`")

    # description
    desc = fm.get("description", "")
    # YAML block scalars come back as strings with embedded newlines — collapse
    desc_str = " ".join(str(desc).split())
    rep.metric("description_chars", len(desc_str))
    if not desc_str:
        rep.err("missing_description", "`description` field is required")
    elif len(desc_str) > MAX_DESC_LEN:
        rep.err("description_too_long",
                f"description is {len(desc_str)} chars, max {MAX_DESC_LEN}")

    # compatibility (optional)
    compat = fm.get("compatibility", "")
    if compat and len(str(compat)) > MAX_COMPAT_LEN:
        rep.err("compatibility_too_long",
                f"compatibility is {len(str(compat))} chars, max {MAX_COMPAT_LEN}")


def _check_body(body: str, rep: Report) -> None:
    lines = [l for l in body.splitlines() if l.strip() != ""]
    total_lines = len(body.splitlines())
    rep.metric("body_lines", total_lines)
    rep.metric("body_nonblank_lines", len(lines))

    if total_lines > RECOMMENDED_BODY_LINES:
        rep.warn("body_too_long",
                 f"body is {total_lines} lines, recommended "
                 f"< {RECOMMENDED_BODY_LINES}")

    # Best-practice heuristics — warnings, not errors
    has_gotchas = bool(re.search(r"^##+\s*.*gotcha", body, re.I | re.M))
    has_when = ("when to use" in body.lower()
                or "use when" in body.lower()
                or "reach for this skill" in body.lower())
    rep.metric("has_gotchas_section", has_gotchas)
    rep.metric("has_when_to_use_guidance", has_when)


def _check_structure(skill_dir: Path, rep: Report) -> None:
    scripts_dir = skill_dir / "scripts"
    refs_dir = skill_dir / "references"
    assets_dir = skill_dir / "assets"
    rep.metric("has_scripts", scripts_dir.is_dir())
    rep.metric("has_references", refs_dir.is_dir())
    rep.metric("has_assets", assets_dir.is_dir())

    if scripts_dir.is_dir():
        py_files = [p for p in scripts_dir.glob("*.py") if p.is_file()]
        rep.metric("scripts_py_count", len(py_files))

    if refs_dir.is_dir():
        md_files = [p for p in refs_dir.glob("*.md") if p.is_file()]
        rep.metric("references_md_count", len(md_files))


def _is_cli_script(py: Path) -> bool:
    """Heuristic: does this .py file look like an executable CLI?

    A file is a CLI iff it has `if __name__ == "__main__"` AND either
    imports argparse or references `sys.argv`. Pure library modules
    (e.g. forgejo_client.py) are skipped.
    """
    try:
        text = py.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return False
    if "__name__" not in text or "__main__" not in text:
        return False
    return "argparse" in text or "sys.argv" in text


def _check_script_help(skill_dir: Path, rep: Report) -> None:
    """Every CLI-style `scripts/*.py` should respond to `--help` with `usage:`.

    Skip files starting with `_` (private helpers) and files that don't look
    like CLIs (no `__main__` guard, no argparse / sys.argv).
    """
    scripts_dir = skill_dir / "scripts"
    if not scripts_dir.is_dir():
        return

    cli_scripts = [p for p in sorted(scripts_dir.glob("*.py"))
                   if not p.name.startswith("_") and _is_cli_script(p)]
    bad: list[str] = []
    for py in cli_scripts:
        try:
            out = subprocess.run(
                [sys.executable, str(py), "--help"],
                capture_output=True, text=True, timeout=15,
            )
        except Exception as e:
            bad.append(f"{py.name}: subprocess failed ({e})")
            continue
        combined = (out.stdout or "") + (out.stderr or "")
        if "usage:" not in combined.lower():
            bad.append(py.name)
    rep.metric("scripts_cli_count", len(cli_scripts))
    rep.metric("scripts_with_help", len(cli_scripts) - len(bad))
    for name in bad:
        rep.warn("script_missing_help",
                 f"scripts/{name} did not return `usage:` on --help")


def _check_references_linked(skill_dir: Path, body: str, rep: Report) -> None:
    """Every `references/*.md` should be mentioned somewhere in SKILL.md body.

    This enforces the "load on demand" principle — if you bundle a reference
    that is never linked from SKILL.md, the Agent has no way to know when to
    load it, which defeats progressive disclosure.
    """
    refs_dir = skill_dir / "references"
    if not refs_dir.is_dir():
        return
    orphans: list[str] = []
    for ref in sorted(refs_dir.glob("*.md")):
        rel = f"references/{ref.name}"
        if rel not in body:
            orphans.append(ref.name)
    rep.metric("orphaned_references", orphans)
    for name in orphans:
        rep.warn("reference_not_linked",
                 f"references/{name} is not referenced from SKILL.md body")


# ── Orchestration ───────────────────────────────────────────────────────────

def check(skill_dir: Path) -> Report:
    rep = Report(skill_dir.name)
    parsed = _read_skill_md(skill_dir, rep)
    if parsed is None:
        return rep
    fm, body = parsed
    _check_frontmatter(fm, skill_dir, rep)
    _check_body(body, rep)
    _check_structure(skill_dir, rep)
    _check_script_help(skill_dir, rep)
    _check_references_linked(skill_dir, body, rep)
    return rep


def _format_human(rep: Report) -> str:
    out: list[str] = []
    verdict = "PASS" if rep.passed else "FAIL"
    out.append(f"=== {rep.skill}: {verdict} ===")
    if rep.errors:
        out.append(f"\nErrors ({len(rep.errors)}):")
        for e in rep.errors:
            out.append(f"  ✗ [{e['kind']}] {e['detail']}")
    if rep.warnings:
        out.append(f"\nWarnings ({len(rep.warnings)}):")
        for w in rep.warnings:
            out.append(f"  ⚠ [{w['kind']}] {w['detail']}")
    if rep.metrics:
        out.append("\nMetrics:")
        for k, v in rep.metrics.items():
            out.append(f"  {k}: {v}")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Static checks for a skill dir against the Agent Skills spec.",
    )
    parser.add_argument("skill_dir", help="Path to the skill directory")
    parser.add_argument("--json", action="store_true",
                        help="Emit a structured JSON report")
    parser.add_argument("--strict", action="store_true",
                        help="Warnings also cause exit 2 to bubble up")
    args = parser.parse_args()

    skill_dir = Path(args.skill_dir).resolve()
    if not skill_dir.is_dir():
        print(f"ERROR: {skill_dir} is not a directory", file=sys.stderr)
        return 1

    rep = check(skill_dir)

    if args.json:
        print(json.dumps(rep.as_dict(), indent=2, ensure_ascii=False))
    else:
        print(_format_human(rep))

    if rep.errors:
        return 1
    if rep.warnings and args.strict:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
