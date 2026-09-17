# Developer setup

## Requirements

- Git 2.26+
- Node.js 22.19+ or 24+
- pnpm 11
- Python 3.10+ for static Skill checks and example fixtures

## Install the CLI

```bash
pnpm install
pnpm build
node dist/cli.js --help
```

To keep development state isolated:

```bash
export SKILLHONE_HOME=/tmp/skillhone-dev-state
```

## Run checks

```bash
pnpm test
python3 skills/skillhone/scripts/quality/static_check.py skills/skillhone
python3 skills/skillhone/scripts/quality/static_check.py \
  skills/skillhone-auto-optimization
gitleaks detect --source . --no-banner --redact
```

## Run the workbench

Import a disposable Skill or register test fixtures through the Catalog, then
run the cross-repository workbench:

```bash
skillhone import /path/to/example-skill --mode copy
skillhone --skill example-skill issue create \
  --title "Example defect" --body "Safe reproduction"
skillhone web --open
```

The server binds only to `127.0.0.1`. Its backend is TypeScript + Node SQLite;
there is no external database or hosted Git service to provision. The Catalog
indexes repositories, while every Skill keeps a separate Issue/PR/Run/Wiki database.

## Test optimization

```bash
skillhone harness configure --provider deepseek --model your-model-id
# Enter the credential at the hidden terminal prompt.
skillhone --skill example-skill optimize 1
```

Harness works on a newly created `skillhone/issue-1-*` branch. A successful run
must contain a commit before SkillHone records a local PR. Nothing is pushed.
The default `review` merge policy leaves that PR in the approval inbox; an
explicitly saved `automatic` policy merges locally only after linked tests pass.
