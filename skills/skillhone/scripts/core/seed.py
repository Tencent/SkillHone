"""SkillHone seed helpers for original skill scaffolding.

This module creates a minimal SkillHone-compatible skill from the target
repository README. It does not call, copy, or depend on external skill authoring
skills.
"""
from __future__ import annotations

import re
import subprocess
import sys
import textwrap
from pathlib import Path

NAME_RE = re.compile(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$")


def run_skillhone_seed(repo_path: Path, cfg=None, model_override: str | None = None,
                       *, force: bool = False) -> None:
    """Create a minimal original skill scaffold in ``repo_path``.

    ``cfg`` and ``model_override`` are accepted for CLI compatibility; the
    implementation is deterministic and does not call a model.
    """
    repo_path = Path(repo_path)
    readme_path = repo_path / "README.md"
    if not readme_path.is_file():
        raise FileNotFoundError(f"{readme_path} not found")

    skill_name = _validate_skill_name(repo_path.name)
    readme = readme_path.read_text(encoding="utf-8").strip()
    if not readme:
        raise ValueError(f"{readme_path} is empty")

    summary = _summary_from_readme(readme)
    _write_file(repo_path / "SKILL.md", _render_skill_md(skill_name, summary), force=force)
    _write_file(repo_path / "references" / "task.md", _render_task_reference(readme), force=force)
    _write_file(repo_path / "scripts" / "validate_seed.py", _render_validate_script(), force=force)

    _run_quality_check(repo_path)


def _validate_skill_name(name: str) -> str:
    if not NAME_RE.match(name):
        raise ValueError(
            f"target directory name `{name}` is not a valid skill name; "
            "use lowercase letters, numbers, and hyphens"
        )
    return name


def _summary_from_readme(readme: str) -> str:
    lines = [line.strip() for line in readme.splitlines() if line.strip()]
    if not lines:
        raise ValueError("README.md has no non-empty content")
    title = lines[0].lstrip("# ").strip()
    details = " ".join(line.lstrip("# ").strip() for line in lines[1:6])
    text = f"{title}. {details}" if details else title
    text = re.sub(r"\s+", " ", text).strip()
    return text[:700]


def _write_file(path: Path, content: str, *, force: bool) -> None:
    if path.exists() and not force:
        raise FileExistsError(f"{path} already exists; pass --force to overwrite seed files")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    if path.suffix == ".py":
        path.chmod(0o755)


def _render_skill_md(skill_name: str, summary: str) -> str:
    desc = (
        f"Use this skill for the task described in references/task.md. "
        f"Initial scope: {summary}"
    )
    return textwrap.dedent(f"""
    ---
    name: {skill_name}
    description: >
      {desc}
    ---

    # {skill_name}

    Use this skill when the user asks for the workflow described in
    `references/task.md`.

    ## Workflow

    1. Read `references/task.md` before acting.
    2. Identify the required output contract from the task brief.
    3. Use or add scripts only when they make repeated operations reliable.
    4. Validate the produced artifact with task-specific checks before reporting completion.

    ## Output Contract

    Follow the task brief exactly. If the README defines filenames, formats,
    parser checks, compile checks, render checks, or deterministic acceptance
    criteria, treat them as required behavior.

    ## Gotchas

    - Do not invent hidden data sources or tools.
    - Do not include eval gold answers or private test data in the skill.
    - Keep `SKILL.md` concise; put detailed background in references.

    ## References

    - [references/task.md](references/task.md) - original task brief used to seed this skill.
    """).lstrip()


def _render_task_reference(readme: str) -> str:
    return "# Task Brief\n\n" + readme.rstrip() + "\n"


def _render_validate_script() -> str:
    return textwrap.dedent("""
    #!/usr/bin/env python3
    \"\"\"Validate the seeded skill skeleton.\"\"\"
    from __future__ import annotations

    import argparse
    import sys
    from pathlib import Path


    def main() -> int:
        parser = argparse.ArgumentParser(description=\"Validate a seeded skill skeleton.\")
        parser.add_argument(\"skill_dir\", nargs=\"?\", default=\".\")
        args = parser.parse_args()

        skill_dir = Path(args.skill_dir)
        required = [
            skill_dir / \"SKILL.md\",
            skill_dir / \"references\" / \"task.md\",
        ]
        missing = [str(path) for path in required if not path.exists()]
        if missing:
            print(\"Missing required files:\", file=sys.stderr)
            for path in missing:
                print(f\"- {path}\", file=sys.stderr)
            return 1
        print(\"Seed skeleton OK\")
        return 0


    if __name__ == \"__main__\":
        raise SystemExit(main())
    """).lstrip()


def _run_quality_check(repo_path: Path) -> None:
    checker = Path(__file__).resolve().parents[1] / "quality" / "static_check.py"
    if not checker.is_file():
        raise FileNotFoundError(f"quality checker not found: {checker}")
    result = subprocess.run(
        [sys.executable, str(checker), str(repo_path), "--json"],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode == 1:
        output = (result.stdout or "") + (result.stderr or "")
        raise RuntimeError(f"seeded skill failed static check:\n{output}")
    if result.stdout.strip():
        print(result.stdout.strip())
