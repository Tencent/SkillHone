# Optimization Loop

## How it works

`scripts/optim.py` launches a Claude Agent SDK session and mounts:

- `skillhone` — evaluation tooling
- `skillhone-evaluation` — eval-loop guidance
- `skillhone-optimization` — optimisation playbook (with the issue / developer / reviewer / explorer subagents)

The agent then runs the optimisation loop autonomously:

```
1. Evaluate (probe) → get the current score
2. Decide: continue or stop?
   - N iterations with no improvement → stop
   - max_iterations reached            → stop
   - otherwise                          → continue
3. Optimise → dispatch subagents to improve the skill
   - issue-reporter: diagnose failures, file an Issue
   - developer:      implement the fix, open a PR
   - reviewer:       review + merge
4. Loop back to step 1
```

## Invocation

```bash
python3 ~/.skillhone/skills/skillhone/scripts/optim.py \
  --repo http://forgejo/skillhone/my-skill.git \
  --iters 5 \
  --patience 2 \
  --max-turns 200
```

## Headless vs. interactive

| | `optim.py` (headless) | Manual (Claude Code, foreground) |
|---|---|---|
| Entry point        | `python3 scripts/optim.py --repo …` | mount the skills, then converse with the agent |
| Control flow       | the agent loops autonomously         | the user decides when to eval / improve |
| When to use it     | batched experiments, unattended runs | interactive debugging, step-by-step verification |

Both modes use the same skills and produce equivalent results.
