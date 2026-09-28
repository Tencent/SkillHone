#!/usr/bin/env python3
"""Fetch the anthropics/skills `skill-creator` at the commit before the
description-optimizer auth fix, and generate a fixture whose regression test
proves the description-optimization path no longer requires ANTHROPIC_API_KEY.

This script does not vendor the upstream Skill into SkillHone, does not execute
upstream files while generating the fixture, and does not call any model API.
"""
from __future__ import annotations

import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


UPSTREAM = "https://github.com/anthropics/skills.git"
SKILL_PATH = Path("skills/skill-creator")

# Commit before the fix: the description optimizer builds an Anthropic SDK
# client (`anthropic.Anthropic()`), so the path requires ANTHROPIC_API_KEY.
DEFECT_COMMIT = "7029232b9212482c0476da354b83364bd28fab2f"
DEFECT_TREE = "5c26c1472b98de33a48074ba5d3efe3a727b8e37"

# Commit after the fix: the optimizer shells out to `claude -p` instead.
FIX_COMMIT = "b0cbd3df1533b396d281a6886d5132f623393a9c"
FIX_TREE = "98a510d1cfef9f82c3b1eec200229ca68725e613"

SKILL_LICENSE_BLOB = "7a4a3ea2424c09fbe48d455aed1eaa94d9124835"
FIX_PR = "https://github.com/anthropics/skills/pull/547"


def run(*args: str, cwd: Path | None = None, timeout: int = 300, **kw) -> None:
    try:
        subprocess.run(args, cwd=cwd, check=True, timeout=timeout, **kw)
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within {timeout} seconds") from error


def capture(*args: str, cwd: Path | None = None, timeout: int = 300) -> str:
    try:
        return subprocess.run(
            args, cwd=cwd, check=True, capture_output=True, text=True, timeout=timeout
        ).stdout.strip()
    except subprocess.TimeoutExpired as error:
        raise RuntimeError(f"{args[0]} did not finish within {timeout} seconds") from error


def fetch_and_verify(checkout: Path) -> None:
    """Fetch both pinned commits and verify SHA, Skill tree and license blob."""
    run("git", "init", "-q", "--template=", str(checkout))
    run("git", "remote", "add", "origin", UPSTREAM, cwd=checkout)

    for label, commit, tree in (
        ("defect", DEFECT_COMMIT, DEFECT_TREE),
        ("fix", FIX_COMMIT, FIX_TREE),
    ):
        # github.com has been observed to time out intermittently; retry a few times
        # before giving up so a flaky connection does not fail the fixture.
        last_error: Exception | None = None
        for attempt in range(1, 4):
            try:
                run("git", "fetch", "-q", "--depth", "1", "--no-tags",
                    "origin", commit, cwd=checkout, timeout=180)
                last_error = None
                break
            except (subprocess.CalledProcessError, RuntimeError) as error:
                last_error = error
                print(f"  {label}: fetch attempt {attempt} failed, retrying", file=sys.stderr)
        if last_error is not None:
            raise RuntimeError(
                f"{label}: could not fetch {commit} from {UPSTREAM} after 3 attempts: {last_error}"
            )
        if capture("git", "rev-parse", "FETCH_HEAD", cwd=checkout) != commit:
            raise RuntimeError(f"{label}: fetched commit did not match the pinned commit")
        got_tree = capture(
            "git", "rev-parse", f"{commit}:{SKILL_PATH.as_posix()}", cwd=checkout
        )
        if got_tree != tree:
            raise RuntimeError(f"{label}: unexpected Skill tree {got_tree} (expected {tree})")
        got_license = capture(
            "git", "rev-parse", f"{commit}:{SKILL_PATH.as_posix()}/LICENSE.txt", cwd=checkout
        )
        if got_license != SKILL_LICENSE_BLOB:
            raise RuntimeError(
                f"{label}: unexpected Skill license blob {got_license} "
                f"(expected {SKILL_LICENSE_BLOB})"
            )


def materialize_skill(checkout: Path, destination: Path) -> None:
    """Copy regular blobs of the pinned defect tree only. No upstream code runs."""
    listing = subprocess.run(
        ["git", "ls-tree", "-r", "-z", DEFECT_COMMIT, "--", SKILL_PATH.as_posix()],
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


def write_repair_patch(checkout: Path, destination: Path) -> None:
    """Record the upstream repair as a fixture-root-relative patch (offline replay)."""
    diff = subprocess.run(
        ["git", "diff", "--no-color", "--no-ext-diff", DEFECT_COMMIT, FIX_COMMIT,
         "--", SKILL_PATH.as_posix()],
        cwd=checkout, check=True, capture_output=True, text=True,
    ).stdout
    if not diff.strip():
        raise RuntimeError("upstream repair diff is empty")
    prefix = SKILL_PATH.as_posix() + "/"
    diff = diff.replace(f"a/{prefix}", "a/").replace(f"b/{prefix}", "b/")
    (destination / "repair.patch").write_text(diff, encoding="utf-8")


TEST_SOURCE = '''#!/usr/bin/env python3
"""Contract: the skill-creator description optimizer must not require ANTHROPIC_API_KEY.

Clause A (structural, ast only)
    The description-optimization path must not construct an Anthropic SDK
    client that resolves credentials from the environment, and must not import
    the Anthropic SDK for that path. Upstream modules are never imported here,
    so a missing `anthropic` package can never be mistaken for this defect.

Clause C (behavioural, only when clauses A and B hold)
    The optimizer is exercised end to end through its own CLI with a stub
    `claude` executable on PATH: the prompt must be delivered over stdin, the
    invocation must carry the non-interactive `-p` flag, and the
    <new_description> tag must be parsed back out.

The test deliberately does NOT treat these as failures: the absence of the
`anthropic` package, import errors, or a changed function signature.
"""
import ast
import json
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OPTIMIZER = ROOT / "scripts" / "improve_description.py"
SDK_CLIENTS = {"anthropic.Anthropic", "anthropic.AsyncAnthropic", "Anthropic", "AsyncAnthropic"}
CREDENTIAL_KWARGS = {"api_key", "auth_token"}


def _modules():
    for path in sorted(ROOT.rglob("*.py")):
        if ".test" in path.parts:
            continue
        yield path


def _imports_anthropic(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "anthropic" or alias.name.startswith("anthropic."):
                    return True
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if module == "anthropic" or module.startswith("anthropic."):
                return True
    return False


def _ambient_sdk_clients(tree):
    sites = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        name = None
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name):
            name = f"{func.value.id}.{func.attr}"
        elif isinstance(func, ast.Name):
            name = func.id
        if name not in SDK_CLIENTS:
            continue
        kwargs = {kw.arg for kw in node.keywords if kw.arg}
        if kwargs & CREDENTIAL_KWARGS:
            continue  # explicit credential supplied: not an ambient-credential client
        sites.append((node.lineno, name))
    return sites


def clause_a():
    findings = []
    for path in _modules():
        try:
            tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
        except SyntaxError as error:
            findings.append(f"{path.relative_to(ROOT)}: unparsable source ({error.msg})")
            continue
        if _imports_anthropic(tree):
            findings.append(
                f"{path.relative_to(ROOT)}: imports the Anthropic SDK for the "
                f"description-optimization path"
            )
        for lineno, name in _ambient_sdk_clients(tree):
            findings.append(
                f"{path.relative_to(ROOT)}:{lineno}: constructs {name}(...) with ambient "
                f"credentials (no explicit api_key) -> this path requires ANTHROPIC_API_KEY "
                f"and cannot run in an environment that only has Claude Code auth"
            )
    return findings


def _claude_cli_sites(path):
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"), filename=str(path))
    # Resolve simple `name = [...]` assignments: upstream builds `cmd = ["claude", ...]`
    # and passes the name to subprocess.run, not a list literal.
    lists = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.List):
            for target in node.targets:
                if isinstance(target, ast.Name):
                    lists[target.id] = node.value
    sites = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not (isinstance(func, ast.Attribute) and func.attr == "run"
                and isinstance(func.value, ast.Name) and func.value.id == "subprocess"):
            continue
        if not node.args:
            continue
        first = node.args[0]
        if isinstance(first, ast.Name):
            first = lists.get(first.id)
        if isinstance(first, ast.List) and first.elts:
            head = first.elts[0]
            if isinstance(head, ast.Constant) and head.value == "claude":
                sites.append(node.lineno)
    return sites


def clause_b():
    if not OPTIMIZER.exists():
        return ["scripts/improve_description.py is missing"]
    text = OPTIMIZER.read_text(encoding="utf-8", errors="replace")
    findings = []
    if not _claude_cli_sites(OPTIMIZER):
        findings.append(
            "scripts/improve_description.py: no subprocess call invoking the `claude` CLI"
        )
    if "<new_description>" not in text:
        findings.append("scripts/improve_description.py: no <new_description> contract")
    return findings


def behavioural():
    """Exercise the optimizer CLI with a stub `claude` on PATH."""
    with tempfile.TemporaryDirectory(prefix="skill-creator-auth-") as tmp:
        tmp_path = Path(tmp)
        stub_dir = tmp_path / "bin"
        stub_dir.mkdir()
        stub = stub_dir / "claude"
        stub.write_text(
            "#!/bin/sh\\n"
            'printf \\'%s\\\\n\\' "$@" > "$CLAUDE_STUB_DIR/argv.txt"\\n'
            'cat > "$CLAUDE_STUB_DIR/stdin.txt"\\n'
            "printf '<new_description>STUB-DESCRIPTION</new_description>\\\\n'\\n",
            encoding="utf-8",
        )
        stub.chmod(stub.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)

        eval_results = {
            "description": "SENTINEL-CURRENT-DESCRIPTION",
            "results": [{"query": "sentinel failed query", "should_trigger": True,
                         "pass": False, "triggers": 0, "runs": 3}],
            "summary": {"passed": 0, "failed": 1, "total": 1},
        }
        eval_file = tmp_path / "eval_results.json"
        eval_file.write_text(json.dumps(eval_results), encoding="utf-8")

        env = {k: v for k, v in os.environ.items() if k != "ANTHROPIC_API_KEY"}
        env["CLAUDE_STUB_DIR"] = str(tmp_path)
        env["PATH"] = f"{stub_dir}{os.pathsep}{env.get('PATH', '')}"
        # upstream modules import `scripts.*`, so the fixture root must be importable
        env["PYTHONPATH"] = f"{ROOT}{os.pathsep}{env.get('PYTHONPATH', '')}"

        proc = subprocess.run(
            [sys.executable, str(OPTIMIZER), "--eval-results", str(eval_file),
             "--skill-path", str(ROOT), "--model", "stub-model"],
            capture_output=True, text=True, env=env, cwd=ROOT, timeout=180,
        )
        findings = []
        if proc.returncode != 0:
            findings.append(f"optimizer CLI exited {proc.returncode}: {proc.stderr.strip()[:400]}")
            return findings
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError as error:
            findings.append(f"optimizer CLI did not print JSON: {error}")
            return findings
        if payload.get("description") != "STUB-DESCRIPTION":
            findings.append(
                f"<new_description> was not parsed from the CLI reply: "
                f"{payload.get('description')!r}"
            )
        stdin_file = tmp_path / "stdin.txt"
        argv_file = tmp_path / "argv.txt"
        stdin_text = stdin_file.read_text(encoding="utf-8") if stdin_file.exists() else ""
        argv_text = argv_file.read_text(encoding="utf-8") if argv_file.exists() else ""
        if "SENTINEL-CURRENT-DESCRIPTION" not in stdin_text:
            findings.append("the prompt was not delivered to `claude` over stdin")
        if "SENTINEL-CURRENT-DESCRIPTION" in argv_text:
            findings.append("the prompt was passed on argv instead of stdin")
        if not argv_text.strip():
            findings.append("the stub `claude` was never invoked")
        argv_args = [line.strip() for line in argv_text.splitlines() if line.strip()]
        if argv_args and "-p" not in argv_args:
            findings.append(
                "the optimizer invoked `claude` without the -p flag, which selects "
                f"non-interactive one-shot mode; argv was {argv_args!r}"
            )
        return findings


def main() -> int:
    print("=== clause A: no ambient-credential Anthropic SDK client (structural) ===")
    findings_a = clause_a()
    for item in findings_a:
        print(f"  FAIL {item}")
    if not findings_a:
        print("  ok")

    print("=== clause B: optimizer calls `claude -p` and holds the tag contract ===")
    findings_b = clause_b()
    for item in findings_b:
        print(f"  FAIL {item}")
    if not findings_b:
        print("  ok")

    if findings_a or findings_b:
        print()
        print("This path depends on an Anthropic SDK client, so it requires")
        print("ANTHROPIC_API_KEY and cannot run with Claude Code auth alone.")
        print("Clause C (behavioural) is NOT attempted while the SDK client is present:")
        print("importing the module here would fail on the missing `anthropic` package,")
        print("and that missing-dependency error is deliberately not counted as this defect.")
        print("RESULT: FAIL")
        return 1

    print("=== clause C: behavioural run with a stub `claude` on PATH ===")
    findings_c = behavioural()
    for item in findings_c:
        print(f"  FAIL {item}")
    if not findings_c:
        print("  ok (prompt via stdin, <new_description> parsed)")

    print()
    print("RESULT:", "PASS" if not findings_c else "FAIL")
    return 0 if not findings_c else 1


if __name__ == "__main__":
    raise SystemExit(main())
'''


def write_test(destination: Path) -> None:
    test_dir = destination / ".test"
    test_dir.mkdir()
    (test_dir / "test_description_optimizer_auth_contract.py").write_text(
        TEST_SOURCE, encoding="utf-8"
    )


def write_provenance(destination: Path) -> None:
    (destination / "PROVENANCE.md").write_text(
        f"""# Fixture provenance

- Upstream: {UPSTREAM}
- Skill path: `{SKILL_PATH.as_posix()}`
- Defect commit (fixture baseline): `{DEFECT_COMMIT}`
- Defect Skill tree: `{DEFECT_TREE}`
- Fix commit: `{FIX_COMMIT}`
- Fix Skill tree: `{FIX_TREE}`
- Skill license blob (identical at both commits): `{SKILL_LICENSE_BLOB}`
- Upstream repair PR: {FIX_PR}
- SkillHone repository license: copied to `LICENSE.skillhone`
- `repair.patch`: `git diff {DEFECT_COMMIT[:8]} {FIX_COMMIT[:8]} -- {SKILL_PATH.as_posix()}`
  with the Skill prefix stripped, so it applies at the fixture root.

`prepare_fixture.py` fetches both commits by full SHA, verifies commit, Skill tree
and license blob, and copies regular Git blobs only. It does not check out or run
upstream code, and it makes no model API calls.

The fixture is the **defect** revision. Applying `repair.patch` reproduces the
upstream repair (the optimizer stops building an Anthropic SDK client and calls
`claude -p` instead).

## Known limitation

The defect's runtime failure mode — an SDK client refusing to construct without
`ANTHROPIC_API_KEY` — is **not reproduced here**: the `anthropic` package is not
installed in this environment, so importing the defect module raises
`ModuleNotFoundError` instead of an authentication error. The test therefore
detects the defect **structurally** (an `anthropic.Anthropic()` construction
resolving ambient credentials) and verifies the repaired path **behaviourally**
with a stub `claude` CLI. It does not prove the SDK's runtime error message and
does not call any live API.
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

    with tempfile.TemporaryDirectory(prefix="skillhone-skill-creator-auth-") as tmp:
        checkout = Path(tmp) / "source"
        materialized = Path(tmp) / "verified-skill"
        fetch_and_verify(checkout)
        materialize_skill(checkout, materialized)
        shutil.copytree(materialized, destination)
        write_repair_patch(checkout, destination)

    write_test(destination)
    write_provenance(destination)
    run("git", "init", "-q", "-b", "main", cwd=destination)
    run("git", "config", "user.name", "SkillHone", cwd=destination)
    run("git", "config", "user.email", "skillhone@example.invalid", cwd=destination)
    run("git", "add", ".", cwd=destination)
    run("git", "commit", "-q", "-m",
        "fixture: reproduce description optimizer requiring ANTHROPIC_API_KEY", cwd=destination)
    print(f"Created fixture: {destination}")
    print("Expected baseline: python3 .test/test_description_optimizer_auth_contract.py -> failure")
    print("Apply the repair:  git apply repair.patch  (then rerun the test -> pass)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
