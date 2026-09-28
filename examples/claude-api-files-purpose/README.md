# Claude API Files upload — stale `purpose` parameter

This case reproduces an API example defect in Anthropic's public
[`claude-api` Skill](https://github.com/anthropics/skills/tree/main/skills/claude-api).
Before the upstream repair, multiple Managed Agents upload examples supplied a
`purpose` field to the Files API. The upstream fix states that the upload
endpoint does not accept this parameter and removes it from the examples.

The fixture is fetched at a pinned upstream commit by `prepare_fixture.py`.
It does not vendor the Skill source, execute upstream files, or require API
credentials. Its regression test is a deterministic static contract check: it
detects the unsupported multipart field and SDK argument in upload examples.
It does **not** call Anthropic's API or prove the server's response at runtime.

## Reproduce

From the SkillHone repository root, build the fixture and enter it:

```bash
python3 examples/claude-api-files-purpose/prepare_fixture.py /tmp/claude-api-files-purpose
cd /tmp/claude-api-files-purpose
```

Run the baseline test. It is expected to **fail** with four findings:

```bash
python3 .test/test_files_upload_contract.py
```

```text
AssertionError: unsupported Files API purpose parameter in upload examples:
- curl/managed-agents.md code block 15: multipart purpose field
- shared/managed-agents-client-patterns.md code block 8: SDK purpose argument
- shared/managed-agents-environments.md code block 3: SDK purpose argument
- typescript/managed-agents/README.md code block 11: SDK purpose argument
```

Apply the upstream repair shipped in the fixture and rerun the same test. It is
expected to **pass** silently, with exit status 0:

```bash
git apply repair.patch
python3 .test/test_files_upload_contract.py
```

`repair.patch` touches only the four files above, so `git status --short` after
applying it lists exactly those four as modified. `git checkout -- .` restores
the defective baseline, and the patch can then be applied again.

## Failure evidence and repair scope

The failure is confined to examples that upload files through
`client.beta.files.upload(...)` or `POST /v1/files`. A repair should remove the
unsupported upload argument while preserving unrelated request fields and
guidance. The test does not prescribe an exact patch or require a model call:
any edit that drops the unsupported argument from the reported blocks satisfies
it.

`repair.patch` is the upstream repair commit diffed against the pinned defect
commit and rebased onto the fixture root. It exists to verify that the contract
test is satisfiable by the real fix. It is not part of the defect being
measured, so an evaluation run should withhold it from the system under test and
let the repair be derived from the failing contract.

## Provenance and limitations

`PROVENANCE.md` in the generated fixture records the source commit, verified
Git tree and license object IDs, and the public upstream repair. The generated
fixture contains the complete pinned Skill tree so the issue can be encountered
through ordinary Skill use; only the regression test is scoped to this defect.

No upstream content is committed to this repository. `prepare_fixture.py`
fetches both pinned commits by full SHA and generates `.test/`, `PROVENANCE.md`
and `repair.patch` into the fixture at preparation time. Before writing the
patch it checks that the repair commit is a direct child of the defect commit,
that its `skills/claude-api` tree matches a pinned object ID, and that it
changes exactly the four files listed above; after committing the fixture it
checks that the patch applies cleanly to it.

This case tests stale API guidance through a structural contract. It does not
validate every SDK version, server-side error wording, or live API behavior.
