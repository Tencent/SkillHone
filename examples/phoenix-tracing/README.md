# Phoenix tracing — fast Issue mode

This runtime-defect example reproduces a publicly documented problem in the
`phoenix-tracing` Skill from GitHub's
[`awesome-copilot`](https://github.com/github/awesome-copilot) repository. The
Skill metadata declares Apache-2.0, while the upstream repository root contains
an MIT license. It does not require a Benchmark or Eval repository.

In [Issue #2567](https://github.com/github/awesome-copilot/issues/2567), the
`phoenix-tracing` Skill advertised four bundled reference documents that did
not exist. An Agent following those links could not load the promised message,
metadata, graph, or exception attribute guidance. The same broken links were
removed by the merged [PR #2568](https://github.com/github/awesome-copilot/pull/2568).

`prepare_fixture.py` fetches the affected commit and verifies its Git objects
before creating the local fixture. It copies regular files only and does not
execute upstream code.

## Licenses and attribution

The fixture keeps the Skill's Apache-2.0 declaration, the upstream repository's
MIT license, and SkillHone's MIT license for the generated test and provenance
files. Baseline upstream files are copied unchanged. If a repair changes
`SKILL.md`, the regression test also requires a visible modification notice.

## Reproduce the baseline

```bash
python3 examples/phoenix-tracing/prepare_fixture.py /tmp/phoenix-tracing
python3 /tmp/phoenix-tracing/.test/test_reference_links.py
```

The second command must fail and list these four missing files:

- `references/attributes-messages.md`
- `references/attributes-metadata.md`
- `references/attributes-graph.md`
- `references/attributes-exceptions.md`

The test checks every local Markdown link in `SKILL.md`; it does not encode the
upstream patch and does not create a SkillHone Issue by itself.

## Trigger it from a Coding Agent

After preparing `/tmp/phoenix-tracing`, paste this as a normal user request:

> Use the `phoenix-tracing` Skill in `/tmp/phoenix-tracing` to explain which
> bundled references define message, metadata, graph, and exception attributes.
> Follow `PROVENANCE.md` when repairing it and preserve its attribution.

The Agent should encounter the missing references during normal Skill use,
record or reuse one SkillHone Issue, dispatch the queued Harness repair, run the
linked `.test/test_reference_links.py` contract, and leave a local PR for
review.
