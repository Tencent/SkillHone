# skill-creator description optimizer — `ANTHROPIC_API_KEY` dependency

This case reproduces an auth-design defect in Anthropic's public
[`skill-creator`](https://github.com/anthropics/skills/tree/main/skills/skill-creator)
Skill. The description-optimization path built an Anthropic SDK client, so it
required `ANTHROPIC_API_KEY`. The upstream repair drops the SDK client and calls
`claude -p` instead, matching the auth pattern already used by `run_eval.py`, so
the path works in an environment that has a Claude Code login but no API key.

- **Defect commit (fixture baseline):** `7029232b9212482c0476da354b83364bd28fab2f`
- **Fix commit:** `b0cbd3df1533b396d281a6886d5132f623393a9c`
- **Upstream repair PR:** https://github.com/anthropics/skills/pull/547

`prepare_fixture.py` fetches both commits by full SHA, verifies the commit, the
Skill tree and the license blob, and copies regular Git blobs only. It does not
vendor the Skill source, run upstream code while generating the fixture, or make
any model API call. The fixture contains the **defect** revision plus
`repair.patch`, which is the upstream diff with the Skill prefix stripped.

## Reproduce

From the SkillHone repository root:

```bash
python3 examples/skill-creator-description-auth/prepare_fixture.py /tmp/skill-creator-description-auth
python3 /tmp/skill-creator-description-auth/.test/test_description_optimizer_auth_contract.py
cd /tmp/skill-creator-description-auth
git apply repair.patch
python3 .test/test_description_optimizer_auth_contract.py
```

The first run is the baseline and is expected to **fail (exit 1)**. After
`git apply repair.patch` the same test is expected to **pass (exit 0)**.

## Failure evidence (baseline — exit 1)

```
=== clause A: no ambient-credential Anthropic SDK client (structural) ===
  FAIL scripts/improve_description.py: imports the Anthropic SDK for the description-optimization path
  FAIL scripts/improve_description.py:219: constructs anthropic.Anthropic(...) with ambient credentials
       (no explicit api_key) -> this path requires ANTHROPIC_API_KEY and cannot run in an
       environment that only has Claude Code auth
  FAIL scripts/run_loop.py: imports the Anthropic SDK for the description-optimization path
  FAIL scripts/run_loop.py:78: constructs anthropic.Anthropic(...) with ambient credentials
       (no explicit api_key) -> this path requires ANTHROPIC_API_KEY and cannot run in an
       environment that only has Claude Code auth
=== clause B: optimizer calls `claude -p` and holds the tag contract ===
  FAIL scripts/improve_description.py: no subprocess call invoking the `claude` CLI
RESULT: FAIL
```

After the repair:

```
=== clause A: ... ===  ok
=== clause B: ... ===  ok
=== clause C: behavioural run with a stub `claude` on PATH ===
  ok (prompt via stdin, <new_description> parsed)
RESULT: PASS
```

## What the regression test checks

Three clauses, in order. Clause C only runs when A and B hold.

- **A. Structural (ast, upstream modules are never imported).** No module under
  the Skill tree may construct an Anthropic SDK client that resolves credentials
  from the environment (`anthropic.Anthropic(...)` with no explicit `api_key` /
  `auth_token`), and no module may import the Anthropic SDK for that path.
- **B. Structural.** The optimizer must invoke the `claude` CLI through
  `subprocess.run` and must contain the `<new_description>` contract.
- **C. Behavioural.** With a stub `claude` executable on `PATH` (recording argv
  and stdin, replying `<new_description>…</new_description>`), the optimizer's own
  CLI is run end to end. The test asserts the prompt is delivered **over stdin**
  (not argv), that the stub received the `-p` flag, and that the
  `<new_description>` tag is parsed back out of the reply. It asserts what the
  stub `claude` was handed; it does not verify the behaviour of the real CLI.

## Repair scope

The upstream repair touches `scripts/improve_description.py` (drop the SDK client
and `client.messages.create`, add `_call_claude()` using `claude -p` with the
prompt on stdin), `scripts/run_loop.py` (drop the SDK import, the client and the
`client=` argument) and `SKILL.md` (prose). The fixture's `repair.patch` carries
exactly that diff for `skills/skill-creator`.

## Test limitations

- **The defect's runtime failure mode is not reproduced here.** With
  `ANTHROPIC_API_KEY` unset, this environment has no `anthropic` package
  installed, so importing the defect module raises `ModuleNotFoundError`, not an
  authentication error. Clause A therefore detects the defect **structurally**
  (an ambient-credential SDK client construction), and the test states explicitly
  that the missing-package error is *not* counted as the defect. It does not
  prove the SDK's runtime error message.
- Clause C verifies the **repaired** path against a stub `claude`, not the real
  CLI and not the live API. It does not validate model output quality, triggering
  accuracy, or `run_eval.py`.
- Clause C executes the repaired `improve_description.py`. The other clauses only
  parse source text.
- The stub `claude` fidelity is limited to the contract under test: argv shape,
  stdin delivery, and tag parsing.
- `repair.patch` is the upstream repair, not an independently authored fix; the
  case records that provenance rather than claiming original repair work.
