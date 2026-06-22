# Difficulty Guidance

This reference explains which questions to keep, which to drop, and why. It is not a list of forbidden entities. Difficulty depends on whether the solver must use the tools and perform real reasoning.

## Simple Questions

A question is simple when it can be answered by one obvious lookup or by memory.

Examples:

- "What is the name of record R001?"
- "Which category is this well-known item in?"
- "What is the top-ranked record for this famous source?"

Even if the wording contains several hops, the question is still simple if the final answer is a fact a strong model is likely to know already.

## Effective Hard Questions

A good hard question forces the answerer to do one or more of these:

- Resolve an entity from attributes rather than name or ID.
- Traverse links or reverse links.
- Join values from two tools or two files.
- Compute a statistic, rank, ratio, threshold, or modulo.
- Apply a meaningful exclusion or tie-breaker.
- Return an exact code, count, ordered list, JSON object, or rounded value.

Short example:

> In a fixed historical window, find records in segment A whose metric is above the cohort median. Exclude records without linked events. Among the remaining records, take the third by metric and return its source code.

This is hard because it requires set construction, aggregation, filtering, ranking, and a precise terminal. The entities themselves do not need to be obscure.

## Invalid Complexity

Some questions look complicated but should be rejected:

- The wording is vague: "important", "popular", "best" without a metric.
- The answer changes too often: "latest", "current", "this week".
- The question reveals the answer in a filter: "the record with 47 linked events" then asks for 47.
- The only challenge is trivia or arbitrary decoration.
- The path is long, but every step and the terminal answer are guessable from pretraining.

## Pretraining Memory Example

A model can sometimes skip the intended path if the final fact is famous. For example, a question may ask the solver to resolve several attributes before identifying a widely known public record, then ask for that record's creator. A strong model may know the creator already, so the tool path did not matter.

Repair this by changing the terminal to something the tools must provide, such as a stable code from the supplied data, an exact count, a derived statistic, or a less public relationship in the graph.

## Keep Or Drop

Keep the candidate when:

- The tool path is necessary.
- The answer is unique and stable.
- The verification can reject near misses.
- The question reflects a realistic analysis task.

Drop or rewrite it when:

- The answer can be guessed without the tools.
- The wording is ambiguous.
- The answer is subjective or drifting.
- The verification is loose enough to accept approximations.
