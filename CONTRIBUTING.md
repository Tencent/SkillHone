# Contributing to SkillHone

The most valuable contribution is a small, reproducible skill-maintenance case.
It should show what an Agent observed, how to reproduce it without private data,
what the repair changed, and which test proves the result.

## Development setup

```bash
git clone https://github.com/Tencent/SkillHone.git
cd SkillHone
corepack enable
pnpm install --frozen-lockfile
pnpm test

python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r skills/skillhone/assets/requirements.txt
```

Run the two skill checks before opening a pull request:

```bash
python skills/skillhone/scripts/quality/static_check.py skills/skillhone
python skills/skillhone/scripts/quality/static_check.py skills/skillhone-auto-optimization
gitleaks dir . --no-banner --redact
gitleaks git . --no-banner --redact
```

## Add a repair example

- Fetch a pinned public upstream version at runtime; do not vendor its source.
- Verify downloaded inputs with a commit SHA or content hashes.
- Keep the reproduction deterministic and runnable without model credentials.
- Put focused runtime-repair checks in `.test/` inside the generated Skill fixture.
- Record exact before/after tests and disclose limitations.
- Never include API keys, private prompts, raw private traces, or company code.

One focused behavior change per pull request is easier to review and reuse.
SkillHone never requires contributors to publish generated branches or local
Issue databases.
