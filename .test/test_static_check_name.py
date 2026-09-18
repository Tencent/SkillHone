"""Regression test for Agent Skills name validation."""
from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
CHECKER_PATH = (
    REPOSITORY_ROOT
    / "skills"
    / "skillhone"
    / "scripts"
    / "quality"
    / "static_check.py"
)
SPEC = importlib.util.spec_from_file_location("skillhone_static_check", CHECKER_PATH)
assert SPEC is not None and SPEC.loader is not None
STATIC_CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(STATIC_CHECK)


class SkillNameValidationTest(unittest.TestCase):
    def check_name(self, name: str) -> set[str]:
        with tempfile.TemporaryDirectory() as temporary_directory:
            skill_directory = Path(temporary_directory) / name
            skill_directory.mkdir()
            (skill_directory / "SKILL.md").write_text(
                "---\n"
                f"name: {name}\n"
                "description: Minimal Skill name fixture.\n"
                "---\n",
                encoding="utf-8",
            )

            report = STATIC_CHECK.check(skill_directory)

        return {error["kind"] for error in report.errors}

    def test_consecutive_hyphens_are_rejected(self) -> None:
        self.assertIn("invalid_name", self.check_name("pdf--processing"))

    def test_single_hyphens_remain_valid(self) -> None:
        self.assertNotIn("invalid_name", self.check_name("pdf-processing"))


if __name__ == "__main__":
    unittest.main()
