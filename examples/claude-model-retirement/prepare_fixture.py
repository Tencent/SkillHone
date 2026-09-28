#!/usr/bin/env python3
"""Prepare the pinned Anthropic claude-api Skill with expired model entries."""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


UPSTREAM = "https://github.com/anthropics/skills.git"
COMMIT = "f6656c1256d5a8adfa37db9110046ef20bac644c"
SKILL_PATH = Path("skills/claude-api")
EXPECTED_BLOBS = {
    "skills/claude-api/SKILL.md": "6441d6c4d9b2eef0002e435edd77bf05f49c1045",
    "skills/claude-api/shared/models.md": "97727f79b7154653399732fceed76cc18d4b6182",
    "skills/claude-api/LICENSE.txt": "4f881c52d1f72f4cfb720e339e2d35c3058d01a9",
}
ORIGINAL_MODELS_SHA256 = "683f4dabcc88084e142c53d5b646943cdf71188b7dba64d0dbcc0f3cf850f398"


def run(*args: str, cwd: Path | None = None, timeout: int = 180) -> None:
    try:
        subprocess.run(args, cwd=cwd, check=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within {timeout} seconds") from error


def capture(*args: str, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(
            args, cwd=cwd, check=True, capture_output=True, text=True, timeout=180
        ).stdout.strip()
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within 180 seconds") from error


def materialize_tree(checkout: Path, destination: Path) -> None:
    run("git", "init", "-q", "--template=", str(checkout))
    run("git", "remote", "add", "origin", UPSTREAM, cwd=checkout)
    run(
        "git", "fetch", "-q", "--depth", "1", "--no-tags",
        "origin", COMMIT, cwd=checkout,
    )
    fetched = capture("git", "rev-parse", "FETCH_HEAD", cwd=checkout)
    if fetched != COMMIT:
        raise RuntimeError(f"unexpected upstream commit: {fetched}")

    for path, expected in EXPECTED_BLOBS.items():
        actual = capture("git", "rev-parse", f"FETCH_HEAD:{path}", cwd=checkout)
        if actual != expected:
            raise RuntimeError(f"unexpected upstream blob for {path}: {actual}")

    listing = subprocess.run(
        ["git", "ls-tree", "-r", "-z", "FETCH_HEAD", "--", SKILL_PATH.as_posix()],
        cwd=checkout,
        check=True,
        capture_output=True,
    )
    destination.mkdir()
    prefix = f"{SKILL_PATH.as_posix()}/"
    found: set[str] = set()
    for record in listing.stdout.split(b"\0"):
        if not record:
            continue
        metadata, raw_name = record.split(b"\t", 1)
        mode, object_type, object_id = metadata.decode("ascii").split(" ", 2)
        name = raw_name.decode("utf-8", errors="surrogateescape")
        if object_type != "blob" or mode not in {"100644", "100755"}:
            raise RuntimeError(f"unsupported upstream Git entry: {mode} {name}")
        if not name.startswith(prefix):
            raise RuntimeError(f"unexpected upstream Git path: {name}")
        relative = Path(name.removeprefix(prefix))
        if not relative.parts or relative.is_absolute() or ".." in relative.parts:
            raise RuntimeError(f"unsafe upstream Git path: {name}")
        target = destination / relative
        if not target.resolve().is_relative_to(destination.resolve()):
            raise RuntimeError(f"upstream Git path escapes destination: {name}")
        target.parent.mkdir(parents=True, exist_ok=True)
        content = subprocess.run(
            ["git", "cat-file", "blob", object_id], cwd=checkout,
            check=True, capture_output=True,
        ).stdout
        target.write_bytes(content)
        target.chmod(0o755 if mode == "100755" else 0o644)
        found.add(name)

    if not set(EXPECTED_BLOBS).issubset(found):
        raise RuntimeError("pinned Skill tree is missing a verified required file")
    models = destination / "shared" / "models.md"
    if hashlib.sha256(models.read_bytes()).hexdigest() != ORIGINAL_MODELS_SHA256:
        raise RuntimeError("pinned models.md failed SHA-256 verification")
    shutil.copyfile(Path(__file__).resolve().parents[2] / "LICENSE", destination / "LICENSE.skillhone")


def write_contract_test(destination: Path) -> None:
    tests = destination / ".test"
    tests.mkdir()
    (tests / "test_model_retirement.py").write_text(
        '''"""Expired model rows must be retired without changing valid active rows."""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "shared" / "models.md"
ORIGINAL_MODELS_SHA256 = "__ORIGINAL_MODELS_SHA256__"
RETIRED_IDS = (
    "claude-opus-4-1-20250805",
    "claude-sonnet-4-20250514",
    "claude-opus-4-20250514",
    "claude-3-haiku-20240307",
)
ACTIVE_IDS = ("claude-opus-4-5-20251101", "claude-sonnet-4-5-20250929")
NOTICE = re.compile(r"(?im)^>\\s*\\*\\*Modification notice:\\*\\*\\s*\\S")


def section(text, heading, required=True):
    match = re.search(r"(?m)^" + re.escape(heading) + r"\\s*$", text)
    if not match and not required:
        return ""
    assert match, f"missing section: {heading}"
    tail = text[match.end():]
    next_heading = re.search(r"(?m)^##\\s+", tail)
    return tail[:next_heading.start()] if next_heading else tail


def row_for(table, model_id):
    rows = [line for line in table.splitlines() if line.lstrip().startswith("|")]
    return next((line for line in rows if model_id in line), None)


def lookup_value(table, request):
    matches = [
        cells[2].strip()
        for line in table.splitlines() if line.lstrip().startswith("|")
        for cells in [line.split("|")]
        if len(cells) >= 4 and cells[1].strip() == request
    ]
    assert len(matches) == 1, f"expected one lookup row for {request}: {matches}"
    return matches[0]


def main():
    text = MODELS.read_text(encoding="utf-8")
    retired = section(text, "## Retired Models (no longer available)")
    legacy = section(text, "## Legacy Models (still active)")
    deprecated = section(text, "## Deprecated Models (retiring soon)", required=False)
    lookup = section(text, "## Resolving User Requests")
    for model_id in RETIRED_IDS:
        assert row_for(retired, model_id), (
            f"{model_id} was reported unavailable but is not in Retired Models"
        )
        assert not row_for(legacy, model_id), f"retired ID remains in Legacy Models: {model_id}"
        assert not row_for(deprecated, model_id), f"retired ID remains in Deprecated Models: {model_id}"
    for model_id in ACTIVE_IDS:
        row = row_for(legacy, model_id)
        assert row and "Active" in row and "Deprecated" not in row, (
            f"previously valid active model changed status: {model_id}"
        )
    retired_requests = {
        '"opus 4.1"': "claude-opus-4-1",
        '"opus 4", "opus 4.0"': "claude-opus-4-0",
        '"sonnet 4", "sonnet 4.0"': "claude-sonnet-4-0",
        '"haiku 3"': "claude-3-haiku-20240307",
    }
    for request, unavailable_id in retired_requests.items():
        value = lookup_value(lookup, request)
        assert value.startswith("Retired") and unavailable_id not in value, (
            f"retired model is still recommended for {request}: {value}"
        )
    for request, active_id in (
        ('"opus 4.5"', "claude-opus-4-5"),
        ('"sonnet 4.5"', "claude-sonnet-4-5"),
    ):
        assert lookup_value(lookup, request) == f"`{active_id}`", (
            f"previously valid active lookup changed: {request}"
        )
    digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
    if digest != ORIGINAL_MODELS_SHA256:
        assert NOTICE.search(text), (
            "modified models.md must include a visible 'Modification notice'"
        )


if __name__ == "__main__":
    main()
'''.replace("__ORIGINAL_MODELS_SHA256__", ORIGINAL_MODELS_SHA256),
        encoding="utf-8",
    )


def write_provenance(destination: Path) -> None:
    (destination / "PROVENANCE.md").write_text(
        f"""# Fixture provenance

- Upstream: {UPSTREAM}
- Commit: `{COMMIT}` (2026-08-13)
- Skill path: `{SKILL_PATH.as_posix()}`
- Verified upstream Git blobs: `SKILL.md`, `shared/models.md`, and `LICENSE.txt`
- Upstream license: Apache-2.0, retained as `LICENSE.txt`
- SkillHone fixture additions: covered by `LICENSE.skillhone`
- Public defect report: https://github.com/anthropics/skills/issues/1603
- Reported check date: 2026-08-17

The issue author reported that the Opus 4.1 retirement date had passed and
that four model IDs returned 404, while Opus 4.5 and Sonnet 4.5 remained
available. The fixture contract encodes those historical observations without
making network or credentialed API calls. It checks the four reported model
statuses and request-lookup rows while preserving two active models and their
lookup rows; it is not a live catalog validator.

`prepare_fixture.py` verifies the pinned commit and key upstream blob IDs,
materializes only regular Git blobs, and never executes upstream code. The
baseline preserves upstream files unchanged. The `.test` contract requires a
visible modification notice if `shared/models.md` is repaired.
""",
        encoding="utf-8",
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        print(f"ERROR: destination already exists: {destination}", file=sys.stderr)
        return 2
    with tempfile.TemporaryDirectory(prefix="skillhone-model-retirement-") as tmp:
        materialized = Path(tmp) / "verified-skill"
        materialize_tree(Path(tmp) / "source", materialized)
        shutil.copytree(materialized, destination)
    write_contract_test(destination)
    write_provenance(destination)
    run("git", "init", "-q", "-b", "main", cwd=destination)
    run("git", "config", "core.autocrlf", "false", cwd=destination)
    run("git", "config", "user.name", "SkillHone", cwd=destination)
    run("git", "config", "user.email", "skillhone@example.invalid", cwd=destination)
    run("git", "add", ".", cwd=destination)
    run("git", "commit", "-q", "-m", "fixture: reproduce expired Claude model entries", cwd=destination)
    print(f"Created fixture: {destination}")
    print("Expected baseline: python .test/test_model_retirement.py -> failure")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
