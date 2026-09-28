# Claude API model retirement — fast Issue mode

This example reproduces a time-sensitive maintenance defect in the public
`claude-api` Skill from [`anthropics/skills`](https://github.com/anthropics/skills).
The Skill is a genuine upstream Skill with its own license and reference files;
the fixture downloads the pinned source at runtime and does not vendor it here.

In [Issue #1603](https://github.com/anthropics/skills/issues/1603), the author
reported on 2026-08-17 that four unavailable model families were still
presented in the Skill's `Legacy` or `Deprecated` sections. One retirement date
had passed, while other rows still said `TBD` or `retiring soon`. The report
also confirmed that the listed Opus 4.5 and Sonnet 4.5 IDs remained active.
The `Resolving User Requests` table still directed readers to unavailable
model aliases or described a retired model as deprecated.
This is a status-expiration defect: time changes the truth of a row without
changing the file.

The fixture pins commit
`f6656c1256d5a8adfa37db9110046ef20bac644c` (2026-08-13), verifies the commit
and key Git blob IDs, and materializes the real Skill tree. The baseline test
must fail for the four reported retired IDs. A scoped repair moves those IDs to
`Retired`, updates the corresponding request-lookup rows to stop recommending
unavailable aliases, keeps Opus 4.5 and Sonnet 4.5 active in both tables, and
adds a visible modification notice to the changed Apache-2.0 file.

## Reproduce the baseline

```powershell
python examples/claude-model-retirement/prepare_fixture.py $env:TEMP\claude-model-retirement
python $env:TEMP\claude-model-retirement\.test\test_model_retirement.py
```

The second command must fail before repair. The test uses the historical
retirement dates and statuses in the public issue; it does not call Anthropic's
API, require a key, or depend on today's live model catalog.

## Trigger it from a Coding Agent

After preparing the fixture, ask a Coding Agent:

> Use the `claude-api` Skill in `$env:TEMP\claude-model-retirement` to report
> the status, as of 2026-08-17, of the four model IDs named in the fixture's
> `PROVENANCE.md`. Use only the local Skill files. Run the linked `.test`
> contract, make the smallest scoped repair to both status and request-lookup
> rows, and preserve the active model rows.

The regression contract checks the four expired IDs and their request-lookup
rows, plus the two reported-active IDs and their lookup rows. It does not
verify current API availability, future retirement dates, or the accuracy of
every other model row. Those remain time-sensitive upstream facts that need a
live-source review.

## Attribution and limitations

The fixture retains the upstream `LICENSE.txt` and copies SkillHone's repository
license for the generated test and provenance files. `prepare_fixture.py`
accepts only regular Git blobs and does not execute upstream code. The API
responses described in Issue #1603 are the issue author's historical evidence;
this deterministic fixture intentionally does not repeat credentialed API
calls.
