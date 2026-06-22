# Iteration Patterns

Common failure→fix patterns observed across skill evolution experiments.

## Pattern 1: Timeout / Recursion Limit Hit

**Symptom**: `Recursion limit of 150 reached` in error field
**Root cause**: Agent loops too many search attempts without converging
**Fixes**:
- Add explicit tool call budget to SKILL.md (e.g., "10 tool calls max")
- Add "write early, update often" rule — write best guess after first search
- Reduce max hops in multi-hop strategy (3 hops max, not unlimited)
- Add anti-loop rule: "never repeat the same query"

## Pattern 2: LLM Fallback Guess

**Symptom**: `answer from LLM fallback guess` in error field
**Root cause**: Agent never wrote answer.txt, so evaluator fell back to asking LLM
**Fixes**:
- Strengthen "always write answer.txt" rule in SKILL.md
- Add write-early checkpoint: "After first search result, immediately write best guess"
- Ensure scripts/ don't silently fail (add error handling + fallback messages)

## Pattern 3: Wrong Search Tool / Empty Results

**Symptom**: Agent uses a search method that returns nothing
**Root cause**: Agent doesn't know available tools or uses wrong syntax
**Fixes**:
- Add clear tool priority in SKILL.md (e.g., "Wikipedia first, then DuckDuckGo")
- Create scripts/ that encapsulate correct API calls
- Add fallback chain: if tool A fails, try tool B

## Pattern 4: Answer Format Mismatch

**Symptom**: Predicted answer is correct content but wrong format
**Examples**: "100%" vs "100", "b,e" vs "b, e", "BRINIEST" vs "Briniest"
**Fixes**:
- Add format rules to SKILL.md: "just the fact, no units unless asked"
- Add examples of expected output format
- Note: some format issues are acceptable (case normalization done by evaluator)

## Pattern 5: Context Overflow

**Symptom**: Agent starts hallucinating or ignoring instructions in later steps
**Root cause**: SKILL.md + accumulated context exceeds model's effective window
**Fixes**:
- Shrink SKILL.md (move content to scripts/ and references/)
- Limit page fetch size (e.g., "only read first 2000 chars of fetched page")
- Add "clear context" between hops (summarize findings, then search again)

## Pattern 6: Multi-hop Chain Breaks

**Symptom**: Agent finds intermediate entity but fails to chain to final answer
**Root cause**: Each hop consumes too many tool calls; budget exhausted before final hop
**Fixes**:
- Limit each hop to 1-2 tool calls
- Plan hops BEFORE searching (decompose in step 0)
- Use more specific queries that combine multiple hops into one

## Iteration Strategy

When improving, follow this priority order:

1. **Fix timeouts first** — they represent 0% chance of correct answer
2. **Fix no-answer cases** — easy wins (just need "write answer" rule)
3. **Fix tool failures** — improve scripts/ to handle edge cases
4. **Fix wrong answers** — hardest, requires better search strategy
5. **Fix format issues** — usually low priority, evaluator handles most

## Measuring Progress

- **Score**: n_passed / n_total (primary metric)
- **Efficiency**: average tool calls per item (lower = better)
- **Stability**: score variance across runs (lower = better at T=1.0)

Track: items that improved vs items that regressed. Net gain > 0 means progress.
