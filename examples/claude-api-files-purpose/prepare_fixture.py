#!/usr/bin/env python3
"""Fetch the claude-api Skill at the commit before the Files API fix.

Also emits `repair.patch`, the verified upstream repair rebased onto the
fixture root.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


UPSTREAM = "https://github.com/anthropics/skills.git"
COMMIT = "5128e1865d670f5d6c9cef000e6dfc4e951fb5b9"
SKILL_PATH = Path("skills/claude-api")
SKILL_TREE = "6d12d690ffa6b91119e932e448f4437d9f197a53"
SKILL_LICENSE_BLOB = "4f881c52d1f72f4cfb720e339e2d35c3058d01a9"
FIX_COMMIT = "d230a6dd6eb1a0dbee9fec55e2f00a96e28dff81"
FIX_SKILL_TREE = "284049f382b3c2b1989353637e0b3848dad0f09f"
FIX_PATHS = (
    "curl/managed-agents.md",
    "shared/managed-agents-client-patterns.md",
    "shared/managed-agents-environments.md",
    "typescript/managed-agents/README.md",
)
REPAIR_PATCH = Path("repair.patch")


def run(*args: str, cwd: Path | None = None, timeout: int = 120) -> None:
    try:
        subprocess.run(args, cwd=cwd, check=True, timeout=timeout)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within {timeout} seconds") from error


def capture(*args: str, cwd: Path | None = None) -> str:
    try:
        return subprocess.run(
            args, cwd=cwd, check=True, capture_output=True, text=True, timeout=120
        ).stdout.strip()
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within 120 seconds") from error


def materialize_skill(checkout: Path, destination: Path) -> None:
    """Fetch and verify a pinned tree, copying regular blobs only."""
    run("git", "init", "-q", "--template=", str(checkout))
    run("git", "remote", "add", "origin", UPSTREAM, cwd=checkout)
    run(
        # This Skill contains several dozen small Markdown blobs. Fetching them
        # in the shallow pack avoids a separate lazy-fetch round trip per file.
        "git", "fetch", "-q", "--depth", "1", "--no-tags",
        "origin", COMMIT, cwd=checkout,
    )

    if capture("git", "rev-parse", "FETCH_HEAD", cwd=checkout) != COMMIT:
        raise RuntimeError("fetched commit did not match the pinned upstream commit")
    tree = capture(
        "git", "rev-parse", f"FETCH_HEAD:{SKILL_PATH.as_posix()}", cwd=checkout
    )
    if tree != SKILL_TREE:
        raise RuntimeError(f"unexpected upstream Skill tree: {tree}")
    license_blob = capture(
        "git", "rev-parse", "FETCH_HEAD:skills/claude-api/LICENSE.txt", cwd=checkout
    )
    if license_blob != SKILL_LICENSE_BLOB:
        raise RuntimeError(f"unexpected Skill license blob: {license_blob}")

    listing = subprocess.run(
        ["git", "ls-tree", "-r", "-z", "FETCH_HEAD", "--", SKILL_PATH.as_posix()],
        cwd=checkout, check=True, capture_output=True,
    )
    destination.mkdir()
    prefix = f"{SKILL_PATH.as_posix()}/"
    found = False
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
        found = True
    if not found:
        raise RuntimeError("verified Skill tree contains no files")

    skill_license = subprocess.run(
        ["git", "cat-file", "blob", SKILL_LICENSE_BLOB], cwd=checkout,
        check=True, capture_output=True,
    ).stdout
    git_blob = hashlib.sha1(
        b"blob " + str(len(skill_license)).encode() + b"\0" + skill_license
    ).hexdigest()
    if git_blob != SKILL_LICENSE_BLOB:
        raise RuntimeError("materialized Skill license failed Git blob verification")
    (destination / "LICENSE.txt").write_bytes(skill_license)
    shutil.copyfile(
        Path(__file__).resolve().parents[2] / "LICENSE",
        destination / "LICENSE.skillhone",
    )


def capture_repair_patch(checkout: Path) -> bytes:
    """Verify the upstream repair commit and return it as a fixture-root patch."""
    run(
        # Depth 2 keeps the parent commit object, so the repair can be proved a
        # direct child of the pinned defect commit rather than a later descendant.
        "git", "fetch", "-q", "--depth", "2", "--no-tags",
        "origin", FIX_COMMIT, cwd=checkout,
    )

    if capture("git", "rev-parse", "FETCH_HEAD", cwd=checkout) != FIX_COMMIT:
        raise RuntimeError("fetched commit did not match the pinned repair commit")
    if capture("git", "rev-parse", f"{FIX_COMMIT}^", cwd=checkout) != COMMIT:
        raise RuntimeError("repair commit is not a direct child of the pinned defect commit")
    fix_tree = capture(
        "git", "rev-parse", f"{FIX_COMMIT}:{SKILL_PATH.as_posix()}", cwd=checkout
    )
    if fix_tree != FIX_SKILL_TREE:
        raise RuntimeError(f"unexpected upstream repair tree: {fix_tree}")

    prefix = f"{SKILL_PATH.as_posix()}/"
    changed = sorted(
        capture("git", "diff", "--name-only", COMMIT, FIX_COMMIT, cwd=checkout).splitlines()
    )
    if changed != sorted(prefix + name for name in FIX_PATHS):
        raise RuntimeError(f"repair commit scope is not the pinned Skill files: {changed}")

    patch = subprocess.run(
        # --relative drops the upstream skills/claude-api/ prefix so the patch
        # applies from the fixture root with git apply's default -p1.
        ["git", "diff", f"--relative={SKILL_PATH.as_posix()}", COMMIT, FIX_COMMIT],
        cwd=checkout, check=True, capture_output=True, timeout=120,
    ).stdout
    if not patch.strip():
        raise RuntimeError("verified repair commit produced an empty patch")
    return patch


def write_test(destination: Path) -> None:
    test_dir = destination / ".test"
    test_dir.mkdir()
    (test_dir / "test_files_upload_contract.py").write_text(
        '''"""Upload examples must not pass the unsupported Files API purpose field."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FENCE = re.compile(r"```[^\\n]*\\n(.*?)```", re.DOTALL)
PURPOSE_ARG = re.compile(r"\\bpurpose\\s*:")
PURPOSE_FORM = re.compile(r"(?m)^\\s*-F\\s+[\\\"']purpose=")


def main():
    failures = []
    for path in sorted(ROOT.rglob("*.md")):
        if ".test" in path.parts:
            continue
        text = path.read_text(encoding="utf-8")
        for number, block in enumerate(FENCE.findall(text), start=1):
            if "files.upload(" in block and PURPOSE_ARG.search(block):
                failures.append(f"{path.relative_to(ROOT)} code block {number}: SDK purpose argument")
            if "/v1/files" in block and PURPOSE_FORM.search(block):
                failures.append(f"{path.relative_to(ROOT)} code block {number}: multipart purpose field")
    assert not failures, "unsupported Files API purpose parameter in upload examples:\\n- " + "\\n- ".join(failures)


if __name__ == "__main__":
    main()
''', encoding="utf-8",
    )


def write_provenance(destination: Path) -> None:
    repaired_paths = "\n".join(f"- `{name}`" for name in FIX_PATHS)
    (destination / "PROVENANCE.md").write_text(
        f"""# Fixture provenance

- Upstream: {UPSTREAM}
- Pinned defect commit: `{COMMIT}`
- Skill path: `{SKILL_PATH.as_posix()}`
- Skill Git tree: `{SKILL_TREE}`
- Skill license blob: `{SKILL_LICENSE_BLOB}`
- SkillHone repository license: copied to `LICENSE.skillhone`
- Upstream repair commit: `{FIX_COMMIT}`
- Repaired Skill Git tree: `{FIX_SKILL_TREE}`
- Public upstream fix: https://github.com/anthropics/skills/commit/{FIX_COMMIT}
- Generated repair patch: `{REPAIR_PATCH.as_posix()}`

`prepare_fixture.py` fetches the commit by full SHA, verifies the Skill tree and
license blob, and copies regular Git blobs only. It does not check out or run
upstream code. The generated `.test` contract, provenance file and repair patch
are SkillHone artifacts licensed under SkillHone's repository license; the
upstream Skill's own `LICENSE.txt` is preserved unchanged.

`{REPAIR_PATCH.as_posix()}` is the upstream repair commit diffed against the
pinned defect commit and rebased onto the fixture root, so it applies with
`git apply` from this directory. `prepare_fixture.py` verifies that the repair
commit is a direct child of the defect commit, that its Skill tree matches the
pinned tree above, and that it changes exactly these paths and nothing else:

{repaired_paths}

The patch is a verification aid for the contract test, not part of the defect
being measured. Withhold it from a system under test.

The test checks upload examples for the unsupported `purpose` parameter. It is
a static documentation contract and does not call the API or assert server
error wording.
""", encoding="utf-8",
    )


def build_fixture(staging: Path, workspace: Path) -> None:
    """Build and fully verify the fixture inside staging, publishing nothing."""
    checkout = workspace / "source"
    materialized = workspace / "verified-skill"
    materialize_skill(checkout, materialized)
    repair_patch = capture_repair_patch(checkout)

    shutil.copytree(materialized, staging, dirs_exist_ok=True)
    (staging / REPAIR_PATCH).write_bytes(repair_patch)
    write_test(staging)
    write_provenance(staging)
    run("git", "init", "-q", "-b", "main", cwd=staging)
    run("git", "config", "user.name", "SkillHone", cwd=staging)
    run("git", "config", "user.email", "skillhone@example.invalid", cwd=staging)
    run("git", "add", ".", cwd=staging)
    run("git", "commit", "-q", "-m", "fixture: reproduce stale Files API upload examples", cwd=staging)
    run("git", "apply", "--check", REPAIR_PATCH.as_posix(), cwd=staging)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("destination", type=Path)
    args = parser.parse_args()
    destination = args.destination.resolve()
    if destination.exists():
        print(f"ERROR: destination already exists: {destination}", file=sys.stderr)
        return 2
    if not destination.parent.is_dir():
        print(f"ERROR: destination parent is not a directory: {destination.parent}", file=sys.stderr)
        return 2

    # Staging sits beside the destination so publishing is a same-filesystem
    # rename. A failed fetch, verification or patch check then leaves no
    # destination behind. The finally block also removes the staging tree on
    # any error or interrupt it survives; SIGKILL or a crash can strand it.
    workspace = Path(tempfile.mkdtemp(prefix="skillhone-claude-api-files-"))
    staging = Path(tempfile.mkdtemp(prefix=".fixture-partial-", dir=destination.parent))
    published = False
    try:
        build_fixture(staging, workspace)
        if destination.exists():
            print(f"ERROR: destination appeared while building: {destination}", file=sys.stderr)
            return 2
        os.replace(staging, destination)
        published = True
    finally:
        shutil.rmtree(workspace, ignore_errors=True)
        if not published:
            shutil.rmtree(staging, ignore_errors=True)

    print(f"Created fixture: {destination}")
    print("Expected baseline: python3 .test/test_files_upload_contract.py -> failure")
    print(f"Expected repair: git apply {REPAIR_PATCH.as_posix()} -> test passes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
