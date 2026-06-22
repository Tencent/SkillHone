# Seed Workflow

`scripts/seed.py` initializes a skill repository from that repository's own
`README.md`. The implementation is part of SkillHone and does not depend on any
external skill authoring package.

## Inputs

- Target repository directory or Forgejo repository URL.
- A non-empty `README.md` in the target repository.
- A target directory name that is already a valid skill name: lowercase letters,
  numbers, and hyphens.

## Generated Files

- `SKILL.md` with valid frontmatter and concise workflow instructions.
- `references/task.md` containing the original task brief from `README.md`.
- `scripts/validate_seed.py` for a minimal skeleton check.

## Validation

After writing files, seed runs:

```bash
python3 skills/skillhone/scripts/quality/static_check.py <skill-dir> --json
```

Hard static-check failures abort the seed workflow. Warnings are printed so the
next optimization iteration can improve the scaffold.

## Rules

- Do not call, import, copy, or require external skill-creation skills.
- Do not copy third-party skill text or scripts into the generated repo.
- Keep generated instructions minimal; detailed task context belongs in
  `references/task.md`.
- The generated skill is a starting point. Use synthesis, evaluation, and
  optimization to harden it against real probe results.
